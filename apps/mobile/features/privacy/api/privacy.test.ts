import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteRelayAccount,
  getDisclosureHistory,
  getPrivacyOverview,
  purgeRawPayloads,
  rotateOpenAiKey,
  submitOpenAiKey,
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
    await expect(getDisclosureHistory("token")).rejects.toMatchObject({
      reason: "malformed-response",
    });
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

  describe("semantic credential", () => {
    const request = {
      apiKey: "sk-synthetic",
      endpoint: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
    };

    it("adds a key with POST and replaces one with PATCH", async () => {
      const stored = Response.json({
        configured: true,
        endpoint: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
        provider: "openai",
        validated: true,
      });
      const fetchMock = vi.fn().mockResolvedValueOnce(stored).mockResolvedValueOnce(stored.clone());
      vi.stubGlobal("fetch", fetchMock);

      await expect(submitOpenAiKey("token", request)).resolves.toMatchObject({ configured: true });
      await rotateOpenAiKey("token", request);

      expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.relay.test/api/connectors/openai");
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
        body: JSON.stringify(request),
        method: "POST",
      });
      expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "PATCH" });
    });

    it("carries the API error code so the form can say which part was refused", async () => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            Response.json({ error: { code: "openai_key_rejected" } }, { status: 400 }),
          ),
      );
      await expect(submitOpenAiKey("token", request)).rejects.toMatchObject({
        apiCode: "openai_key_rejected",
        reason: "validation",
      });
    });

    it("refuses a status payload carrying key material", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          Response.json({
            apiKey: "sk-synthetic",
            configured: true,
            provider: "openai",
          }),
        ),
      );
      // The status contract is strict, so a deployment that ever echoed a key back would fail the
      // boundary rather than reach a screen.
      await expect(submitOpenAiKey("token", request)).rejects.toMatchObject({
        reason: "malformed-response",
      });
    });
  });
});
