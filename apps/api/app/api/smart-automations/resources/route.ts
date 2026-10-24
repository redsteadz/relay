import { googleServiceSchema, smartResourcesSchema } from "@relay/contracts";
import { authenticateRequest } from "../../../../lib/auth";
import { publishSmartAutomation } from "../../../../lib/pipeline";
import { apiRequestId, loggedErrorResponse } from "../../../../lib/observability";
export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;
  const service = googleServiceSchema.safeParse(new URL(request.url).searchParams.get("service"));
  if (!service.success)
    return Response.json({ error: { code: "invalid_service" } }, { status: 400 });
  if (process.env.RELAY_SMART_GOOGLE_ENABLED !== "true")
    return Response.json({ error: { code: "smart_disabled" } }, { status: 503 });
  try {
    const response = await publishSmartAutomation(
      { userId: auth.userId, resources: service.data },
      apiRequestId(request),
    );
    if (!response.ok) throw new Error("Resource discovery unavailable");
    return Response.json(smartResourcesSchema.parse(await response.json()), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error: unknown) {
    return loggedErrorResponse(
      request,
      error,
      {
        code: "SMART_RESOURCES_FAILED",
        event: "smart.resources_failed",
        integration: "relay-pipeline",
        operation: "discoverGoogleResources",
      },
      Response.json(
        { error: { code: "resources_unavailable", message: "Could not load destinations." } },
        { status: 503 },
      ),
    );
  }
}
