import {
  ingressQueueMessageSchema,
  relayUserIdSchema,
  type DeadLetterFailureCode,
  type IngressEnvelope,
} from "@relay/contracts";
import { decryptValue } from "@relay/crypto";
import { contentFingerprint, sourceIdentity } from "@relay/domain";

import {
  readPersistenceConfiguration,
  supabaseBackendHeaders,
  type PersistenceConfiguration,
} from "./configuration";
import { base64ToPostgresBytea, sourceItemEncryptionContext } from "./encryption";
import type { Env, IngressQueueMessage } from "./env";
import { recordPipelineMetric } from "./metrics";
import {
  parseDecryptedIngressEnvelope,
  parseSourcePersistenceResponse,
  SourcePersistenceError,
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
    await storage.put(`${E2E_RESULT_PREFIX}${message.data.envelopeId}`, {
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
 * digest (`^[0-9a-f]{64}$`, enforced by `persist_encrypted_source_item_v2`), so the algorithm
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
  envelope: IngressEnvelope,
  fingerprint: string,
): Promise<"stored" | "duplicate" | "local"> {
  if (configuration.supabase === undefined) return "local";

  const response = await fetch(
    `${configuration.supabase.url}/rest/v1/rpc/persist_encrypted_source_item_v2`,
    {
      method: "POST",
      headers: supabaseBackendHeaders(configuration.supabase.serviceRoleKey),
      body: JSON.stringify({
        p_application_id: envelope.source.applicationId ?? null,
        p_accepted_at: message.acceptedAt,
        p_captured_at: envelope.capturedAt,
        p_content_fingerprint: fingerprint,
        p_encryption_environment: configuration.environment,
        p_external_id: envelope.source.externalId,
        p_id: envelope.id,
        p_key_version: message.encrypted.keyVersion,
        p_occurred_at: envelope.occurredAt,
        p_raw_ciphertext: base64ToPostgresBytea(message.encrypted.ciphertext),
        p_raw_expires_at: message.rawExpiresAt,
        p_raw_nonce: base64ToPostgresBytea(message.encrypted.nonce),
        p_source: envelope.source.kind,
        p_source_account_id: envelope.source.accountId ?? null,
        p_user_id: message.userId,
        p_wrap_nonce: base64ToPostgresBytea(message.encrypted.wrapNonce),
        p_wrapped_data_key: base64ToPostgresBytea(message.encrypted.wrappedKey),
      }),
    },
  );

  return parseSourcePersistenceResponse(response);
}

/**
 * Processes one ingress Queue message inside a tenant's serialized Durable Object turn.
 *
 * Dedup has two layers, matching `docs/architecture/data-flow.md`:
 *  - DO-local storage cache (`source:`/`fingerprint:` keys) is a fast path that survives DO restarts
 *    because `DurableObjectStorage` is durable, not in-memory — only the caller's `SerialExecutor`
 *    ordering resets on restart, never this state.
 *  - Supabase unique constraints on `source_items` remain final arbitration. A message that reaches
 *    `persist` and gets `"duplicate"` back never populates the local cache (see
 *    `docs/architecture/data-flow.md`: "Database conflicts do not populate candidate Durable Object
 *    identity or fingerprint markers"), so a lost HTTP response after a committed DB insert is safe:
 *    the retry re-derives identity/fingerprint, calls `persist` again, and the unique constraint
 *    converts the second attempt into a `"duplicate"` result. Exactly one row survives either way.
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
  if (Date.parse(message.rawExpiresAt) <= Date.now()) {
    return Response.json({ accepted: false, reason: "expired" }, { status: 410 });
  }

  const identity = sourceIdentity(envelope);
  const fingerprint = await contentFingerprint(envelope);
  const identityKey = `source:${identity}`;
  const fingerprintKey = `fingerprint:${fingerprint}`;
  const [seenIdentity, seenFingerprint] = await Promise.all([
    storage.get(identityKey),
    storage.get(fingerprintKey),
  ]);
  if (seenIdentity !== undefined || seenFingerprint !== undefined) {
    if (env.RELAY_E2E_MODE === "true") {
      await storage.put(`${E2E_RESULT_PREFIX}${message.envelopeId}`, {
        keyVersion: message.encrypted.keyVersion,
        status: seenIdentity !== undefined ? "duplicate-source" : "duplicate-fingerprint",
      } satisfies E2EResult);
    }
    recordPipelineMetric(
      env.PIPELINE_METRICS,
      "source_item_duplicate",
      1,
      performance.now() - startedAt,
    );
    return Response.json({ accepted: false, reason: "duplicate" });
  }

  let persistence: "stored" | "duplicate" | "local";
  try {
    persistence = await persist(configuration, message, envelope, fingerprint);
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
  recordPipelineMetric(
    env.PIPELINE_METRICS,
    persistence === "duplicate" ? "source_item_duplicate" : "source_item_persisted",
    1,
    performance.now() - startedAt,
  );
  const now = Date.now();
  const records: Record<string, unknown> = {};
  if (persistence !== "duplicate") {
    records[identityKey] = now;
    records[fingerprintKey] = now;
  }
  if (persistence === "local") {
    const expiresAt = Date.parse(message.rawExpiresAt);
    records[`source-item:${message.envelopeId}`] = { encrypted: message.encrypted, expiresAt };
    const alarm = await storage.getAlarm();
    if (alarm === null || alarm > expiresAt) await storage.setAlarm(expiresAt);
  }
  if (env.RELAY_E2E_MODE === "true") {
    records[`${E2E_RESULT_PREFIX}${message.envelopeId}`] = {
      keyVersion: message.encrypted.keyVersion,
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
  if (nextExpiry !== undefined) await storage.setAlarm(nextExpiry);
}
