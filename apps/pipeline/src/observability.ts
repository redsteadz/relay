import { createLogger, normalizeError } from "@relay/observability";

import type { Env } from "./env";

export function logPipelineError(
  env: Env,
  event: string,
  error: unknown,
  options: {
    code: string;
    integration?: string | undefined;
    operation: string;
    requestId?: string | undefined;
    startedAt?: number | undefined;
  },
): void {
  createLogger({ debugSpecification: env.DEBUG, namespace: "relay:pipeline" }).error(
    event,
    normalizeError(error, {
      code: options.code,
      integration: options.integration,
      operation: options.operation,
    }),
    {
      ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
      ...(options.startedAt === undefined ? {} : { durationMs: Date.now() - options.startedAt }),
    },
  );
}
