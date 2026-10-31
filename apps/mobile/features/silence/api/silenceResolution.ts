import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClassifiableRule } from "@relay/domain";

import { classifiableRules } from "@/features/inbox/models/deviceClassification";
import { listFilterRevisions } from "@/features/filters/api/filters";
import { readDeviceSemanticConfig } from "@/lib/device-semantic-config";
import { localStoreSupported, openLocalStore } from "@/lib/local-store";
import {
  resolvePendingSilences,
  type SilenceCandidateContent,
} from "@/lib/notification-silence-resolution";
import RelayDeviceIngress, { PENDING_SILENCE_LIMIT } from "@/modules/relay-device-ingress";

/**
 * Where a pass got to, and what it did with each candidate.
 *
 * A pass has five ways of doing nothing and used to report all of them as the number `0`: no
 * candidate was offered, no model is configured, no store is available, the rule behind a
 * candidate has gone, or the device no longer holds what the notification said. Only the last two
 * are visible anywhere else, and only since `SilenceSkip` existed. A number told a reader nothing
 * about which, so this says.
 *
 * Content-free: a stage name and counts.
 */
export type QuietPassReport = {
  acted: number;
  /** How many candidates the device offered -- already filtered to ones still in the shade. */
  candidates: number;
  /** Verdict counts, by what the device recorded. */
  decided: Record<string, number>;
  /** How many candidates a model was actually asked about. */
  evaluated: number;
  /** How far the pass got before it had nothing left to do. */
  stage: "no-candidates" | "no-model" | "no-store" | "ran";
  /** Why the rest were passed over, by reason. */
  skipped: Record<string, number>;
};

function tally(values: Iterable<string>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

/**
 * The deferred half of quieting, with this tenant's candidates, endpoint and store looked up.
 *
 * Separate from `resolvePendingSilences` because opening a store reaches `expo-sqlite` and reading
 * candidates reaches the native module, and that function has to stay loadable in a plain test
 * runtime. The division is the useful one anyway: the resolver asks a model and hands the answer
 * over, and this decides which candidates, which endpoint, and which store.
 *
 * Reads candidates before anything else, because that read is local and cheap and is almost always
 * empty. A reader with no semantic quiet rule pays one SQLite query per pass and nothing more -- no
 * endpoint lookup, no revision fetch, no model request.
 *
 * `rules` is passed in by a caller that already has them, and fetched otherwise, so the inbox does
 * not repeat a read it just performed and the background task does not need a React tree to get one.
 *
 * Reports rather than counts, so a diagnostic can run a real pass -- not a simulation of one --
 * and see every stage of it. `resolvePendingSilencesForTenant` reduces this to the one number its
 * callers want.
 */
export async function runQuietPass(
  client: SupabaseClient,
  tenantId: string,
  rules?: readonly ClassifiableRule[],
): Promise<QuietPassReport> {
  const empty = { acted: 0, decided: {}, evaluated: 0, skipped: {} };
  const candidates = await RelayDeviceIngress.getPendingNotificationSilences(
    tenantId,
    PENDING_SILENCE_LIMIT,
  );
  if (candidates.length === 0) return { ...empty, candidates: 0, stage: "no-candidates" };

  const config = await readDeviceSemanticConfig(tenantId);
  if (config === undefined) {
    return { ...empty, candidates: candidates.length, stage: "no-model" };
  }
  if (!localStoreSupported()) {
    return { ...empty, candidates: candidates.length, stage: "no-store" };
  }

  // The device's own retained copy of what each notification said. A capture that was uploaded and
  // acknowledged still has it: retention is kept separately from the outbox so forgetting one does
  // not forget the other.
  const retained = await RelayDeviceIngress.getRetainedCaptureContent(
    tenantId,
    candidates.map((candidate) => candidate.envelopeId),
  );

  const database = await openLocalStore();
  const resolution = await resolvePendingSilences(
    candidates,
    rules ?? classifiableRules(await listFilterRevisions(client)),
    {
      config,
      content: new Map<string, SilenceCandidateContent>(Object.entries(retained)),
      database,
      resolve: async (envelopeId, matched) =>
        (await RelayDeviceIngress.resolveNotificationSilence(tenantId, envelopeId, matched)) ??
        null,
      tenantId,
    },
  );

  let acted = 0;
  for (const decision of resolution.recorded.values()) {
    if (decision === "snoozed" || decision === "dismissed") acted += 1;
  }
  return {
    acted,
    candidates: candidates.length,
    decided: tally(resolution.recorded.values()),
    evaluated: resolution.evaluated,
    skipped: tally(resolution.skipped.values()),
    stage: "ran",
  };
}

/** The pass as its callers want it: how many notifications were acted on, and nothing else. */
export async function resolvePendingSilencesForTenant(
  client: SupabaseClient,
  tenantId: string,
  rules?: readonly ClassifiableRule[],
): Promise<number> {
  return (await runQuietPass(client, tenantId, rules)).acted;
}
