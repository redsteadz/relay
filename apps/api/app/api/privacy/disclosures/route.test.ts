import { beforeEach, expect, it, vi } from "vitest";

import { authenticateRequest } from "../../../../lib/auth";
import { listDisclosures, loadPrivacyEnv } from "../../../../lib/privacy";
import { GET } from "./route";

vi.mock("../../../../lib/auth", () => ({ authenticateRequest: vi.fn() }));
vi.mock("../../../../lib/privacy", () => ({ listDisclosures: vi.fn(), loadPrivacyEnv: vi.fn() }));

const userId = "638ce145-a77d-4c32-b798-cb398e881fc9";
const request = (query = "") => new Request(`https://relay.test/api/privacy/disclosures${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadPrivacyEnv).mockReturnValue({
    kekKeyring: "synthetic",
    supabaseServiceRoleKey: "sb_secret_synthetic_backend_key_12345",
    supabaseUrl: "https://supabase.example.test",
  });
  vi.mocked(authenticateRequest).mockResolvedValue({ userId });
  vi.mocked(listDisclosures).mockResolvedValue([]);
});

it("returns the tenant disclosure history", async () => {
  vi.mocked(listDisclosures).mockResolvedValue([
    {
      createdAt: "2026-08-29T10:00:00.000Z",
      disclosedFields: ["subject"],
      id: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
      model: "synthetic-model",
      provider: "openai",
      purpose: "synthetic purpose",
    },
  ]);

  const response = await GET(request());

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    disclosures: [{ disclosedFields: ["subject"], provider: "openai" }],
  });
  expect(listDisclosures).toHaveBeenCalledWith(userId, expect.anything(), 100);
});

it.each(["?limit=0", "?limit=101", "?limit=abc", "?limit=-1"])(
  "rejects an out-of-range limit %s",
  async (query) => {
    expect((await GET(request(query))).status).toBe(400);
    expect(listDisclosures).not.toHaveBeenCalled();
  },
);

it("accepts a valid limit", async () => {
  await GET(request("?limit=25"));
  expect(listDisclosures).toHaveBeenCalledWith(userId, expect.anything(), 25);
});

it("never lists disclosures for an unauthenticated caller", async () => {
  vi.mocked(authenticateRequest).mockResolvedValue({
    error: Response.json({ error: { code: "unauthorized" } }, { status: 401 }),
  });

  expect((await GET(request())).status).toBe(401);
  expect(listDisclosures).not.toHaveBeenCalled();
});
