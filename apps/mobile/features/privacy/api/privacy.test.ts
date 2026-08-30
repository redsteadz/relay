import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteRelayAccount,
  getDisclosureHistory,
  getPrivacyOverview,
  purgeRawPayloads,
} from "./privacy";

describe("privacy API boundary", () => {
  beforeEach(() => vi.stubEnv("EXPO_PUBLIC_API_URL", "https://api.relay.test"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("parses the privacy overview contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          deletion: null,
          retention: {
            earliestExpiresAt: null,
            latestExpiresAt: null,
            retainedCount: 0,
            retentionDays: 7,
          },
        }),
      ),
    );
    await expect(getPrivacyOverview("token")).resolves.toMatchObject({
      retention: { retainedCount: 0, retentionDays: 7 },
    });
  });

  it("rejects disclosure payloads containing source content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          disclosures: [
            {
              createdAt: "2026-08-29T10:00:00Z",
              disclosedFields: ["subject"],
              id: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
              model: "gpt-5-mini",
              provider: "openai",
              purpose: "Classify",
              sourceBody: "must not cross the contract",
            },
          ],
        }),
      ),
    );
    await expect(getDisclosureHistory("token")).rejects.toMatchObject({ reason: "unavailable" });
  });

  it("uses destructive HTTP methods and the exact account confirmation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ purged: true, purgedCount: 4 }))
      .mockResolvedValueOnce(
        Response.json({
          deleted: true,
          deletion: {
            attemptCount: 1,
            completedAt: "2026-08-29T10:01:00Z",
            connectorsRevokedAt: "2026-08-29T10:00:30Z",
            requestedAt: "2026-08-29T10:00:00Z",
            state: "completed",
          },
          failedRevocations: 0,
          revokedCredentials: 1,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await purgeRawPayloads("token");
    await deleteRelayAccount("token");

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ confirm: "delete my account" }),
      method: "DELETE",
    });
  });
});
