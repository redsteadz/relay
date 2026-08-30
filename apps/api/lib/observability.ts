import {
  AppError,
  createLogger,
  normalizeError,
  requestId,
  type ErrorCategory,
  type ErrorMetadata,
} from "@relay/observability";

export const RELAY_REQUEST_ID_HEADER = "x-relay-request-id";
const REQUEST_IDS = new WeakMap<Request, string>();

function logger() {
  return createLogger({
    debugSpecification: process.env.DEBUG,
    namespace: "relay:api",
  });
}

export function apiRequestId(request: Request): string {
  const existing = REQUEST_IDS.get(request);
  if (existing !== undefined) return existing;
  const resolved = requestId(request.headers.get(RELAY_REQUEST_ID_HEADER));
  REQUEST_IDS.set(request, resolved);
  return resolved;
}

export function logApiError(
  request: Request,
  error: unknown,
  options: {
    category?: ErrorCategory | undefined;
    code: string;
    event: string;
    integration?: string | undefined;
    metadata?: ErrorMetadata | undefined;
    operation: string;
    retryable?: boolean | undefined;
    startedAt?: number | undefined;
    statusCode?: number | undefined;
  },
): AppError {
  return logApiIntegrationError(error, {
    ...options,
    requestId: apiRequestId(request),
  });
}

export function logApiIntegrationError(
  error: unknown,
  options: {
    category?: ErrorCategory | undefined;
    code: string;
    event: string;
    integration?: string | undefined;
    metadata?: ErrorMetadata | undefined;
    operation: string;
    requestId: string;
    retryable?: boolean | undefined;
    startedAt?: number | undefined;
    statusCode?: number | undefined;
  },
): AppError {
  const normalized =
    options.category === undefined
      ? normalizeError(error, {
          code: options.code,
          integration: options.integration,
          metadata: options.metadata,
          operation: options.operation,
        })
      : new AppError("API operation failed", {
          category: options.category,
          cause: error,
          code: options.code,
          integration: options.integration,
          metadata: options.metadata,
          operation: options.operation,
          retryable: options.retryable,
          statusCode: options.statusCode,
        });
  logger().error(options.event, normalized, {
    requestId: options.requestId,
    ...(options.startedAt === undefined ? {} : { durationMs: Date.now() - options.startedAt }),
  });
  return normalized;
}

export function databaseError(
  error: unknown,
  code: string,
  operation: string,
  metadata?: ErrorMetadata,
  message = "Database operation failed",
): AppError {
  return new AppError(message, {
    category: "database",
    cause: error,
    code,
    integration: "supabase",
    metadata,
    operation,
    retryable: true,
  });
}

export function loggedErrorResponse(
  request: Request,
  error: unknown,
  options: Parameters<typeof logApiError>[2],
  response: Response,
): Response {
  const operationRequestId = apiRequestId(request);
  logApiIntegrationError(error, { ...options, requestId: operationRequestId });
  response.headers.set(RELAY_REQUEST_ID_HEADER, operationRequestId);
  return response;
}
