import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateRequest } from "./auth";

const supabase = vi.hoisted(() => {
  const getUser = vi.fn();
  return {
    createClient: vi.fn(() => ({ auth: { getUser } })),
    getUser,
  };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: supabase.createClient }));

async function expectAuthError(
  result: Awaited<ReturnType<typeof authenticateRequest>>,
  code: string,
) {
  expect("error" in result).toBe(true);
  if (!("error" in result)) return;
  expect(result.error.status).toBe(401);
  await expect(result.error.json()).resolves.toMatchObject({ error: { code } });
}

describe("authenticateRequest", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://relay-auth.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-publishable-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("accepts a bearer user verified by the configured Supabase project", async () => {
    const userId = "638ce145-a77d-4c32-b798-cb398e881fc9";
    supabase.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });

    const result = await authenticateRequest(
      new Request("https://relay.test/api/ingest", {
        headers: { authorization: "Bearer synthetic-access-token" },
      }),
    );

    expect(result).toEqual({ userId });
    expect(supabase.getUser).toHaveBeenCalledWith("synthetic-access-token");
  });

  it("rejects a missing or malformed bearer credential", async () => {
    const missing = await authenticateRequest(new Request("https://relay.test/api/ingest"));
    const malformed = await authenticateRequest(
      new Request("https://relay.test/api/ingest", {
        headers: { authorization: "Bearer token with spaces" },
      }),
    );

    await expectAuthError(missing, "unauthorized");
    await expectAuthError(malformed, "unauthorized");
    expect(supabase.createClient).not.toHaveBeenCalled();
  });

  it.each(["expired", "wrong-project"])("rejects a %s bearer token", async () => {
    supabase.getUser.mockResolvedValue({
      data: { user: null },
      error: new Error("synthetic auth rejection"),
    });

    const result = await authenticateRequest(
      new Request("https://relay.test/api/ingest", {
        headers: { authorization: "Bearer rejected-token" },
      }),
    );

    await expectAuthError(result, "invalid_token");
  });

  it("rejects an invalid user identifier from the auth provider", async () => {
    supabase.getUser.mockResolvedValue({ data: { user: { id: "not-a-uuid" } }, error: null });

    const result = await authenticateRequest(
      new Request("https://relay.test/api/ingest", {
        headers: { authorization: "Bearer malformed-user-token" },
      }),
    );

    await expectAuthError(result, "invalid_token");
  });

  it("ignores the development identity header in production", async () => {
    const result = await authenticateRequest(
      new Request("https://relay.test/api/ingest", {
        headers: { "x-relay-development-user": "638ce145-a77d-4c32-b798-cb398e881fc9" },
      }),
    );

    await expectAuthError(result, "unauthorized");
  });

  it("allows a valid development identity only outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const userId = "638ce145-a77d-4c32-b798-cb398e881fc9";

    const result = await authenticateRequest(
      new Request("https://relay.test/api/ingest", {
        headers: { "x-relay-development-user": userId },
      }),
    );

    expect(result).toEqual({ userId });
    expect(supabase.createClient).not.toHaveBeenCalled();
  });

  it("rejects a non-UUID development user", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const result = await authenticateRequest(
      new Request("https://relay.test/api/ingest", {
        headers: { "x-relay-development-user": "development-user" },
      }),
    );

    await expectAuthError(result, "invalid_development_user");
  });
});
