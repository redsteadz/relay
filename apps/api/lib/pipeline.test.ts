import { afterEach, describe, expect, it, vi } from "vitest";

import { publishGmailDisconnect, publishIngress } from "./pipeline";

const openNext = vi.hoisted(() => ({ getCloudflareContext: vi.fn() }));

vi.mock("@opennextjs/cloudflare", () => openNext);

describe("publishIngress", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("prefers an explicit local pipeline URL outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("RELAY_INGEST_SHARED_SECRET", "synthetic-secret");
    vi.stubEnv("RELAY_PIPELINE_URL", "http://127.0.0.1:8787");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ accepted: true }, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const message = {
      envelope: { id: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8" },
      userId: "638ce145-a77d-4c32-b798-cb398e881fc9",
    };

    const response = await publishIngress(message);

    expect(response.status).toBe(202);
    expect(openNext.getCloudflareContext).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8787/internal/ingest", {
      body: JSON.stringify(message),
      headers: {
        "content-type": "application/json",
        "x-relay-internal-secret": "synthetic-secret",
      },
      method: "POST",
    });
  });

  it("routes Gmail disconnect through private Pipeline binding without local success stub", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RELAY_INGEST_SHARED_SECRET", "synthetic-secret");
    const pipelineFetch = vi.fn(() => Promise.resolve(Response.json({ disconnected: true })));
    openNext.getCloudflareContext.mockReturnValue({
      env: { PIPELINE: { fetch: pipelineFetch } },
    });
    const message = {
      schemaVersion: 1 as const,
      connectionId: "19784902-e7a4-4f7f-b04d-e3a78c876629",
      userId: "638ce145-a77d-4c32-b798-cb398e881fc9",
    };

    const response = await publishGmailDisconnect(message);

    expect(response.status).toBe(200);
    expect(pipelineFetch).toHaveBeenCalledWith(
      "https://pipeline.internal/internal/gmail/disconnect",
      {
        body: JSON.stringify(message),
        headers: {
          "content-type": "application/json",
          "x-relay-internal-secret": "synthetic-secret",
        },
        method: "POST",
      },
    );
  });
});
