import {
  AppError,
  createLogger,
  normalizeError,
  requestId,
  type ErrorMetadata,
} from "@relay/observability";

function logger() {
  return createLogger({
    debugSpecification: process.env.EXPO_PUBLIC_DEBUG,
    namespace: "relay:mobile",
  });
}

export function mobileRequestId(): string {
  return requestId();
}

export function logMobileError(
  event: string,
  error: unknown,
  options: {
    code: string;
    integration?: string | undefined;
    metadata?: ErrorMetadata | undefined;
    operation: string;
    requestId?: string | undefined;
    startedAt?: number | undefined;
  },
): void {
  logger().error(
    event,
    normalizeError(error, {
      code: options.code,
      integration: options.integration,
      metadata: options.metadata,
      operation: options.operation,
    }),
    {
      ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
      ...(options.startedAt === undefined ? {} : { durationMs: Date.now() - options.startedAt }),
    },
  );
}

export function runInBackground(
  operation: Promise<unknown>,
  event: string,
  options: Parameters<typeof logMobileError>[2],
): void {
  void operation.catch((error: unknown) => logMobileError(event, error, options));
}

/** AppErrors are already logged at their integration boundary and remain visible in UI state. */
export function reportUnexpectedUiError(
  error: unknown,
  event: string,
  options: Parameters<typeof logMobileError>[2],
): void {
  if (error instanceof AppError) return;
  logMobileError(event, error, options);
}
