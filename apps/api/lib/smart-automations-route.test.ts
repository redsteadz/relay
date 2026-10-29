import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ auth: vi.fn(), publish: vi.fn(), rpc: vi.fn() }));
vi.mock("./auth", () => ({ authenticateRequest: mock.auth }));
vi.mock("./pipeline", () => ({ publishSmartAutomation: mock.publish }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: mock.rpc }) }));
import { GET, POST } from "../app/api/smart-automations/route";
const userId = "93000000-0000-4000-8000-000000000001";
function request(body: unknown): Request {
  return new Request("http://localhost/api/smart-automations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
describe("Smart Automation authenticated API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RELAY_SMART_GOOGLE_ENABLED", "true");
    mock.auth.mockResolvedValue({ userId, accessToken: "synthetic-token" });
    mock.publish.mockImplementation(() =>
      Promise.resolve(Response.json({ paused: true, services: [], rules: [], receipts: [] })),
    );
    mock.rpc.mockResolvedValue({ error: null });
  });
  afterEach(() => vi.unstubAllEnvs());
  it("refuses unauthenticated access before reaching Pipeline", async () => {
    mock.auth.mockResolvedValue({ error: new Response(null, { status: 401 }) });
    expect((await GET(new Request("http://localhost/api/smart-automations"))).status).toBe(401);
    expect(mock.publish).not.toHaveBeenCalled();
  });
  it("leaves existing app functionality isolated when the feature is disabled", async () => {
    vi.stubEnv("RELAY_SMART_GOOGLE_ENABLED", "false");
    expect((await POST(request({ type: "pause", paused: false }))).status).toBe(503);
    expect(mock.publish).not.toHaveBeenCalled();
  });
  it("cannot accept a caller-supplied tenant or provider operation", async () => {
    expect(
      (
        await POST(
          request({
            type: "pause",
            paused: false,
            userId: "another-tenant",
            operation: "send-email",
          }),
        )
      ).status,
    ).toBe(400);
    expect(mock.publish).not.toHaveBeenCalled();
  });
  it("bounds incoming configuration bodies before parsing", async () => {
    expect(
      (await POST(request({ type: "pause", paused: false, padding: "x".repeat(70_000) }))).status,
    ).toBe(400);
    expect(mock.publish).not.toHaveBeenCalled();
  });
  it("uses the verified identity for configuration", async () => {
    expect((await POST(request({ type: "pause", paused: true }))).status).toBe(200);
    expect(mock.publish.mock.calls[0]?.[0]).toEqual({
      userId,
      command: { type: "pause", paused: true },
    });
  });
  it("uses the existing authenticated decision RPC rather than a privileged approval", async () => {
    const receiptId = "93100000-0000-4000-8000-000000000001";
    expect((await POST(request({ type: "approve", receiptId }))).status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith("decide_action_run", {
      p_action_run_id: receiptId,
      p_decision: "approve",
    });
    expect(mock.publish.mock.calls[0]?.[0]).toEqual({ userId });
  });
});
