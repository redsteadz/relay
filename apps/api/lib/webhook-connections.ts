/**
 * Webhook connections: creating one and rotating its signing secret.
 *
 * The destination URL and the signing secret are encrypted together into the connection's credential
 * under ADR-0005, because a receiver URL commonly carries a token in its path or query. Plain
 * metadata holds only the host, the signature version and, during a rotation, when the previous
 * secret stops signing. Relay generates every secret and returns it once. See
 * `docs/integrations/webhook.md`.
 */

import { createClient } from "@supabase/supabase-js";

import { decryptValue, encryptValue, parseKekKeyring, type KekKeyring } from "@relay/crypto";
import {
  WEBHOOK_ROTATION_OVERLAP_MS,
  WEBHOOK_SIGNATURE_VERSION,
  webhookConnectionMetadataSchema,
  webhookCredentialSchema,
  type WebhookConnectionSecretResponse,
  type WebhookCredential,
} from "@relay/contracts";
import { parsePublicHttpsUrl } from "@relay/domain";
import { AppError } from "@relay/observability";

import type { Database } from "../../../supabase/database.generated";
import { databaseError, logApiIntegrationError } from "./observability";

const WEBHOOK_PROVIDER = "webhook";

export class WebhookDestinationInvalidError extends Error {}
export class WebhookConnectionNotFoundError extends Error {}
export class WebhookRotationConflictError extends Error {}

type WebhookEnv = {
  kekKeyring: string;
  relayEnvironment: string;
  supabaseServiceRoleKey: string;
  supabaseUrl: string;
};

export function loadWebhookEnv(): WebhookEnv | null {
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
  return { kekKeyring, relayEnvironment, supabaseServiceRoleKey, supabaseUrl };
}

export function unconfiguredWebhook(): Response {
  return Response.json(
    { error: { code: "webhook_not_configured", message: "Webhook connector is not configured" } },
    { status: 503 },
  );
}

/** The body carries a secret shown once, so nothing between here and the client may keep it. */
export function webhookSecretResponse(body: WebhookConnectionSecretResponse): Response {
  return Response.json(body, { headers: { "cache-control": "no-store" }, status: 200 });
}

function serviceClient(env: WebhookEnv) {
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

function postgresByteaToBase64(value: unknown): string {
  if (typeof value !== "string" || !/^\\x(?:[0-9a-f]{2})+$/iu.test(value)) {
    throw new Error("Encrypted database value is invalid");
  }
  const hex = value.slice(2);
  let binary = "";
  for (let index = 0; index < hex.length; index += 2) {
    binary += String.fromCharCode(Number.parseInt(hex.slice(index, index + 2), 16));
  }
  return btoa(binary);
}

function credentialContext(userId: string, connectionId: string): string {
  return `connection:${userId}:${connectionId}:credential`;
}

/** 32 random bytes as lowercase hex: the form the tenant is shown and the receiver keys HMAC with. */
function generateSecret(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function encryptedColumns(
  credential: WebhookCredential,
  keyring: KekKeyring,
  userId: string,
  connectionId: string,
) {
  const encrypted = await encryptValue(
    JSON.stringify(webhookCredentialSchema.parse(credential)),
    keyring,
    credentialContext(userId, connectionId),
  );
  return {
    credential_ciphertext: base64ToPostgresBytea(encrypted.ciphertext),
    credential_nonce: base64ToPostgresBytea(encrypted.nonce),
    key_version: encrypted.keyVersion,
    wrap_nonce: base64ToPostgresBytea(encrypted.wrapNonce),
    wrapped_data_key: base64ToPostgresBytea(encrypted.wrappedKey),
  };
}

async function writeAudit(
  supabase: ReturnType<typeof serviceClient>,
  userId: string,
  connectionId: string,
  action: "connector.configured" | "connector.rotated",
  operation: string,
): Promise<void> {
  const { error } = await supabase.from("audit_log").insert({
    action,
    actor_id: userId,
    actor_type: "user",
    metadata: { provider: WEBHOOK_PROVIDER },
    target_id: connectionId,
    target_type: "connection",
    user_id: userId,
  });
  if (error !== null) {
    logApiIntegrationError(databaseError(error, "WEBHOOK_AUDIT_WRITE_FAILED", operation), {
      code: "WEBHOOK_AUDIT_WRITE_FAILED",
      event: "database.audit_write_failed",
      integration: "supabase",
      operation,
      requestId: crypto.randomUUID(),
    });
  }
}

/**
 * Creates a webhook connection and returns its secret, which is never readable again.
 *
 * Each webhook is its own connection, so its own ID stands in for the external account the
 * `(user_id, provider, external_account_id)` uniqueness expects; otherwise a tenant could hold only
 * one receiver.
 */
export async function createWebhookConnection(
  userId: string,
  url: string,
  env: WebhookEnv,
): Promise<WebhookConnectionSecretResponse> {
  const destination = parsePublicHttpsUrl(url);
  if (destination === undefined) throw new WebhookDestinationInvalidError();

  const connectionId = crypto.randomUUID();
  const secret = generateSecret();
  const columns = await encryptedColumns(
    { secret, url: destination.href },
    parseKekKeyring(env.kekKeyring),
    userId,
    connectionId,
  );
  const metadata = webhookConnectionMetadataSchema.parse({
    host: destination.hostname,
    signatureVersion: WEBHOOK_SIGNATURE_VERSION,
  });

  const supabase = serviceClient(env);
  const { error } = await supabase.from("connections").insert({
    ...columns,
    encryption_environment: env.relayEnvironment,
    external_account_id: connectionId,
    id: connectionId,
    metadata,
    provider: WEBHOOK_PROVIDER,
    scopes: [],
    status: "active",
    user_id: userId,
  });
  if (error !== null) {
    throw databaseError(error, "WEBHOOK_CONNECTION_STORE_FAILED", "createWebhookConnection");
  }

  await writeAudit(
    supabase,
    userId,
    connectionId,
    "connector.configured",
    "createWebhookConnection.audit",
  );
  return { connectionId, host: metadata.host, previousSecretExpiresAt: null, secret };
}

function unreadableCredential(cause?: unknown): AppError {
  return new AppError("Webhook credential could not be read", {
    category: "internal",
    cause,
    code: "WEBHOOK_CREDENTIAL_UNREADABLE",
    integration: "webhook",
    operation: "rotateWebhookConnection",
    retryable: false,
  });
}

/**
 * Replaces a connection's secret, keeping the old one signing beside it for the overlap window.
 *
 * Rotating again inside the window drops the oldest secret: only the current and the immediately
 * previous one ever exist. The write is conditional on the credential this read, so two rotations
 * racing cannot both report success while one of the secrets they returned is silently lost.
 */
export async function rotateWebhookConnection(
  userId: string,
  connectionId: string,
  env: WebhookEnv,
  now: Date = new Date(),
): Promise<WebhookConnectionSecretResponse> {
  const supabase = serviceClient(env);
  const { data: row, error } = await supabase
    .from("connections")
    .select(
      "id, credential_ciphertext, credential_nonce, wrapped_data_key, wrap_nonce, key_version, encryption_environment, metadata",
    )
    .eq("id", connectionId)
    .eq("user_id", userId)
    .eq("provider", WEBHOOK_PROVIDER)
    .eq("status", "active")
    .maybeSingle();
  if (error !== null) {
    throw databaseError(error, "WEBHOOK_CONNECTION_QUERY_FAILED", "rotateWebhookConnection");
  }
  if (row === null) throw new WebhookConnectionNotFoundError();
  if (row.encryption_environment !== env.relayEnvironment) throw unreadableCredential();

  const metadata = webhookConnectionMetadataSchema.safeParse(row.metadata);
  if (!metadata.success) throw unreadableCredential(metadata.error);

  const keyring = parseKekKeyring(env.kekKeyring);
  let current: WebhookCredential;
  try {
    const plaintext = await decryptValue(
      {
        algorithm: "AES-GCM-256",
        ciphertext: postgresByteaToBase64(row.credential_ciphertext),
        keyVersion: row.key_version,
        nonce: postgresByteaToBase64(row.credential_nonce),
        wrapNonce: postgresByteaToBase64(row.wrap_nonce),
        wrappedKey: postgresByteaToBase64(row.wrapped_data_key),
      },
      keyring,
      credentialContext(userId, connectionId),
    );
    current = webhookCredentialSchema.parse(JSON.parse(plaintext));
  } catch {
    // No cause: a decryption or parse failure could carry credential-derived detail.
    throw unreadableCredential();
  }

  const secret = generateSecret();
  const previousSecretExpiresAt = new Date(
    now.getTime() + WEBHOOK_ROTATION_OVERLAP_MS,
  ).toISOString();
  const columns = await encryptedColumns(
    { previousSecret: current.secret, secret, url: current.url },
    keyring,
    userId,
    connectionId,
  );

  const { data: updated, error: updateError } = await supabase
    .from("connections")
    .update({
      ...columns,
      encryption_environment: env.relayEnvironment,
      metadata: webhookConnectionMetadataSchema.parse({
        ...metadata.data,
        previousSecretExpiresAt,
      }),
    })
    .eq("id", connectionId)
    .eq("user_id", userId)
    .eq("credential_nonce", row.credential_nonce)
    .select("id");
  if (updateError !== null) {
    throw databaseError(updateError, "WEBHOOK_CONNECTION_ROTATE_FAILED", "rotateWebhookConnection");
  }
  if (updated.length !== 1) throw new WebhookRotationConflictError();

  await writeAudit(
    supabase,
    userId,
    connectionId,
    "connector.rotated",
    "rotateWebhookConnection.audit",
  );
  return { connectionId, host: metadata.data.host, previousSecretExpiresAt, secret };
}
