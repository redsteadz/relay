import { getCloudflareContext } from "@opennextjs/cloudflare";

import type {
  FilterCompileInternalRequest,
  GmailDisconnectRequest,
  VerifiedGmailCursor,
} from "@relay/contracts";
import { AppError } from "@relay/observability";
import { logApiIntegrationError } from "./observability";

type PipelineMessage = {
  userId: string;
  envelope: unknown;
};

async function publishPrivate(
  path:
    | "/internal/filters/compile"
    | "/internal/gmail/cursor"
    | "/internal/gmail/disconnect"
    | "/internal/ingest",
  message: unknown,
  allowLocalStub: boolean,
  signal?: AbortSignal,
  requestId?: string,
): Promise<Response> {
  const operationRequestId = requestId ?? crypto.randomUUID();
  const startedAt = Date.now();
  const secret = process.env.RELAY_INGEST_SHARED_SECRET;
  if (secret === undefined) {
    logApiIntegrationError(
      new AppError("Pipeline integration is not configured", {
        category: "configuration",
        code: "PIPELINE_INTERNAL_SECRET_MISSING",
        integration: "relay-pipeline",
        operation: path,
        retryable: false,
      }),
      {
        code: "PIPELINE_INTERNAL_SECRET_MISSING",
        event: "integration.pipeline_request_failed",
        integration: "relay-pipeline",
        operation: path,
        requestId: operationRequestId,
        startedAt,
      },
    );
    return Response.json({ accepted: false, reason: "internal-secret-missing" }, { status: 503 });
  }
  const headers = {
    "content-type": "application/json",
    "x-relay-internal-secret": secret,
    "x-relay-request-id": operationRequestId,
  };
  const body = JSON.stringify(message);
  const init: RequestInit = { method: "POST", headers, body };
  if (signal !== undefined) init.signal = signal;
  const pipelineUrl = process.env.RELAY_PIPELINE_URL;
  try {
    let response: Response;
    if (process.env.NODE_ENV !== "production" && pipelineUrl !== undefined) {
      response = await fetch(`${pipelineUrl}${path}`, init);
    } else {
      const { env } = getCloudflareContext();
      response = await env.PIPELINE.fetch(`https://pipeline.internal${path}`, init);
    }
    if (response.status >= 500) {
      logApiIntegrationError(new Error(`Pipeline returned status ${response.status.toString()}`), {
        code: "PIPELINE_UPSTREAM_FAILURE",
        event: "integration.pipeline_request_failed",
        integration: "relay-pipeline",
        operation: path,
        requestId: operationRequestId,
        startedAt,
        statusCode: response.status,
      });
    }
    return response;
  } catch (error: unknown) {
    logApiIntegrationError(error, {
      code: "PIPELINE_REQUEST_FAILED",
      event: "integration.pipeline_request_failed",
      integration: "relay-pipeline",
      operation: path,
      requestId: operationRequestId,
      startedAt,
    });
    if (
      allowLocalStub &&
      process.env.NODE_ENV !== "production" &&
      process.env.RELAY_ALLOW_LOCAL_STUB === "true"
    ) {
      return Response.json({ accepted: true, mode: "local-stub" }, { status: 202 });
    }
    return Response.json({ accepted: false, reason: "pipeline-unavailable" }, { status: 503 });
  }
}

export async function publishIngress(
  message: PipelineMessage,
  requestId?: string,
): Promise<Response> {
  return publishPrivate("/internal/ingest", message, true, undefined, requestId);
}

export async function publishFilterCompilation(
  request: FilterCompileInternalRequest,
  requestId?: string,
): Promise<Response> {
  return publishPrivate("/internal/filters/compile", request, false, undefined, requestId);
}

export async function publishGmailCursor(
  cursor: VerifiedGmailCursor,
  requestId?: string,
): Promise<Response> {
  return publishPrivate("/internal/gmail/cursor", cursor, false, undefined, requestId);
}

export async function publishGmailDisconnect(
  request: GmailDisconnectRequest,
  signal?: AbortSignal,
  requestId?: string,
): Promise<Response> {
  return publishPrivate("/internal/gmail/disconnect", request, false, signal, requestId);
}
