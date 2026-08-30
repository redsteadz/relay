import { createClient } from "@supabase/supabase-js";

import { encryptValue, parseKekKeyring } from "@relay/crypto";
import {
  openAiCredentialRevocationResultSchema,
  type OpenAiCredentialStatus,
} from "@relay/contracts";

import type { Database } from "../../../supabase/database.generated";
import { databaseError, logApiIntegrationError } from "./observability";

const OPENAI_MODELS_ENDPOINT = "https://api.openai.com/v1/models";
const OPENAI_PROVIDER = "openai";

export class CredentialRejectedError extends Error {}
export class CredentialValidationUnavailableError extends Error {}
export class CredentialNotFoundError extends Error {}
export class CredentialConflictError extends Error {}

type OpenAiEnv = {
  kekKeyring: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  relayEnvironment: string;
};

export function loadOpenAiEnv(): OpenAiEnv | null {
  const kekKeyring = process.env.RELAY_CREDENTIAL_KEK_KEYRING;
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const relayEnvironment = process.env.RELAY_ENVIRONMENT ?? "development";

  if (
    kekKeyring === undefined ||
    supabaseUrl === undefined ||
    supabaseServiceRoleKey === undefined
  ) {
    return null;
  }
  return { kekKeyring, supabaseUrl, supabaseServiceRoleKey, relayEnvironment };
}

function serviceClient(env: OpenAiEnv) {
  return createClient<Database>(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function base64ToPostgresBytea(value: string): string {
  const binary = atob(value);
  let hex = "";
  for (let index = 0; index < binary.length; index += 1) {
    hex += binary.charCodeAt(index).toString(16).padStart(2, "0");
  }
  return `\\x${hex}`;
}

function credentialContext(userId: string, connectionId: string): string {
  return `connection:${userId}:${connectionId}:credential`;
}

type ConnectionMetadata = { lastValidatedAt?: unknown };

function readLastValidatedAt(metadata: unknown): string | undefined {
  const candidate = metadata as ConnectionMetadata | null;
  return typeof candidate?.lastValidatedAt === "string" ? candidate.lastValidatedAt : undefined;
}

/**
 * Confirms the key is accepted by OpenAI without persisting or logging the provider response body.
 * Only the HTTP status is used to determine validity.
 */
export async function validateOpenAiKey(apiKey: string): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch(OPENAI_MODELS_ENDPOINT, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
  } catch (error: unknown) {
    throw new CredentialValidationUnavailableError("OpenAI validation is unavailable", {
      cause: error,
    });
  }
  try {
    await response.body?.cancel();
  } catch (error: unknown) {
    logApiIntegrationError(error, {
      code: "OPENAI_RESPONSE_CANCELLATION_FAILED",
      event: "integration.response_cleanup_failed",
      integration: "openai",
      operation: "validateOpenAiKey.cancelResponse",
      requestId: crypto.randomUUID(),
    });
  }
  if (response.status === 401 || response.status === 403) return false;
  if (!response.ok)
    throw new CredentialValidationUnavailableError("OpenAI validation is unavailable", {
      cause: new Error(`OpenAI validation returned status ${response.status.toString()}`),
    });
  return true;
}

async function assertValidOpenAiKey(apiKey: string): Promise<void> {
  const valid = await validateOpenAiKey(apiKey);
  if (!valid) throw new CredentialRejectedError("OpenAI key was rejected by the provider");
}

export async function getOpenAiCredentialStatus(
  userId: string,
  env: OpenAiEnv,
): Promise<OpenAiCredentialStatus> {
  const { data, error } = await serviceClient(env)
    .from("connections")
    .select("metadata")
    .eq("user_id", userId)
    .eq("provider", OPENAI_PROVIDER)
    .maybeSingle();

  if (error !== null) {
    throw databaseError(error, "OPENAI_STATUS_QUERY_FAILED", "getOpenAiCredentialStatus");
  }
  if (data === null) return { provider: "openai", configured: false };
  const lastValidatedAt = readLastValidatedAt(data.metadata);
  return {
    provider: "openai",
    configured: true,
    ...(lastValidatedAt !== undefined ? { lastValidatedAt } : {}),
  };
}

export async function submitOpenAiCredential(
  userId: string,
  apiKey: string,
  env: OpenAiEnv,
): Promise<OpenAiCredentialStatus> {
  await assertValidOpenAiKey(apiKey);

  const supabase = serviceClient(env);
  const keyring = parseKekKeyring(env.kekKeyring);
  const connectionId = crypto.randomUUID();
  const context = credentialContext(userId, connectionId);
  const encrypted = await encryptValue(apiKey, keyring, context);
  const lastValidatedAt = new Date().toISOString();

  const { error } = await supabase.from("connections").insert({
    id: connectionId,
    user_id: userId,
    provider: OPENAI_PROVIDER,
    credential_ciphertext: base64ToPostgresBytea(encrypted.ciphertext),
    credential_nonce: base64ToPostgresBytea(encrypted.nonce),
    wrapped_data_key: base64ToPostgresBytea(encrypted.wrappedKey),
    wrap_nonce: base64ToPostgresBytea(encrypted.wrapNonce),
    key_version: encrypted.keyVersion,
    encryption_environment: env.relayEnvironment,
    scopes: [],
    status: "active",
    metadata: { lastValidatedAt },
  });

  if (error !== null) {
    if (error.code === "23505") {
      throw new CredentialConflictError("An OpenAI key is already configured");
    }
    throw databaseError(error, "OPENAI_CREDENTIAL_STORE_FAILED", "submitOpenAiCredential");
  }

  const { error: auditError } = await supabase.from("audit_log").insert({
    user_id: userId,
    actor_type: "user",
    actor_id: userId,
    action: "connector.configured",
    target_type: "connection",
    target_id: connectionId,
    metadata: { provider: OPENAI_PROVIDER },
  });
  if (auditError !== null) {
    logApiIntegrationError(
      databaseError(auditError, "OPENAI_AUDIT_WRITE_FAILED", "submitOpenAiCredential.audit"),
      {
        code: "OPENAI_AUDIT_WRITE_FAILED",
        event: "database.audit_write_failed",
        integration: "supabase",
        operation: "submitOpenAiCredential.audit",
        requestId: crypto.randomUUID(),
      },
    );
  }

  return { provider: "openai", configured: true, lastValidatedAt };
}

export async function rotateOpenAiCredential(
  userId: string,
  apiKey: string,
  env: OpenAiEnv,
): Promise<OpenAiCredentialStatus> {
  const supabase = serviceClient(env);
  const { data: existing, error: existingError } = await supabase
    .from("connections")
    .select("id")
    .eq("user_id", userId)
    .eq("provider", OPENAI_PROVIDER)
    .maybeSingle();
  if (existingError !== null) {
    throw databaseError(existingError, "OPENAI_CREDENTIAL_QUERY_FAILED", "rotateOpenAiCredential");
  }
  if (existing === null) throw new CredentialNotFoundError("No OpenAI key is configured");

  await assertValidOpenAiKey(apiKey);

  const keyring = parseKekKeyring(env.kekKeyring);
  const context = credentialContext(userId, existing.id);
  const encrypted = await encryptValue(apiKey, keyring, context);
  const lastValidatedAt = new Date().toISOString();

  const { error } = await supabase
    .from("connections")
    .update({
      credential_ciphertext: base64ToPostgresBytea(encrypted.ciphertext),
      credential_nonce: base64ToPostgresBytea(encrypted.nonce),
      wrapped_data_key: base64ToPostgresBytea(encrypted.wrappedKey),
      wrap_nonce: base64ToPostgresBytea(encrypted.wrapNonce),
      key_version: encrypted.keyVersion,
      encryption_environment: env.relayEnvironment,
      status: "active",
      metadata: { lastValidatedAt },
    })
    .eq("id", existing.id)
    .eq("user_id", userId);
  if (error !== null) {
    throw databaseError(error, "OPENAI_CREDENTIAL_ROTATE_FAILED", "rotateOpenAiCredential");
  }

  const { error: auditError } = await supabase.from("audit_log").insert({
    user_id: userId,
    actor_type: "user",
    actor_id: userId,
    action: "connector.rotated",
    target_type: "connection",
    target_id: existing.id,
    metadata: { provider: OPENAI_PROVIDER },
  });
  if (auditError !== null) {
    logApiIntegrationError(
      databaseError(auditError, "OPENAI_AUDIT_WRITE_FAILED", "rotateOpenAiCredential.audit"),
      {
        code: "OPENAI_AUDIT_WRITE_FAILED",
        event: "database.audit_write_failed",
        integration: "supabase",
        operation: "rotateOpenAiCredential.audit",
        requestId: crypto.randomUUID(),
      },
    );
  }

  return { provider: "openai", configured: true, lastValidatedAt };
}

export async function revokeOpenAiCredential(
  userId: string,
  env: OpenAiEnv,
): Promise<{ revoked: boolean }> {
  const supabase = serviceClient(env);
  const { data, error } = await supabase.rpc("revoke_openai_connection", {
    p_user_id: userId,
  });
  const result = openAiCredentialRevocationResultSchema.safeParse(data);
  if (error !== null || !result.success) {
    throw databaseError(
      error ?? result.error,
      "OPENAI_CREDENTIAL_REVOKE_FAILED",
      "revokeOpenAiCredential",
      undefined,
      "Failed to revoke OpenAI credential",
    );
  }
  return { revoked: result.data.revoked };
}
