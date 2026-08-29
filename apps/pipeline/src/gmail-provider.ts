import { gmailHistoryIdSchema, type IngressEnvelope } from "@relay/contracts";

import { BoundedJsonError, readBoundedJson } from "./bounded-json";
import type { Env } from "./env";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const GMAIL_API_ROOT = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_TOKEN_RESPONSE_BYTES = 32_768;
const MAX_HISTORY_RESPONSE_BYTES = 512_000;
const MAX_MESSAGE_RESPONSE_BYTES = 1_000_000;
const MAX_HISTORY_RECORDS_PER_PAGE = 20;
const MAX_CHANGED_MESSAGE_CANDIDATES_PER_PAGE = 25_000;
const MAX_GMAIL_BODY_BYTES = 48_000;
const MAX_MIME_PARTS = 1000;
export const MAX_GMAIL_ENVELOPE_SERIALIZED_BYTES = 80_000;
export const GMAIL_EXTERNAL_OPERATION_TIMEOUT_MS = 15_000;
export const GMAIL_WATCH_MAX_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const GMAIL_WATCH_EXPIRATION_TOLERANCE_MS = 5 * 60 * 1000;
const GMAIL_ENVELOPE_NAMESPACE = "4d095f89-4e37-50d3-a92e-56b9ba2376f7";
const DEFINITIVE_WATCH_REJECTION_STATUSES = new Set([400, 401, 403, 404, 429]);

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export type GmailProviderConfiguration = {
  clientId: string;
  clientSecret: string;
  pubsubRetentionSeconds: number;
  topicName: string;
};

export class GmailProviderError extends Error {
  constructor(
    readonly code:
      | "grant-revoked"
      | "invalid-history"
      | "invalid-response"
      | "request-rejected"
      | "response-too-large"
      | "stale-history"
      | "unavailable",
  ) {
    super("Gmail provider operation failed");
  }
}

export function readGmailProviderConfiguration(env: Env): GmailProviderConfiguration {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const pubsubRetention = env.GOOGLE_PUBSUB_MESSAGE_RETENTION_SECONDS;
  const topicName = env.GOOGLE_GMAIL_PUBSUB_TOPIC;
  const pubsubRetentionSeconds =
    pubsubRetention !== undefined && /^\d+$/u.test(pubsubRetention)
      ? Number(pubsubRetention)
      : Number.NaN;
  if (
    clientId === undefined ||
    clientId.length === 0 ||
    clientId.trim() !== clientId ||
    clientSecret === undefined ||
    clientSecret.length === 0 ||
    clientSecret.trim() !== clientSecret ||
    !Number.isSafeInteger(pubsubRetentionSeconds) ||
    pubsubRetentionSeconds < 600 ||
    pubsubRetentionSeconds > 31 * 24 * 60 * 60 ||
    topicName === undefined ||
    topicName.length > 512 ||
    !/^projects\/[A-Za-z0-9._~+%-]+\/topics\/[A-Za-z0-9._~+%-]+$/u.test(topicName)
  ) {
    throw new GmailProviderError("unavailable");
  }
  return { clientId, clientSecret, pubsubRetentionSeconds, topicName };
}

function responseError(error: unknown): GmailProviderError {
  if (error instanceof GmailProviderError) return error;
  if (error instanceof BoundedJsonError) {
    if (error.code === "response-too-large") return new GmailProviderError("response-too-large");
    if (error.code === "response-unavailable") return new GmailProviderError("unavailable");
  }
  return new GmailProviderError("invalid-response");
}

function providerJson(
  response: Response,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<unknown> {
  return readBoundedJson(response, maximumBytes, {
    ...(signal === undefined ? {} : { signal }),
    timeoutMs: GMAIL_EXTERNAL_OPERATION_TIMEOUT_MS,
  });
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GmailProviderError("invalid-response");
  }
  return value as Record<string, unknown>;
}

function providerId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,256}$/u.test(value)) {
    throw new GmailProviderError("invalid-response");
  }
  return value;
}

function paginationToken(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    throw new GmailProviderError("invalid-response");
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (/\s/u.test(character) || codePoint <= 31 || codePoint === 127) {
      throw new GmailProviderError("invalid-response");
    }
  }
  return value;
}

function historyId(value: unknown): string {
  const parsed = gmailHistoryIdSchema.safeParse(value);
  if (!parsed.success) throw new GmailProviderError("invalid-response");
  return parsed.data;
}

export async function refreshGmailAccessToken(
  refreshToken: string,
  configuration: GmailProviderConfiguration,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetcher(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: configuration.clientId,
      client_secret: configuration.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) {
    if (response.status === 400) {
      try {
        const error = objectValue(await providerJson(response, MAX_TOKEN_RESPONSE_BYTES, signal));
        if (error.error === "invalid_grant") throw new GmailProviderError("grant-revoked");
      } catch (error) {
        if (error instanceof GmailProviderError && error.code === "grant-revoked") throw error;
      }
    }
    throw new GmailProviderError("unavailable");
  }
  let data: Record<string, unknown>;
  try {
    data = objectValue(await providerJson(response, MAX_TOKEN_RESPONSE_BYTES, signal));
  } catch (error) {
    throw responseError(error);
  }
  if (
    typeof data.access_token !== "string" ||
    data.access_token.length === 0 ||
    data.access_token.length > 8192
  ) {
    throw new GmailProviderError("invalid-response");
  }
  return data.access_token;
}

export type GmailHistoryPage = {
  latestHistoryId: string;
  messageIds: string[];
  nextPageToken?: string;
};

export async function listGmailHistoryPage(
  accessToken: string,
  startHistoryId: string,
  pageToken: string | undefined,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<GmailHistoryPage> {
  historyId(startHistoryId);
  const messageIds = new Set<string>();
  let messageCandidateCount = 0;
  const url = new URL(`${GMAIL_API_ROOT}/history`);
  url.searchParams.set("startHistoryId", startHistoryId);
  url.searchParams.set("historyTypes", "messageAdded");
  url.searchParams.set("maxResults", MAX_HISTORY_RECORDS_PER_PAGE.toString());
  if (pageToken !== undefined) url.searchParams.set("pageToken", paginationToken(pageToken));
  const response = await fetcher(url.toString(), {
    headers: { authorization: `Bearer ${accessToken}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (response.status === 400) throw new GmailProviderError("invalid-history");
  if (response.status === 404) throw new GmailProviderError("stale-history");
  if (!response.ok) throw new GmailProviderError("unavailable");

  let data: Record<string, unknown>;
  let latestHistoryId: string;
  try {
    data = objectValue(await providerJson(response, MAX_HISTORY_RESPONSE_BYTES, signal));
    latestHistoryId = historyId(data.historyId);
  } catch (error) {
    throw responseError(error);
  }
  if (BigInt(latestHistoryId) < BigInt(startHistoryId)) {
    throw new GmailProviderError("invalid-response");
  }

  if (data.history !== undefined) {
    if (!Array.isArray(data.history) || data.history.length > MAX_HISTORY_RECORDS_PER_PAGE) {
      throw new GmailProviderError("invalid-response");
    }
    for (const historyCandidate of data.history) {
      const history = objectValue(historyCandidate);
      historyId(history.id);
      if (history.messagesAdded === undefined) continue;
      if (
        !Array.isArray(history.messagesAdded) ||
        history.messagesAdded.length > MAX_CHANGED_MESSAGE_CANDIDATES_PER_PAGE
      ) {
        throw new GmailProviderError("invalid-response");
      }
      for (const addedCandidate of history.messagesAdded) {
        messageCandidateCount += 1;
        if (messageCandidateCount > MAX_CHANGED_MESSAGE_CANDIDATES_PER_PAGE) {
          throw new GmailProviderError("invalid-response");
        }
        const added = objectValue(addedCandidate);
        const message = objectValue(added.message);
        messageIds.add(providerId(message.id));
        if (messageIds.size > MAX_CHANGED_MESSAGE_CANDIDATES_PER_PAGE) {
          throw new GmailProviderError("invalid-response");
        }
      }
    }
  }

  return {
    latestHistoryId,
    messageIds: [...messageIds].sort(),
    ...(data.nextPageToken === undefined
      ? {}
      : { nextPageToken: paginationToken(data.nextPageToken) }),
  };
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*={0,2}$/u.test(value) || value.length > 1_400_000) {
    throw new GmailProviderError("invalid-response");
  }
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new GmailProviderError("invalid-response");
  }
}

function truncateUtf8(value: string, maximumBytes: number): { truncated: boolean; value: string } {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= maximumBytes) return { truncated: false, value };
  for (let end = maximumBytes; end >= 0; end -= 1) {
    try {
      return {
        truncated: true,
        value: new TextDecoder("utf-8", { fatal: true }).decode(encoded.subarray(0, end)),
      };
    } catch {
      // Back up at most one UTF-8 code point to preserve a valid deterministic boundary.
    }
  }
  return { truncated: true, value: "" };
}

function headerValue(
  headers: unknown,
  expectedName: "from" | "subject",
  maximumBytes: number,
): { truncated: boolean; value?: string } {
  if (headers === undefined) return { truncated: false };
  if (!Array.isArray(headers)) throw new GmailProviderError("invalid-response");
  const headerListTruncated = headers.length > 200;
  for (const candidate of headers.slice(0, 200)) {
    const header = objectValue(candidate);
    if (
      typeof header.name !== "string" ||
      header.name.length > 256 ||
      typeof header.value !== "string" ||
      header.value.length > 32_768
    ) {
      throw new GmailProviderError("invalid-response");
    }
    if (header.name.toLowerCase() === expectedName) {
      const truncated = truncateUtf8(header.value, maximumBytes);
      return {
        truncated: headerListTruncated || truncated.truncated,
        value: truncated.value,
      };
    }
  }
  return { truncated: headerListTruncated };
}

type TextExtraction = {
  body?: string;
  bytes: number;
  truncated: boolean;
};

function extractText(payloadCandidate: unknown): TextExtraction {
  const chunks: Uint8Array[] = [];
  let sourceBytes = 0;
  let retainedBytes = 0;
  let partCount = 0;
  let truncated = false;

  const visit = (candidate: unknown, depth: number): void => {
    partCount += 1;
    if (partCount > MAX_MIME_PARTS || depth > 20) {
      truncated = true;
      return;
    }
    const part = objectValue(candidate);
    if (typeof part.mimeType !== "string" || part.mimeType.length > 256) {
      throw new GmailProviderError("invalid-response");
    }
    const filename = part.filename;
    if (filename !== undefined && (typeof filename !== "string" || filename.length > 1024)) {
      throw new GmailProviderError("invalid-response");
    }
    if (part.mimeType.toLowerCase() === "text/plain") {
      const body = objectValue(part.body);
      const namedPart = typeof filename === "string" && filename.length > 0;
      let decodedBytes = 0;
      if (body.data !== undefined) {
        if (typeof body.data !== "string") throw new GmailProviderError("invalid-response");
        const decoded = decodeBase64Url(body.data);
        decodedBytes = decoded.byteLength;
        if (namedPart) {
          truncated = true;
        } else {
          sourceBytes += decoded.byteLength;
          const remaining = Math.max(0, MAX_GMAIL_BODY_BYTES - retainedBytes);
          if (remaining > 0) {
            const retained = decoded.subarray(0, remaining);
            chunks.push(retained);
            retainedBytes += retained.byteLength;
          }
          if (decoded.byteLength > remaining) truncated = true;
        }
      }
      if (body.size !== undefined && (!Number.isSafeInteger(body.size) || Number(body.size) < 0)) {
        throw new GmailProviderError("invalid-response");
      }
      if (
        typeof body.size === "number" &&
        (body.size > decodedBytes || (namedPart && body.size > 0))
      ) {
        truncated = true;
      }
      if (body.attachmentId !== undefined) {
        paginationToken(body.attachmentId);
        truncated = true;
      }
    }
    if (part.parts !== undefined) {
      if (!Array.isArray(part.parts)) throw new GmailProviderError("invalid-response");
      if (part.parts.length > MAX_MIME_PARTS) truncated = true;
      for (const child of part.parts.slice(0, MAX_MIME_PARTS)) visit(child, depth + 1);
    }
  };

  visit(payloadCandidate, 0);
  if (chunks.length === 0) return { bytes: sourceBytes, truncated };
  const joinedBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0) + chunks.length - 1;
  const joined = new Uint8Array(Math.min(joinedBytes, MAX_GMAIL_BODY_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset > 0 && offset < joined.length) joined[offset++] = 10;
    const retained = chunk.subarray(0, joined.length - offset);
    joined.set(retained, offset);
    offset += retained.byteLength;
    if (retained.byteLength < chunk.byteLength) truncated = true;
  }
  const decoded = truncateUtf8(
    new TextDecoder("utf-8").decode(joined.subarray(0, offset)),
    MAX_GMAIL_BODY_BYTES,
  );
  return {
    body: decoded.value,
    bytes: sourceBytes,
    truncated: truncated || decoded.truncated,
  };
}

function uuidBytes(value: string): Uint8Array {
  return Uint8Array.from(value.replace(/-/g, "").match(/.{2}/gu) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
}

export async function gmailEnvelopeId(connectionId: string, messageId: string): Promise<string> {
  const namespace = uuidBytes(GMAIL_ENVELOPE_NAMESPACE);
  const name = new TextEncoder().encode(`${connectionId}\u0000${messageId}`);
  const input = new Uint8Array(namespace.byteLength + name.byteLength);
  input.set(namespace);
  input.set(name, namespace.byteLength);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", input));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function serializedEnvelopeBytes(envelope: IngressEnvelope): number {
  return new TextEncoder().encode(JSON.stringify(envelope)).byteLength;
}

function fitStringField(
  envelope: IngressEnvelope,
  field: "body" | "sender" | "subject",
): IngressEnvelope {
  const value = envelope[field];
  if (value === undefined) return envelope;
  const sourceBytes = new TextEncoder().encode(value).byteLength;
  let lower = 0;
  let upper = sourceBytes;
  let fitted = "";
  while (lower <= upper) {
    const midpoint = Math.floor((lower + upper) / 2);
    const candidate = truncateUtf8(value, midpoint).value;
    const changed = { ...envelope, [field]: candidate };
    if (serializedEnvelopeBytes(changed) <= MAX_GMAIL_ENVELOPE_SERIALIZED_BYTES) {
      fitted = candidate;
      lower = midpoint + 1;
    } else {
      upper = midpoint - 1;
    }
  }
  return { ...envelope, [field]: fitted };
}

function fitGmailEnvelopeToQueueBudget(envelope: IngressEnvelope): IngressEnvelope {
  if (serializedEnvelopeBytes(envelope) <= MAX_GMAIL_ENVELOPE_SERIALIZED_BYTES) return envelope;
  let bounded: IngressEnvelope = {
    ...envelope,
    attributes: {
      ...envelope.attributes,
      gmailBodyTruncated: true,
      gmailQueueTruncated: true,
    },
  };
  for (const field of ["body", "subject", "sender"] as const) {
    bounded = fitStringField(bounded, field);
    bounded = {
      ...bounded,
      attributes: {
        ...bounded.attributes,
        ...(field === "sender" ? { gmailSenderTruncated: true } : {}),
        ...(field === "subject" ? { gmailSubjectTruncated: true } : {}),
      },
    };
    if (serializedEnvelopeBytes(bounded) <= MAX_GMAIL_ENVELOPE_SERIALIZED_BYTES) return bounded;
  }
  const labels = bounded.attributes.gmailLabelIds;
  if (Array.isArray(labels)) {
    while (
      labels.length > 0 &&
      serializedEnvelopeBytes(bounded) > MAX_GMAIL_ENVELOPE_SERIALIZED_BYTES
    ) {
      labels.pop();
    }
    bounded = {
      ...bounded,
      attributes: { ...bounded.attributes, gmailLabelIds: labels, gmailMetadataTruncated: true },
    };
  }
  if (serializedEnvelopeBytes(bounded) > MAX_GMAIL_ENVELOPE_SERIALIZED_BYTES) {
    throw new GmailProviderError("invalid-response");
  }
  return bounded;
}

export async function fetchCanonicalGmailEnvelope(
  accessToken: string,
  connectionId: string,
  messageId: string,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<IngressEnvelope | undefined> {
  const url = new URL(`${GMAIL_API_ROOT}/messages/${encodeURIComponent(providerId(messageId))}`);
  url.searchParams.set("format", "full");
  url.searchParams.set("fields", "id,threadId,internalDate,labelIds,payload");
  const response = await fetcher(url.toString(), {
    headers: { authorization: `Bearer ${accessToken}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new GmailProviderError("unavailable");

  let data: Record<string, unknown>;
  try {
    data = objectValue(await providerJson(response, MAX_MESSAGE_RESPONSE_BYTES, signal));
  } catch (error) {
    throw responseError(error);
  }
  const returnedMessageId = providerId(data.id);
  if (returnedMessageId !== messageId) throw new GmailProviderError("invalid-response");
  const threadId = providerId(data.threadId);
  const internalDate = historyId(data.internalDate);
  const milliseconds = BigInt(internalDate);
  if (milliseconds > 8_640_000_000_000_000n) throw new GmailProviderError("invalid-response");
  let occurredAt: string;
  try {
    occurredAt = new Date(Number(milliseconds)).toISOString();
  } catch {
    throw new GmailProviderError("invalid-response");
  }
  const payload = objectValue(data.payload);
  const sender = headerValue(payload.headers, "from", 1024);
  const subject = headerValue(payload.headers, "subject", 4096);
  const text = extractText(payload);
  if (data.labelIds !== undefined && !Array.isArray(data.labelIds)) {
    throw new GmailProviderError("invalid-response");
  }
  const labelCandidates = (data.labelIds ?? []) as unknown[];
  const metadataTruncated = labelCandidates.length > 100;
  const labels = labelCandidates.slice(0, 100).map(providerId).sort();

  return fitGmailEnvelopeToQueueBudget({
    schemaVersion: 1,
    id: await gmailEnvelopeId(connectionId, messageId),
    occurredAt,
    capturedAt: occurredAt,
    source: { kind: "gmail", externalId: messageId, accountId: connectionId },
    ...(sender.value === undefined ? {} : { sender: sender.value }),
    ...(subject.value === undefined ? {} : { subject: subject.value }),
    ...(text.body === undefined ? {} : { body: text.body }),
    attributes: {
      gmailBodyBytes: text.bytes,
      gmailBodyTruncated: text.truncated,
      gmailLabelIds: [...new Set(labels)],
      gmailMetadataTruncated: metadataTruncated,
      gmailSenderTruncated: sender.truncated,
      gmailSubjectTruncated: subject.truncated,
      gmailThreadId: threadId,
    },
  });
}

export type GmailWatch = { expiration: string; historyId: string };

export async function createGmailWatch(
  accessToken: string,
  configuration: GmailProviderConfiguration,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
  nowMs: number = Date.now(),
): Promise<GmailWatch> {
  const response = await fetcher(`${GMAIL_API_ROOT}/watch`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ topicName: configuration.topicName }),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) {
    throw new GmailProviderError(
      DEFINITIVE_WATCH_REJECTION_STATUSES.has(response.status) ? "request-rejected" : "unavailable",
    );
  }
  let data: Record<string, unknown>;
  try {
    data = objectValue(await providerJson(response, MAX_TOKEN_RESPONSE_BYTES, signal));
  } catch (error) {
    throw responseError(error);
  }
  const responseHistoryId = historyId(data.historyId);
  const expirationId = historyId(data.expiration);
  const expirationMs = BigInt(expirationId);
  if (expirationMs > 8_640_000_000_000_000n) throw new GmailProviderError("invalid-response");
  let expiration: string;
  try {
    expiration = new Date(Number(expirationMs)).toISOString();
  } catch {
    throw new GmailProviderError("invalid-response");
  }
  const expirationMilliseconds = Date.parse(expiration);
  if (
    expirationMilliseconds <= nowMs ||
    expirationMilliseconds >
      nowMs + GMAIL_WATCH_MAX_LIFETIME_MS + GMAIL_WATCH_EXPIRATION_TOLERANCE_MS
  ) {
    throw new GmailProviderError("invalid-response");
  }
  return { expiration, historyId: responseHistoryId };
}

export async function stopGmailWatch(
  accessToken: string,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetcher(`${GMAIL_API_ROOT}/stop`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new GmailProviderError("unavailable");
}

export async function revokeGoogleRefreshToken(
  refreshToken: string,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<void> {
  if (refreshToken.length === 0 || refreshToken.length > 8192) {
    throw new GmailProviderError("unavailable");
  }
  const response = await fetcher(GOOGLE_REVOKE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
    ...(signal === undefined ? {} : { signal }),
  });
  if (response.ok) return;
  if (response.status === 400) {
    try {
      const data = objectValue(await providerJson(response, MAX_TOKEN_RESPONSE_BYTES, signal));
      if (data.error === "invalid_token") return;
    } catch {
      // A malformed provider error is not proof that credential revocation completed.
    }
  }
  throw new GmailProviderError("unavailable");
}
