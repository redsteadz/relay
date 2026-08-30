import {
  canonicalUuidSchema,
  ingressQueueMessageSchema,
  relayUserIdSchema,
  type DeadLetterFailureCode,
  type IngressEnvelope,
  type SourceEventSet,
  type SourceFactSet,
} from "@relay/contracts";
import { decryptValue, encryptValue } from "@relay/crypto";
import {
  contentFingerprint,
  extractSourceEvents,
  normalizeSourceFacts,
  sourceEventSetFingerprint,
  sourceFactSetFingerprint,
  sourceIdentity,
} from "@relay/domain";

import { scheduleEarlierAlarm } from "./alarms";
import {
  readPersistenceConfiguration,
  supabaseBackendHeaders,
  type PersistenceConfiguration,
} from "./configuration";
import { base64ToPostgresBytea, sourceItemEncryptionContext } from "./encryption";
import type { Env, IngressQueueMessage } from "./env";
import { EventPersistenceError, persistSourceEventSet } from "./events";
import { FactPersistenceError, persistSourceFactSet } from "./facts";
import { recordPipelineMetric } from "./metrics";
import {
  parseDecryptedIngressEnvelope,
  parseSourcePersistenceV3Response,
  SourcePersistenceError,
  type SourcePersistenceV3Result,
} from "./persistence";

// Pure Durable Object logic, deliberately isolated from `coordinator.ts`. The real
// `TenantCoordinator` class imports the `cloudflare:workers` runtime module, which only resolves
// inside the Workers runtime (Miniflare/`wrangler dev`/production), not under plain Vitest. Keeping
// every actual decision here — with `DurableObjectStorage` accepted as a plain parameter rather than
// read off `this.ctx` — lets tests exercise real dedup, restart, and race behavior against an
// in-memory fake storage without needing the Workers test runtime. `coordinator.ts` must stay a thin
// adapter: add new behavior here, not there.

type LocalSourceRecord = {
  encrypted: IngressQueueMessage["encrypted"];
  expiresAt: number;
};

type DurableFactDedupMarker = {
  factSetFingerprint: string;
  sourceItemId: string;
};

type DurableDedupMarker = DurableFactDedupMarker & {
  eventSetFingerprint: string;
  extractorVersion: number;
  normalizerVersion: number;
};

type DurableFactSourceBinding = DurableFactDedupMarker & {
  contentFingerprint: string;
  sourceIdentity: string;
};

type DurableSourceBinding = DurableFactSourceBinding & DurableDedupMarker;

function durableFactDedupMarker(value: unknown): DurableFactDedupMarker | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const marker = value as Record<string, unknown>;
  return typeof marker.factSetFingerprint === "string" && typeof marker.sourceItemId === "string"
    ? { factSetFingerprint: marker.factSetFingerprint, sourceItemId: marker.sourceItemId }
    : undefined;
}

function durableDedupMarker(value: unknown): DurableDedupMarker | undefined {
  const marker = durableFactDedupMarker(value);
  if (marker === undefined || typeof value !== "object" || value === null) return undefined;
  const eventMarker = value as Record<string, unknown>;
  return typeof eventMarker.eventSetFingerprint === "string" &&
    typeof eventMarker.extractorVersion === "number" &&
    typeof eventMarker.normalizerVersion === "number"
    ? {
        ...marker,
        eventSetFingerprint: eventMarker.eventSetFingerprint,
        extractorVersion: eventMarker.extractorVersion,
        normalizerVersion: eventMarker.normalizerVersion,
      }
    : undefined;
}

function durableFactSourceBinding(value: unknown): DurableFactSourceBinding | undefined {
  const marker = durableFactDedupMarker(value);
  if (marker === undefined || typeof value !== "object" || value === null) return undefined;
  const binding = value as Record<string, unknown>;
  return typeof binding.contentFingerprint === "string" &&
    typeof binding.sourceIdentity === "string"
    ? {
        ...marker,
        contentFingerprint: binding.contentFingerprint,
        sourceIdentity: binding.sourceIdentity,
      }
    : undefined;
}

function durableSourceBinding(value: unknown): DurableSourceBinding | undefined {
  const marker = durableDedupMarker(value);
  const binding = durableFactSourceBinding(value);
  return marker === undefined || binding === undefined ? undefined : { ...binding, ...marker };
}

export const E2E_RESULT_PREFIX = "e2e-result:";

export type E2EResult = {
  keyVersion: number;
  status:
    | "dead-letter"
    | "duplicate-database"
    | "duplicate-fingerprint"
    | "duplicate-source"
    | "persisted";
};

function failureResponse(failureCode: DeadLetterFailureCode): Response {
  return Response.json({ accepted: false, failureCode }, { status: 503 });
}

export async function handleE2EResultRequest(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET") {
    const envelopeId = relayUserIdSchema.safeParse(url.searchParams.get("envelopeId"));
    if (!envelopeId.success) return new Response("Invalid", { status: 400 });
    const result = await storage.get<E2EResult>(`${E2E_RESULT_PREFIX}${envelopeId.data}`);
    return result === undefined
      ? new Response("Not found", { status: 404 })
      : Response.json(result);
  }
  if (request.method === "POST") {
    const message = ingressQueueMessageSchema.safeParse(
      await request.json<unknown>().catch(() => undefined),
    );
    if (!message.success) return new Response("Invalid", { status: 400 });
    const envelopeId = relayUserIdSchema.parse(message.data.envelopeId);
    await storage.put(`${E2E_RESULT_PREFIX}${envelopeId}`, {
      keyVersion: message.data.encrypted.keyVersion,
      status: "dead-letter",
    } satisfies E2EResult);
    return new Response(null, { status: 204 });
  }
  return new Response("Method not allowed", { status: 405 });
}

/**
 * Content fingerprint canonicalization, algorithm version 1.
 *
 * The wire format persisted to `source_items.content_fingerprint` is a bare lowercase hex SHA-256
 * digest (`^[0-9a-f]{64}$`, enforced by `persist_encrypted_source_item_v3`), so the algorithm
 * version cannot be embedded in the string itself. This constant is the canonical record of which
 * canonicalization rule produced fingerprints written under that constraint. See
 * `contentFingerprint` in `packages/domain/src/index.ts` for the exact field selection, separator,
 * and normalization steps this version number refers to.
 *
 * Bumping this is an algorithm change, not a formatting tweak: existing rows keep whatever hash an
 * older version produced, so a bump must ship with a migration plan for previously-persisted
 * fingerprints (recompute-and-compare or accept a dedupe gap across the boundary) rather than a
 * silent behavior change here.
 */
export const CONTENT_FINGERPRINT_ALGORITHM_VERSION = 1 as const;

async function persist(
  configuration: PersistenceConfiguration,
  message: IngressQueueMessage,
  encrypted: IngressQueueMessage["encrypted"],
  userId: string,
  envelope: IngressEnvelope,
  fingerprint: string,
  factSetFingerprint: string,
): Promise<SourcePersistenceV3Result | "local"> {
  if (configuration.supabase === undefined) return "local";

  const gmailConnectionId =
    envelope.source.kind === "gmail"
      ? canonicalUuidSchema.safeParse(envelope.source.accountId)
      : undefined;
  if (gmailConnectionId !== undefined && !gmailConnectionId.success) {
    throw new SourcePersistenceError("tenant_id_conflict");
  }
  const rpc = gmailConnectionId?.success
    ? "persist_encrypted_source_item_v4"
    : "persist_encrypted_source_item_v3";

  const response = await fetch(`${configuration.supabase.url}/rest/v1/rpc/${rpc}`, {
    method: "POST",
    headers: supabaseBackendHeaders(configuration.supabase.serviceRoleKey),
    body: JSON.stringify({
      p_application_id: envelope.source.applicationId ?? null,
      p_accepted_at: message.acceptedAt,
      p_captured_at: envelope.capturedAt,
      ...(gmailConnectionId?.success ? { p_connection_id: gmailConnectionId.data } : {}),
      p_content_fingerprint: fingerprint,
      p_encryption_environment: configuration.environment,
      p_external_id: envelope.source.externalId,
      p_fact_set_fingerprint: factSetFingerprint,
      p_id: envelope.id,
      p_key_version: encrypted.keyVersion,
      p_occurred_at: envelope.occurredAt,
      p_raw_ciphertext: base64ToPostgresBytea(encrypted.ciphertext),
      p_raw_expires_at: message.rawExpiresAt,
      p_raw_nonce: base64ToPostgresBytea(encrypted.nonce),
      p_source: envelope.source.kind,
      p_source_account_id: envelope.source.accountId ?? null,
      p_user_id: userId,
      p_wrap_nonce: base64ToPostgresBytea(encrypted.wrapNonce),
      p_wrapped_data_key: base64ToPostgresBytea(encrypted.wrappedKey),
    }),
  });

  return parseSourcePersistenceV3Response(response);
}

/**
 * Processes one ingress Queue message inside a tenant's serialized Durable Object turn.
 *
 * Dedup has two layers, matching `docs/architecture/data-flow.md`:
 *  - DO-local storage cache (`source:`/`fingerprint:`/fact/event fingerprints/`source-binding:` keys)
 *    is a fast path that survives DO restarts. Complete markers bind source ID to source identity,
 *    content fingerprint, fact digest, and versioned event digest. Exact legacy fact-only bindings
 *    fall through for event backfill; unbound markers never decide completion.
 *  - Supabase unique constraints on `source_items` remain final arbitration. A message that reaches
 *    `persist` after a lost response re-derives every fingerprint. Exact same-ID retries may populate
 *    bound markers only after fact and event persistence converge; duplicates under another source ID
 *    do not.
 */
export async function processIngressMessage(
  storage: DurableObjectStorage,
  env: Env,
  message: IngressQueueMessage,
): Promise<Response> {
  const startedAt = performance.now();
  let configuration: PersistenceConfiguration;
  try {
    configuration = readPersistenceConfiguration(env);
  } catch {
    return failureResponse("configuration_invalid");
  }
  if (message.encryptionEnvironment !== configuration.environment) {
    return failureResponse("configuration_invalid");
  }
  if (configuration.keyring.keys[message.encrypted.keyVersion] === undefined) {
    return failureResponse("key_version_unavailable");
  }
  const context = sourceItemEncryptionContext(message.userId, message.envelopeId);
  let plaintext: string;
  try {
    plaintext = await decryptValue(message.encrypted, configuration.keyring, context);
  } catch {
    return failureResponse("ciphertext_invalid");
  }
  const envelope = parseDecryptedIngressEnvelope(plaintext, message);
  if (envelope === undefined) {
    return failureResponse("envelope_invalid");
  }
  const userId = relayUserIdSchema.safeParse(message.userId);
  if (!userId.success) return failureResponse("envelope_invalid");
  if (Date.parse(message.rawExpiresAt) <= Date.now()) {
    return Response.json({ accepted: false, reason: "expired" }, { status: 410 });
  }

  const identity = sourceIdentity(envelope);
  const fingerprint = await contentFingerprint(envelope);
  let factSet: SourceFactSet;
  let factSetFingerprint: string;
  let eventSet: SourceEventSet;
  let eventSetFingerprint: string;
  try {
    factSet = normalizeSourceFacts(envelope);
    factSetFingerprint = await sourceFactSetFingerprint(factSet);
    eventSet = extractSourceEvents(factSet);
    eventSetFingerprint = await sourceEventSetFingerprint(eventSet);
  } catch {
    return failureResponse("persistence_response_invalid");
  }
  const identityKey = `source:${identity}`;
  const fingerprintKey = `fingerprint:${fingerprint}`;
  const factSetFingerprintKey = `fact-set-fingerprint:${envelope.id}`;
  const eventSetFingerprintKey = `event-set-fingerprint:${envelope.id}:n${eventSet.normalizerVersion}:v${eventSet.extractorVersion}`;
  const sourceBindingKey = `source-binding:${envelope.id}`;
  const localSourceKey = `source-item:${envelope.id}`;
  const [
    storedFactSetFingerprint,
    storedEventSetFingerprint,
    sourceBindingValue,
    seenIdentityValue,
    seenFingerprintValue,
    localSource,
  ] = await Promise.all([
    storage.get(factSetFingerprintKey),
    storage.get(eventSetFingerprintKey),
    storage.get(sourceBindingKey),
    storage.get(identityKey),
    storage.get(fingerprintKey),
    storage.get(localSourceKey),
  ]);
  const duplicateResponse = async (
    status: "duplicate-fingerprint" | "duplicate-source",
  ): Promise<Response> => {
    if (env.RELAY_E2E_MODE === "true") {
      await storage.put(`${E2E_RESULT_PREFIX}${envelope.id}`, {
        keyVersion: message.encrypted.keyVersion,
        status,
      } satisfies E2EResult);
    }
    recordPipelineMetric(
      env.PIPELINE_METRICS,
      "source_item_duplicate",
      1,
      performance.now() - startedAt,
    );
    return Response.json({ accepted: false, reason: "duplicate" });
  };
  let needsEventBackfill = false;
  if (sourceBindingValue !== undefined) {
    const factBinding = durableFactSourceBinding(sourceBindingValue);
    if (
      factBinding === undefined ||
      factBinding.sourceItemId !== envelope.id ||
      factBinding.sourceIdentity !== identity ||
      factBinding.contentFingerprint !== fingerprint ||
      factBinding.factSetFingerprint !== factSetFingerprint ||
      typeof storedFactSetFingerprint !== "string" ||
      storedFactSetFingerprint !== factSetFingerprint
    ) {
      return failureResponse("fact_integrity_conflict");
    }
    const sourceBinding = durableSourceBinding(sourceBindingValue);
    if (sourceBinding !== undefined) {
      if (
        sourceBinding.extractorVersion === eventSet.extractorVersion &&
        sourceBinding.normalizerVersion === eventSet.normalizerVersion
      ) {
        if (
          sourceBinding.eventSetFingerprint !== eventSetFingerprint ||
          storedEventSetFingerprint !== eventSetFingerprint
        ) {
          return failureResponse("event_integrity_conflict");
        }
        return duplicateResponse("duplicate-source");
      }
      if (storedEventSetFingerprint !== undefined) {
        return storedEventSetFingerprint === eventSetFingerprint
          ? duplicateResponse("duplicate-source")
          : failureResponse("event_integrity_conflict");
      }
    }
    needsEventBackfill = true;
  }
  if (storedFactSetFingerprint !== undefined && !needsEventBackfill) {
    return failureResponse("fact_integrity_conflict");
  }
  const seenIdentity = needsEventBackfill ? undefined : durableDedupMarker(seenIdentityValue);
  if (seenIdentity !== undefined) {
    if (
      seenIdentity.sourceItemId === envelope.id &&
      seenIdentity.factSetFingerprint !== factSetFingerprint
    ) {
      return failureResponse("fact_integrity_conflict");
    }
    if (
      seenIdentity.sourceItemId === envelope.id &&
      (seenIdentity.eventSetFingerprint !== eventSetFingerprint ||
        seenIdentity.extractorVersion !== eventSet.extractorVersion ||
        seenIdentity.normalizerVersion !== eventSet.normalizerVersion)
    ) {
      return failureResponse("event_integrity_conflict");
    }
    return duplicateResponse("duplicate-source");
  }
  const seenFingerprint = needsEventBackfill ? undefined : durableDedupMarker(seenFingerprintValue);
  if (seenFingerprint !== undefined) {
    if (
      seenFingerprint.sourceItemId === envelope.id &&
      seenFingerprint.factSetFingerprint !== factSetFingerprint
    ) {
      return failureResponse("fact_integrity_conflict");
    }
    if (
      seenFingerprint.sourceItemId === envelope.id &&
      (seenFingerprint.eventSetFingerprint !== eventSetFingerprint ||
        seenFingerprint.extractorVersion !== eventSet.extractorVersion ||
        seenFingerprint.normalizerVersion !== eventSet.normalizerVersion)
    ) {
      return failureResponse("event_integrity_conflict");
    }
    return duplicateResponse("duplicate-fingerprint");
  }
  if (configuration.supabase === undefined && localSource !== undefined) {
    if (durableFactSourceBinding(sourceBindingValue) === undefined) {
      return failureResponse("fact_integrity_conflict");
    }
  }

  let durableEncrypted = message.encrypted;
  const durableContext = sourceItemEncryptionContext(userId.data, envelope.id);
  if (context !== durableContext) {
    try {
      durableEncrypted = await encryptValue(plaintext, configuration.keyring, durableContext);
    } catch {
      return failureResponse("persistence_unavailable");
    }
  }

  let persistence: SourcePersistenceV3Result | "local";
  try {
    persistence = await persist(
      configuration,
      message,
      durableEncrypted,
      userId.data,
      envelope,
      fingerprint,
      factSetFingerprint,
    );
  } catch (error) {
    recordPipelineMetric(
      env.PIPELINE_METRICS,
      "source_item_failed",
      1,
      performance.now() - startedAt,
    );
    return failureResponse(
      error instanceof SourcePersistenceError ? error.reason : "persistence_unavailable",
    );
  }
  if (persistence === "fact-integrity-conflict") {
    return failureResponse("fact_integrity_conflict");
  }
  if (persistence === "tenant-conflict") {
    return failureResponse("tenant_id_conflict");
  }
  let factPersistence:
    "duplicate" | "fact-integrity-conflict" | "local" | "source-missing" | "stored";
  try {
    factPersistence = await persistSourceFactSet(
      configuration,
      userId.data,
      factSet,
      factSetFingerprint,
    );
  } catch (error) {
    recordPipelineMetric(
      env.PIPELINE_METRICS,
      "source_item_failed",
      1,
      performance.now() - startedAt,
    );
    if (!(error instanceof FactPersistenceError)) return failureResponse("persistence_unavailable");
    return failureResponse(
      error.reason === "fact_persistence_conflict"
        ? "fact_integrity_conflict"
        : error.reason === "fact_persistence_response_invalid"
          ? "persistence_response_invalid"
          : "persistence_unavailable",
    );
  }
  if (
    factPersistence === "fact-integrity-conflict" ||
    (factPersistence === "source-missing" && persistence === "stored")
  ) {
    recordPipelineMetric(
      env.PIPELINE_METRICS,
      "source_item_failed",
      1,
      performance.now() - startedAt,
    );
    return failureResponse("fact_integrity_conflict");
  }
  let eventPersistence:
    | "duplicate"
    | "event-integrity-conflict"
    | "facts-missing"
    | "local"
    | "source-missing"
    | "stored";
  if (factPersistence === "source-missing" && persistence === "duplicate") {
    eventPersistence = "source-missing";
  } else {
    try {
      eventPersistence = await persistSourceEventSet(
        configuration,
        userId.data,
        eventSet,
        factSetFingerprint,
        eventSetFingerprint,
      );
    } catch (error) {
      recordPipelineMetric(
        env.PIPELINE_METRICS,
        "source_item_failed",
        1,
        performance.now() - startedAt,
      );
      if (!(error instanceof EventPersistenceError)) {
        return failureResponse("persistence_unavailable");
      }
      return failureResponse(
        error.reason === "event_persistence_conflict"
          ? "event_integrity_conflict"
          : error.reason === "event_persistence_response_invalid"
            ? "persistence_response_invalid"
            : "persistence_unavailable",
      );
    }
  }
  if (
    eventPersistence === "event-integrity-conflict" ||
    eventPersistence === "facts-missing" ||
    (eventPersistence === "source-missing" && persistence === "stored")
  ) {
    recordPipelineMetric(
      env.PIPELINE_METRICS,
      "source_item_failed",
      1,
      performance.now() - startedAt,
    );
    return failureResponse("event_integrity_conflict");
  }
  recordPipelineMetric(
    env.PIPELINE_METRICS,
    persistence === "duplicate" ? "source_item_duplicate" : "source_item_persisted",
    1,
    performance.now() - startedAt,
  );
  const records: Record<string, unknown> = {};
  if (
    (persistence !== "duplicate" || factPersistence !== "source-missing") &&
    eventPersistence !== "source-missing"
  ) {
    const marker = {
      eventSetFingerprint,
      extractorVersion: eventSet.extractorVersion,
      factSetFingerprint,
      normalizerVersion: eventSet.normalizerVersion,
      sourceItemId: envelope.id,
    } satisfies DurableDedupMarker;
    const sourceBinding = {
      ...marker,
      contentFingerprint: fingerprint,
      sourceIdentity: identity,
    } satisfies DurableSourceBinding;
    records[identityKey] = marker;
    records[fingerprintKey] = marker;
    records[factSetFingerprintKey] = factSetFingerprint;
    records[eventSetFingerprintKey] = eventSetFingerprint;
    records[sourceBindingKey] = sourceBinding;
  }
  if (persistence === "local") {
    const expiresAt = Date.parse(message.rawExpiresAt);
    records[localSourceKey] = { encrypted: durableEncrypted, expiresAt };
    records[`source-facts:${envelope.id}:v${factSet.normalizerVersion}`] = factSet;
    records[
      `source-events:${envelope.id}:n${eventSet.normalizerVersion}:v${eventSet.extractorVersion}`
    ] = eventSet;
    await scheduleEarlierAlarm(storage, expiresAt);
  }
  if (env.RELAY_E2E_MODE === "true") {
    records[`${E2E_RESULT_PREFIX}${envelope.id}`] = {
      keyVersion: durableEncrypted.keyVersion,
      status: persistence === "duplicate" ? "duplicate-database" : "persisted",
    } satisfies E2EResult;
  }
  if (Object.keys(records).length > 0) await storage.put(records);

  return Response.json({
    accepted: persistence !== "duplicate",
    reason: persistence === "duplicate" ? "duplicate" : "persisted",
  });
}

export async function runMaintenanceAlarm(storage: DurableObjectStorage): Promise<void> {
  const now = Date.now();
  const records = await storage.list<LocalSourceRecord>({ prefix: "source-item:" });
  const expired: string[] = [];
  let nextExpiry: number | undefined;
  for (const [key, record] of records) {
    if (record.expiresAt <= now) expired.push(key);
    else nextExpiry = Math.min(nextExpiry ?? record.expiresAt, record.expiresAt);
  }
  if (expired.length > 0) await storage.delete(expired);
  if (nextExpiry !== undefined) await scheduleEarlierAlarm(storage, nextExpiry);
}
