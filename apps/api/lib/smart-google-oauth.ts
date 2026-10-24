import { googleServiceSchema, encryptedValueSchema, type GoogleService } from "@relay/contracts";
import { GOOGLE_SERVICE_SCOPES } from "@relay/domain";
import { encryptValue, decryptValue, parseKekKeyring } from "@relay/crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  fetchGmailAddress,
  persistConnection as persistGmail,
  loadGmailEnv,
  readBoundedJson,
} from "./gmail";
import { AppError } from "@relay/observability";

const jwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const SESSION_MS = 10 * 60_000;
const cookieName = "relay_smart_google_oauth";
type Row = Record<string, unknown>;
function rows(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new Error("Invalid OAuth database response");
  return value as Row[];
}
function environment() {
  const value = loadGmailEnv();
  if (value === null || process.env.RELAY_SMART_GOOGLE_ENABLED !== "true")
    throw new Error("Google integration unavailable");
  return value;
}
async function db(path: string, method: string, body?: unknown): Promise<unknown> {
  const env = environment();
  const response = await fetch(`${env.supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: env.supabaseServiceRoleKey,
      "content-type": "application/json",
      prefer: "return=representation,resolution=merge-duplicates",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new AppError("Google authorization persistence failed", {
      cause: new Error("Database refused operation"),
      code: "SMART_OAUTH_DATABASE_FAILED",
      category: "database",
      integration: "supabase",
      operation: "googleAuthorization",
    });
  return response.status === 204 ? null : response.json();
}
function origin(): string {
  const value = new URL(process.env.RELAY_GOOGLE_REDIRECT_ORIGIN ?? "http://localhost:3000");
  if (
    value.username ||
    value.password ||
    value.pathname !== "/" ||
    value.search ||
    value.hash ||
    (value.protocol !== "https:" &&
      !(
        process.env.NODE_ENV !== "production" &&
        value.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(value.hostname)
      ))
  )
    throw new Error("Invalid OAuth origin");
  return value.origin;
}
export async function startSmartGoogleAuthorization(
  userId: string,
  service: GoogleService,
): Promise<string> {
  const env = environment();
  const sessionId = crypto.randomUUID();
  const verifier = generateCodeVerifier();
  const sealed = await encryptValue(
    JSON.stringify({ verifier }),
    parseKekKeyring(env.kekKeyring),
    `smart-oauth:${userId}:${sessionId}`,
  );
  await db("smart_google_oauth_sessions", "POST", {
    id: sessionId,
    user_id: userId,
    service,
    sealed,
    expires_at: new Date(Date.now() + SESSION_MS).toISOString(),
  });
  return `${origin()}/api/smart-automations/oauth/${service}/launch?session=${sessionId}`;
}
export async function launchSmartGoogleAuthorization(
  service: GoogleService,
  sessionId: string,
): Promise<Response> {
  const env = environment();
  const sessions = rows(
    await db(
      `smart_google_oauth_sessions?id=eq.${sessionId}&service=eq.${service}&launched=eq.false&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`,
      "PATCH",
      { launched: true },
    ),
  );
  if (sessions.length !== 1)
    return Response.json({ error: { code: "invalid_oauth_session" } }, { status: 400 });
  const session = sessions[0]!;
  const value: unknown = JSON.parse(
    await decryptValue(
      encryptedValueSchema.parse(session.sealed),
      parseKekKeyring(env.kekKeyring),
      `smart-oauth:${String(session.user_id)}:${sessionId}`,
    ),
  );
  const verifier = (value as { verifier: string }).verifier;
  const callback = `${origin()}/api/smart-automations/oauth/${service}/callback`;
  const parameters = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: callback,
    response_type: "code",
    scope: ["openid", ...GOOGLE_SERVICE_SCOPES[service]].join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state: sessionId,
    nonce: sessionId,
    code_challenge: await generateCodeChallenge(verifier),
    code_challenge_method: "S256",
  });
  return new Response(null, {
    status: 302,
    headers: {
      location: `https://accounts.google.com/o/oauth2/v2/auth?${parameters}`,
      "cache-control": "no-store",
      "set-cookie": `${cookieName}=${sessionId}; HttpOnly; SameSite=Lax; Path=/api/smart-automations/oauth; Max-Age=600${origin().startsWith("https:") ? "; Secure" : ""}`,
    },
  });
}
function bytea(base64: string): string {
  return (
    "\\x" +
    Array.from(atob(base64), (character) =>
      character.charCodeAt(0).toString(16).padStart(2, "0"),
    ).join("")
  );
}
export async function finishSmartGoogleAuthorization(
  request: Request,
  service: GoogleService,
  sessionId: string,
  code: string,
): Promise<Response> {
  const env = environment();
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  if (cookie !== sessionId)
    return Response.json({ error: { code: "invalid_oauth_state" } }, { status: 400 });
  // Deletion consumes the session atomically before exchanging the code; retries need a fresh flow.
  const sessions = rows(
    await db(
      `smart_google_oauth_sessions?id=eq.${sessionId}&service=eq.${service}&launched=eq.true&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`,
      "DELETE",
    ),
  );
  if (sessions.length !== 1)
    return Response.json({ error: { code: "oauth_session_expired" } }, { status: 400 });
  const session = sessions[0]!;
  const userId = String(session.user_id);
  const payload = JSON.parse(
    await decryptValue(
      encryptedValueSchema.parse(session.sealed),
      parseKekKeyring(env.kekKeyring),
      `smart-oauth:${userId}:${sessionId}`,
    ),
  ) as { verifier: string };
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      code_verifier: payload.verifier,
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      redirect_uri: `${origin()}/api/smart-automations/oauth/${service}/callback`,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Google code exchange refused");
  const candidate = await readBoundedJson(response, 65_536);
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate))
    throw new Error("Google token response invalid");
  const token = candidate as {
    access_token?: unknown;
    refresh_token?: unknown;
    scope?: unknown;
    id_token?: unknown;
  };
  if (
    typeof token.access_token !== "string" ||
    typeof token.refresh_token !== "string" ||
    token.refresh_token.length > 8192 ||
    typeof token.scope !== "string" ||
    typeof token.id_token !== "string"
  )
    throw new Error("Google token response invalid");
  const verified = await jwtVerify(token.id_token, jwks, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: env.googleClientId,
    algorithms: ["RS256"],
  });
  if (verified.payload.nonce !== sessionId || typeof verified.payload.sub !== "string")
    throw new Error("Google identity invalid");
  const scopes = token.scope.split(" ");
  if (!GOOGLE_SERVICE_SCOPES[service].every((scope) => scopes.includes(scope)))
    throw new Error("Required permissions not granted");
  let connectionId: string;
  if (service === "gmail") {
    const address = await fetchGmailAddress(token.access_token);
    connectionId = (await persistGmail(userId, address, token.refresh_token, scopes, env)).id;
  } else {
    const existing = rows(
      await db(
        `connections?user_id=eq.${userId}&provider=eq.${service}&select=id,external_account_id`,
        "GET",
      ),
    );
    if (
      existing.length > 1 ||
      (existing[0] !== undefined && existing[0].external_account_id !== verified.payload.sub)
    )
      throw new Error("Existing Google account differs; disconnect it first");
    connectionId = existing[0] === undefined ? crypto.randomUUID() : String(existing[0].id);
    const encrypted = await encryptValue(
      token.refresh_token,
      parseKekKeyring(env.kekKeyring),
      `connection:${userId}:${connectionId}:credential`,
    );
    await db("connections?on_conflict=id", "POST", {
      id: connectionId,
      user_id: userId,
      provider: service,
      external_account_id: verified.payload.sub,
      credential_ciphertext: bytea(encrypted.ciphertext),
      credential_nonce: bytea(encrypted.nonce),
      wrapped_data_key: bytea(encrypted.wrappedKey),
      wrap_nonce: bytea(encrypted.wrapNonce),
      key_version: encrypted.keyVersion,
      encryption_environment: env.relayEnvironment,
      scopes,
      status: "active",
    });
  }
  await db("smart_google_services?on_conflict=user_id,service", "POST", {
    user_id: userId,
    service,
    connection_id: connectionId,
    enabled: service === "gmail",
    permission_required: false,
  });
  return new Response(
    "Google service connected. Return to Relay and refresh Smart Automations to configure its destination.",
    {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": `${cookieName}=; HttpOnly; SameSite=Lax; Path=/api/smart-automations/oauth; Max-Age=0`,
      },
    },
  );
}
export { googleServiceSchema };
