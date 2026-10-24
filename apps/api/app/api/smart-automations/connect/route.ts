import { googleConnectSchema } from "@relay/contracts";
import { authenticateRequest } from "../../../../lib/auth";
import { loggedErrorResponse } from "../../../../lib/observability";
import { startSmartGoogleAuthorization } from "../../../../lib/smart-google-oauth";
import { readBoundedJson } from "../../../../lib/gmail";
export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;
  const input = googleConnectSchema.safeParse(
    await readBoundedJson(new Response(request.body, { headers: request.headers }), 4096).catch(
      () => undefined,
    ),
  );
  if (!input.success) return Response.json({ error: { code: "invalid_request" } }, { status: 400 });
  try {
    return Response.json(
      { url: await startSmartGoogleAuthorization(auth.userId, input.data.service) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error: unknown) {
    return loggedErrorResponse(
      request,
      error,
      {
        code: "SMART_OAUTH_START_FAILED",
        event: "smart.oauth_start_failed",
        integration: "google",
        operation: "startAuthorization",
      },
      Response.json(
        {
          error: {
            code: "smart_oauth_unavailable",
            message: "Google authorization is unavailable.",
          },
        },
        { status: 503 },
      ),
    );
  }
}
