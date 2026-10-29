import type { ClassifiableRule, FilterDecision } from "@relay/domain";

import { readDeviceSemanticConfig } from "@/lib/device-semantic-config";
import { EMPTY_PASS_COUNTS, journaledDeviceModelPass } from "@/lib/device-semantic-diagnostics";
import { resolveAwaitingModel } from "@/lib/device-semantic-filing";
import { localStoreSupported, openLocalStore } from "@/lib/local-store";

import type { AwaitingModel } from "../models/deviceClassification";

/**
 * Phase two of filing, with this tenant's endpoint and store looked up.
 *
 * Separate from `resolveAwaitingModel` because opening a store reaches `expo-sqlite`, and that
 * function has to stay loadable in a plain test runtime. The division is the useful one anyway: the
 * resolver takes a store and a configuration, and this decides which.
 *
 * Returns nothing when there is no endpoint, no store, or nothing was answered, which the caller
 * reads as "no new information" and leaves its deterministic result standing. Each run is written to
 * the device model journal, so a capture that says "a rule needs a model to decide this one" can be
 * traced to the pass that tried, or to the gate that stopped one.
 */
export async function resolveAwaitingModelForTenant(
  tenantId: string,
  pending: readonly AwaitingModel[],
  rules: readonly ClassifiableRule[],
): Promise<Map<string, Map<string, FilterDecision>> | undefined> {
  return journaledDeviceModelPass(tenantId, "filing", "foreground", async () => {
    const config = await readDeviceSemanticConfig(tenantId);
    if (config === undefined) {
      return {
        attempts: [],
        counts: { ...EMPTY_PASS_COUNTS, candidates: pending.length },
        outcome: "not-configured",
        result: undefined,
      };
    }
    if (!localStoreSupported()) {
      return {
        attempts: [],
        counts: { ...EMPTY_PASS_COUNTS, candidates: pending.length },
        outcome: "store-unsupported",
        result: undefined,
      };
    }

    const database = await openLocalStore();
    const resolved = await resolveAwaitingModel(pending, rules, { config, database, tenantId });
    return {
      attempts: resolved.attempts,
      counts: {
        ...EMPTY_PASS_COUNTS,
        candidates: pending.length,
        evaluated: resolved.evaluated,
        skippedRuleGone: resolved.skippedRuleGone,
        undecided: resolved.undecided,
      },
      outcome: "evaluated",
      result: resolved.evaluated === 0 ? undefined : resolved.decisions,
    };
  });
}
