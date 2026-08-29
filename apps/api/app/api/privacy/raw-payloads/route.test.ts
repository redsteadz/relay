import { beforeEach, expect, it, vi } from "vitest";

import { authenticateRequest } from "../../../../lib/auth";
import { loadPrivacyEnv, purgeRawPayloads } from "../../../../lib/privacy";
import { DELETE } from "./route";

vi.mock("../../../../lib/auth", () => ({ authenticateRequest: vi.fn() }));
vi.mock("../../../../lib/privacy", () => ({
  loadPrivacyEnv: vi.fn(),
  purgeRawPayloads: vi.fn(),
}));

const userId = "638ce145-a77d-4c32-b798-cb398e881fc9";
const request = () =>
  new Request("https://relay.test/api/privacy/raw-payloads", { method: "DELETE" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadPrivacyEnv).mockReturnValue({
    kekKeyring: "synthetic",
    supabaseServiceRoleKey: "sb_secret_synthetic_backend_key_12345",
    supabaseUrl: "https://supabase.example.test",
  });
  vi.mocked(authenticateRequest).mockResolvedValue({ userId });
});

it("purges only the authenticated tenant payloads", async () => {
  vi.mocked(purgeRawPayloads).mockResolvedValue(3);

  const response = await DELETE(request());

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ purged: true, purgedCount: 3 });
  expect(purgeRawPayloads).toHaveBeenCalledWith(userId, expect.anything());
});

it("reports zero rather than failing when nothing is retained", async () => {
  vi.mocked(purgeRawPayloads).mockResolvedValue(0);

  expect(await (await DELETE(request())).json()).toEqual({ purged: true, purgedCount: 0 });
});

it("never purges for an unauthenticated caller", async () => {
  vi.mocked(authenticateRequest).mockResolvedValue({
    error: Response.json({ error: { code: "unauthorized" } }, { status: 401 }),
  });

  expect((await DELETE(request())).status).toBe(401);
  expect(purgeRawPayloads).not.toHaveBeenCalled();
});

it("reports an unconfigured deployment without touching data", async () => {
  vi.mocked(loadPrivacyEnv).mockReturnValue(null);

  expect((await DELETE(request())).status).toBe(503);
  expect(purgeRawPayloads).not.toHaveBeenCalled();
});

it("does not reflect internal failure detail", async () => {
  vi.mocked(purgeRawPayloads).mockRejectedValue(new Error("synthetic database detail"));

  const body: unknown = await (await DELETE(request())).json();

  expect(body).toMatchObject({ error: { code: "purge_failed" } });
  expect(JSON.stringify(body)).not.toContain("synthetic database detail");
});
