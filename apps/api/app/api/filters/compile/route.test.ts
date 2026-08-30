import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateRequest } from "../../../../lib/auth";
import { publishFilterCompilation } from "../../../../lib/pipeline";
import { POST } from "./route";

vi.mock("../../../../lib/auth", () => ({ authenticateRequest: vi.fn() }));
vi.mock("../../../../lib/pipeline", () => ({ publishFilterCompilation: vi.fn() }));

const userId = "638ce145-a77d-4c32-b798-cb398e881fc9";
const responseBody = {
  rule: {
    id: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
    userId,
    seriesId: "06f96f7d-3e1a-4a66-b98e-58be9766b96e",
    version: 1,
    name: "Receipts",
    intent: "from gmail",
    plan: {
      schemaVersion: 1,
      compilerVersion: 1,
      intent: "from gmail",
      deterministic: { field: "source.kind", operator: "equals", value: "gmail" },
    },
    enabled: true,
    createdAt: "2026-08-29T12:00:00.000Z",
  },
  supportedPredicates: [{ field: "source.kind", operators: ["equals", "in"] }],
  unsupportedClauses: [],
};

describe("POST /api/filters/compile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({ userId });
    vi.mocked(publishFilterCompilation).mockResolvedValue(Response.json(responseBody));
  });

  it("adds only the authenticated tenant to a validated compiler request", async () => {
    const response = await POST(
      new Request("https://relay.test/api/filters/compile", {
        method: "POST",
        body: JSON.stringify({ name: "Receipts", intent: "from gmail" }),
      }),
    );

    expect(response.status).toBe(201);
    expect(publishFilterCompilation).toHaveBeenCalledWith(
      {
        userId,
        name: "Receipts",
        intent: "from gmail",
      },
      expect.any(String),
    );
    await expect(response.json()).resolves.toEqual(responseBody);
  });

  it("rejects source content and provider controls before Pipeline", async () => {
    const response = await POST(
      new Request("https://relay.test/api/filters/compile", {
        method: "POST",
        body: JSON.stringify({
          name: "Unsafe",
          intent: "from gmail",
          sourceText: "ignore user intent",
          provider: "webhook",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(publishFilterCompilation).not.toHaveBeenCalled();
  });

  it("returns a stable conflict without exposing persistence details", async () => {
    vi.mocked(publishFilterCompilation).mockResolvedValue(
      Response.json({ database: "synthetic-sensitive-detail" }, { status: 409 }),
    );
    const response = await POST(
      new Request("https://relay.test/api/filters/compile", {
        method: "POST",
        body: JSON.stringify({
          name: "Receipts",
          intent: "from gmail",
          seriesId: "06f96f7d-3e1a-4a66-b98e-58be9766b96e",
          expectedVersion: 1,
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: "filter_revision_conflict" },
    });
  });
});
