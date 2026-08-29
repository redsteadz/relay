import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateRequest } from "../../../../lib/auth";
import { deleteAccount, getAccountDeletionStatus, loadPrivacyEnv } from "../../../../lib/privacy";
import { DELETE, GET } from "./route";

vi.mock("../../../../lib/auth", () => ({ authenticateRequest: vi.fn() }));
vi.mock("../../../../lib/privacy", () => ({
  deleteAccount: vi.fn(),
  getAccountDeletionStatus: vi.fn(),
  loadPrivacyEnv: vi.fn(),
}));

const userId = "638ce145-a77d-4c32-b798-cb398e881fc9";

function deleteRequest(body: unknown) {
  return new Request("https://relay.test/api/privacy/account", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    method: "DELETE",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadPrivacyEnv).mockReturnValue({
    kekKeyring: "synthetic",
    supabaseServiceRoleKey: "sb_secret_synthetic_backend_key_12345",
    supabaseUrl: "https://supabase.example.test",
  });
  vi.mocked(authenticateRequest).mockResolvedValue({ userId });
});

describe("DELETE /api/privacy/account", () => {
  it("refuses to delete without the explicit confirmation phrase", async () => {
    const result = await DELETE(deleteRequest({ confirm: "yes" }));

    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({ error: { code: "confirmation_required" } });
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("refuses a bare call with no body at all", async () => {
    const result = await DELETE(deleteRequest("not json"));

    expect(result.status).toBe(400);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("deletes the authenticated account and reports revocation counts", async () => {
    vi.mocked(deleteAccount).mockResolvedValue({
      failedRevocations: 0,
      revokedCredentials: 2,
      status: {
        attemptCount: 1,
        completedAt: "2026-08-29T10:00:00.000Z",
        connectorsRevokedAt: "2026-08-29T09:59:00.000Z",
        requestedAt: "2026-08-29T09:58:00.000Z",
        state: "completed",
      },
    });

    const result = await DELETE(deleteRequest({ confirm: "delete my account" }));

    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      deleted: true,
      deletion: { state: "completed" },
      revokedCredentials: 2,
    });
    expect(deleteAccount).toHaveBeenCalledWith(userId, expect.anything());
  });

  it("never deletes an account for an unauthenticated caller", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      error: Response.json({ error: { code: "unauthorized" } }, { status: 401 }),
    });

    const result = await DELETE(deleteRequest({ confirm: "delete my account" }));

    expect(result.status).toBe(401);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("reports a retryable failure without reflecting internal detail", async () => {
    vi.mocked(deleteAccount).mockRejectedValue(new Error("synthetic Supabase outage detail"));

    const result = await DELETE(deleteRequest({ confirm: "delete my account" }));
    const body: unknown = await result.json();

    expect(result.status).toBe(503);
    expect(body).toMatchObject({ error: { code: "deletion_failed" } });
    expect(JSON.stringify(body)).not.toContain("synthetic Supabase outage");
  });
});

describe("GET /api/privacy/account", () => {
  it("returns null when the tenant never requested deletion", async () => {
    vi.mocked(getAccountDeletionStatus).mockResolvedValue(null);

    const result = await GET(new Request("https://relay.test/api/privacy/account"));

    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ deletion: null });
  });

  it("exposes in-progress deletion state so a retry can be resumed", async () => {
    vi.mocked(getAccountDeletionStatus).mockResolvedValue({
      attemptCount: 2,
      completedAt: null,
      connectorsRevokedAt: "2026-08-29T09:59:00.000Z",
      requestedAt: "2026-08-29T09:58:00.000Z",
      state: "connectors_revoked",
    });

    const result = await GET(new Request("https://relay.test/api/privacy/account"));

    expect(await result.json()).toMatchObject({
      deletion: { attemptCount: 2, state: "connectors_revoked" },
    });
  });
});
