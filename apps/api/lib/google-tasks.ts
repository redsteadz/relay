import { createClient } from "@supabase/supabase-js";

import { decryptValue, encryptValue, parseKekKeyring } from "@relay/crypto";

import type { Database } from "../../../supabase/database.generated";

// Google Tasks scope only. Relay's only configured operation is creating a task (see
// docs/integrations/google-tasks.md); a broader profile/email scope is intentionally not
// requested just to label the connection, so no userinfo call is made here at all.
const GOOGLE_TASKS_SCOPES = ["https://www.googleapis.com/auth/tasks"];
const OAUTH_COOKIE_NAME = "relay_google_tasks_oauth";
const OAUTH_COOKIE_MAX_AGE_SECONDS = 600;
const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const GOOGLE_TASKLISTS_ENDPOINT = "https://tasks.googleapis.com/tasks/v1/users/@me/lists";
const PROVIDER = "google-tasks";

export class ConnectionNotFoundError extends Error {}

type GoogleTasksEnv = {
  googleClientId: string;
  googleClientSecret: string;
  kekKeyring: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  relayEnvironment: string;
};

export function loadGoogleTasksEnv(): GoogleTasksEnv | null {
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

function serviceClient(env: GoogleTasksEnv) {
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

export function buildOAuthCookie(state: string, codeVerifier: string, userId: string): string {
  const payload: OAuthCookiePayload = {
    state,
    codeVerifier,
    userId,
    expiresAt: Date.now() + OAUTH_COOKIE_MAX_AGE_SECONDS * 1000,
  };
  const encoded = btoa(JSON.stringify(payload));
  const isProduction = process.env.NODE_ENV === "production";
  const parts = [
    `${OAUTH_COOKIE_NAME}=${encoded}`,
    "HttpOnly",
    "Path=/api/connectors/google-tasks",
    `Max-Age=${OAUTH_COOKIE_MAX_AGE_SECONDS.toString()}`,
    `SameSite=Lax`,
  ];
  if (isProduction) parts.push("Secure");
  return parts.join("; ");
}

export function parseOAuthCookie(request: Request): OAuthCookiePayload | null {
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader === null) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${OAUTH_COOKIE_NAME}=([^;]+)`));
  if (match === null || match[1] === undefined) return null;
  try {
    const payload = JSON.parse(atob(match[1])) as unknown;
    if (typeof payload !== "object" || payload === null) return null;
    const candidate = payload as Record<string, unknown>;
    if (
      typeof candidate.state !== "string" ||
      typeof candidate.codeVerifier !== "string" ||
      typeof candidate.userId !== "string" ||
      typeof candidate.expiresAt !== "number"
    ) {
      return null;
    }
    if (candidate.expiresAt < Date.now()) return null;
    return candidate as OAuthCookiePayload;
  } catch {
    return null;
  }
}

export function clearOAuthCookie(): string {
  const isProduction = process.env.NODE_ENV === "production";
  const parts = [
    `${OAUTH_COOKIE_NAME}=`,
    "HttpOnly",
    "Path=/api/connectors/google-tasks",
    "Max-Age=0",
    "SameSite=Lax",
  ];
  if (isProduction) parts.push("Secure");
  return parts.join("; ");
}

// ---------------------------------------------------------------------------
// Google OAuth URL
// ---------------------------------------------------------------------------

export function buildCallbackUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.origin}/api/connectors/google-tasks/callback`;
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
    scope: GOOGLE_TASKS_SCOPES.join(" "),
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

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string,
  env: GoogleTasksEnv,
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

  if (!response.ok) throw new Error("Token exchange failed");

  const data = (await response.json()) as Record<string, unknown>;
  const accessToken = data.access_token;
  const refreshToken = data.refresh_token;
  const expiresIn = data.expires_in;
  const scope = data.scope;

  if (
    typeof accessToken !== "string" ||
    typeof refreshToken !== "string" ||
    typeof expiresIn !== "number" ||
    typeof scope !== "string"
  ) {
    throw new Error("Token exchange returned invalid response");
  }

  return { accessToken, refreshToken, expiresIn, scope };
}

async function refreshAccessToken(refreshToken: string, env: GoogleTasksEnv): Promise<string> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) throw new Error("Access token refresh failed");

  const data = (await response.json()) as Record<string, unknown>;
  const accessToken = data.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("Access token refresh returned an invalid response");
  }
  return accessToken;
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

function connectionCredentialContext(userId: string, connectionId: string): string {
  return `connection:${userId}:${connectionId}:credential`;
}

export async function persistConnection(
  userId: string,
  refreshToken: string,
  grantedScopes: string[],
  env: GoogleTasksEnv,
): Promise<{ id: string }> {
  const keyring = parseKekKeyring(env.kekKeyring);
  // Generate connection ID before encryption so we can bind context to it.
  const connectionId = crypto.randomUUID();
  const context = connectionCredentialContext(userId, connectionId);
  const encrypted = await encryptValue(refreshToken, keyring, context);

  const supabase = serviceClient(env);
  const { data, error } = await supabase
    .from("connections")
    .insert({
      id: connectionId,
      user_id: userId,
      provider: PROVIDER,
      credential_ciphertext: base64ToPostgresBytea(encrypted.ciphertext),
      credential_nonce: base64ToPostgresBytea(encrypted.nonce),
      wrapped_data_key: base64ToPostgresBytea(encrypted.wrappedKey),
      wrap_nonce: base64ToPostgresBytea(encrypted.wrapNonce),
      key_version: encrypted.keyVersion,
      encryption_environment: env.relayEnvironment,
      scopes: grantedScopes,
      status: "active",
    })
    .select("id")
    .single();

  if (error !== null) {
    if (error.code === "23505") throw new Error("Google Tasks is already connected");
    throw new Error("Failed to persist connection");
  }
  if (data === null) throw new Error("Failed to persist connection");
  return { id: data.id };
}

// ---------------------------------------------------------------------------
// Task lists
// ---------------------------------------------------------------------------

export type TaskListSummary = { id: string; title: string };

async function loadConnectionCredential(
  userId: string,
  env: GoogleTasksEnv,
): Promise<{ connectionId: string; refreshToken: string }> {
  const supabase = serviceClient(env);
  const { data: row } = await supabase
    .from("connections")
    .select(
      "id, credential_ciphertext, credential_nonce, wrapped_data_key, wrap_nonce, key_version",
    )
    .eq("user_id", userId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (row === null) throw new ConnectionNotFoundError("No Google Tasks connection is configured");

  const keyring = parseKekKeyring(env.kekKeyring);
  const context = connectionCredentialContext(userId, row.id);
  const refreshToken = await decryptValue(
    {
      algorithm: "AES-GCM-256",
      ciphertext: postgresByteaToBase64(row.credential_ciphertext),
      nonce: postgresByteaToBase64(row.credential_nonce),
      wrappedKey: postgresByteaToBase64(row.wrapped_data_key),
      wrapNonce: postgresByteaToBase64(row.wrap_nonce),
      keyVersion: row.key_version,
    },
    keyring,
    context,
  );
  return { connectionId: row.id, refreshToken };
}

export async function listTaskLists(
  userId: string,
  env: GoogleTasksEnv,
): Promise<TaskListSummary[]> {
  const { refreshToken } = await loadConnectionCredential(userId, env);
  const accessToken = await refreshAccessToken(refreshToken, env);

  const response = await fetch(GOOGLE_TASKLISTS_ENDPOINT, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error("Failed to list Google Task lists");

  const data = (await response.json()) as Record<string, unknown>;
  const items = data.items;
  if (!Array.isArray(items)) return [];

  const lists: TaskListSummary[] = [];
  for (const item of items) {
    if (
      typeof item === "object" &&
      item !== null &&
      typeof (item as Record<string, unknown>).id === "string" &&
      typeof (item as Record<string, unknown>).title === "string"
    ) {
      lists.push({
        id: (item as Record<string, unknown>).id as string,
        title: (item as Record<string, unknown>).title as string,
      });
    }
  }
  return lists;
}

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

export async function revokeGoogleToken(token: string): Promise<boolean> {
  try {
    const response = await fetch(GOOGLE_REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    return response.ok;
  } catch {
    // Revocation is best-effort; we still delete the local credential.
    return false;
  }
}

export async function disconnectGoogleTasks(
  userId: string,
  connectionId: string,
  env: GoogleTasksEnv,
): Promise<{ deleted: boolean; revoked: boolean }> {
  const supabase = serviceClient(env);

  const { data: row } = await supabase
    .from("connections")
    .select(
      "credential_ciphertext, credential_nonce, wrapped_data_key, wrap_nonce, key_version, provider",
    )
    .eq("id", connectionId)
    .eq("user_id", userId)
    .eq("provider", PROVIDER)
    .single();

  // Nothing to disconnect — report that plainly rather than a spurious success, since a delete
  // of zero matching rows below would otherwise report no error either way.
  if (row === null) return { deleted: false, revoked: false };

  let revoked = false;
  try {
    const keyring = parseKekKeyring(env.kekKeyring);
    const context = connectionCredentialContext(userId, connectionId);
    const refreshToken = await decryptValue(
      {
        algorithm: "AES-GCM-256",
        ciphertext: postgresByteaToBase64(row.credential_ciphertext),
        nonce: postgresByteaToBase64(row.credential_nonce),
        wrappedKey: postgresByteaToBase64(row.wrapped_data_key),
        wrapNonce: postgresByteaToBase64(row.wrap_nonce),
        keyVersion: row.key_version,
      },
      keyring,
      context,
    );
    revoked = await revokeGoogleToken(refreshToken);
  } catch {
    // Revocation failure must not prevent credential deletion.
  }

  // action_rules.connection_id is ON DELETE RESTRICT, so a rule still pointing at this
  // connection would otherwise block deletion. Detach and disable those rules first — the
  // provider is gone, so an enabled rule with no connection could never run correctly.
  const { data: dependentRules } = await supabase
    .from("action_rules")
    .select("id")
    .eq("user_id", userId)
    .eq("connection_id", connectionId);
  const dependentRuleIds = (dependentRules ?? []).map((rule) => rule.id);
  if (dependentRuleIds.length > 0) {
    await supabase
      .from("action_rules")
      .update({ enabled: false, connection_id: null })
      .eq("user_id", userId)
      .in("id", dependentRuleIds);
  }

  const { error } = await supabase
    .from("connections")
    .delete()
    .eq("id", connectionId)
    .eq("user_id", userId)
    .eq("provider", PROVIDER);

  const deleted = error === null;

  if (deleted) {
    await supabase.from("audit_log").insert({
      user_id: userId,
      actor_type: "user",
      actor_id: userId,
      action: "connector.disconnected",
      target_type: "connection",
      target_id: connectionId,
      metadata: { provider: PROVIDER, revoked, disabledRuleCount: dependentRuleIds.length },
    });
  }

  return { deleted, revoked };
}
