import { authenticateRequest } from "../../../../../lib/auth";
import {
  buildCallbackUrl,
  buildGoogleAuthUrl,
  buildOAuthCookie,
  generateCodeVerifier,
  generateState,
  loadGoogleTasksEnv,
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

  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const redirectUri = buildCallbackUrl(request);
  const googleUrl = await buildGoogleAuthUrl(env.googleClientId, redirectUri, state, codeVerifier);
  const cookie = buildOAuthCookie(state, codeVerifier, auth.userId);

  return new Response(null, {
    status: 302,
    headers: {
      location: googleUrl,
      "set-cookie": cookie,
      "cache-control": "no-store",
    },
  });
}
