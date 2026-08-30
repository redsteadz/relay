import {
  gmailPubSubPushSchema,
  gmailPushCursorPayloadSchema,
  verifiedGmailCursorSchema,
  type VerifiedGmailCursor,
} from "@relay/contracts";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

import { publishGmailCursor } from "./pipeline";

const GOOGLE_JWKS_URL = new URL("https://www.googleapis.com/oauth2/v3/certs");
const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"] as const;
const GOOGLE_REMOTE_JWKS = createRemoteJWKSet(GOOGLE_JWKS_URL);
const MAX_BEARER_TOKEN_BYTES = 8192;
export const MAX_GMAIL_PUSH_BODY_BYTES = 16_384;

export type GmailPushConfiguration = {
  audience: string;
  serviceAccountEmail: string;
};

type GmailPushDependencies = {
  parseRequest: (request: Request) => Promise<VerifiedGmailCursor>;
  publish: (cursor: VerifiedGmailCursor) => Promise<Response>;
  verify: (token: string, configuration: GmailPushConfiguration) => Promise<void>;
};

export function loadGmailPushConfiguration(): GmailPushConfiguration | null {
  const audience = process.env.GOOGLE_PUBSUB_AUDIENCE;
  const serviceAccountEmail = process.env.GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL;
  if (
    audience === undefined ||
    audience.length === 0 ||
    audience.trim() !== audience ||
    audience.length > 2048 ||
    serviceAccountEmail === undefined ||
    serviceAccountEmail.length < 3 ||
    serviceAccountEmail.length > 320 ||
    serviceAccountEmail.trim() !== serviceAccountEmail ||
    serviceAccountEmail !== serviceAccountEmail.toLowerCase() ||
    !serviceAccountEmail.includes("@")
  ) {
    return null;
  }
  return { audience, serviceAccountEmail };
}

export async function verifyPubSubBearerJwt(
  token: string,
  configuration: GmailPushConfiguration,
  keyResolver: JWTVerifyGetKey = GOOGLE_REMOTE_JWKS,
): Promise<void> {
  const result = await jwtVerify(token, keyResolver, {
    algorithms: ["RS256"],
    audience: configuration.audience,
    issuer: [...GOOGLE_ISSUERS],
    requiredClaims: ["aud", "email", "email_verified", "exp", "iss"],
  });
  if (
    result.payload.aud !== configuration.audience ||
    result.payload.email !== configuration.serviceAccountEmail ||
    result.payload.email_verified !== true
  ) {
    throw new Error("Pub/Sub authentication failed");
  }
}

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_GMAIL_PUSH_BODY_BYTES)
  ) {
    throw new Error("Push request is invalid");
  }
  if (request.body === null) throw new Error("Push request is invalid");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > MAX_GMAIL_PUSH_BODY_BYTES) {
      await reader.cancel();
      throw new Error("Push request is invalid");
    }
    chunks.push(next.value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  );
}

export async function parseVerifiedGmailPush(request: Request): Promise<VerifiedGmailCursor> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new Error("Push request is invalid");
  }
  const body = await readBoundedBody(request);
  const wrapper = gmailPubSubPushSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown,
  );
  const decoded = gmailPushCursorPayloadSchema.parse(
    JSON.parse(decodeBase64Url(wrapper.message.data)) as unknown,
  );
  return verifiedGmailCursorSchema.parse({
    schemaVersion: 1,
    emailAddress: decoded.emailAddress.trim().toLowerCase(),
    historyId: decoded.historyId,
  });
}

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status });
}

export async function handleGmailPush(
  request: Request,
  dependencies: GmailPushDependencies = {
    parseRequest: parseVerifiedGmailPush,
    publish: publishGmailCursor,
    verify: verifyPubSubBearerJwt,
  },
): Promise<Response> {
  const configuration = loadGmailPushConfiguration();
  if (configuration === null) {
    return errorResponse("gmail_push_not_configured", "Gmail push is not configured", 503);
  }

  const authorization = request.headers.get("authorization");
  const match = authorization === null ? null : /^Bearer ([^\s]+)$/u.exec(authorization);
  if (
    match?.[1] === undefined ||
    new TextEncoder().encode(match[1]).byteLength > MAX_BEARER_TOKEN_BYTES
  ) {
    return errorResponse("gmail_push_unauthorized", "Gmail push authentication failed", 401);
  }
  try {
    await dependencies.verify(match[1], configuration);
  } catch {
    return errorResponse("gmail_push_unauthorized", "Gmail push authentication failed", 401);
  }

  let cursor: VerifiedGmailCursor;
  try {
    cursor = await dependencies.parseRequest(request);
  } catch {
    return errorResponse("gmail_push_invalid", "Gmail push request is invalid", 400);
  }

  let pipelineResponse: Response;
  try {
    pipelineResponse = await dependencies.publish(cursor);
  } catch {
    return errorResponse("gmail_push_unavailable", "Gmail push is temporarily unavailable", 503);
  }
  if (pipelineResponse.ok) return new Response(null, { status: 204 });
  if (pipelineResponse.status === 404 || pipelineResponse.status === 409) {
    return errorResponse(
      "gmail_ownership_unresolved",
      "Gmail push ownership could not be resolved",
      409,
    );
  }
  return errorResponse("gmail_cursor_not_durable", "Gmail cursor was not durably accepted", 503);
}
