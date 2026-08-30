import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCallbackUrl,
  DuplicateGmailConnectionError,
  exchangeCodeForTokens,
  fetchGmailAddress,
  loadGmailEnv,
  parseOAuthCookie,
  persistConnection,
} from "../../../../../lib/gmail";
import { GET } from "./route";

vi.mock("../../../../../lib/gmail", () => {
  class MockDuplicateGmailConnectionError extends Error {}
  return {
    buildCallbackUrl: vi.fn(),
    clearOAuthCookie: vi.fn(() => "relay_gmail_oauth=; Max-Age=0; HttpOnly; Secure"),
    DuplicateGmailConnectionError: MockDuplicateGmailConnectionError,
    exchangeCodeForTokens: vi.fn(),
    fetchGmailAddress: vi.fn(),
    loadGmailEnv: vi.fn(),
    parseOAuthCookie: vi.fn(),
    persistConnection: vi.fn(),
  };
});

const env = {
  googleClientId: "synthetic-client-id",
  googleClientSecret: "synthetic-client-secret",
  kekKeyring: "synthetic",
  supabaseUrl: "https://relay-auth.example.test",
  supabaseServiceRoleKey: "synthetic-service-key",
  relayEnvironment: "development",
};
const oauthSession = {
  state: "synthetic-state",
  codeVerifier: "synthetic-verifier",
  userId: "638ce145-a77d-4c32-b798-cb398e881fc9",
  expiresAt: Date.now() + 60_000,
};

function callbackRequest(query: string) {
  return new Request(`https://relay.test/api/connectors/gmail/callback${query}`);
}

describe("GET /api/connectors/gmail/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadGmailEnv).mockReturnValue(env);
    vi.mocked(buildCallbackUrl).mockReturnValue("https://relay.test/api/connectors/gmail/callback");
    vi.mocked(parseOAuthCookie).mockResolvedValue(oauthSession);
    vi.mocked(fetchGmailAddress).mockResolvedValue("mailbox@example.test");
  });

  it("requires readonly scope before mailbox lookup or persistence", async () => {
    vi.mocked(exchangeCodeForTokens).mockResolvedValue({
      accessToken: "synthetic-access-token",
      refreshToken: "synthetic-refresh-token",
      expiresIn: 3600,
      scope: "openid",
    });

    const response = await GET(callbackRequest("?code=abc&state=synthetic-state"));

    expect(response.status).toBe(403);
    expect(fetchGmailAddress).not.toHaveBeenCalled();
    expect(persistConnection).not.toHaveBeenCalled();
  });

  it("persists atomically initialized Gmail connection after profile lookup", async () => {
    vi.mocked(exchangeCodeForTokens).mockResolvedValue({
      accessToken: "synthetic-access-token",
      refreshToken: "synthetic-refresh-token",
      expiresIn: 3600,
      scope: "https://www.googleapis.com/auth/gmail.readonly",
    });
    vi.mocked(persistConnection).mockResolvedValue({ id: "19784902-e7a4-4f7f-b04d-e3a78c876629" });

    const response = await GET(callbackRequest("?code=abc&state=synthetic-state"));

    expect(response.status).toBe(200);
    expect(fetchGmailAddress).toHaveBeenCalledWith("synthetic-access-token");
    expect(persistConnection).toHaveBeenCalledWith(
      oauthSession.userId,
      "mailbox@example.test",
      "synthetic-refresh-token",
      ["https://www.googleapis.com/auth/gmail.readonly"],
      env,
    );
  });

  it("does not reflect provider OAuth error text", async () => {
    const providerError = "private-provider-error";
    const response = await GET(callbackRequest(`?error=${providerError}`));
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(text).not.toContain(providerError);
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it("maps duplicate ownership to fixed 409 response", async () => {
    vi.mocked(exchangeCodeForTokens).mockResolvedValue({
      accessToken: "synthetic-access-token",
      refreshToken: "synthetic-refresh-token",
      expiresIn: 3600,
      scope: "https://www.googleapis.com/auth/gmail.readonly",
    });
    vi.mocked(persistConnection).mockRejectedValue(new DuplicateGmailConnectionError());

    const response = await GET(callbackRequest("?code=abc&state=synthetic-state"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "duplicate_connection" },
    });
  });
});
