/**
 * Finishing the quiet decisions the listener could not make.
 *
 * `RelayNotificationListenerService` runs in a process the system binds, with no session and no
 * credential, and it cannot reach an endpoint. So a rule carrying a semantic clause records
 * `awaiting-model` against the notification and leaves it alone, and this is the pass that comes
 * back: it asks the reader's own model, records what it disclosed, and hands the answer to the
 * device, which decides what the answer permits.
 *
 * The deferral is real and worth stating plainly. Quieting a notification this way happens when the
 * app next runs a pass -- on open, or on the background delivery task's fifteen-minute floor -- not
 * when the notification arrives. A notification the reader already dealt with is recorded as
 * `no-longer-posted` rather than pretended about. The alternative was driving Expo's headless app
 * loader from the listener, which needs a custom `TaskConsumer` deep in Expo internals whose failure
 * mode only appears on hardware; a late act that is honest about being late is the better trade.
 *
 * Nothing here decides whether Relay may act. `resolveNotificationSilence` re-reads the rule, the
 * stop and the application scope natively before touching anything, so a model's answer narrows what
 * the reader already authorized and can never widen it --
 * [ADR-0003](../../../docs/decisions/0003-deterministic-before-ai.md)'s ordering kept intact across
 * the boundary the deferral introduced. See
 * [ADR-0019](../../../docs/decisions/0019-device-semantic-evaluation.md).
 */

import { filterItem, type ClassifiableRule } from "@relay/domain";
import * as Crypto from "expo-crypto";

import { evaluateDeviceSemanticClause, type DeviceSemanticResult } from "./device-semantic";
// Imported from the module directly rather than through `./local-store`, whose barrel re-exports
// `database` and so pulls in `expo-sqlite` and React Native. This module takes its store and its
// native calls as parameters and must stay loadable in a plain test runtime.
import type { LocalStore } from "./local-store/database";
import { recordDeviceDisclosure } from "./local-store/disclosures";
import { logMobileError } from "./observability";

/** One notification whose rule is waiting on a model, as the device reports it. */
export type SilenceCandidate = {
  applicationId: string;
  envelopeId: string;
  filterRuleId: string;
};

/** What this device kept of a notification: the visible title and text, and nothing else. */
export type SilenceCandidateContent = {
  body?: string;
  subject?: string;
};

export type SilenceResolution = {
  /** How many candidates a model was actually asked about. */
  evaluated: number;
  /** What the device recorded, by envelope, so a caller can report without deciding. */
  recorded: Map<string, string>;
};

/**
 * The record the clause is evaluated against.
 *
 * Built from what the device itself kept rather than from an inbox item, because a candidate exists
 * whether or not the capture has been uploaded, filed, or even seen. `source.kind` is fixed: the
 * only thing that can be quieted is a notification.
 */
function candidateItem(
  candidate: SilenceCandidate,
  content: SilenceCandidateContent,
): Record<string, unknown> {
  return filterItem({
    attributes: {},
    ...(content.body === undefined ? {} : { body: content.body }),
    source: { applicationId: candidate.applicationId, kind: "notification" },
    ...(content.subject === undefined ? {} : { subject: content.subject }),
  });
}

/**
 * Asks the configured model about each candidate and hands the answer to the device.
 *
 * `undecided` is the one answer that is not handed over at all: the candidate keeps its row and a
 * later pass tries again, which is what makes a model that is unreachable cost a delay rather than a
 * decision. A local endpoint is only reachable while the phone is on that network, so "the reader
 * left the house" belongs in that case rather than in an error.
 *
 * Never throws. It runs beside work whose job is to make progress where it can, and a model that is
 * unreachable must not take the rest of a pass down with it.
 */
export async function resolvePendingSilences(
  candidates: readonly SilenceCandidate[],
  rules: readonly ClassifiableRule[],
  options: {
    config: unknown;
    /** What the device retained, by envelope. A candidate with no content is not asked about. */
    content: ReadonlyMap<string, SilenceCandidateContent>;
    database: LocalStore;
    fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
    /** The native call that decides what the answer permits and records the verdict. */
    resolve: (envelopeId: string, matched: boolean) => Promise<string | null>;
    tenantId: string;
  },
): Promise<SilenceResolution> {
  const recorded = new Map<string, string>();
  if (options.config === undefined) return { evaluated: 0, recorded };

  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  let evaluated = 0;

  for (const candidate of candidates) {
    const clause = byId.get(candidate.filterRuleId)?.plan.semantic;
    // A rule that has gone away, or one whose clause this pass cannot see, is left for the device to
    // decline on its own terms. Guessing here would be answering for a rule that no longer exists.
    if (clause === undefined) continue;

    const content = options.content.get(candidate.envelopeId);
    // Retention is thirty days and bounded by size, so a candidate can outlive its own content. A
    // clause cannot be evaluated against nothing, and inventing an empty subject would answer the
    // question "is this urgent?" about a notification nobody can read.
    if (content === undefined) continue;

    let result: DeviceSemanticResult;
    try {
      result = await evaluateDeviceSemanticClause(
        clause,
        candidateItem(candidate, content),
        options.config,
        options.fetcher === undefined ? {} : { fetcher: options.fetcher },
      );
    } catch (error: unknown) {
      // `evaluateDeviceSemanticClause` reports its own failures as outcomes, so reaching here is a
      // programming error rather than a network one. It still must not stop the pass.
      logMobileError("silence.device_evaluation_threw", error, {
        code: "SILENCE_DEVICE_EVALUATION_THREW",
        integration: "device-semantic",
        operation: "evaluateDeviceSemanticClause",
      });
      continue;
    }

    evaluated += 1;

    // Before acting, because a request that happened and was not recorded is the failure that
    // matters here: something left the device that the disclosure history will not account for.
    try {
      await recordDeviceDisclosure(options.database, options.tenantId, {
        filterRuleId: candidate.filterRuleId,
        id: Crypto.randomUUID(),
        result,
        sourceItemId: candidate.envelopeId,
      });
    } catch (error: unknown) {
      logMobileError("silence.device_disclosure_unrecorded", error, {
        code: "SILENCE_DEVICE_DISCLOSURE_UNRECORDED",
        integration: "device-semantic",
        metadata: { disclosed: result.disclosure !== undefined },
        operation: "recordDeviceDisclosure",
      });
    }

    // No answer is not an answer of no. Handing `undecided` over as `matched: false` would record a
    // miss the model never reported and close a candidate that deserves another pass.
    if (result.decision === "undecided") continue;

    try {
      const decision = await options.resolve(candidate.envelopeId, result.decision === "match");
      if (decision !== null) recorded.set(candidate.envelopeId, decision);
    } catch (error: unknown) {
      logMobileError("silence.resolution_failed", error, {
        code: "SILENCE_RESOLUTION_FAILED",
        integration: "device-ingress",
        metadata: { matched: result.decision === "match" },
        operation: "resolveNotificationSilence",
      });
    }
  }

  return { evaluated, recorded };
}
