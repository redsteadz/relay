import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Gmail from "./gmail";
const mock = vi.hoisted(() => ({
  sessions: new Map<string, Record<string, unknown>>(),
  nonce: "",
  calls: [] as string[],
}));
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(),
  jwtVerify: vi.fn(() =>
    Promise.resolve({ payload: { sub: "synthetic-google-sub", nonce: mock.nonce } }),
  ),
}));
vi.mock("./gmail", async (importOriginal) => ({
  ...(await importOriginal<typeof Gmail>()),
  loadGmailEnv: () => ({
    googleClientId: "synthetic-client",
    googleClientSecret: "synthetic-secret",
    kekKeyring: JSON.stringify({ activeVersion: 1, keys: { "1": btoa("k".repeat(32)) } }),
    supabaseUrl: "http://127.0.0.1:55321",
    supabaseServiceRoleKey: "synthetic-service-key",
    relayEnvironment: "development",
  }),
  generateCodeVerifier: () => "v".repeat(43),
  generateCodeChallenge: () => Promise.resolve("synthetic-challenge"),
  fetchGmailAddress: () => Promise.resolve("synthetic@example.invalid"),
  persistConnection: () => Promise.resolve({ id: "93100000-0000-4000-8000-000000000001" }),
}));
import {
  startSmartGoogleAuthorization,
  launchSmartGoogleAuthorization,
  finishSmartGoogleAuthorization,
} from "./smart-google-oauth";

describe("Google authorization handoff (mocked provider and database)", () => {
  beforeEach(() => {
    vi.stubEnv("RELAY_SMART_GOOGLE_ENABLED", "true");
    vi.stubEnv("RELAY_GOOGLE_REDIRECT_ORIGIN", "http://localhost:3000");
    mock.sessions.clear();
    mock.calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input);
        mock.calls.push(url.pathname);
        if (url.hostname === "oauth2.googleapis.com")
          return Promise.resolve(
            Response.json({
              access_token: "synthetic-access",
              refresh_token: "synthetic-refresh",
              scope: "openid https://www.googleapis.com/auth/tasks",
              id_token: "synthetic-id-token",
            }),
          );
        if (url.hostname !== "127.0.0.1")
          throw new Error("Tests may not contact external services");
        if (url.pathname.endsWith("/smart_google_oauth_sessions")) {
          if (init?.method === "POST") {
            const row = JSON.parse(init.body as string) as Record<string, unknown>;
            mock.sessions.set(String(row.id), row);
            return Promise.resolve(Response.json([row]));
          }
          const id = url.searchParams.get("id")?.slice(3) ?? "";
          const row = mock.sessions.get(id);
          if (row === undefined) return Promise.resolve(Response.json([]));
          if (init?.method === "DELETE") mock.sessions.delete(id);
          return Promise.resolve(Response.json([row]));
        }
        return Promise.resolve(Response.json([]));
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it("requests only the selected service and binds an encrypted, expiring session", async () => {
    const launch = new URL(
      await startSmartGoogleAuthorization("93000000-0000-4000-8000-000000000001", "google-tasks"),
    );
    const id = launch.searchParams.get("session")!;
    const session = mock.sessions.get(id)!;
    expect(JSON.stringify(session)).not.toContain("v".repeat(43));
    expect(Date.parse(String(session.expires_at))).toBeGreaterThan(Date.now());
    const response = await launchSmartGoogleAuthorization("google-tasks", id);
    const google = new URL(response.headers.get("location")!);
    expect(google.searchParams.get("include_granted_scopes")).toBe("true");
    expect(google.searchParams.get("scope")).toBe("openid https://www.googleapis.com/auth/tasks");
    expect(google.searchParams.get("state")).toBe(id);
  });
  it("rejects a callback with no matching browser cookie before token exchange", async () => {
    const response = await finishSmartGoogleAuthorization(
      new Request("http://localhost:3000"),
      "google-tasks",
      "synthetic-session",
      "synthetic-code",
    );
    expect(response.status).toBe(400);
    expect(mock.calls).not.toContain("/token");
  });
  it("consumes callback state once and never returns Google tokens", async () => {
    const launch = new URL(
      await startSmartGoogleAuthorization("93000000-0000-4000-8000-000000000001", "google-tasks"),
    );
    const id = launch.searchParams.get("session")!;
    mock.nonce = id;
    await launchSmartGoogleAuthorization("google-tasks", id);
    const request = new Request("http://localhost:3000", {
      headers: { cookie: `relay_smart_google_oauth=${id}` },
    });
    const completed = await finishSmartGoogleAuthorization(
      request,
      "google-tasks",
      id,
      "synthetic-code",
    );
    expect(completed.status).toBe(200);
    expect(await completed.text()).not.toContain("synthetic-refresh");
    expect(
      (await finishSmartGoogleAuthorization(request, "google-tasks", id, "synthetic-code")).status,
    ).toBe(400);
  });
  it("fails closed when the feature is disabled", async () => {
    vi.stubEnv("RELAY_SMART_GOOGLE_ENABLED", "false");
    await expect(
      startSmartGoogleAuthorization("93000000-0000-4000-8000-000000000001", "google-tasks"),
    ).rejects.toThrow();
    expect(mock.calls).toEqual([]);
  });
});
