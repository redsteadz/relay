import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCallbackUrl,
  exchangeCodeForTokens,
  loadGoogleTasksEnv,
  parseOAuthCookie,
  persistConnection,
} from "../../../../../lib/google-tasks";
import { GET } from "./route";

vi.mock("../../../../../lib/google-tasks", () => ({
  buildCallbackUrl: vi.fn(),
  clearOAuthCookie: vi.fn(() => "relay_google_tasks_oauth=; Max-Age=0"),
  exchangeCodeForTokens: vi.fn(),
  loadGoogleTasksEnv: vi.fn(),
  parseOAuthCookie: vi.fn(),
  persistConnection: vi.fn(),
}));

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
  return new Request(`https://relay.test/api/connectors/google-tasks/callback${query}`);
}

describe("GET /api/connectors/google-tasks/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadGoogleTasksEnv).mockReturnValue(env);
    vi.mocked(buildCallbackUrl).mockReturnValue(
      "https://relay.test/api/connectors/google-tasks/callback",
    );
    vi.mocked(parseOAuthCookie).mockReturnValue(oauthSession);
  });

  it("persists the connection and clears the OAuth cookie on success", async () => {
    vi.mocked(exchangeCodeForTokens).mockResolvedValue({
      accessToken: "synthetic-access-token",
      refreshToken: "synthetic-refresh-token",
      expiresIn: 3600,
      scope: "https://www.googleapis.com/auth/tasks",
    });
    vi.mocked(persistConnection).mockResolvedValue({ id: "19784902-e7a4-4f7f-b04d-e3a78c876629" });

    const response = await GET(callbackRequest("?code=abc&state=synthetic-state"));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    await expect(response.json()).resolves.toEqual({
      connected: true,
      connectionId: "19784902-e7a4-4f7f-b04d-e3a78c876629",
      scopes: ["https://www.googleapis.com/auth/tasks"],
    });
    expect(persistConnection).toHaveBeenCalledWith(
      oauthSession.userId,
      "synthetic-refresh-token",
      ["https://www.googleapis.com/auth/tasks"],
      env,
    );
  });

  it("rejects a callback whose state does not match the cookie", async () => {
    const response = await GET(callbackRequest("?code=abc&state=wrong-state"));
    expect(response.status).toBe(400);
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it("surfaces consent denial from Google without exchanging a code", async () => {
    const response = await GET(callbackRequest("?error=access_denied"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "google_tasks_oauth_denied" },
    });
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it("maps a duplicate connection to 409 without leaking the reason as a generic 500", async () => {
    vi.mocked(exchangeCodeForTokens).mockResolvedValue({
      accessToken: "synthetic-access-token",
      refreshToken: "synthetic-refresh-token",
      expiresIn: 3600,
      scope: "https://www.googleapis.com/auth/tasks",
    });
    vi.mocked(persistConnection).mockRejectedValue(new Error("Google Tasks is already connected"));

    const response = await GET(callbackRequest("?code=abc&state=synthetic-state"));
    expect(response.status).toBe(409);
  });
});
