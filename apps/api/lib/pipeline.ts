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

/**
 * How long saving a rule waits for the pipeline, covering the request and reading the reply.
 *
 * A warm compile answers in well under a second. Without a deadline a hung pipeline held the request
 * until the platform gave up, about 90 seconds, with the person watching a spinner.
 */
export const FILTER_COMPILATION_TIMEOUT_MS = 10_000;

/** The abort reason for a deadline this module set, as opposed to a caller cancelling. */
class PipelineDeadlineError extends Error {
  constructor() {
    super("Pipeline request deadline exceeded");
    this.name = "PipelineDeadlineError";
  }
}

function deadlineExceeded(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true && signal.reason instanceof PipelineDeadlineError;
}

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
    // The caller that set the deadline reports it, once, knowing whether the reply had started.
    if (deadlineExceeded(signal)) throw error;
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

/**
 * Asks the pipeline to compile and store a rule revision, within `FILTER_COMPILATION_TIMEOUT_MS`.
 *
 * The reply is read before returning, under the same deadline, so a pipeline that sends headers and
 * then stalls cannot hold the request open either. Running out of time is a `504` with reason
 * `pipeline-timeout`. Whether the pipeline committed is then unknown.
 */
export async function publishFilterCompilation(
  request: FilterCompileInternalRequest,
  requestId?: string,
): Promise<Response> {
  const operationRequestId = requestId ?? crypto.randomUUID();
  const startedAt = Date.now();
  const controller = new AbortController();
  const expired = new PipelineDeadlineError();
  // Raced as well as passed as the signal, so a transport that ignores the signal is still cut off.
  const deadline = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener(
      "abort",
      () => {
        reject(expired);
      },
      { once: true },
    );
  });
  const timer = setTimeout(() => {
    controller.abort(expired);
  }, FILTER_COMPILATION_TIMEOUT_MS);

  const exchange = (async () => {
    const response = await publishPrivate(
      "/internal/filters/compile",
      request,
      false,
      controller.signal,
      operationRequestId,
    );
    return { body: await response.text(), response };
  })();

  try {
    const { body, response } = await Promise.race([exchange, deadline]);
    return new Response(body, { headers: response.headers, status: response.status });
  } catch (error: unknown) {
    const timedOut = deadlineExceeded(controller.signal);
    logApiIntegrationError(error, {
      category: timedOut ? "timeout" : "network",
      code: timedOut ? "PIPELINE_REQUEST_TIMEOUT" : "PIPELINE_RESPONSE_READ_FAILED",
      event: "integration.pipeline_request_failed",
      integration: "relay-pipeline",
      operation: "/internal/filters/compile",
      requestId: operationRequestId,
      retryable: true,
      startedAt,
    });
    return timedOut
      ? Response.json({ accepted: false, reason: "pipeline-timeout" }, { status: 504 })
      : Response.json({ accepted: false, reason: "pipeline-unavailable" }, { status: 503 });
  } finally {
    clearTimeout(timer);
  }
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
