import {
  deadLetterMetadataSchema,
  ingressQueueMessageSchema,
  type DeadLetterFailureCode,
  type DeadLetterMetadata,
  type IngressQueueMessage,
} from "@relay/contracts";

import {
  readPersistenceConfiguration,
  supabaseBackendHeaders,
  type SupabaseConfiguration,
} from "./configuration";
import { base64ToPostgresBytea, postgresByteaToBase64 } from "./encryption";
import type { Env } from "./env";
import { prepareIngressQueueMessage } from "./queue";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

function recoveryConfiguration(env: Env): SupabaseConfiguration {
  const configuration = readPersistenceConfiguration(env);
  if (configuration.supabase === undefined) {
    throw new Error("Dead-letter recovery requires Supabase configuration");
  }
  return configuration.supabase;
}

async function callRecoveryRpc(
  supabase: SupabaseConfiguration,
  rpc: string,
  body: Record<string, unknown>,
  fetcher: Fetcher,
): Promise<unknown> {
  const response = await fetcher(`${supabase.url}/rest/v1/rpc/${rpc}`, {
    method: "POST",
    headers: supabaseBackendHeaders(supabase.serviceRoleKey),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Dead-letter recovery ${rpc} failed with ${response.status.toString()}`);
  }
  return response.json<unknown>().catch(() => undefined);
}

export async function recordDeadLetterItem(
  env: Env,
  message: IngressQueueMessage,
  failureCode: DeadLetterFailureCode,
  fetcher: Fetcher = fetch,
): Promise<void> {
  const value = await callRecoveryRpc(
    recoveryConfiguration(env),
    "record_dead_letter_item",
    {
      p_accepted_at: message.acceptedAt,
      p_ciphertext: base64ToPostgresBytea(message.encrypted.ciphertext),
      p_encryption_environment: message.encryptionEnvironment,
      p_envelope_id: message.envelopeId,
      p_failure_code: failureCode,
      p_id: message.recoveryId,
      p_key_version: message.encrypted.keyVersion,
      p_nonce: base64ToPostgresBytea(message.encrypted.nonce),
      p_raw_expires_at: message.rawExpiresAt,
      p_replay_request_id: message.replayRequestId ?? null,
      p_user_id: message.userId,
      p_wrap_nonce: base64ToPostgresBytea(message.encrypted.wrapNonce),
      p_wrapped_data_key: base64ToPostgresBytea(message.encrypted.wrappedKey),
    },
    fetcher,
  );
  if (typeof value !== "boolean") throw new Error("Dead-letter record response is invalid");
}

function parseMetadata(value: unknown): DeadLetterMetadata[] {
  if (!Array.isArray(value)) throw new Error("Dead-letter inventory response is invalid");
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error("Dead-letter inventory response is invalid");
    }
    const row = entry as Record<string, unknown>;
    const parsed = deadLetterMetadataSchema.safeParse({
      id: row.id,
      envelopeId: row.envelope_id,
      failureCode: row.failure_code,
      status: row.status,
      acceptedAt: row.accepted_at,
      rawExpiresAt: row.raw_expires_at,
      keyVersion: row.key_version,
      replayCount: row.replay_count,
      firstFailedAt: row.first_failed_at,
      lastFailedAt: row.last_failed_at,
      lastReplayedAt: row.last_replayed_at,
      completedAt: row.completed_at,
    });
    if (!parsed.success) throw new Error("Dead-letter inventory response is invalid");
    return parsed.data;
  });
}

export async function listDeadLetterItems(
  env: Env,
  limit: number,
  fetcher: Fetcher = fetch,
): Promise<DeadLetterMetadata[]> {
  const value = await callRecoveryRpc(
    recoveryConfiguration(env),
    "list_dead_letter_items",
    { p_limit: limit },
    fetcher,
  );
  return parseMetadata(value);
}

function parseClaimedMessage(value: unknown, requestId: string): IngressQueueMessage | undefined {
  if (!Array.isArray(value) || value.length > 1) {
    throw new Error("Dead-letter claim response is invalid");
  }
  const entry: unknown = value[0];
  if (entry === undefined) return undefined;
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new Error("Dead-letter claim response is invalid");
  }
  const row = entry as Record<string, unknown>;
  let encrypted;
  try {
    encrypted = {
      algorithm: "AES-GCM-256" as const,
      ciphertext: postgresByteaToBase64(row.ciphertext),
      keyVersion: row.key_version,
      nonce: postgresByteaToBase64(row.nonce, 12),
      wrappedKey: postgresByteaToBase64(row.wrapped_data_key, 48),
      wrapNonce: postgresByteaToBase64(row.wrap_nonce, 12),
    };
  } catch {
    throw new Error("Dead-letter claim response is invalid");
  }
  const parsed = ingressQueueMessageSchema.safeParse({
    schemaVersion: 1,
    userId: row.user_id,
    envelopeId: row.envelope_id,
    acceptedAt: row.accepted_at,
    rawExpiresAt: row.raw_expires_at,
    encryptionEnvironment: row.encryption_environment,
    recoveryId: row.id,
    replayRequestId: requestId,
    encrypted,
  });
  if (!parsed.success) throw new Error("Dead-letter claim response is invalid");
  return parsed.data;
}

async function releaseReplay(
  supabase: SupabaseConfiguration,
  id: string,
  requestId: string,
  fetcher: Fetcher,
): Promise<void> {
  const released = await callRecoveryRpc(
    supabase,
    "release_dead_letter_replay",
    { p_id: id, p_request_id: requestId },
    fetcher,
  );
  if (typeof released !== "boolean") throw new Error("Dead-letter release response is invalid");
}

export async function replayDeadLetterItem(
  env: Env,
  id: string,
  requestId: string,
  fetcher: Fetcher = fetch,
): Promise<boolean> {
  const supabase = recoveryConfiguration(env);
  const claimed = parseClaimedMessage(
    await callRecoveryRpc(
      supabase,
      "claim_dead_letter_replay",
      { p_id: id, p_request_id: requestId },
      fetcher,
    ),
    requestId,
  );
  if (claimed === undefined) return false;

  const prepared = prepareIngressQueueMessage(claimed);
  if (prepared === undefined) {
    await releaseReplay(supabase, id, requestId, fetcher);
    throw new Error("Dead-letter replay message exceeds Queue budget");
  }
  await env.INGRESS_QUEUE.send(prepared);
  return true;
}

export async function completeDeadLetterReplay(
  env: Env,
  message: IngressQueueMessage,
  result: "duplicate" | "succeeded",
  fetcher: Fetcher = fetch,
): Promise<void> {
  if (message.replayRequestId === undefined) return;
  const completed = await callRecoveryRpc(
    recoveryConfiguration(env),
    "complete_dead_letter_replay",
    {
      p_id: message.recoveryId,
      p_request_id: message.replayRequestId,
      p_result: result,
    },
    fetcher,
  );
  if (completed !== true) throw new Error("Dead-letter completion response is invalid");
}
