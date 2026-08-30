import { describe, expect, it, vi } from "vitest";

import {
  AppError,
  createLogger,
  normalizeError,
  redact,
  serializeError,
  userMessageForCategory,
} from "../src/index";

function parseLog(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") {
    throw new TypeError("Expected a serialized log line");
  }
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Expected a structured log object");
  }
  return parsed as Record<string, unknown>;
}

describe("application errors", () => {
  it("preserves an original network failure as cause", () => {
    const original = Object.assign(new TypeError("fetch failed"), { code: "ECONNRESET" });
    const normalized = normalizeError(original, {
      code: "RELAY_CONNECTION_ERROR",
      integration: "relay",
      operation: "privacyOverview",
    });
    expect(normalized).toMatchObject({ category: "network", retryable: true });
    expect(normalized.cause).toBe(original);
  });

  it("maps authentication, timeout, and rate limits deterministically", () => {
    expect(normalizeError({ status: 401 })).toMatchObject({ category: "unauthorized" });
    expect(normalizeError({ code: "ETIMEDOUT" })).toMatchObject({ category: "timeout" });
    expect(normalizeError({ statusCode: 429 })).toMatchObject({
      category: "rate-limit",
      retryable: true,
    });
    expect(userMessageForCategory("unauthorized")).toContain("session expired");
  });
});

describe("safe structured logging", () => {
  it("redacts sensitive values recursively", () => {
    expect(
      redact({
        authorization: "Bearer top-secret",
        nested: {
          accessToken: "token-value",
          clientSecret: "secret-value",
          password: "password-value",
          safe: "kept",
        },
      }),
    ).toEqual({
      authorization: "[REDACTED]",
      nested: {
        accessToken: "[REDACTED]",
        clientSecret: "[REDACTED]",
        password: "[REDACTED]",
        safe: "kept",
      },
    });
  });

  it("adds stack and a safe cause chain only in debug mode", () => {
    const cause = Object.assign(new Error("Bearer secret-value"), { code: "ECONNRESET" });
    const error = new AppError("Relay request failed", {
      category: "network",
      cause,
      code: "RELAY_CONNECTION_ERROR",
    });
    expect(serializeError(error, false)).not.toHaveProperty("stack");
    expect(serializeError(error, true)).toMatchObject({
      causeChain: [{ code: "ECONNRESET", name: "Error" }],
    });
    expect(JSON.stringify(serializeError(error, true))).not.toContain("secret-value");
  });

  it("emits concise production logs and detailed debug logs", () => {
    const productionError = vi.fn<(...data: unknown[]) => void>();
    const debugError = vi.fn<(...data: unknown[]) => void>();
    const sink = (error: (...data: unknown[]) => void) => ({
      debug: vi.fn(),
      error,
      info: vi.fn(),
      warn: vi.fn(),
    });
    const cause = Object.assign(new Error("network detail"), { code: "ECONNRESET" });
    const appError = normalizeError(cause, {
      code: "RELAY_CONNECTION_ERROR",
      metadata: { attempt: 2, authorization: "Bearer top-secret" },
    });
    createLogger({ namespace: "relay:api", sink: sink(productionError) }).error(
      "integration.request_failed",
      appError,
    );
    createLogger({
      debugSpecification: "relay:*",
      namespace: "relay:api",
      sink: sink(debugError),
    }).error("integration.request_failed", appError);
    expect(parseLog(productionError.mock.calls[0]?.[0]).error).not.toHaveProperty("causeChain");
    const debugLog = parseLog(debugError.mock.calls[0]?.[0]);
    expect(debugLog.error).toHaveProperty("causeChain");
    expect(debugLog.error).toMatchObject({
      metadata: { attempt: 2, authorization: "[REDACTED]" },
    });
  });
});
