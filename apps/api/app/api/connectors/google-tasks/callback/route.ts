import {
  buildCallbackUrl,
  clearOAuthCookie,
  DuplicateGoogleTasksConnectionError,
  exchangeCodeForTokens,
  loadGoogleTasksEnv,
  parseOAuthCookie,
  persistConnection,
} from "../../../../../lib/google-tasks";
import { loggedErrorResponse } from "../../../../../lib/observability";

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
          message: "Google Tasks authorization was denied",
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
  } catch (error: unknown) {
    return loggedErrorResponse(
      request,
      error,
      {
        code: "GOOGLE_TASKS_TOKEN_EXCHANGE_FAILED",
        event: "connector.oauth_exchange_failed",
        integration: "google-tasks",
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
    const isDuplicate = error instanceof DuplicateGoogleTasksConnectionError;
    const response = Response.json(
      {
        error: {
          code: isDuplicate ? "duplicate_connection" : "connection_failed",
          message: isDuplicate ? "Google Tasks is already connected" : "Failed to store connection",
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
            code: "GOOGLE_TASKS_CONNECTION_FAILED",
            event: "connector.connection_failed",
            integration: "supabase",
            operation: "persistGoogleTasksConnection",
          },
          response,
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
