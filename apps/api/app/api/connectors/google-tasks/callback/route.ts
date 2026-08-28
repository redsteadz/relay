import {
  buildCallbackUrl,
  clearOAuthCookie,
  exchangeCodeForTokens,
  loadGoogleTasksEnv,
  parseOAuthCookie,
  persistConnection,
} from "../../../../../lib/google-tasks";

export async function GET(request: Request) {
  const env = loadGoogleTasksEnv();
  if (env === null) {
    return Response.json(
      {
        error: {
          code: "google_tasks_not_configured",
          message: "Google Tasks connector is not configured",
        },
      },
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
      {
        error: {
          code: "google_tasks_oauth_denied",
          message: `Authorization denied: ${errorParam}`,
        },
      },
      { status: 400, headers: { "set-cookie": clearOAuthCookie() } },
    );
  }

  if (code === null || stateParam === null) {
    return Response.json(
      { error: { code: "invalid_callback", message: "Missing authorization code or state" } },
      { status: 400, headers: { "set-cookie": clearOAuthCookie() } },
    );
  }

  // Validate state against cookie to prevent callback substitution.
  const oauthSession = parseOAuthCookie(request);
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
  } catch {
    return Response.json(
      {
        error: { code: "token_exchange_failed", message: "Failed to exchange authorization code" },
      },
      { status: 502, headers: { "set-cookie": clearOAuthCookie() } },
    );
  }

  const grantedScopes = tokens.scope.split(" ").filter((scope) => scope.length > 0);

  let connection;
  try {
    connection = await persistConnection(
      oauthSession.userId,
      tokens.refreshToken,
      grantedScopes,
      env,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to store connection";
    const isDuplicate = message === "Google Tasks is already connected";
    return Response.json(
      { error: { code: isDuplicate ? "duplicate_connection" : "connection_failed", message } },
      { status: isDuplicate ? 409 : 500, headers: { "set-cookie": clearOAuthCookie() } },
    );
  }

  return Response.json(
    {
      connected: true,
      connectionId: connection.id,
      scopes: grantedScopes,
    },
    { status: 200, headers: { "set-cookie": clearOAuthCookie() } },
  );
}
