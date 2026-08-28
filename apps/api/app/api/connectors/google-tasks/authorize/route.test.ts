import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateRequest } from "../../../../../lib/auth";
import {
  buildCallbackUrl,
  buildGoogleAuthUrl,
  buildOAuthCookie,
  generateCodeVerifier,
  generateState,
  loadGoogleTasksEnv,
} from "../../../../../lib/google-tasks";
import { GET } from "./route";

vi.mock("../../../../../lib/auth", () => ({ authenticateRequest: vi.fn() }));
vi.mock("../../../../../lib/google-tasks", () => ({
  buildCallbackUrl: vi.fn(),
  buildGoogleAuthUrl: vi.fn(),
  buildOAuthCookie: vi.fn(),
  generateCodeVerifier: vi.fn(),
  generateState: vi.fn(),
  loadGoogleTasksEnv: vi.fn(),
}));

const env = {
  googleClientId: "synthetic-client-id",
  googleClientSecret: "synthetic-client-secret",
  kekKeyring: "synthetic",
  supabaseUrl: "https://relay-auth.example.test",
  supabaseServiceRoleKey: "synthetic-service-key",
  relayEnvironment: "development",
};

describe("GET /api/connectors/google-tasks/authorize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadGoogleTasksEnv).mockReturnValue(env);
    vi.mocked(authenticateRequest).mockResolvedValue({
      accessToken: "synthetic-token",
      userId: "638ce145-a77d-4c32-b798-cb398e881fc9",
    });
    vi.mocked(generateState).mockReturnValue("synthetic-state");
    vi.mocked(generateCodeVerifier).mockReturnValue("synthetic-verifier");
    vi.mocked(buildCallbackUrl).mockReturnValue(
      "https://relay.test/api/connectors/google-tasks/callback",
    );
    vi.mocked(buildGoogleAuthUrl).mockResolvedValue(
      "https://accounts.google.com/o/oauth2/v2/auth?x=1",
    );
    vi.mocked(buildOAuthCookie).mockReturnValue("relay_google_tasks_oauth=synthetic; HttpOnly");
  });

  it("redirects to Google with a scoped PKCE cookie set, using bearer authority only", async () => {
    const response = await GET(
      new Request("https://relay.test/api/connectors/google-tasks/authorize"),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth?x=1",
    );
    expect(response.headers.get("set-cookie")).toContain("relay_google_tasks_oauth");
    expect(buildOAuthCookie).toHaveBeenCalledWith(
      "synthetic-state",
      "synthetic-verifier",
      "638ce145-a77d-4c32-b798-cb398e881fc9",
    );
  });

  it("returns 503 when the connector is not configured", async () => {
    vi.mocked(loadGoogleTasksEnv).mockReturnValue(null);
    const response = await GET(
      new Request("https://relay.test/api/connectors/google-tasks/authorize"),
    );
    expect(response.status).toBe(503);
    expect(authenticateRequest).not.toHaveBeenCalled();
  });

  it("propagates authentication failure before contacting Google", async () => {
    const unauthorized = Response.json({ error: { code: "unauthorized" } }, { status: 401 });
    vi.mocked(authenticateRequest).mockResolvedValue({ error: unauthorized });
    const response = await GET(
      new Request("https://relay.test/api/connectors/google-tasks/authorize"),
    );
    expect(response.status).toBe(401);
    expect(buildGoogleAuthUrl).not.toHaveBeenCalled();
  });
});
