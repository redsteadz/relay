import { authenticateRequest } from "../../../../../lib/auth";
import {
  ConnectionNotFoundError,
  listTaskLists,
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

  try {
    const taskLists = await listTaskLists(auth.userId, env);
    return Response.json({ taskLists }, { status: 200 });
  } catch (error) {
    if (error instanceof ConnectionNotFoundError) {
      return Response.json({ error: { code: "connection_not_found" } }, { status: 404 });
    }
    return Response.json({ error: { code: "task_lists_unavailable" } }, { status: 502 });
  }
}
