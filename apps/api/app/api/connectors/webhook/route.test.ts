import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateRequest } from "../../../../lib/auth";
import type * as WebhookConnectionsModule from "../../../../lib/webhook-connections";
import {
  WebhookConnectionNotFoundError,
  WebhookDestinationInvalidError,
  WebhookRotationConflictError,
  createWebhookConnection,
  loadWebhookEnv,
  rotateWebhookConnection,
} from "../../../../lib/webhook-connections";
import { POST as rotate } from "./rotate/route";
import { POST as create } from "./route";

vi.mock("../../../../lib/auth", () => ({ authenticateRequest: vi.fn() }));
vi.mock("../../../../lib/webhook-connections", async (importOriginal) => ({
  ...(await importOriginal<WebhookConnections>()),
  createWebhookConnection: vi.fn(),
  loadWebhookEnv: vi.fn(),
  rotateWebhookConnection: vi.fn(),
}));

type WebhookConnections = typeof WebhookConnectionsModule;

const userId = "638ce145-a77d-4c32-b798-cb398e881fc9";
const connectionId = "19784902-e7a4-4f7f-b04d-e3a78c876629";
const env = {
  kekKeyring: "synthetic",
  relayEnvironment: "development",
  supabaseServiceRoleKey: "synthetic-service-key",
  supabaseUrl: "https://relay-auth.example.test",
};
const issued = {
  connectionId,
  host: "hooks.example.com",
  previousSecretExpiresAt: null,
  secret: "a".repeat(64),
};

function post(path: string, body: unknown): Request {
  return new Request(`https://relay.test/api/connectors/webhook${path}`, {
    body: typeof body === "string" ? body : JSON.stringify(body),
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadWebhookEnv).mockReturnValue(env);
  vi.mocked(authenticateRequest).mockResolvedValue({ accessToken: "synthetic-token", userId });
});

describe("POST /api/connectors/webhook", () => {
  it("returns the secret once, marked uncacheable", async () => {
    vi.mocked(createWebhookConnection).mockResolvedValue(issued);
    const response = await create(post("", { url: "https://hooks.example.com/relay" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(issued);
    expect(createWebhookConnection).toHaveBeenCalledWith(
      userId,
      "https://hooks.example.com/relay",
      env,
    );
  });

  it.each([
    ["malformed JSON", "{"],
    ["no URL", {}],
    ["an extra field", { url: "https://hooks.example.com/", headers: { a: "b" } }],
  ])("refuses %s without storing anything", async (_name, body) => {
    const response = await create(post("", body));
    expect(response.status).toBe(400);
    expect(createWebhookConnection).not.toHaveBeenCalled();
  });

  it("reports a refused destination as a client error", async () => {
    vi.mocked(createWebhookConnection).mockRejectedValue(new WebhookDestinationInvalidError());
    const response = await create(post("", { url: "https://10.0.0.5/" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "webhook_destination_refused" },
    });
  });

  it("hides an unexpected failure behind a fixed 503", async () => {
    vi.mocked(createWebhookConnection).mockRejectedValue(new Error("synthetic database detail"));
    const response = await create(post("", { url: "https://hooks.example.com/" }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("synthetic database detail");
  });

  it("returns 503 when the connector is not configured on this deployment", async () => {
    vi.mocked(loadWebhookEnv).mockReturnValue(null);
    const response = await create(post("", { url: "https://hooks.example.com/" }));
    expect(response.status).toBe(503);
    expect(authenticateRequest).not.toHaveBeenCalled();
  });

  it("passes an authentication failure through untouched", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      error: Response.json({ error: { code: "unauthorized" } }, { status: 401 }),
    });
    const response = await create(post("", { url: "https://hooks.example.com/" }));
    expect(response.status).toBe(401);
    expect(createWebhookConnection).not.toHaveBeenCalled();
  });
});

describe("POST /api/connectors/webhook/rotate", () => {
  it("returns the new secret and when the old one stops signing", async () => {
    const rotated = { ...issued, previousSecretExpiresAt: "2026-11-01T12:00:00.000Z" };
    vi.mocked(rotateWebhookConnection).mockResolvedValue(rotated);
    const response = await rotate(post("/rotate", { connectionId }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(rotated);
    expect(rotateWebhookConnection).toHaveBeenCalledWith(userId, connectionId, env);
  });

  it("refuses a connection ID that is not a UUID", async () => {
    const response = await rotate(post("/rotate", { connectionId: "not-a-uuid" }));
    expect(response.status).toBe(400);
    expect(rotateWebhookConnection).not.toHaveBeenCalled();
  });

  it.each([
    [new WebhookConnectionNotFoundError(), 404, "webhook_not_found"],
    [new WebhookRotationConflictError(), 409, "webhook_rotation_conflict"],
  ])("maps %o to %i", async (error, status, code) => {
    vi.mocked(rotateWebhookConnection).mockRejectedValue(error);
    const response = await rotate(post("/rotate", { connectionId }));
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: { code } });
  });
});
