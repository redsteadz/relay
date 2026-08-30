import { afterEach, describe, expect, it, vi } from "vitest";

import { publishFilterCompilation, publishGmailDisconnect, publishIngress } from "./pipeline";

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
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(input).toBe("http://127.0.0.1:8787/internal/ingest");
    expect(init).toMatchObject({
      body: JSON.stringify(message),
      headers: {
        "content-type": "application/json",
        "x-relay-internal-secret": "synthetic-secret",
      },
      method: "POST",
    });
    expect(new Headers(init?.headers).get("x-relay-request-id")).toMatch(/^[0-9a-f-]+$/i);
  });

  it("routes Gmail disconnect through private Pipeline binding without local success stub", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RELAY_INGEST_SHARED_SECRET", "synthetic-secret");
    const pipelineFetch = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ disconnected: true })),
    );
    openNext.getCloudflareContext.mockReturnValue({
      env: { PIPELINE: { fetch: pipelineFetch } },
    });
    const signal = new AbortController().signal;
    const message = {
      schemaVersion: 1 as const,
      connectionId: "19784902-e7a4-4f7f-b04d-e3a78c876629",
      userId: "638ce145-a77d-4c32-b798-cb398e881fc9",
    };

    const response = await publishGmailDisconnect(message, signal);

    expect(response.status).toBe(200);
    const [input, init] = pipelineFetch.mock.calls[0] ?? [];
    expect(input).toBe("https://pipeline.internal/internal/gmail/disconnect");
    expect(init).toMatchObject({
      body: JSON.stringify(message),
      headers: {
        "content-type": "application/json",
        "x-relay-internal-secret": "synthetic-secret",
      },
      method: "POST",
      signal,
    });
    expect(new Headers(init?.headers).get("x-relay-request-id")).toMatch(/^[0-9a-f-]+$/i);
  });
});

describe("publishFilterCompilation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("forwards validated intent to the private compiler route", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("RELAY_INGEST_SHARED_SECRET", "synthetic-secret");
    vi.stubEnv("RELAY_PIPELINE_URL", "http://127.0.0.1:8787");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const request = {
      userId: "638ce145-a77d-4c32-b798-cb398e881fc9",
      name: "Receipts",
      intent: "from gmail",
    };

    const response = await publishFilterCompilation(request);

    expect(response.status).toBe(201);
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(input).toBe("http://127.0.0.1:8787/internal/filters/compile");
    expect(init).toMatchObject({
      body: JSON.stringify(request),
      headers: {
        "content-type": "application/json",
        "x-relay-internal-secret": "synthetic-secret",
      },
      method: "POST",
    });
    expect(new Headers(init?.headers).get("x-relay-request-id")).toMatch(/^[0-9a-f-]+$/i);
  });
});
