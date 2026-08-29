import { createClient } from "@supabase/supabase-js";

import { canonicalUuidSchema, encryptedValueSchema } from "@relay/contracts";
import { decryptValue, encryptValue, parseKekKeyring } from "@relay/crypto";

import type { Database } from "../../../supabase/database.generated";

// Minimum scopes required for Gmail History/message retrieval.
const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const OAUTH_COOKIE_NAME = "relay_gmail_oauth";
const OAUTH_COOKIE_MAX_AGE_SECONDS = 600;
const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_PROFILE_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const OAUTH_COOKIE_CONTEXT = "oauth:gmail:cookie:v1";
const MAX_OAUTH_RESPONSE_BYTES = 32_768;

export type GmailEnv = {
  googleClientId: string;
  googleClientSecret: string;
  kekKeyring: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  relayEnvironment: string;
};

export class DuplicateGmailConnectionError extends Error {
  constructor() {
    super("Gmail connection already exists");
  }
}

export function loadGmailEnv(): GmailEnv | null {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const kekKeyring = process.env.RELAY_CREDENTIAL_KEK_KEYRING;
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const relayEnvironment = process.env.RELAY_ENVIRONMENT ?? "development";

  if (
    googleClientId === undefined ||
    googleClientSecret === undefined ||
    kekKeyring === undefined ||
    supabaseUrl === undefined ||
    supabaseServiceRoleKey === undefined
  ) {
    return null;
  }

  return {
    googleClientId,
    googleClientSecret,
    kekKeyring,
    supabaseUrl,
    supabaseServiceRoleKey,
    relayEnvironment,
  };
}

function serviceClient(env: GmailEnv) {
  return createClient<Database>(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("OAuth cookie is invalid");
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function generateCodeVerifier(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return bytesToBase64Url(new Uint8Array(digest));
}

export function generateState(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

// ---------------------------------------------------------------------------
// Cookie-based OAuth state
// ---------------------------------------------------------------------------

type OAuthCookiePayload = {
  state: string;
  codeVerifier: string;
  userId: string;
  expiresAt: number;
};

export async function buildOAuthCookie(
  state: string,
  codeVerifier: string,
  userId: string,
  env: GmailEnv,
): Promise<string> {
  const payload: OAuthCookiePayload = {
    state,
    codeVerifier,
    userId,
    expiresAt: Date.now() + OAUTH_COOKIE_MAX_AGE_SECONDS * 1000,
  };
  const encrypted = await encryptValue(
    JSON.stringify(payload),
    parseKekKeyring(env.kekKeyring),
    OAUTH_COOKIE_CONTEXT,
  );
  const encoded = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(encrypted)));
  const parts = [
    `${OAUTH_COOKIE_NAME}=${encoded}`,
    "HttpOnly",
    "Path=/api/connectors/gmail",
    `Max-Age=${OAUTH_COOKIE_MAX_AGE_SECONDS.toString()}`,
    `SameSite=Lax`,
    "Secure",
  ];
  return parts.join("; ");
}

export async function parseOAuthCookie(
  request: Request,
  env: GmailEnv,
): Promise<OAuthCookiePayload | null> {
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader === null) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${OAUTH_COOKIE_NAME}=([^;]+)`));
  if (match === null || match[1] === undefined) return null;
  try {
    const encryptedCandidate = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(match[1])),
    ) as unknown;
    const encrypted = encryptedValueSchema.parse(encryptedCandidate);
    const payload = JSON.parse(
      await decryptValue(encrypted, parseKekKeyring(env.kekKeyring), OAUTH_COOKIE_CONTEXT),
    ) as unknown;
    if (typeof payload !== "object" || payload === null) return null;
    const candidate = payload as Record<string, unknown>;
    const parsedUserId = canonicalUuidSchema.safeParse(candidate.userId);
    if (
      Object.keys(candidate).length !== 4 ||
      typeof candidate.state !== "string" ||
      !/^[A-Za-z0-9_-]{43,128}$/u.test(candidate.state) ||
      typeof candidate.codeVerifier !== "string" ||
      !/^[A-Za-z0-9_-]{43,128}$/u.test(candidate.codeVerifier) ||
      typeof candidate.userId !== "string" ||
      !parsedUserId.success ||
      typeof candidate.expiresAt !== "number" ||
      !Number.isSafeInteger(candidate.expiresAt)
    ) {
      return null;
    }
    if (
      candidate.expiresAt <= Date.now() ||
      candidate.expiresAt > Date.now() + OAUTH_COOKIE_MAX_AGE_SECONDS * 1000
    ) {
      return null;
    }
    return {
      state: candidate.state,
      codeVerifier: candidate.codeVerifier,
      userId: parsedUserId.data,
      expiresAt: candidate.expiresAt,
    };
  } catch {
    return null;
  }
}

export function clearOAuthCookie(): string {
  const parts = [
    `${OAUTH_COOKIE_NAME}=`,
    "HttpOnly",
    "Path=/api/connectors/gmail",
    "Max-Age=0",
    "SameSite=Lax",
    "Secure",
  ];
  return parts.join("; ");
}

// ---------------------------------------------------------------------------
// Google OAuth URL
// ---------------------------------------------------------------------------

export function buildCallbackUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.origin}/api/connectors/gmail/callback`;
}

export async function buildGoogleAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  codeVerifier: string,
): Promise<string> {
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

type TokenResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
};

async function readBoundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/u.test(contentLength) || Number(contentLength) > maximumBytes)
  ) {
    throw new Error("Provider response is invalid");
  }
  if (response.body === null) throw new Error("Provider response is invalid");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > maximumBytes) {
      await reader.cancel();
      throw new Error("Provider response is invalid");
    }
    chunks.push(next.value);
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(combined)) as unknown;
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string,
  env: GmailEnv,
): Promise<TokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    throw new Error("Token exchange failed");
  }

  const candidate = await readBoundedJson(response, MAX_OAUTH_RESPONSE_BYTES);
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw new Error("Token exchange returned invalid response");
  }
  const data = candidate as Record<string, unknown>;
  const accessToken = data.access_token;
  const refreshToken = data.refresh_token;
  const expiresIn = data.expires_in;
  const scope = data.scope;

  if (
    typeof accessToken !== "string" ||
    accessToken.length === 0 ||
    accessToken.length > 8192 ||
    typeof refreshToken !== "string" ||
    refreshToken.length === 0 ||
    refreshToken.length > 8192 ||
    typeof expiresIn !== "number" ||
    !Number.isSafeInteger(expiresIn) ||
    expiresIn < 1 ||
    expiresIn > 86_400 ||
    typeof scope !== "string" ||
    scope.length === 0 ||
    scope.length > 8192
  ) {
    throw new Error("Token exchange returned invalid response");
  }

  return { accessToken, refreshToken, expiresIn, scope };
}

// ---------------------------------------------------------------------------
// Google user info
// ---------------------------------------------------------------------------

export async function fetchGmailAddress(accessToken: string): Promise<string> {
  const response = await fetch(GOOGLE_PROFILE_ENDPOINT, {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error("Failed to retrieve Gmail address");
  }

  const candidate = await readBoundedJson(response, MAX_OAUTH_RESPONSE_BYTES);
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw new Error("Gmail address unavailable");
  }
  const data = candidate as Record<string, unknown>;
  if (typeof data.emailAddress !== "string") {
    throw new Error("Gmail address unavailable");
  }

  return normalizeGmailMailbox(data.emailAddress);
}

export function normalizeGmailMailbox(value: string): string {
  const normalized = value.trim().toLowerCase();
  const hasForbiddenCharacter = [...normalized].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return /\s/u.test(character) || codePoint <= 31 || codePoint === 127;
  });
  if (
    normalized.length < 3 ||
    normalized.length > 320 ||
    !normalized.includes("@") ||
    hasForbiddenCharacter
  ) {
    throw new Error("Gmail address unavailable");
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// Connection persistence
// ---------------------------------------------------------------------------

function base64ToPostgresBytea(value: string): string {
  const binary = atob(value);
  let hex = "";
  for (let index = 0; index < binary.length; index += 1) {
    hex += binary.charCodeAt(index).toString(16).padStart(2, "0");
  }
  return `\\x${hex}`;
}

function connectionCredentialContext(userId: string, connectionId: string): string {
  return `connection:${userId}:${connectionId}:credential`;
}

export async function persistConnection(
  userId: string,
  email: string,
  refreshToken: string,
  grantedScopes: string[],
  env: GmailEnv,
): Promise<{ id: string }> {
  const keyring = parseKekKeyring(env.kekKeyring);
  // Generate connection ID before encryption so we can bind context to it.
  const connectionId = crypto.randomUUID();
  const context = connectionCredentialContext(userId, connectionId);
  const encrypted = await encryptValue(refreshToken, keyring, context);

  const supabase = serviceClient(env);
  const normalizedEmail = normalizeGmailMailbox(email);
  const { data, error } = await supabase.rpc("create_gmail_connection_v1", {
    p_id: connectionId,
    p_user_id: userId,
    p_normalized_email: normalizedEmail,
    p_credential_ciphertext: base64ToPostgresBytea(encrypted.ciphertext),
    p_credential_nonce: base64ToPostgresBytea(encrypted.nonce),
    p_wrapped_data_key: base64ToPostgresBytea(encrypted.wrappedKey),
    p_wrap_nonce: base64ToPostgresBytea(encrypted.wrapNonce),
    p_key_version: encrypted.keyVersion,
    p_encryption_environment: env.relayEnvironment,
    p_scopes: grantedScopes,
  });

  if (error !== null) {
    if (error.code === "23505") {
      throw new DuplicateGmailConnectionError();
    }
    throw new Error("Failed to persist connection");
  }
  const persistedId = canonicalUuidSchema.safeParse(data);
  if (!persistedId.success || persistedId.data !== connectionId) {
    throw new Error("Failed to persist connection");
  }
  return { id: persistedId.data };
}
