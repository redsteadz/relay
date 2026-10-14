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
 * Returns how many notifications were acted on, which is zero in every ordinary case: nothing
 * pending, no endpoint, a model that did not answer, an answer of no, or a notification the reader
 * already dealt with.
 */
export async function resolvePendingSilencesForTenant(
  client: SupabaseClient,
  tenantId: string,
  rules?: readonly ClassifiableRule[],
): Promise<number> {
  const candidates = await RelayDeviceIngress.getPendingNotificationSilences(
    tenantId,
    PENDING_SILENCE_LIMIT,
  );
  if (candidates.length === 0) return 0;

  const config = await readDeviceSemanticConfig(tenantId);
  if (config === undefined || !localStoreSupported()) return 0;

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
  return acted;
}
