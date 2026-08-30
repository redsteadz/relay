import { privacyOverviewResponseSchema } from "@relay/contracts";

import { authenticateRequest } from "../../../lib/auth";
import { loggedErrorResponse } from "../../../lib/observability";
import { getAccountDeletionStatus, getRetentionStatus, loadPrivacyEnv } from "../../../lib/privacy";

function notConfigured() {
  return Response.json(
    { error: { code: "privacy_not_configured", message: "Privacy controls are not configured" } },
    { status: 503 },
  );
}

export async function GET(request: Request) {
  const env = loadPrivacyEnv();
  if (env === null) return notConfigured();

  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  try {
    const [retention, deletion] = await Promise.all([
      getRetentionStatus(auth.userId, env),
      getAccountDeletionStatus(auth.userId, env),
    ]);
    return Response.json(privacyOverviewResponseSchema.parse({ deletion, retention }));
  } catch (error: unknown) {
    return loggedErrorResponse(
      request,
      error,
      {
        code: "PRIVACY_OVERVIEW_FAILED",
        event: "privacy.overview_failed",
        integration: "supabase",
        operation: "getPrivacyOverview",
      },
      Response.json(
        { error: { code: "privacy_unavailable", message: "Privacy overview unavailable" } },
        { status: 503 },
      ),
    );
  }
}
