import { sha256FingerprintSchema, sourceFactSetSchema, type SourceFactSet } from "@relay/contracts";

import { supabaseBackendHeaders, type PersistenceConfiguration } from "./configuration";

export type FactPersistenceResult =
  "duplicate" | "fact-integrity-conflict" | "source-missing" | "stored";

export class FactPersistenceError extends Error {
  constructor(
    readonly reason:
      | "fact_persistence_conflict"
      | "fact_persistence_response_invalid"
      | "fact_persistence_unavailable",
  ) {
    super("Fact persistence failed");
  }
}

export async function parseFactPersistenceResponse(
  response: Response,
): Promise<FactPersistenceResult> {
  if (!response.ok) {
    throw new FactPersistenceError(
      response.status === 409 ? "fact_persistence_conflict" : "fact_persistence_unavailable",
    );
  }
  const result = await response.json<unknown>().catch(() => undefined);
  if (
    result === "stored" ||
    result === "duplicate" ||
    result === "fact-integrity-conflict" ||
    result === "source-missing"
  ) {
    return result;
  }
  throw new FactPersistenceError("fact_persistence_response_invalid");
}

export async function persistSourceFactSet(
  configuration: PersistenceConfiguration,
  userId: string,
  candidate: SourceFactSet,
  factSetFingerprint: string,
): Promise<FactPersistenceResult | "local"> {
  const factSet = sourceFactSetSchema.safeParse(candidate);
  const fingerprint = sha256FingerprintSchema.safeParse(factSetFingerprint);
  if (!factSet.success || !fingerprint.success) {
    throw new FactPersistenceError("fact_persistence_response_invalid");
  }
  if (configuration.supabase === undefined) return "local";

  const response = await fetch(`${configuration.supabase.url}/rest/v1/rpc/persist_source_facts`, {
    method: "POST",
    headers: supabaseBackendHeaders(configuration.supabase.serviceRoleKey),
    body: JSON.stringify({
      p_facts: factSet.data.facts,
      p_fact_set_fingerprint: fingerprint.data,
      p_normalizer_version: factSet.data.normalizerVersion,
      p_source_item_id: factSet.data.sourceItemId,
      p_user_id: userId,
    }),
  });
  return parseFactPersistenceResponse(response);
}
