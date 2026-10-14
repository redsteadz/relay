/**
 * Resolving the clauses a classification pass could not decide.
 *
 * Phase one is deterministic, synchronous and free: `classificationPass` files everything it can and
 * reports what is blocked on a model. Phase two is this — it asks the configured endpoint about each
 * blocked capture, records what it disclosed, and hands the answers back so the pass can be re-run
 * with them. [ADR-0019](../../../docs/decisions/0019-device-semantic-evaluation.md).
 *
 * Splitting it this way is what keeps ADR-0003's ordering load-bearing rather than decorative: a
 * capture only reaches a model if every literal predicate already matched, so the number of requests
 * is bounded by what the reader's own rules actually selected rather than by how many notifications
 * arrived.
 */

import type { ClassifiableRule, FilterDecision } from "@relay/domain";
import * as Crypto from "expo-crypto";

import {
  classificationItemFor,
  type AwaitingModel,
} from "@/features/inbox/models/deviceClassification";

import { evaluateDeviceSemanticClause, type DeviceSemanticResult } from "./device-semantic";
// Imported from the modules directly rather than through `./local-store`, whose barrel re-exports
// `database` and therefore pulls in `expo-sqlite` and React Native. This module has to stay loadable
// in a plain test runtime, so it takes the store as a parameter and never opens one.
import type { LocalStore } from "./local-store/database";
import { recordDeviceDisclosure } from "./local-store/disclosures";
import { logMobileError } from "./observability";

/**
 * How many clauses one pass will resolve.
 *
 * A cold start with a backlog could otherwise fire a request per capture at a model that answers in
 * seconds. The rest stay awaiting a model and are picked up next pass, which is the same way the
 * derivation pass bounds itself.
 */
export const DEVICE_SEMANTIC_PASS_LIMIT = 8;

export type SemanticFilingResult = {
  /** Answers by capture, then by rule, in the shape `classificationPass` takes back. */
  decisions: Map<string, Map<string, FilterDecision>>;
  /** How many clauses were asked about, for a caller deciding whether anything changed. */
  evaluated: number;
};

/**
 * Asks the configured model about each blocked capture.
 *
 * Every outcome is recorded, including the ones that sent nothing, because a disclosure history that
 * only lists successes does not say what was attempted. A failure contributes `undecided`, which
 * `classifyCapture` treats as no answer at all, so the capture stays blocked rather than being filed
 * on a guess.
 *
 * Never throws. This runs beside a pass whose whole job is to make progress where it can, and a
 * model that is unreachable must not take the deterministic filing down with it.
 */
export async function resolveAwaitingModel(
  pending: readonly AwaitingModel[],
  rules: readonly ClassifiableRule[],
  options: {
    config: unknown;
    database: LocalStore;
    fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
    limit?: number;
    tenantId: string;
  },
): Promise<SemanticFilingResult> {
  const decisions = new Map<string, Map<string, FilterDecision>>();
  if (options.config === undefined) return { decisions, evaluated: 0 };

  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const bounded = pending.slice(0, options.limit ?? DEVICE_SEMANTIC_PASS_LIMIT);
  let evaluated = 0;

  for (const entry of bounded) {
    const clause = byId.get(entry.filterRuleId)?.plan.semantic;
    // A capture can be blocked by something other than a clause this phase can resolve, and a rule
    // can have gone away since the pass ran. Neither is an error; there is simply nothing to ask.
    if (clause === undefined) continue;

    let result: DeviceSemanticResult;
    try {
      result = await evaluateDeviceSemanticClause(
        clause,
        classificationItemFor(entry.capture),
        options.config,
        options.fetcher === undefined ? {} : { fetcher: options.fetcher },
      );
    } catch (error: unknown) {
      // `evaluateDeviceSemanticClause` reports its own failures as outcomes, so reaching here is a
      // programming error rather than a network one. It still must not stop the pass.
      logMobileError("semantic.device_evaluation_threw", error, {
        code: "DEVICE_SEMANTIC_EVALUATION_THREW",
        integration: "device-semantic",
        operation: "evaluateDeviceSemanticClause",
      });
      continue;
    }

    evaluated += 1;
    const forCapture =
      decisions.get(entry.capture.sourceItemId) ?? new Map<string, FilterDecision>();
    forCapture.set(entry.filterRuleId, result.decision);
    decisions.set(entry.capture.sourceItemId, forCapture);

    try {
      await recordDeviceDisclosure(options.database, options.tenantId, {
        filterRuleId: entry.filterRuleId,
        id: Crypto.randomUUID(),
        result,
        sourceItemId: entry.capture.sourceItemId,
      });
    } catch (error: unknown) {
      // The request already happened, so failing to record it is the one failure here worth
      // reporting: it means something was disclosed that the history will not account for.
      logMobileError("semantic.device_disclosure_unrecorded", error, {
        code: "DEVICE_SEMANTIC_DISCLOSURE_UNRECORDED",
        integration: "device-semantic",
        metadata: { disclosed: result.disclosure !== undefined },
        operation: "recordDeviceDisclosure",
      });
    }
  }

  return { decisions, evaluated };
}
