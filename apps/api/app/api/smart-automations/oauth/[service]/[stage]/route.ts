import { canonicalUuidSchema } from "@relay/contracts";
import {
  googleServiceSchema,
  launchSmartGoogleAuthorization,
  finishSmartGoogleAuthorization,
} from "../../../../../../lib/smart-google-oauth";
import { loggedErrorResponse } from "../../../../../../lib/observability";
export async function GET(
  request: Request,
  context: { params: Promise<{ service: string; stage: string }> },
): Promise<Response> {
  const params = await context.params;
  const service = googleServiceSchema.safeParse(params.service);
  const url = new URL(request.url);
  const session = canonicalUuidSchema.safeParse(
    url.searchParams.get(params.stage === "launch" ? "session" : "state"),
  );
  if (!service.success || !session.success)
    return Response.json({ error: { code: "invalid_oauth_request" } }, { status: 400 });
  if (url.searchParams.has("error"))
    return Response.json(
      {
        error: { code: "oauth_permission_denied", message: "Google permissions were not granted." },
      },
      { status: 400 },
    );
  try {
    if (params.stage === "launch")
      return await launchSmartGoogleAuthorization(service.data, session.data);
    const code = url.searchParams.get("code");
    if (params.stage !== "callback" || code === null || code.length === 0 || code.length > 4096)
      return Response.json({ error: { code: "invalid_oauth_callback" } }, { status: 400 });
    return await finishSmartGoogleAuthorization(request, service.data, session.data, code);
  } catch (error: unknown) {
    return loggedErrorResponse(
      request,
      error,
      {
        code: "SMART_OAUTH_CALLBACK_FAILED",
        event: "smart.oauth_failed",
        integration: "google",
        operation: "completeAuthorization",
      },
      Response.json(
        {
          error: {
            code: "google_authorization_failed",
            message: "Could not connect this service. Start a new authorization request.",
          },
        },
        { status: 400 },
      ),
    );
  }
}
