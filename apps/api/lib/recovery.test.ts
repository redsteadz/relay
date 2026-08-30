import { afterEach, describe, expect, it, vi } from "vitest";

import { authorizeRecoveryRequest, requestPipelineRecovery } from "./recovery";

const openNext = vi.hoisted(() => ({ getCloudflareContext: vi.fn() }));

vi.mock("@opennextjs/cloudflare", () => openNext);

describe("recovery boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("requires exact dedicated bearer secret", () => {
    vi.stubEnv("RELAY_RECOVERY_SHARED_SECRET", "synthetic-recovery-secret");
    expect(
      authorizeRecoveryRequest(
        new Request("https://relay.test/api/recovery/dead-letters", {
          headers: { authorization: "Bearer synthetic-recovery-secret" },
        }),
      ),
    ).toBe(true);
    expect(
      authorizeRecoveryRequest(
        new Request("https://relay.test/api/recovery/dead-letters", {
          headers: { authorization: "Bearer synthetic-ingress-secret" },
        }),
      ),
    ).toBe(false);
  });

  it("forwards only internal recovery credential to local Pipeline", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("RELAY_PIPELINE_URL", "http://127.0.0.1:8787");
    vi.stubEnv("RELAY_RECOVERY_SHARED_SECRET", "synthetic-recovery-secret");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await requestPipelineRecovery("/internal/recovery/dead-letters?limit=10");

    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(input).toBe("http://127.0.0.1:8787/internal/recovery/dead-letters?limit=10");
    expect(init).toMatchObject({
      headers: {
        "content-type": "application/json",
        "x-relay-recovery-secret": "synthetic-recovery-secret",
      },
    });
    expect(new Headers(init?.headers).get("x-relay-request-id")).toMatch(/^[0-9a-f-]+$/i);
    expect(openNext.getCloudflareContext).not.toHaveBeenCalled();
  });
});
