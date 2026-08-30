import {
  sha256FingerprintSchema,
  sourceEventSetSchema,
  type SourceEventSet,
} from "@relay/contracts";

import { supabaseBackendHeaders, type PersistenceConfiguration } from "./configuration";

export type EventPersistenceResult =
  "duplicate" | "event-integrity-conflict" | "facts-missing" | "source-missing" | "stored";

export class EventPersistenceError extends Error {
  constructor(
    readonly reason:
      | "event_persistence_conflict"
      | "event_persistence_response_invalid"
      | "event_persistence_unavailable",
  ) {
    super("Event persistence failed");
  }
}

export async function parseEventPersistenceResponse(
  response: Response,
): Promise<EventPersistenceResult> {
  if (!response.ok) {
    throw new EventPersistenceError(
      response.status === 409 ? "event_persistence_conflict" : "event_persistence_unavailable",
    );
  }
  const result = await response.json<unknown>().catch(() => undefined);
  if (
    result === "stored" ||
    result === "duplicate" ||
    result === "event-integrity-conflict" ||
    result === "facts-missing" ||
    result === "source-missing"
  ) {
    return result;
  }
  throw new EventPersistenceError("event_persistence_response_invalid");
}

export async function persistSourceEventSet(
  configuration: PersistenceConfiguration,
  userId: string,
  candidate: SourceEventSet,
  factSetFingerprint: string,
  eventSetFingerprint: string,
): Promise<EventPersistenceResult | "local"> {
  const eventSet = sourceEventSetSchema.safeParse(candidate);
  const factFingerprint = sha256FingerprintSchema.safeParse(factSetFingerprint);
  const eventFingerprint = sha256FingerprintSchema.safeParse(eventSetFingerprint);
  if (!eventSet.success || !factFingerprint.success || !eventFingerprint.success) {
    throw new EventPersistenceError("event_persistence_response_invalid");
  }
  if (configuration.supabase === undefined) return "local";

  const response = await fetch(`${configuration.supabase.url}/rest/v1/rpc/persist_source_events`, {
    method: "POST",
    headers: supabaseBackendHeaders(configuration.supabase.serviceRoleKey),
    body: JSON.stringify({
      p_events: eventSet.data.events,
      p_event_set_fingerprint: eventFingerprint.data,
      p_extractor_version: eventSet.data.extractorVersion,
      p_fact_set_fingerprint: factFingerprint.data,
      p_normalizer_version: eventSet.data.normalizerVersion,
      p_source_item_id: eventSet.data.sourceItemId,
      p_user_id: userId,
    }),
  });
  return parseEventPersistenceResponse(response);
}
