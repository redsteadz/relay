import type { ClassifiableRule, FilterDecision } from "@relay/domain";

import { readDeviceSemanticConfig } from "@/lib/device-semantic-config";
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
 * reads as "no new information" and leaves its deterministic result standing.
 */
export async function resolveAwaitingModelForTenant(
  tenantId: string,
  pending: readonly AwaitingModel[],
  rules: readonly ClassifiableRule[],
): Promise<Map<string, Map<string, FilterDecision>> | undefined> {
  const config = await readDeviceSemanticConfig(tenantId);
  if (config === undefined || !localStoreSupported()) return undefined;

  const database = await openLocalStore();
  const resolved = await resolveAwaitingModel(pending, rules, { config, database, tenantId });
  return resolved.evaluated === 0 ? undefined : resolved.decisions;
}
