import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateRequest } from "../../../lib/auth";
import { publishIngress } from "../../../lib/pipeline";
import { POST } from "./route";

vi.mock("../../../lib/auth", () => ({ authenticateRequest: vi.fn() }));
vi.mock("../../../lib/pipeline", () => ({ publishIngress: vi.fn() }));

const envelope = {
  schemaVersion: 1,
  id: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
  occurredAt: "2026-08-24T10:00:00Z",
  capturedAt: "2026-08-24T10:00:01Z",
  source: {
    kind: "notification",
    externalId: "notification-key",
    applicationId: "com.example.bank",
  },
  attributes: {},
};

describe("POST /api/ingest", () => {
  beforeEach(() => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      userId: "638ce145-a77d-4c32-b798-cb398e881fc9",
    });
  });

  it("returns stable 413 response when Queue budget is exceeded", async () => {
    vi.mocked(publishIngress).mockResolvedValue(
      Response.json({ accepted: false, reason: "queue-message-too-large" }, { status: 413 }),
    );

    const response = await POST(
      new Request("https://relay.test/api/ingest", {
        method: "POST",
        body: JSON.stringify(envelope),
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: { code: "ingress_too_large", message: "Payload exceeds ingestion size limit" },
    });
  });
});
