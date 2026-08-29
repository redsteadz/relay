import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateRequest } from "../../../../../lib/auth";
import { publishGmailDisconnect } from "../../../../../lib/pipeline";
import { POST } from "./route";

vi.mock("../../../../../lib/auth", () => ({ authenticateRequest: vi.fn() }));
vi.mock("../../../../../lib/pipeline", () => ({ publishGmailDisconnect: vi.fn() }));

const userId = "638ce145-a77d-4c32-b798-cb398e881fc9";
const connectionId = "19784902-e7a4-4f7f-b04d-e3a78c876629";

function request(body: unknown): Request {
  return new Request("https://relay.test/api/connectors/gmail/disconnect", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function rawRequest(body: BodyInit, headers?: HeadersInit): Request {
  return new Request("https://relay.test/api/connectors/gmail/disconnect", {
    method: "POST",
    body,
    headers,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("POST /api/connectors/gmail/disconnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      accessToken: "synthetic-token",
      userId,
    });
  });

  it("routes authenticated tenant identity to Pipeline and reports completed consent withdrawal", async () => {
    vi.mocked(publishGmailDisconnect).mockResolvedValue(Response.json({ disconnected: true }));

    const response = await POST(request({ connectionId }));

    expect(response.status).toBe(200);
    expect(publishGmailDisconnect).toHaveBeenCalledWith({
      schemaVersion: 1,
      connectionId,
      userId,
    });
    await expect(response.json()).resolves.toEqual({
      disconnected: true,
      connectionId,
      tokenRevoked: true,
    });
  });

  it("returns retryable failure when Pipeline cannot stop provider delivery", async () => {
    vi.mocked(publishGmailDisconnect).mockResolvedValue(
      Response.json({ disconnected: false }, { status: 503 }),
    );

    const response = await POST(request({ connectionId }));

    expect(response.status).toBe(503);
  });

  it("preserves not-found result and rejects noncanonical or extra identifiers", async () => {
    vi.mocked(publishGmailDisconnect).mockResolvedValue(
      Response.json({ disconnected: false }, { status: 404 }),
    );
    expect((await POST(request({ connectionId }))).status).toBe(404);

    expect((await POST(request({ connectionId: "not-a-uuid" }))).status).toBe(400);
    expect((await POST(request({ connectionId, userId }))).status).toBe(400);
  });

  it("rejects declared and streamed oversized bodies before Pipeline publication", async () => {
    const declared = await POST(rawRequest("{}", { "content-length": "4097" }));
    const streamed = await POST(rawRequest("x".repeat(4097)));

    expect(declared.status).toBe(400);
    expect(streamed.status).toBe(400);
    expect(publishGmailDisconnect).not.toHaveBeenCalled();
  });
});
