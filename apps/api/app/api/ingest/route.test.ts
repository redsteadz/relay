import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateRequest } from "../../../lib/auth";
import { authorizeDeviceIngress } from "../../../lib/devices";
import { publishIngress } from "../../../lib/pipeline";
import { POST } from "./route";

vi.mock("../../../lib/auth", () => ({ authenticateRequest: vi.fn() }));
vi.mock("../../../lib/devices", () => ({ authorizeDeviceIngress: vi.fn() }));
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
const requestBody = {
  deviceId: "19784902-e7a4-4f7f-b04d-e3a78c876629",
  envelope,
};

describe("POST /api/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      accessToken: "synthetic-token",
      userId: "638ce145-a77d-4c32-b798-cb398e881fc9",
    });
    vi.mocked(authorizeDeviceIngress).mockResolvedValue(true);
  });

  it("returns stable 413 response when Queue budget is exceeded", async () => {
    vi.mocked(publishIngress).mockResolvedValue(
      Response.json({ accepted: false, reason: "queue-message-too-large" }, { status: 413 }),
    );

    const response = await POST(
      new Request("https://relay.test/api/ingest", {
        method: "POST",
        body: JSON.stringify(requestBody),
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: { code: "ingress_too_large", message: "Payload exceeds ingestion size limit" },
    });
  });

  it("rejects inactive devices before Queue publication", async () => {
    vi.mocked(authorizeDeviceIngress).mockResolvedValue(false);
    const response = await POST(
      new Request("https://relay.test/api/ingest", {
        method: "POST",
        body: JSON.stringify(requestBody),
      }),
    );
    expect(response.status).toBe(403);
    expect(publishIngress).not.toHaveBeenCalled();
  });

  it("returns an explicit durable acknowledgement after Queue publication", async () => {
    vi.mocked(publishIngress).mockResolvedValue(Response.json({ accepted: true }, { status: 202 }));
    const response = await POST(
      new Request("https://relay.test/api/ingest", {
        method: "POST",
        body: JSON.stringify(requestBody),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      durable: true,
      id: envelope.id,
    });
  });
});
