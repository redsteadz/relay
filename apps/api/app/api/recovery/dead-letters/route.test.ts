import { beforeEach, describe, expect, it, vi } from "vitest";

import { authorizeRecoveryRequest, requestPipelineRecovery } from "../../../../lib/recovery";
import { GET, POST } from "./route";

vi.mock("../../../../lib/recovery", () => ({
  authorizeRecoveryRequest: vi.fn(),
  requestPipelineRecovery: vi.fn(),
}));

const id = "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8";
const requestId = "06f96f7d-3e1a-4a66-b98e-58be9766b96e";

describe("/api/recovery/dead-letters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authorizeRecoveryRequest).mockReturnValue(true);
  });

  it("rejects missing operator authorization before Pipeline access", async () => {
    vi.mocked(authorizeRecoveryRequest).mockReturnValue(false);
    const response = await GET(new Request("https://relay.test/api/recovery/dead-letters"));
    expect(response.status).toBe(401);
    expect(requestPipelineRecovery).not.toHaveBeenCalled();
  });

  it("returns only validated failure metadata", async () => {
    vi.mocked(requestPipelineRecovery).mockResolvedValue(
      Response.json({
        items: [
          {
            id,
            envelopeId: id,
            failureCode: "retry_exhausted_unknown",
            status: "available",
            acceptedAt: "2026-08-24T10:00:00.000Z",
            rawExpiresAt: "2026-08-31T10:00:00.000Z",
            keyVersion: 1,
            replayCount: 0,
            firstFailedAt: "2026-08-25T10:00:00.000Z",
            lastFailedAt: "2026-08-25T10:00:00.000Z",
            lastReplayedAt: null,
            completedAt: null,
          },
        ],
      }),
    );

    const response = await GET(
      new Request("https://relay.test/api/recovery/dead-letters?limit=25"),
    );
    expect(response.status).toBe(200);
    expect(requestPipelineRecovery).toHaveBeenCalledWith(
      "/internal/recovery/dead-letters?limit=25",
    );
    expect(JSON.stringify(await response.json())).not.toContain("ciphertext");
  });

  it("validates stable request ID before replay", async () => {
    const response = await POST(
      new Request("https://relay.test/api/recovery/dead-letters", {
        method: "POST",
        body: JSON.stringify({ id, requestId: "not-a-uuid" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(requestPipelineRecovery).not.toHaveBeenCalled();
  });

  it("forwards replay identity without source content", async () => {
    vi.mocked(requestPipelineRecovery).mockResolvedValue(
      Response.json({ accepted: true, id, requestId }, { status: 202 }),
    );
    const response = await POST(
      new Request("https://relay.test/api/recovery/dead-letters", {
        method: "POST",
        body: JSON.stringify({ id, requestId }),
      }),
    );

    expect(response.status).toBe(202);
    expect(requestPipelineRecovery).toHaveBeenCalledWith(
      `/internal/recovery/dead-letters/${id}/replay`,
      { method: "POST", body: JSON.stringify({ requestId }) },
    );
  });
});
