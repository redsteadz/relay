import { authenticateRequest } from "../../../../../lib/auth";
import { disconnectGoogleTasks, loadGoogleTasksEnv } from "../../../../../lib/google-tasks";

export async function POST(request: Request) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { code: "invalid_request", message: "Request body must be valid JSON" } },
      { status: 400 },
    );
  }

  const candidate = body as Record<string, unknown> | null;
  const connectionId = candidate?.connectionId;
  if (typeof connectionId !== "string" || connectionId.length === 0) {
    return Response.json(
      { error: { code: "invalid_request", message: "connectionId is required" } },
      { status: 400 },
    );
  }

  try {
    const result = await disconnectGoogleTasks(auth.userId, connectionId, env);
    if (!result.deleted) {
      return Response.json(
        { error: { code: "connection_not_found", message: "Connection not found" } },
        { status: 404 },
      );
    }

    return Response.json({
      disconnected: true,
      connectionId,
      tokenRevoked: result.revoked,
    });
  } catch {
    return Response.json(
      { error: { code: "disconnect_failed", message: "Failed to disconnect Google Tasks" } },
      { status: 500 },
    );
  }
}
