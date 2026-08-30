import {
  buildCallbackUrl,
  clearOAuthCookie,
  DuplicateGmailConnectionError,
  exchangeCodeForTokens,
  fetchGmailAddress,
  loadGmailEnv,
  parseOAuthCookie,
  persistConnection,
} from "../../../../../lib/gmail";
import { loggedErrorResponse } from "../../../../../lib/observability";

export async function GET(request: Request) {
  const env = loadGmailEnv();
  if (env === null) {
    return Response.json(
      { error: { code: "gmail_not_configured", message: "Gmail connector is not configured" } },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  // Google may redirect with an error (e.g. user denied consent).
  if (errorParam !== null) {
    return Response.json(
      { error: { code: "gmail_oauth_denied", message: "Gmail authorization was denied" } },
      { status: 400, headers: { "set-cookie": clearOAuthCookie() } },
    );
  }

  if (code === null || code.length === 0 || code.length > 4096 || stateParam === null) {
    return Response.json(
      { error: { code: "invalid_callback", message: "Missing authorization code or state" } },
      { status: 400, headers: { "set-cookie": clearOAuthCookie() } },
    );
  }

  // Validate state against cookie to prevent callback substitution.
  const oauthSession = await parseOAuthCookie(request, env);
  if (oauthSession === null) {
    return Response.json(
      { error: { code: "invalid_state", message: "OAuth session expired or missing" } },
      { status: 400, headers: { "set-cookie": clearOAuthCookie() } },
    );
  }

  if (oauthSession.state !== stateParam) {
    return Response.json(
      { error: { code: "state_mismatch", message: "OAuth state validation failed" } },
      { status: 400, headers: { "set-cookie": clearOAuthCookie() } },
    );
  }

  const redirectUri = buildCallbackUrl(request);

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, oauthSession.codeVerifier, redirectUri, env);
  } catch (error: unknown) {
    return loggedErrorResponse(
      request,
      error,
      {
        code: "GMAIL_TOKEN_EXCHANGE_FAILED",
        event: "connector.oauth_exchange_failed",
        integration: "google-gmail",
        operation: "exchangeCodeForTokens",
      },
      Response.json(
        {
          error: {
            code: "token_exchange_failed",
            message: "Failed to exchange authorization code",
          },
        },
        { status: 502, headers: { "set-cookie": clearOAuthCookie() } },
      ),
    );
  }

  const grantedScopes = tokens.scope.split(" ").filter((scope: string) => scope.length > 0);
  if (!grantedScopes.includes("https://www.googleapis.com/auth/gmail.readonly")) {
    return Response.json(
      { error: { code: "gmail_scope_missing", message: "Required Gmail scope was not granted" } },
      { status: 403, headers: { "set-cookie": clearOAuthCookie() } },
    );
  }

  let email;
  try {
    email = await fetchGmailAddress(tokens.accessToken);
  } catch (error: unknown) {
    return loggedErrorResponse(
      request,
      error,
      {
        code: "GMAIL_PROFILE_FAILED",
        event: "connector.profile_request_failed",
        integration: "google-gmail",
        operation: "fetchGmailAddress",
      },
      Response.json(
        {
          error: {
            code: "gmail_address_unavailable",
            message: "Could not retrieve Gmail address",
          },
        },
        { status: 502, headers: { "set-cookie": clearOAuthCookie() } },
      ),
    );
  }

  let connection;
  try {
    connection = await persistConnection(
      oauthSession.userId,
      email,
      tokens.refreshToken,
      grantedScopes,
      env,
    );
  } catch (error) {
    const isDuplicate = error instanceof DuplicateGmailConnectionError;
    const response = Response.json(
      {
        error: {
          code: isDuplicate ? "duplicate_connection" : "connection_failed",
          message: isDuplicate
            ? "Gmail account is already connected"
            : "Failed to store connection",
        },
      },
      { status: isDuplicate ? 409 : 500, headers: { "set-cookie": clearOAuthCookie() } },
    );
    return isDuplicate
      ? response
      : loggedErrorResponse(
          request,
          error,
          {
            code: "GMAIL_CONNECTION_FAILED",
            event: "connector.connection_failed",
            integration: "supabase",
            operation: "persistGmailConnection",
          },
          response,
        );
  }

  return Response.json(
    {
      connected: true,
      connectionId: connection.id,
      email,
      scopes: grantedScopes,
    },
    { status: 200, headers: { "set-cookie": clearOAuthCookie() } },
  );
}
