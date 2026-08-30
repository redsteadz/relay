import { authenticateRequest } from "../../../../../lib/auth";
import {
  ConnectionNotFoundError,
  listTaskLists,
  loadGoogleTasksEnv,
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

  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  try {
    const taskLists = await listTaskLists(auth.userId, env);
    return Response.json({ taskLists }, { status: 200 });
  } catch (error) {
    if (error instanceof ConnectionNotFoundError) {
      return Response.json({ error: { code: "connection_not_found" } }, { status: 404 });
    }
    return loggedErrorResponse(
      request,
      error,
      {
        code: "GOOGLE_TASK_LISTS_FAILED",
        event: "connector.task_lists_failed",
        integration: "google-tasks",
        operation: "listTaskLists",
      },
      Response.json({ error: { code: "task_lists_unavailable" } }, { status: 502 }),
    );
  }
}
