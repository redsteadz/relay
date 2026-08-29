import { beforeEach, expect, it, vi } from "vitest";

import { authenticateRequest } from "../../../lib/auth";
import { getAccountDeletionStatus, getRetentionStatus, loadPrivacyEnv } from "../../../lib/privacy";
import { GET } from "./route";

vi.mock("../../../lib/auth", () => ({ authenticateRequest: vi.fn() }));
vi.mock("../../../lib/privacy", () => ({
  getAccountDeletionStatus: vi.fn(),
  getRetentionStatus: vi.fn(),
  loadPrivacyEnv: vi.fn(),
}));

const userId = "638ce145-a77d-4c32-b798-cb398e881fc9";
const request = () => new Request("https://relay.test/api/privacy");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadPrivacyEnv).mockReturnValue({
    kekKeyring: "synthetic",
    supabaseServiceRoleKey: "sb_secret_synthetic_backend_key_12345",
    supabaseUrl: "https://supabase.example.test",
  });
  vi.mocked(authenticateRequest).mockResolvedValue({ userId });
  vi.mocked(getAccountDeletionStatus).mockResolvedValue(null);
});

it("reports the fixed retention window and what is still retained", async () => {
  vi.mocked(getRetentionStatus).mockResolvedValue({
    earliestExpiresAt: "2026-09-05T10:00:00.000Z",
    latestExpiresAt: "2026-09-05T12:00:00.000Z",
    retainedCount: 4,
    retentionDays: 7,
  });

  const response = await GET(request());

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    deletion: null,
    retention: {
      earliestExpiresAt: "2026-09-05T10:00:00.000Z",
      latestExpiresAt: "2026-09-05T12:00:00.000Z",
      retainedCount: 4,
      retentionDays: 7,
    },
  });
});

it("scopes both reads to the authenticated tenant", async () => {
  vi.mocked(getRetentionStatus).mockResolvedValue({
    earliestExpiresAt: null,
    latestExpiresAt: null,
    retainedCount: 0,
    retentionDays: 7,
  });

  await GET(request());

  expect(getRetentionStatus).toHaveBeenCalledWith(userId, expect.anything());
  expect(getAccountDeletionStatus).toHaveBeenCalledWith(userId, expect.anything());
});

it("does not reflect internal failure detail", async () => {
  vi.mocked(getRetentionStatus).mockRejectedValue(new Error("synthetic database detail"));

  const body: unknown = await (await GET(request())).json();

  expect(body).toMatchObject({ error: { code: "privacy_unavailable" } });
  expect(JSON.stringify(body)).not.toContain("synthetic database detail");
});
