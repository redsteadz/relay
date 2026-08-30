import { authenticateRequest } from "../../../../../lib/auth";
import {
  buildCallbackUrl,
  buildGoogleAuthUrl,
  buildOAuthCookie,
  generateCodeVerifier,
  generateState,
  loadGmailEnv,
} from "../../../../../lib/gmail";

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

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const redirectUri = buildCallbackUrl(request);
  const googleUrl = await buildGoogleAuthUrl(env.googleClientId, redirectUri, state, codeVerifier);
  const cookie = await buildOAuthCookie(state, codeVerifier, auth.userId, env);

  return new Response(null, {
    status: 302,
    headers: {
      location: googleUrl,
      "set-cookie": cookie,
      "cache-control": "no-store",
    },
  });
}
