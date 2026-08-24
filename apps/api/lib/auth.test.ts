import { afterEach, describe, expect, it, vi } from "vitest";

import { authenticateRequest } from "./auth";

describe("authenticateRequest", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a non-UUID development user", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const result = await authenticateRequest(
      new Request("https://relay.test/api/ingest", {
        headers: { "x-relay-development-user": "development-user" },
      }),
    );

    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error.status).toBe(401);
    await expect(result.error.json()).resolves.toEqual({
      error: {
        code: "invalid_development_user",
        message: "Development user must be a UUID",
      },
    });
  });
});
