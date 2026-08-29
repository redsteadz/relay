import { afterEach, describe, expect, it, vi } from "vitest";

import { RelayApiError, requestRelayApi } from "./relay-api";

describe("requestRelayApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("binds bearer authority and JSON without tenant-controlled headers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ purged: true, purgedCount: 2 }, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await requestRelayApi("synthetic-access-token", "/api/privacy/raw-payloads", {
      body: { requested: true },
      method: "DELETE",
    });

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/api/privacy/raw-payloads", {
      body: JSON.stringify({ requested: true }),
      headers: {
        authorization: "Bearer synthetic-access-token",
        "content-type": "application/json",
      },
      method: "DELETE",
    });
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

    await expect(requestRelayApi("token", "/api/privacy")).rejects.toEqual(
      new RelayApiError("not-configured"),
    );
    await expect(requestRelayApi("token", "/api/privacy")).rejects.toSatisfy(
      (error: Error) => !error.message.includes("database detail"),
    );
  });

  it("turns malformed success payloads into an unavailable response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));
    await expect(requestRelayApi("token", "/api/privacy")).rejects.toMatchObject({
      reason: "unavailable",
    });
  });
});
