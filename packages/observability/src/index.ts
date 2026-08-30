export type ErrorCategory =
  | "cancelled"
  | "configuration"
  | "database"
  | "forbidden"
  | "internal"
  | "malformed-response"
  | "network"
  | "not-found"
  | "rate-limit"
  | "timeout"
  | "unauthorized"
  | "unavailable"
  | "upstream-service"
  | "validation";

export type ErrorMetadata = Readonly<Record<string, unknown>>;

export type AppErrorOptions = {
  category: ErrorCategory;
  cause?: unknown;
  code: string;
  integration?: string | undefined;
  metadata?: ErrorMetadata | undefined;
  operation?: string | undefined;
  retryable?: boolean | undefined;
  statusCode?: number | undefined;
  userMessage?: string | undefined;
};

const DEFAULT_RETRYABLE = new Set<ErrorCategory>([
  "network",
  "rate-limit",
  "timeout",
  "unavailable",
  "upstream-service",
]);

export class AppError extends Error {
  readonly category: ErrorCategory;
  readonly code: string;
  readonly integration: string | undefined;
  readonly metadata: ErrorMetadata | undefined;
  readonly operation: string | undefined;
  readonly retryable: boolean;
  readonly statusCode: number | undefined;
  readonly userMessage: string;

  constructor(message: string, options: AppErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.category = options.category;
    this.code = options.code;
    this.integration = options.integration;
    this.metadata = options.metadata;
    this.operation = options.operation;
    this.retryable = options.retryable ?? DEFAULT_RETRYABLE.has(options.category);
    this.statusCode = options.statusCode;
    this.userMessage = options.userMessage ?? userMessageForCategory(options.category);
  }
}

export function userMessageForCategory(category: ErrorCategory): string {
  switch (category) {
    case "configuration":
      return "This feature is not configured on the current Relay deployment.";
    case "unauthorized":
      return "Your session expired. Sign in again to continue.";
    case "forbidden":
      return "You do not have permission to complete this action.";
    case "validation":
      return "The request could not be completed because some information is invalid.";
    case "not-found":
      return "The requested item could not be found.";
    case "rate-limit":
      return "Too many requests. Please try again shortly.";
    case "network":
    case "timeout":
      return "The service is temporarily unreachable. Please try again.";
    case "cancelled":
      return "The operation was cancelled.";
    case "database":
    case "internal":
    case "malformed-response":
    case "unavailable":
    case "upstream-service":
      return "This service is temporarily unavailable. Please try again.";
  }
}

type NormalizeDefaults = {
  code?: string | undefined;
  integration?: string | undefined;
  message?: string | undefined;
  metadata?: ErrorMetadata | undefined;
  operation?: string | undefined;
  userMessage?: string | undefined;
};

function objectField(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function numericStatus(error: unknown): number | undefined {
  const candidate = objectField(error, "statusCode") ?? objectField(error, "status");
  return typeof candidate === "number" && Number.isInteger(candidate) ? candidate : undefined;
}

function stringCode(error: unknown): string | undefined {
  const candidate = objectField(error, "code");
  return typeof candidate === "string" && candidate.length <= 128 ? candidate : undefined;
}

function errorName(error: unknown): string | undefined {
  const candidate = objectField(error, "name");
  return typeof candidate === "string" ? candidate : undefined;
}

function errorMessage(error: unknown): string | undefined {
  const candidate = objectField(error, "message");
  return typeof candidate === "string" ? candidate : undefined;
}

export function categoryForHttpStatus(status: number): ErrorCategory {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate-limit";
  if (status >= 400 && status < 500) return "validation";
  if (status >= 500) return "upstream-service";
  return "internal";
}

export function normalizeError(error: unknown, defaults: NormalizeDefaults = {}): AppError {
  if (error instanceof AppError) {
    if (
      defaults.integration === undefined &&
      defaults.operation === undefined &&
      defaults.metadata === undefined &&
      defaults.userMessage === undefined &&
      defaults.code === undefined
    ) {
      return error;
    }
    return new AppError(defaults.message ?? error.message, {
      category: error.category,
      cause: error,
      code: defaults.code ?? error.code,
      integration: defaults.integration ?? error.integration,
      metadata: defaults.metadata ?? error.metadata,
      operation: defaults.operation ?? error.operation,
      retryable: error.retryable,
      statusCode: error.statusCode,
      userMessage: defaults.userMessage ?? error.userMessage,
    });
  }

  const statusCode = numericStatus(error);
  const code = stringCode(error);
  const name = errorName(error);
  const message = errorMessage(error)?.toLowerCase() ?? "";
  let category: ErrorCategory;
  if (name === "AbortError" || code === "ABORT_ERR") category = "cancelled";
  else if (
    code === "ETIMEDOUT" ||
    code === "ESOCKETTIMEDOUT" ||
    /\btimeout|timed out\b/u.test(message)
  ) {
    category = "timeout";
  } else if (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ENETUNREACH" ||
    code === "EHOSTUNREACH" ||
    (name === "TypeError" && /fetch|network|connection/u.test(message))
  ) {
    category = "network";
  } else if (statusCode !== undefined) category = categoryForHttpStatus(statusCode);
  else category = "internal";

  return new AppError(defaults.message ?? "Operation failed", {
    category,
    cause: error,
    code: defaults.code ?? code ?? `RELAY_${category.replaceAll("-", "_").toUpperCase()}_ERROR`,
    integration: defaults.integration,
    metadata: defaults.metadata,
    operation: defaults.operation,
    statusCode,
    userMessage: defaults.userMessage,
  });
}

export function httpResponseError(
  response: Pick<Response, "status">,
  options: Omit<AppErrorOptions, "category" | "statusCode"> & { category?: ErrorCategory },
): AppError {
  return new AppError("Remote service request failed", {
    ...options,
    category: options.category ?? categoryForHttpStatus(response.status),
    statusCode: response.status,
  });
}

const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 2048;

function redactString(value: string): string {
  const sanitized = value
    .replace(/\bBearer\s+[^\s,;]+/giu, "Bearer [REDACTED]")
    .replace(/\b(?:sk|sb_secret)_[A-Za-z0-9_-]{8,}\b/gu, "[REDACTED]")
    .replace(
      /([?&](?:access_token|refresh_token|token|api_key|key|secret)=)[^&#\s]*/giu,
      "$1[REDACTED]",
    );
  return sanitized.length <= MAX_STRING_LENGTH
    ? sanitized
    : `${sanitized.slice(0, MAX_STRING_LENGTH)}...[TRUNCATED]`;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/giu, "").toLowerCase();
  return (
    normalized.includes("authorization") ||
    normalized === "token" ||
    normalized.endsWith("token") ||
    normalized.includes("apikey") ||
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.includes("cookie") ||
    normalized.includes("session") ||
    normalized.includes("credential") ||
    normalized.includes("privatekey")
  );
}

export function redact(value: unknown): unknown {
  const seen = new WeakSet<object>();
  const visit = (candidate: unknown, depth: number, key?: string): unknown => {
    if (key !== undefined && isSensitiveKey(key)) return "[REDACTED]";
    if (typeof candidate === "string") return redactString(candidate);
    if (
      candidate === null ||
      typeof candidate === "number" ||
      typeof candidate === "boolean" ||
      candidate === undefined
    ) {
      return candidate;
    }
    if (typeof candidate === "bigint") return candidate.toString();
    if (typeof candidate !== "object") return `[${typeof candidate}]`;
    if (depth >= MAX_DEPTH) return "[MAX_DEPTH]";
    if (seen.has(candidate)) return "[CIRCULAR]";
    seen.add(candidate);
    if (candidate instanceof Headers) {
      return visit(Object.fromEntries(candidate.entries()), depth + 1);
    }
    if (candidate instanceof URL) {
      return `${candidate.origin}${candidate.pathname}`;
    }
    if (Array.isArray(candidate)) {
      return candidate.slice(0, MAX_ARRAY_ITEMS).map((entry) => visit(entry, depth + 1));
    }
    return Object.fromEntries(
      Object.entries(candidate).map(([entryKey, entry]) => [
        entryKey,
        visit(entry, depth + 1, entryKey),
      ]),
    );
  };
  return visit(value, 0);
}

export type SerializedError = {
  category: ErrorCategory;
  causeChain?: unknown[];
  code: string;
  integration?: string;
  message: string;
  metadata?: unknown;
  name: string;
  operation?: string;
  retryable: boolean;
  stack?: string[];
  statusCode?: number;
};

function safeCause(error: unknown): Record<string, unknown> {
  const code = stringCode(error);
  const statusCode = numericStatus(error);
  return {
    name: errorName(error) ?? typeof error,
    ...(code === undefined ? {} : { code: redactString(code) }),
    ...(statusCode === undefined ? {} : { statusCode }),
    ...(error instanceof AppError ? { category: error.category } : {}),
  };
}

function stackFrames(error: unknown): string[] | undefined {
  const stack = objectField(error, "stack");
  if (typeof stack !== "string") return undefined;
  const frames = stack
    .split("\n")
    .slice(1, 21)
    .map((line) => redactString(line.trim()))
    .filter((line) => line.length > 0);
  return frames.length === 0 ? undefined : frames;
}

export function serializeError(error: unknown, debug = false): SerializedError {
  const normalized = normalizeError(error);
  const serialized: SerializedError = {
    category: normalized.category,
    code: normalized.code,
    message: normalized.message,
    name: normalized.name,
    retryable: normalized.retryable,
    ...(normalized.integration === undefined ? {} : { integration: normalized.integration }),
    ...(normalized.metadata === undefined ? {} : { metadata: redact(normalized.metadata) }),
    ...(normalized.operation === undefined ? {} : { operation: normalized.operation }),
    ...(normalized.statusCode === undefined ? {} : { statusCode: normalized.statusCode }),
  };
  if (!debug) return serialized;

  const stack = stackFrames(normalized);
  if (stack !== undefined) serialized.stack = stack;
  const causes: unknown[] = [];
  const seen = new Set<unknown>();
  let cause: unknown = normalized.cause;
  while (cause !== undefined && cause !== null && causes.length < 8 && !seen.has(cause)) {
    seen.add(cause);
    causes.push(safeCause(cause));
    cause = objectField(cause, "cause");
  }
  if (causes.length > 0) serialized.causeChain = causes;
  return serialized;
}

export function isDebugEnabled(namespace: string, specification: string | undefined): boolean {
  if (specification === undefined) return false;
  const entries = specification
    .split(/[\s,]+/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  let enabled = false;
  for (const entry of entries) {
    const disabled = entry.startsWith("-");
    const pattern = disabled ? entry.slice(1) : entry;
    const matches =
      pattern === "1" ||
      pattern === "true" ||
      pattern === "*" ||
      pattern === namespace ||
      (pattern.endsWith("*") && namespace.startsWith(pattern.slice(0, -1)));
    if (matches) enabled = !disabled;
  }
  return enabled;
}

type LogContext = Readonly<Record<string, unknown>>;
type LogSink = Pick<Console, "debug" | "error" | "info" | "warn">;

export type Logger = {
  debug: (event: string, context?: LogContext) => void;
  error: (event: string, error: unknown, context?: LogContext) => void;
  info: (event: string, context?: LogContext) => void;
  warn: (event: string, context?: LogContext) => void;
};

export function createLogger(options: {
  debugSpecification?: string | undefined;
  namespace: string;
  sink?: LogSink | undefined;
}): Logger {
  const sink = options.sink ?? console;
  const debug = isDebugEnabled(options.namespace, options.debugSpecification);
  const write = (
    level: "debug" | "error" | "info" | "warn",
    event: string,
    context: LogContext = {},
    error?: unknown,
  ): void => {
    const entry = redact({
      level,
      event,
      namespace: options.namespace,
      ...context,
      ...(error === undefined ? {} : { error: serializeError(error, debug) }),
    });
    sink[level](JSON.stringify(entry));
  };
  return {
    debug: (event, context) => {
      if (debug) write("debug", event, context);
    },
    error: (event, error, context) => write("error", event, context, error),
    info: (event, context) => write("info", event, context),
    warn: (event, context) => write("warn", event, context),
  };
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function requestId(value?: string | null): string {
  return value !== undefined && value !== null && REQUEST_ID_PATTERN.test(value)
    ? value
    : crypto.randomUUID();
}
