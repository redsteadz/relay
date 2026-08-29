import { RAW_PAYLOAD_RETENTION_MS } from "@relay/contracts";
import { decryptValue, parseKekKeyring } from "@relay/crypto";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "../../../supabase/database.generated";
import { revokeGoogleToken } from "./google-tasks";

export type PrivacyEnv = {
  kekKeyring: string;
  supabaseServiceRoleKey: string;
  supabaseUrl: string;
};

export function loadPrivacyEnv(): PrivacyEnv | null {
  const kekKeyring = process.env.RELAY_CREDENTIAL_KEK_KEYRING;
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (
    kekKeyring === undefined ||
    supabaseUrl === undefined ||
    supabaseServiceRoleKey === undefined
  ) {
    return null;
  }
  return { kekKeyring, supabaseServiceRoleKey, supabaseUrl };
}

function serviceClient(env: PrivacyEnv) {
  return createClient<Database>(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Must match the context used when the connectors encrypted the credential. The same expression
// currently appears in gmail.ts, google-tasks.ts, and openai-credentials.ts; consolidating those is
// worth doing separately, and is deliberately not folded into this change.
function connectionCredentialContext(userId: string, connectionId: string): string {
  return `connection:${userId}:${connectionId}:credential`;
}

function postgresByteaToBase64(value: unknown): string {
  const hex = String(value).slice(2);
  let binary = "";
  for (let index = 0; index < hex.length; index += 2) {
    binary += String.fromCharCode(Number.parseInt(hex.slice(index, index + 2), 16));
  }
  return btoa(binary);
}

export type RetentionStatus = {
  earliestExpiresAt: string | null;
  latestExpiresAt: string | null;
  retainedCount: number;
  retentionDays: number;
};

const RETENTION_DAYS = Math.round(RAW_PAYLOAD_RETENTION_MS / (24 * 60 * 60 * 1000));

export async function getRetentionStatus(
  userId: string,
  env: PrivacyEnv,
): Promise<RetentionStatus> {
  const supabase = serviceClient(env);
  // The RPC is `security invoker` and relies on row-level security, which the service role bypasses,
  // so scope explicitly here instead. Service-role reads must always bind a verified tenant.
  const { data, error } = await supabase
    .from("source_items")
    .select("raw_expires_at")
    .eq("user_id", userId)
    .not("raw_ciphertext", "is", null)
    .order("raw_expires_at", { ascending: true });
  if (error !== null) throw new Error("Retention status unavailable");

  const expiries = (data ?? []).map((row) => row.raw_expires_at);
  return {
    earliestExpiresAt: expiries[0] ?? null,
    latestExpiresAt: expiries.at(-1) ?? null,
    retainedCount: expiries.length,
    retentionDays: RETENTION_DAYS,
  };
}

export async function purgeRawPayloads(userId: string, env: PrivacyEnv): Promise<number> {
  const supabase = serviceClient(env);
  const { data, error } = await supabase
    .from("source_items")
    .update({
      encryption_environment: null,
      key_version: null,
      raw_ciphertext: null,
      raw_nonce: null,
      wrap_nonce: null,
      wrapped_data_key: null,
    })
    .eq("user_id", userId)
    .not("raw_ciphertext", "is", null)
    .select("id");
  if (error !== null) throw new Error("Raw payload purge failed");

  const purgedCount = data?.length ?? 0;
  await supabase.from("audit_log").insert({
    action: "privacy.raw_payloads_purged",
    actor_type: "user",
    metadata: { purgedCount },
    target_type: "source_items",
    user_id: userId,
  });
  return purgedCount;
}

export type DisclosureSummary = {
  createdAt: string;
  disclosedFields: string[];
  id: string;
  model: string;
  provider: string;
  purpose: string;
};

export async function listDisclosures(
  userId: string,
  env: PrivacyEnv,
  limit = 100,
): Promise<DisclosureSummary[]> {
  const supabase = serviceClient(env);
  const { data, error } = await supabase
    .from("ai_disclosures")
    .select("id, provider, model, disclosed_fields, purpose, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error !== null) throw new Error("Disclosure history unavailable");

  // Deliberately no prompt, response, redaction payload, or source body: the history explains what
  // was disclosed, not the content that was disclosed.
  return (data ?? []).map((row) => ({
    createdAt: row.created_at,
    disclosedFields: row.disclosed_fields,
    id: row.id,
    model: row.model,
    provider: row.provider,
    purpose: row.purpose,
  }));
}

export type AccountDeletionStatus = {
  attemptCount: number;
  completedAt: string | null;
  connectorsRevokedAt: string | null;
  requestedAt: string;
  state: "requested" | "connectors_revoked" | "completed";
};

function toStatus(row: {
  attempt_count: number;
  completed_at: string | null;
  connectors_revoked_at: string | null;
  requested_at: string;
  state: string;
}): AccountDeletionStatus {
  return {
    attemptCount: row.attempt_count,
    completedAt: row.completed_at,
    connectorsRevokedAt: row.connectors_revoked_at,
    requestedAt: row.requested_at,
    state: row.state as AccountDeletionStatus["state"],
  };
}

export async function getAccountDeletionStatus(
  userId: string,
  env: PrivacyEnv,
): Promise<AccountDeletionStatus | null> {
  const supabase = serviceClient(env);
  const { data } = await supabase
    .from("account_deletions")
    .select("state, attempt_count, requested_at, connectors_revoked_at, completed_at")
    .eq("user_id", userId)
    .maybeSingle();
  return data === null ? null : toStatus(data);
}

/**
 * Best-effort provider-side revocation.
 *
 * Google refresh tokens are revoked at the provider; OpenAI has no revocation endpoint, so removing
 * the stored key is the whole of what Relay can do. A provider that refuses or is unreachable must
 * not strand the deletion, so failures are counted rather than thrown — the credential rows are
 * deleted regardless, which is what guarantees Relay itself retains nothing.
 */
export async function revokeProviderCredentials(
  userId: string,
  env: PrivacyEnv,
): Promise<{ revoked: number; failed: number }> {
  const supabase = serviceClient(env);
  const { data } = await supabase
    .from("connections")
    .select(
      "id, provider, credential_ciphertext, credential_nonce, wrapped_data_key, wrap_nonce, key_version",
    )
    .eq("user_id", userId);

  let revoked = 0;
  let failed = 0;
  for (const row of data ?? []) {
    if (!row.provider.startsWith("google")) continue;
    try {
      const refreshToken = await decryptValue(
        {
          algorithm: "AES-GCM-256",
          ciphertext: postgresByteaToBase64(row.credential_ciphertext),
          keyVersion: row.key_version,
          nonce: postgresByteaToBase64(row.credential_nonce),
          wrapNonce: postgresByteaToBase64(row.wrap_nonce),
          wrappedKey: postgresByteaToBase64(row.wrapped_data_key),
        },
        parseKekKeyring(env.kekKeyring),
        connectionCredentialContext(userId, row.id),
      );
      if (await revokeGoogleToken(refreshToken)) revoked += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }
  return { failed, revoked };
}

/**
 * Runs the deletion to completion, and is safe to call again after an interruption.
 *
 * Order matters: credentials are revoked provider-side while they are still readable, the state is
 * advanced so a retry resumes correctly, the database finalization cancels pending actions,
 * invalidates devices, deletes credential rows and purges raw payloads, and only then is the auth
 * user removed — which cascades every remaining tenant row.
 */
export async function deleteAccount(
  userId: string,
  env: PrivacyEnv,
): Promise<{
  status: AccountDeletionStatus;
  revokedCredentials: number;
  failedRevocations: number;
}> {
  const supabase = serviceClient(env);

  const { error: requestError } = await supabase.rpc("request_account_deletion", {
    p_user_id: userId,
  });
  if (requestError !== null) throw new Error("Account deletion could not be requested");

  const revocation = await revokeProviderCredentials(userId, env);

  const { error: markError } = await supabase.rpc("mark_account_connectors_revoked", {
    p_user_id: userId,
  });
  if (markError !== null) throw new Error("Account deletion could not advance");

  const { data: finalized, error: finalizeError } = await supabase.rpc(
    "finalize_account_deletion",
    { p_user_id: userId },
  );
  if (finalizeError !== null || finalized === null) {
    throw new Error("Account deletion could not be finalized");
  }

  // Removing the auth user cascades every remaining tenant row, including the deletion record
  // itself. A failure here leaves a resumable `completed` database state rather than a half-deleted
  // account holding live credentials, because revocation and credential removal already happened.
  const { error: authError } = await supabase.auth.admin.deleteUser(userId);
  if (authError !== null) throw new Error("Account identity could not be removed");

  return {
    failedRevocations: revocation.failed,
    revokedCredentials: revocation.revoked,
    status: toStatus(finalized),
  };
}
