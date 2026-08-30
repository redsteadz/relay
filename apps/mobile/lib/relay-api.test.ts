import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requestRelayApi } from "./relay-api";

describe("requestRelayApi", () => {
  beforeEach(() => vi.stubEnv("EXPO_PUBLIC_API_URL", "https://api.relay.test/"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("binds bearer authority and JSON without tenant-controlled headers", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ purged: true, purgedCount: 2 }, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await requestRelayApi("synthetic-access-token", "/api/privacy/raw-payloads", {
      body: { requested: true },
      method: "DELETE",
    });

    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(input).toBe("https://api.relay.test/api/privacy/raw-payloads");
    expect(init).toMatchObject({
      body: JSON.stringify({ requested: true }),
      headers: {
        authorization: "Bearer synthetic-access-token",
        "content-type": "application/json",
      },
      method: "DELETE",
    });
    expect(new Headers(init?.headers).get("x-relay-request-id")).toMatch(/^[0-9a-f-]+$/i);
  });

  it("fails closed when the Relay API URL is missing or invalid", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    vi.stubEnv("EXPO_PUBLIC_API_URL", "");
    await expect(requestRelayApi("token", "/api/privacy")).rejects.toMatchObject({
      reason: "not-configured",
    });

    vi.stubEnv("EXPO_PUBLIC_API_URL", "file:///relay-api");
    await expect(requestRelayApi("token", "/api/privacy")).rejects.toMatchObject({
      reason: "not-configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps server failures to fixed client reasons without reflecting messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code: "privacy_not_configured", message: "synthetic database detail" } },
            { status: 503 },
          ),
        ),
    );

    await expect(requestRelayApi("token", "/api/privacy")).rejects.toMatchObject({
      reason: "not-configured",
    });
    await expect(requestRelayApi("token", "/api/privacy")).rejects.toSatisfy(
      (error: Error) => !error.message.includes("database detail"),
    );
  });

  it("turns malformed success payloads into a deterministic malformed response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));
    await expect(requestRelayApi("token", "/api/privacy")).rejects.toMatchObject({
      reason: "malformed-response",
    });
  });
});
