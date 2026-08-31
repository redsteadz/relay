import { createClient } from "@supabase/supabase-js";

import { encryptValue, parseKekKeyring } from "@relay/crypto";
import {
  openAiCredentialRevocationResultSchema,
  semanticEndpointOverrideSchema,
  type OpenAiCredentialStatus,
  type SemanticEndpointOverride,
} from "@relay/contracts";
import { parseSemanticBaseUrl } from "@relay/domain";

import type { Database } from "../../../supabase/database.generated";
import { databaseError, logApiIntegrationError } from "./observability";

const DEFAULT_SEMANTIC_BASE_URL = "https://api.openai.com/v1";
const OPENAI_PROVIDER = "openai";

export class CredentialRejectedError extends Error {}
export class CredentialEndpointInvalidError extends Error {}
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

type ConnectionMetadata = {
  baseUrl?: unknown;
  lastValidatedAt?: unknown;
  model?: unknown;
  responseFormat?: unknown;
};

function readLastValidatedAt(metadata: unknown): string | undefined {
  const candidate = metadata as ConnectionMetadata | null;
  return typeof candidate?.lastValidatedAt === "string" ? candidate.lastValidatedAt : undefined;
}

function readStoredEndpoint(metadata: unknown): SemanticEndpointOverride | undefined {
  const candidate = metadata as ConnectionMetadata | null;
  const parsed = semanticEndpointOverrideSchema.safeParse({
    ...(typeof candidate?.baseUrl === "string" ? { baseUrl: candidate.baseUrl } : {}),
    ...(typeof candidate?.model === "string" ? { model: candidate.model } : {}),
    ...(typeof candidate?.responseFormat === "string"
      ? { responseFormat: candidate.responseFormat }
      : {}),
  });
  if (!parsed.success || Object.keys(parsed.data).length === 0) return undefined;
  return parsed.data;
}

type ResolvedEndpoint = {
  baseUrl: string;
  stored: SemanticEndpointOverride;
};

/**
 * Validates a submitted endpoint and normalizes what will be persisted.
 *
 * The same validator `apps/pipeline` uses, so a key cannot be stored for an endpoint the pipeline
 * would later refuse to send to. Loopback over plain HTTP is permitted only in a development
 * deployment, matching the pipeline rule and the local-Supabase exception.
 *
 * An absent endpoint stores nothing, leaving the tenant on whatever the operator has configured.
 */
function resolveSubmittedEndpoint(
  endpoint: SemanticEndpointOverride | undefined,
  relayEnvironment: string,
): ResolvedEndpoint {
  if (endpoint === undefined) return { baseUrl: DEFAULT_SEMANTIC_BASE_URL, stored: {} };

  const stored: SemanticEndpointOverride = {
    ...(endpoint.model === undefined ? {} : { model: endpoint.model }),
    ...(endpoint.responseFormat === undefined ? {} : { responseFormat: endpoint.responseFormat }),
  };
  if (endpoint.baseUrl === undefined) return { baseUrl: DEFAULT_SEMANTIC_BASE_URL, stored };

  const parsed = parseSemanticBaseUrl(endpoint.baseUrl, {
    allowLoopbackHttp: relayEnvironment === "development",
  });
  if (parsed === undefined) {
    throw new CredentialEndpointInvalidError("Semantic endpoint is not an allowed URL");
  }
  return { baseUrl: parsed.baseUrl, stored: { ...stored, baseUrl: parsed.baseUrl } };
}

/**
 * Outcome of probing an endpoint with a submitted key.
 *
 * `unsupported` is its own answer rather than a failure: `GET /models` is an OpenAI convention that
 * most compatible servers implement, but not all. An endpoint that has no such route has told us
 * nothing about the key, which is different from telling us the key is bad.
 */
export type CredentialValidation = "rejected" | "unsupported" | "valid";

/**
 * Confirms the key is accepted by the endpoint it is for, without persisting or logging the
 * response body. Only the HTTP status is used.
 *
 * The endpoint is the one the key will actually be used against, not a hardcoded OpenAI URL --
 * validating a DeepSeek or gateway key against `api.openai.com` would reject every key that is not
 * an OpenAI one, which is precisely what it used to do.
 */
export async function validateOpenAiKey(
  apiKey: string,
  baseUrl: string = DEFAULT_SEMANTIC_BASE_URL,
): Promise<CredentialValidation> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
  } catch (error: unknown) {
    throw new CredentialValidationUnavailableError("Credential validation is unavailable", {
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
  if (response.status === 401 || response.status === 403) return "rejected";
  // The endpoint exists but exposes no model listing. Storing unvalidated is honest; refusing would
  // lock out otherwise usable servers, and claiming validation would be a lie.
  if (response.status === 404 || response.status === 405) return "unsupported";
  if (!response.ok)
    throw new CredentialValidationUnavailableError("Credential validation is unavailable", {
      cause: new Error(`Credential validation returned status ${response.status.toString()}`),
    });
  return "valid";
}

async function assertValidOpenAiKey(apiKey: string, baseUrl: string): Promise<boolean> {
  const validation = await validateOpenAiKey(apiKey, baseUrl);
  if (validation === "rejected") {
    throw new CredentialRejectedError("Key was rejected by the provider");
  }
  return validation === "valid";
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
  const endpoint = readStoredEndpoint(data.metadata);
  return {
    provider: "openai",
    configured: true,
    ...(lastValidatedAt !== undefined ? { lastValidatedAt } : {}),
    ...(endpoint === undefined ? {} : { endpoint }),
    validated: lastValidatedAt !== undefined,
  };
}

export async function submitOpenAiCredential(
  userId: string,
  apiKey: string,
  env: OpenAiEnv,
  endpoint?: SemanticEndpointOverride,
): Promise<OpenAiCredentialStatus> {
  const resolved = resolveSubmittedEndpoint(endpoint, env.relayEnvironment);
  const validated = await assertValidOpenAiKey(apiKey, resolved.baseUrl);

  const supabase = serviceClient(env);
  const keyring = parseKekKeyring(env.kekKeyring);
  const connectionId = crypto.randomUUID();
  const context = credentialContext(userId, connectionId);
  const encrypted = await encryptValue(apiKey, keyring, context);
  // Only recorded when the endpoint actually confirmed the key; an endpoint with no model listing
  // leaves this unset rather than implying a check that never happened.
  const lastValidatedAt = validated ? new Date().toISOString() : undefined;

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
    metadata: {
      ...resolved.stored,
      ...(lastValidatedAt === undefined ? {} : { lastValidatedAt }),
    },
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

  return {
    provider: "openai",
    configured: true,
    ...(lastValidatedAt === undefined ? {} : { lastValidatedAt }),
    ...(Object.keys(resolved.stored).length === 0 ? {} : { endpoint: resolved.stored }),
    validated,
  };
}

export async function rotateOpenAiCredential(
  userId: string,
  apiKey: string,
  env: OpenAiEnv,
  endpoint?: SemanticEndpointOverride,
): Promise<OpenAiCredentialStatus> {
  const supabase = serviceClient(env);
  const { data: existing, error: existingError } = await supabase
    .from("connections")
    .select("id, metadata")
    .eq("user_id", userId)
    .eq("provider", OPENAI_PROVIDER)
    .maybeSingle();
  if (existingError !== null) {
    throw databaseError(existingError, "OPENAI_CREDENTIAL_QUERY_FAILED", "rotateOpenAiCredential");
  }
  if (existing === null) throw new CredentialNotFoundError("No OpenAI key is configured");

  // Rotating without naming an endpoint keeps the one already stored: a replacement key is normally
  // for the same provider, and silently moving it back to OpenAI would break the connection.
  const resolved = resolveSubmittedEndpoint(
    endpoint ?? readStoredEndpoint(existing.metadata),
    env.relayEnvironment,
  );
  const validated = await assertValidOpenAiKey(apiKey, resolved.baseUrl);

  const keyring = parseKekKeyring(env.kekKeyring);
  const context = credentialContext(userId, existing.id);
  const encrypted = await encryptValue(apiKey, keyring, context);
  const lastValidatedAt = validated ? new Date().toISOString() : undefined;

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
      metadata: {
        ...resolved.stored,
        ...(lastValidatedAt === undefined ? {} : { lastValidatedAt }),
      },
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

  return {
    provider: "openai",
    configured: true,
    ...(lastValidatedAt === undefined ? {} : { lastValidatedAt }),
    ...(Object.keys(resolved.stored).length === 0 ? {} : { endpoint: resolved.stored }),
    validated,
  };
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
