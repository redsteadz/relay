import { getCloudflareContext } from "@opennextjs/cloudflare";
import { AppError } from "@relay/observability";
import { logApiIntegrationError } from "./observability";

export function authorizeRecoveryRequest(request: Request): boolean {
  const secret = process.env.RELAY_RECOVERY_SHARED_SECRET;
  return secret !== undefined && request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function requestPipelineRecovery(
  path: string,
  init?: RequestInit,
  requestId = crypto.randomUUID(),
): Promise<Response> {
  const startedAt = Date.now();
  const secret = process.env.RELAY_RECOVERY_SHARED_SECRET;
  if (secret === undefined || secret.length === 0) {
    logApiIntegrationError(
      new AppError("Recovery integration is not configured", {
        category: "configuration",
        code: "RECOVERY_SECRET_MISSING",
        integration: "relay-pipeline",
        operation: path,
        retryable: false,
      }),
      {
        code: "RECOVERY_SECRET_MISSING",
        event: "integration.recovery_request_failed",
        integration: "relay-pipeline",
        operation: path,
        requestId,
        startedAt,
      },
    );
    return Response.json({ error: "recovery-secret-missing" }, { status: 503 });
  }
  const headers = {
    ...init?.headers,
    "content-type": "application/json",
    "x-relay-recovery-secret": secret,
    "x-relay-request-id": requestId,
  };
  const pipelineUrl = process.env.RELAY_PIPELINE_URL;
  try {
    let response: Response;
    if (process.env.NODE_ENV !== "production" && pipelineUrl !== undefined) {
      response = await fetch(`${pipelineUrl}${path}`, { ...init, headers });
    } else {
      const { env } = getCloudflareContext();
      response = await env.PIPELINE.fetch(`https://pipeline.internal${path}`, { ...init, headers });
    }
    if (response.status >= 500) {
      logApiIntegrationError(new Error(`Pipeline returned status ${response.status.toString()}`), {
        code: "RECOVERY_PIPELINE_FAILURE",
        event: "integration.recovery_request_failed",
        integration: "relay-pipeline",
        operation: path,
        requestId,
        startedAt,
        statusCode: response.status,
      });
    }
    return response;
  } catch (error: unknown) {
    logApiIntegrationError(error, {
      code: "RECOVERY_PIPELINE_UNAVAILABLE",
      event: "integration.recovery_request_failed",
      integration: "relay-pipeline",
      operation: path,
      requestId,
      startedAt,
    });
    return Response.json({ error: "pipeline-unavailable" }, { status: 503 });
  }
}
