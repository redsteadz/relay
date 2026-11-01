/**
 * Signed webhook action provider.
 *
 * Sends one approved Relay action to a receiver the tenant configured, as a signed HTTPS `POST`. The
 * receiver deduplicates on the signed body's `actionId`, which is the run's derived ID and therefore
 * identical on every attempt, so a retry after a lost response is recognised rather than repeated.
 *
 * See `docs/integrations/webhook.md` and `docs/architecture/action-model.md`.
 */

import {
  WEBHOOK_SIGNATURE_VERSION,
  webhookActionInputSchema,
  webhookConnectionMetadataSchema,
  webhookCredentialSchema,
  webhookEnvelopeSchema,
  type ActionIntent,
  type WebhookDeliveryErrorCode,
} from "@relay/contracts";
import { decryptValue } from "@relay/crypto";
import { parsePublicHttpsUrl } from "@relay/domain";

import { readBoundedJson } from "./bounded-json";
import { supabaseBackendHeaders, type PersistenceConfiguration } from "./configuration";
import { withOperationDeadline } from "./deadline";
import { connectionCredentialEncryptionContext, postgresByteaToBase64 } from "./encryption";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export const WEBHOOK_PROVIDER = "webhook";
export const WEBHOOK_DELIVERY_TIMEOUT_MS = 10_000;
const MAX_CONNECTION_RESPONSE_BYTES = 64_000;

/**
 * A delivery that produced no effect, and why.
 *
 * `statusCode` is the receiver's status when there was one. It is the only thing recorded about a
 * response: the body is never read, so nothing a receiver says can reach a log or the ledger.
 */
export class WebhookDeliveryError extends Error {
  readonly statusCode: number | undefined;

  constructor(
    readonly code: WebhookDeliveryErrorCode,
    options: { cause?: unknown; statusCode?: number } = {},
  ) {
    super(
      "Webhook delivery failed",
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "WebhookDeliveryError";
    this.statusCode = options.statusCode;
  }
}

/** Whether another attempt may be made, which is what the ledger records. */
export function isRetryableWebhookFailure(code: WebhookDeliveryErrorCode): boolean {
  return code === "webhook-unreachable" || code === "webhook-retryable-status";
}

/**
 * Maps a receiver's status onto the failure vocabulary, or `undefined` for success.
 *
 * 408, 429 and 5xx say "not now" and are retried. Any other 4xx says "never" and ends the run. A 3xx
 * is refused rather than followed: following it would send a signed request to an address no one
 * validated, and a receiver that has moved should be reconfigured, not chased.
 */
export function classifyWebhookStatus(status: number): WebhookDeliveryErrorCode | undefined {
  if (status >= 200 && status < 300) return undefined;
  if (status >= 300 && status < 400) return "webhook-redirect-refused";
  if (status === 408 || status === 429 || status >= 500) return "webhook-retryable-status";
  return "webhook-rejected";
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * `v1` signature: HMAC-SHA256 over `<timestamp>.<raw body bytes>`, keyed with the secret exactly as
 * the tenant was shown it, lowercase hex.
 */
export async function webhookSignature(
  secret: string,
  timestampSeconds: number,
  body: Uint8Array,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const prefix = encoder.encode(`${timestampSeconds}.`);
  const message = new Uint8Array(prefix.byteLength + body.byteLength);
  message.set(prefix, 0);
  message.set(body, prefix.byteLength);
  return hex(await crypto.subtle.sign("HMAC", key, message));
}

export type WebhookDestination = {
  /** Current secret first, then the rotated-out one while its overlap window is open. */
  secrets: readonly string[];
  url: string;
};

/**
 * Builds the signed request for one attempt.
 *
 * The URL is checked again here, not only when it was saved, so a destination the shared rule now
 * refuses fails permanently instead of being sent to. This reads the name as written and never its
 * DNS answer; what that leaves open is stated in `docs/integrations/webhook.md`.
 */
export async function webhookRequest(
  destination: WebhookDestination,
  intent: ActionIntent,
  attempt: number,
  timestampSeconds: number,
): Promise<{ body: Uint8Array<ArrayBuffer>; headers: Record<string, string>; url: URL }> {
  const url = parsePublicHttpsUrl(destination.url);
  if (url === undefined) throw new WebhookDeliveryError("webhook-destination-refused");
  if (destination.secrets.length === 0) {
    throw new WebhookDeliveryError("webhook-credential-unavailable");
  }

  const input = webhookActionInputSchema.safeParse(intent.input);
  if (!input.success)
    throw new WebhookDeliveryError("webhook-invalid-input", { cause: input.error });
  const envelope = webhookEnvelopeSchema.safeParse({
    version: 1,
    actionId: intent.id,
    eventType: input.data.eventType,
    attempt,
    fields: input.data.fields,
  });
  if (!envelope.success) {
    throw new WebhookDeliveryError("webhook-invalid-input", { cause: envelope.error });
  }

  const body = new Uint8Array(new TextEncoder().encode(JSON.stringify(envelope.data)));
  const signatures = await Promise.all(
    destination.secrets.map(
      async (secret) =>
        `${WEBHOOK_SIGNATURE_VERSION}=${await webhookSignature(secret, timestampSeconds, body)}`,
    ),
  );
  return {
    body,
    headers: {
      "content-type": "application/json",
      "relay-action-id": intent.id,
      "relay-signature": signatures.join(","),
      "relay-timestamp": String(timestampSeconds),
    },
    url,
  };
}

/**
 * Sends one attempt and returns the receiver's success status, or throws `WebhookDeliveryError`.
 *
 * Redirects are not followed, the whole exchange shares one deadline, and the response body is
 * cancelled unread whatever the status.
 */
export async function deliverWebhook(
  destination: WebhookDestination,
  intent: ActionIntent,
  attempt: number,
  fetcher: Fetcher = fetch,
  options: { now?: Date; signal?: AbortSignal } = {},
): Promise<{ statusCode: number }> {
  const timestampSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const request = await webhookRequest(destination, intent, attempt, timestampSeconds);

  let response: Response;
  try {
    response = await withOperationDeadline(
      (signal) =>
        fetcher(request.url.toString(), {
          body: request.body,
          headers: request.headers,
          method: "POST",
          redirect: "manual",
          signal,
        }),
      WEBHOOK_DELIVERY_TIMEOUT_MS,
      options.signal,
    );
  } catch (error: unknown) {
    throw new WebhookDeliveryError("webhook-unreachable", { cause: error });
  }

  try {
    await response.body?.cancel();
  } catch {
    // The status has arrived and decides the outcome; failing to release an unread body changes
    // nothing a receiver or the ledger can observe.
  }

  // A runtime that implements "manual" as the browser does hides the 3xx behind status 0.
  if (response.type === "opaqueredirect") {
    throw new WebhookDeliveryError("webhook-redirect-refused");
  }
  const failure = classifyWebhookStatus(response.status);
  if (failure !== undefined) {
    throw new WebhookDeliveryError(failure, { statusCode: response.status });
  }
  return { statusCode: response.status };
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Loads and decrypts a webhook connection's destination and signing secrets.
 *
 * Fails closed: a missing, ambiguous, other-environment or undecryptable row is
 * `webhook-credential-unavailable`, which is permanent. A rotated-out secret is returned only while
 * its recorded expiry is in the future, and never when the expiry is missing, so a secret that was
 * meant to stop signing cannot keep doing so because its metadata was lost.
 */
export async function loadWebhookDestination(
  configuration: PersistenceConfiguration,
  userId: string,
  connectionId: string,
  fetcher: Fetcher = fetch,
  options: { now?: Date; signal?: AbortSignal } = {},
): Promise<WebhookDestination> {
  const unavailable = (cause?: unknown) =>
    new WebhookDeliveryError(
      "webhook-credential-unavailable",
      cause === undefined ? {} : { cause },
    );
  if (configuration.supabase === undefined) throw unavailable();

  const url = new URL("/rest/v1/connections", configuration.supabase.url);
  url.searchParams.set(
    "select",
    [
      "credential_ciphertext",
      "credential_nonce",
      "wrapped_data_key",
      "wrap_nonce",
      "key_version",
      "encryption_environment",
      "metadata",
    ].join(","),
  );
  url.searchParams.set("id", `eq.${connectionId}`);
  url.searchParams.set("user_id", `eq.${userId}`);
  url.searchParams.set("provider", `eq.${WEBHOOK_PROVIDER}`);
  url.searchParams.set("status", "eq.active");
  url.searchParams.set("limit", "2");

  let rows: unknown;
  try {
    const response = await fetcher(url.toString(), {
      headers: supabaseBackendHeaders(configuration.supabase.serviceRoleKey),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (!response.ok) throw unavailable();
    rows = await readBoundedJson(response, MAX_CONNECTION_RESPONSE_BYTES, {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      timeoutMs: WEBHOOK_DELIVERY_TIMEOUT_MS,
    });
  } catch (error: unknown) {
    if (error instanceof WebhookDeliveryError) throw error;
    throw unavailable(error);
  }
  if (!Array.isArray(rows) || rows.length !== 1) throw unavailable();

  const row = objectValue(rows[0]);
  const metadata = webhookConnectionMetadataSchema.safeParse(row?.metadata);
  if (
    row === undefined ||
    !metadata.success ||
    row.encryption_environment !== configuration.environment ||
    typeof row.key_version !== "number" ||
    !Number.isInteger(row.key_version) ||
    row.key_version < 1
  ) {
    throw unavailable();
  }

  let plaintext: string;
  try {
    plaintext = await decryptValue(
      {
        algorithm: "AES-GCM-256",
        ciphertext: postgresByteaToBase64(row.credential_ciphertext),
        nonce: postgresByteaToBase64(row.credential_nonce, 12),
        wrappedKey: postgresByteaToBase64(row.wrapped_data_key, 48),
        wrapNonce: postgresByteaToBase64(row.wrap_nonce, 12),
        keyVersion: row.key_version,
      },
      configuration.keyring,
      connectionCredentialEncryptionContext(userId, connectionId),
    );
  } catch {
    // Carries no ciphertext, tenant or key material, and no cause that could.
    throw unavailable();
  }

  let credential: ReturnType<typeof webhookCredentialSchema.safeParse>;
  try {
    credential = webhookCredentialSchema.safeParse(JSON.parse(plaintext));
  } catch {
    throw unavailable();
  }
  if (!credential.success) throw unavailable();

  const { previousSecret, secret } = credential.data;
  const expiresAt = metadata.data.previousSecretExpiresAt;
  const previousOpen =
    expiresAt !== undefined && Date.parse(expiresAt) > (options.now ?? new Date()).getTime();
  return {
    secrets: previousSecret !== undefined && previousOpen ? [secret, previousSecret] : [secret],
    url: credential.data.url,
  };
}
