import { AppError, type ErrorCategory } from "@relay/observability";

import { logMobileError, mobileRequestId } from "./observability";

export type RelayApiFailure =
  | "cancelled"
  | "confirmation-required"
  | "forbidden"
  | "malformed-response"
  | "network"
  | "not-configured"
  | "not-found"
  | "rate-limit"
  | "timeout"
  | "unauthorized"
  | "unavailable"
  | "validation";

const categoryForFailure: Record<RelayApiFailure, ErrorCategory> = {
  cancelled: "cancelled",
  "confirmation-required": "validation",
  forbidden: "forbidden",
  "malformed-response": "malformed-response",
  network: "network",
  "not-configured": "configuration",
  "not-found": "not-found",
  "rate-limit": "rate-limit",
  timeout: "timeout",
  unauthorized: "unauthorized",
  unavailable: "unavailable",
  validation: "validation",
};

export class RelayApiError extends AppError {
  constructor(
    readonly reason: RelayApiFailure,
    options: {
      cause?: unknown;
      operation?: string;
      requestId?: string;
      statusCode?: number;
    } = {},
  ) {
    super("Relay API request failed", {
      category: categoryForFailure[reason],
      cause: options.cause,
      code: `RELAY_API_${reason.replaceAll("-", "_").toUpperCase()}`,
      integration: "relay-api",
      operation: options.operation,
      statusCode: options.statusCode,
    });
    this.name = "RelayApiError";
  }
}

function failureFor(status: number, code: string | undefined): RelayApiFailure {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate-limit";
  if (code === "confirmation_required") return "confirmation-required";
  if (code?.endsWith("_not_configured") === true) return "not-configured";
  if (status >= 400 && status < 500) return "validation";
  return "unavailable";
}

function errorCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("error" in value)) return undefined;
  const error = value.error;
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function configuredBaseUrl(): string {
  const candidate = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (candidate === undefined || candidate.length === 0) {
    throw new RelayApiError("not-configured");
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Unsupported Relay API protocol");
    }
  } catch (error: unknown) {
    throw new RelayApiError("not-configured", {
      cause: error,
      operation: "configureBaseUrl",
    });
  }

  return candidate.replace(/\/+$/u, "");
}

export async function requestRelayApi(
  accessToken: string,
  path: string,
  init: { body?: unknown; method?: "DELETE" | "GET" } = {},
): Promise<unknown> {
  const operation = `${init.method ?? "GET"} ${path.split("?", 1)[0] ?? path}`;
  const operationRequestId = mobileRequestId();
  const startedAt = Date.now();
  let baseUrl: string;
  try {
    baseUrl = configuredBaseUrl();
  } catch (error: unknown) {
    const normalized =
      error instanceof RelayApiError
        ? error
        : new RelayApiError("not-configured", {
            cause: error,
            operation,
            requestId: operationRequestId,
          });
    logMobileError("integration.configuration_failed", normalized, {
      code: normalized.code,
      integration: "relay-api",
      operation,
      requestId: operationRequestId,
      startedAt,
    });
    throw normalized;
  }
  const hasBody = init.body !== undefined;
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(hasBody ? { "content-type": "application/json" } : {}),
        "x-relay-request-id": operationRequestId,
      },
      ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch (error: unknown) {
    const name =
      typeof error === "object" && error !== null && "name" in error
        ? (error as { name?: unknown }).name
        : undefined;
    const message =
      typeof error === "object" && error !== null && "message" in error
        ? (error as { message?: unknown }).message
        : undefined;
    const reason: RelayApiFailure =
      name === "AbortError"
        ? "cancelled"
        : typeof message === "string" && /timeout|timed out/iu.test(message)
          ? "timeout"
          : "network";
    const normalized = new RelayApiError(reason, {
      cause: error,
      operation,
      requestId: operationRequestId,
    });
    logMobileError("integration.request_failed", normalized, {
      code: normalized.code,
      integration: "relay-api",
      operation,
      requestId: operationRequestId,
      startedAt,
    });
    throw normalized;
  }

  let value: unknown;
  try {
    value = await response.json();
  } catch (error: unknown) {
    const normalized = new RelayApiError("malformed-response", {
      cause: error,
      operation,
      requestId: operationRequestId,
      statusCode: response.status,
    });
    logMobileError("integration.response_malformed", normalized, {
      code: normalized.code,
      integration: "relay-api",
      operation,
      requestId: operationRequestId,
      startedAt,
    });
    throw normalized;
  }
  if (!response.ok) {
    const normalized = new RelayApiError(failureFor(response.status, errorCode(value)), {
      cause: new Error("Relay API returned a failure status"),
      operation,
      requestId: operationRequestId,
      statusCode: response.status,
    });
    logMobileError("integration.request_failed", normalized, {
      code: normalized.code,
      integration: "relay-api",
      operation,
      requestId: operationRequestId,
      startedAt,
    });
    throw normalized;
  }
  return value;
}
