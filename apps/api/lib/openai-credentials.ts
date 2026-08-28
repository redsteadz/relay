import { createClient } from "@supabase/supabase-js";

import { encryptValue, parseKekKeyring } from "@relay/crypto";
import type { OpenAiCredentialStatus } from "@relay/contracts";

import type { Database } from "../../../supabase/database.generated";

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
  } catch {
    throw new CredentialValidationUnavailableError("OpenAI validation is unavailable");
  }
  await response.body?.cancel().catch(() => undefined);
  if (response.status === 401 || response.status === 403) return false;
  if (!response.ok)
    throw new CredentialValidationUnavailableError("OpenAI validation is unavailable");
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
  const { data } = await serviceClient(env)
    .from("connections")
    .select("metadata")
    .eq("user_id", userId)
    .eq("provider", OPENAI_PROVIDER)
    .maybeSingle();

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
    throw new Error("Failed to store OpenAI credential");
  }

  await supabase.from("audit_log").insert({
    user_id: userId,
    actor_type: "user",
    actor_id: userId,
    action: "connector.configured",
    target_type: "connection",
    target_id: connectionId,
    metadata: { provider: OPENAI_PROVIDER },
  });

  return { provider: "openai", configured: true, lastValidatedAt };
}

export async function rotateOpenAiCredential(
  userId: string,
  apiKey: string,
  env: OpenAiEnv,
): Promise<OpenAiCredentialStatus> {
  const supabase = serviceClient(env);
  const { data: existing } = await supabase
    .from("connections")
    .select("id")
    .eq("user_id", userId)
    .eq("provider", OPENAI_PROVIDER)
    .maybeSingle();
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
  if (error !== null) throw new Error("Failed to rotate OpenAI credential");

  await supabase.from("audit_log").insert({
    user_id: userId,
    actor_type: "user",
    actor_id: userId,
    action: "connector.rotated",
    target_type: "connection",
    target_id: existing.id,
    metadata: { provider: OPENAI_PROVIDER },
  });

  return { provider: "openai", configured: true, lastValidatedAt };
}

export async function revokeOpenAiCredential(
  userId: string,
  env: OpenAiEnv,
): Promise<{ revoked: boolean }> {
  const supabase = serviceClient(env);
  const { data: existing } = await supabase
    .from("connections")
    .select("id")
    .eq("user_id", userId)
    .eq("provider", OPENAI_PROVIDER)
    .maybeSingle();
  if (existing === null) return { revoked: false };

  const { error } = await supabase
    .from("connections")
    .delete()
    .eq("id", existing.id)
    .eq("user_id", userId);
  if (error !== null) throw new Error("Failed to revoke OpenAI credential");

  // Semantic filter clauses cannot evaluate without a live OpenAI key; disable rather than
  // silently leaving an evaluator that can never resolve them.
  const { data: enabledRules } = await supabase
    .from("filter_rules")
    .select("id, plan")
    .eq("user_id", userId)
    .eq("enabled", true);
  const semanticRuleIds = (enabledRules ?? [])
    .filter((rule) => {
      const plan = rule.plan as unknown as { semantic?: unknown } | null;
      return (
        plan !== null &&
        typeof plan === "object" &&
        "semantic" in plan &&
        plan.semantic !== undefined &&
        plan.semantic !== null
      );
    })
    .map((rule) => rule.id);
  if (semanticRuleIds.length > 0) {
    await supabase
      .from("filter_rules")
      .update({ enabled: false })
      .eq("user_id", userId)
      .in("id", semanticRuleIds);
  }

  await supabase.from("audit_log").insert({
    user_id: userId,
    actor_type: "user",
    actor_id: userId,
    action: "connector.revoked",
    target_type: "connection",
    target_id: existing.id,
    metadata: { provider: OPENAI_PROVIDER },
  });

  return { revoked: true };
}
