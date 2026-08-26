import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../src/env";
import { handlePipelineRequest } from "../src/http";
import { listDeadLetterItems, replayDeadLetterItem } from "../src/recovery";

vi.mock("../src/recovery", () => ({
  completeDeadLetterReplay: vi.fn(() => Promise.resolve()),
  listDeadLetterItems: vi.fn(() => Promise.resolve([])),
  recordDeadLetterItem: vi.fn(() => Promise.resolve()),
  replayDeadLetterItem: vi.fn(() => Promise.resolve(true)),
}));

const env = {
  RELAY_INGEST_SHARED_SECRET: "synthetic-ingress-secret",
  RELAY_RECOVERY_SHARED_SECRET: "synthetic-recovery-secret",
} as unknown as Env;

describe("Pipeline recovery authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listDeadLetterItems).mockResolvedValue([]);
    vi.mocked(replayDeadLetterItem).mockResolvedValue(true);
  });

  it.each([
    {},
    { "x-relay-internal-secret": "synthetic-ingress-secret" },
    { "x-relay-recovery-secret": "wrong-recovery-secret" },
  ])("rejects non-recovery credential before inventory access", async (headers) => {
    const response = await handlePipelineRequest(
      new Request("https://pipeline.internal/internal/recovery/dead-letters", { headers }),
      env,
    );

    expect(response.status).toBe(401);
    expect(listDeadLetterItems).not.toHaveBeenCalled();
  });

  it("accepts dedicated recovery credential for metadata inventory", async () => {
    const response = await handlePipelineRequest(
      new Request("https://pipeline.internal/internal/recovery/dead-letters?limit=25", {
        headers: { "x-relay-recovery-secret": "synthetic-recovery-secret" },
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(listDeadLetterItems).toHaveBeenCalledWith(env, 25);
  });

  it("rejects ingestion credential before replay claim or Queue publication", async () => {
    const response = await handlePipelineRequest(
      new Request(
        "https://pipeline.internal/internal/recovery/dead-letters/5e106d7a-85aa-4a08-9a1f-cb13b42df1f8/replay",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-relay-internal-secret": "synthetic-ingress-secret",
          },
          body: JSON.stringify({ requestId: "06f96f7d-3e1a-4a66-b98e-58be9766b96e" }),
        },
      ),
      env,
    );

    expect(response.status).toBe(401);
    expect(replayDeadLetterItem).not.toHaveBeenCalled();
  });
});
