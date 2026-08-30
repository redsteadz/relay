import { deadLetterMetadataSchema, deadLetterReplayRequestSchema } from "@relay/contracts";

import { authorizeRecoveryRequest, requestPipelineRecovery } from "../../../../lib/recovery";
import { apiRequestId, loggedErrorResponse } from "../../../../lib/observability";

function unauthorized(): Response {
  return Response.json(
    { error: { code: "recovery_unauthorized", message: "Recovery authorization is required" } },
    { status: 401 },
  );
}

function unavailable(): Response {
  return Response.json(
    { error: { code: "recovery_unavailable", message: "Recovery service is unavailable" } },
    { status: 503 },
  );
}

export async function GET(request: Request) {
  if (!authorizeRecoveryRequest(request)) return unauthorized();
  const rawLimit = new URL(request.url).searchParams.get("limit") ?? "100";
  if (!/^\d{1,3}$/u.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100) {
    return Response.json(
      { error: { code: "invalid_recovery_query", message: "Limit must be between 1 and 100" } },
      { status: 400 },
    );
  }

  const response = await requestPipelineRecovery(
    `/internal/recovery/dead-letters?limit=${rawLimit}`,
    undefined,
    apiRequestId(request),
  );
  if (!response.ok) return unavailable();
  let value: { items?: unknown } | undefined;
  try {
    value = (await response.json()) as { items?: unknown };
  } catch (error: unknown) {
    return loggedErrorResponse(
      request,
      error,
      {
        category: "malformed-response",
        code: "RECOVERY_RESPONSE_INVALID",
        event: "integration.recovery_response_invalid",
        integration: "relay-pipeline",
        operation: "listDeadLetterItems",
        statusCode: response.status,
      },
      unavailable(),
    );
  }
  if (!Array.isArray(value.items)) {
    return loggedErrorResponse(
      request,
      new Error("Recovery response did not contain an item list"),
      {
        category: "malformed-response",
        code: "RECOVERY_RESPONSE_INVALID",
        event: "integration.recovery_response_invalid",
        integration: "relay-pipeline",
        operation: "listDeadLetterItems",
        statusCode: response.status,
      },
      unavailable(),
    );
  }
  const items = value.items.map((item) => deadLetterMetadataSchema.safeParse(item));
  if (items.some((item) => !item.success)) return unavailable();
  return Response.json({ items: items.map((item) => item.data) });
}

export async function POST(request: Request) {
  if (!authorizeRecoveryRequest(request)) return unauthorized();
  const replay = deadLetterReplayRequestSchema.safeParse(
    await request.json().catch(() => undefined),
  );
  if (!replay.success) {
    return Response.json(
      { error: { code: "invalid_replay", message: "Replay request is invalid" } },
      { status: 400 },
    );
  }

  const response = await requestPipelineRecovery(
    `/internal/recovery/dead-letters/${replay.data.id}/replay`,
    { method: "POST", body: JSON.stringify({ requestId: replay.data.requestId }) },
    apiRequestId(request),
  );
  if (response.status === 409) {
    return Response.json(
      { accepted: false, reason: "unavailable", ...replay.data },
      { status: 409 },
    );
  }
  if (!response.ok) return unavailable();
  return Response.json({ accepted: true, ...replay.data }, { status: 202 });
}
