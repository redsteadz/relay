import { privacyPurgeResponseSchema } from "@relay/contracts";

import { authenticateRequest } from "../../../../lib/auth";
import { apiRequestId, loggedErrorResponse } from "../../../../lib/observability";
import { loadPrivacyEnv, purgeRawPayloads } from "../../../../lib/privacy";

// DELETE, not POST: this removes the encrypted raw payloads and keeps every derived fact.
export async function DELETE(request: Request) {
  const env = loadPrivacyEnv();
  if (env === null) {
    return Response.json(
      { error: { code: "privacy_not_configured", message: "Privacy controls are not configured" } },
      { status: 503 },
    );
  }

  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  try {
    return Response.json(
      privacyPurgeResponseSchema.parse({
        purged: true,
        purgedCount: await purgeRawPayloads(auth.userId, env, apiRequestId(request)),
      }),
    );
  } catch (error: unknown) {
    return loggedErrorResponse(
      request,
      error,
      {
        code: "PRIVACY_RAW_PURGE_FAILED",
        event: "privacy.raw_payload_purge_failed",
        integration: "supabase",
        operation: "purgeRawPayloads",
      },
      Response.json(
        { error: { code: "purge_failed", message: "Raw payload purge failed" } },
        { status: 503 },
      ),
    );
  }
}
