import { authenticateRequest } from "../../../../../lib/auth";
import {
  buildCallbackUrl,
  buildGoogleAuthUrl,
  buildOAuthCookie,
  generateCodeVerifier,
  generateState,
  loadGmailEnv,
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

  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  try {
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const redirectUri = buildCallbackUrl(request);
    const googleUrl = await buildGoogleAuthUrl(
      env.googleClientId,
      redirectUri,
      state,
      codeVerifier,
    );
    const cookie = await buildOAuthCookie(state, codeVerifier, auth.userId, env);

    return new Response(null, {
      status: 302,
      headers: {
        location: googleUrl,
        "set-cookie": cookie,
        "cache-control": "no-store",
      },
    });
  } catch (error: unknown) {
    return loggedErrorResponse(
      request,
      error,
      {
        code: "GMAIL_AUTHORIZATION_START_FAILED",
        event: "connector.authorization_start_failed",
        integration: "google-gmail",
        operation: "buildGoogleAuthUrl",
      },
      Response.json(
        { error: { code: "gmail_unavailable", message: "Gmail is unavailable" } },
        { status: 503 },
      ),
    );
  }
}
