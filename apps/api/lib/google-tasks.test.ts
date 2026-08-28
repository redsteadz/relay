import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const crypto = vi.hoisted(() => ({
  decryptValue: vi.fn(),
  encryptValue: vi.fn(),
  parseKekKeyring: vi.fn(),
}));
vi.mock("@relay/crypto", () => crypto);

type ChainResult = { data?: unknown; error?: unknown };
type Builder = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  then: Promise<ChainResult>["then"];
};

function chainable(result: ChainResult): Builder {
  const builder = {} as Builder;
  const self = () => builder;
  builder.select = vi.fn(self);
  builder.insert = vi.fn(self);
  builder.update = vi.fn(self);
  builder.delete = vi.fn(self);
  builder.eq = vi.fn(self);
  builder.in = vi.fn(self);
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected);
  return builder;
}

const supabase = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: supabase.createClient }));

const userId = "638ce145-a77d-4c32-b798-cb398e881fc9";
const connectionId = "19784902-e7a4-4f7f-b04d-e3a78c876629";
const env = {
  googleClientId: "synthetic-client-id",
  googleClientSecret: "synthetic-client-secret",
  kekKeyring: '{"activeVersion":1,"keys":{"1":"synthetic"}}',
  supabaseUrl: "https://relay-auth.example.test",
  supabaseServiceRoleKey: "synthetic-service-key",
  relayEnvironment: "development",
};

const encryptedValue = {
  algorithm: "AES-GCM-256" as const,
  ciphertext: "AAAAAAAAAAAAAAAAAAAAAA==",
  keyVersion: 1,
  nonce: "AAAAAAAAAAAAAAAA",
  wrappedKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  wrapNonce: "AAAAAAAAAAAAAAAA",
};

async function importSubject() {
  return import("./google-tasks");
}

describe("PKCE", () => {
  it("generates a code verifier with sufficient entropy", async () => {
    const { generateCodeVerifier } = await importSubject();
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces a deterministic SHA-256 S256 challenge", async () => {
    const { generateCodeChallenge, generateCodeVerifier } = await importSubject();
    const verifier = generateCodeVerifier();
    const a = await generateCodeChallenge(verifier);
    const b = await generateCodeChallenge(verifier);
    expect(a).toBe(b);
    expect(a.length).toBe(43);
  });
});

describe("OAuth cookie", () => {
  it("round-trips state and verifier scoped to the google-tasks callback path", async () => {
    const { buildOAuthCookie, generateCodeVerifier, generateState, parseOAuthCookie } =
      await importSubject();
    const state = generateState();
    const verifier = generateCodeVerifier();
    const cookie = buildOAuthCookie(state, verifier, userId);
    expect(cookie).toContain("Path=/api/connectors/google-tasks");

    const value = cookie.split(";")[0]!.split("=").slice(1).join("=");
    const request = new Request("https://localhost/api/connectors/google-tasks/callback", {
      headers: { cookie: `relay_google_tasks_oauth=${value}` },
    });
    const parsed = parseOAuthCookie(request);
    expect(parsed).not.toBeNull();
    expect(parsed?.state).toBe(state);
    expect(parsed?.codeVerifier).toBe(verifier);
    expect(parsed?.userId).toBe(userId);
    expect(typeof parsed?.expiresAt).toBe("number");
  });

  it("does not collide with the Gmail connector's cookie name", async () => {
    const { buildOAuthCookie, generateCodeVerifier, generateState, parseOAuthCookie } =
      await importSubject();
    const cookie = buildOAuthCookie(generateState(), generateCodeVerifier(), userId);
    const request = new Request("https://localhost/api/connectors/google-tasks/callback", {
      headers: { cookie: "relay_gmail_oauth=unrelated-value" },
    });
    expect(cookie).not.toContain("relay_gmail_oauth");
    expect(parseOAuthCookie(request)).toBeNull();
  });

  it("returns null when the cookie is expired", async () => {
    const { parseOAuthCookie } = await importSubject();
    const payload = {
      state: "s",
      codeVerifier: "v",
      userId,
      expiresAt: Date.now() - 1000,
    };
    const request = new Request("https://localhost/api/connectors/google-tasks/callback", {
      headers: { cookie: `relay_google_tasks_oauth=${btoa(JSON.stringify(payload))}` },
    });
    expect(parseOAuthCookie(request)).toBeNull();
  });
});

describe("buildGoogleAuthUrl", () => {
  it("requests only the Google Tasks scope", async () => {
    const { buildGoogleAuthUrl, generateCodeVerifier, generateState } = await importSubject();
    const url = await buildGoogleAuthUrl(
      "client-id",
      "https://relay.test/api/connectors/google-tasks/callback",
      generateState(),
      generateCodeVerifier(),
    );
    const scope = new URL(url).searchParams.get("scope");
    expect(scope).toBe("https://www.googleapis.com/auth/tasks");
  });
});

describe("persistConnection", () => {
  beforeEach(() => {
    crypto.parseKekKeyring.mockReturnValue({ activeVersion: 1, keys: { 1: "synthetic" } });
    crypto.encryptValue.mockResolvedValue(encryptedValue);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("stores an envelope-encrypted refresh token without an account label", async () => {
    const insert = chainable({ data: { id: connectionId }, error: null });
    const from = vi.fn().mockReturnValue(insert);
    supabase.createClient.mockReturnValue({ from });

    const { persistConnection } = await importSubject();
    const result = await persistConnection(userId, "1//refresh-token", ["tasks"], env);

    expect(result).toEqual({ id: connectionId });
    expect(insert.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: userId, provider: "google-tasks" }),
    );
    const insertedRow = insert.insert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertedRow.external_account_id).toBeUndefined();
    expect(JSON.stringify(insertedRow)).not.toContain("refresh-token");
  });

  it("surfaces a clear conflict when Google Tasks is already connected", async () => {
    const insert = chainable({ data: null, error: { code: "23505" } });
    const from = vi.fn().mockReturnValue(insert);
    supabase.createClient.mockReturnValue({ from });

    const { persistConnection } = await importSubject();
    await expect(persistConnection(userId, "1//refresh-token", ["tasks"], env)).rejects.toThrow(
      "Google Tasks is already connected",
    );
  });
});

describe("listTaskLists", () => {
  beforeEach(() => {
    crypto.parseKekKeyring.mockReturnValue({ activeVersion: 1, keys: { 1: "synthetic" } });
    crypto.decryptValue.mockResolvedValue("1//refresh-token");
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns only id and title, refreshing the access token first", async () => {
    const selectConnection = chainable({
      data: {
        id: connectionId,
        credential_ciphertext: "\\xaa",
        credential_nonce: "\\xaa",
        wrapped_data_key: "\\xaa",
        wrap_nonce: "\\xaa",
        key_version: 1,
      },
      error: null,
    });
    const from = vi.fn().mockReturnValue(selectConnection);
    supabase.createClient.mockReturnValue({ from });

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "synthetic-access-token" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              { id: "list-1", title: "Inbox", etag: "synthetic", extra: "ignored" },
              { id: "list-2" },
            ],
          }),
          { status: 200 },
        ),
      );

    const { listTaskLists } = await importSubject();
    const lists = await listTaskLists(userId, env);

    expect(lists).toEqual([{ id: "list-1", title: "Inbox" }]);
    const secondCall = vi.mocked(fetch).mock.calls[1];
    expect(secondCall?.[1]).toMatchObject({
      headers: { authorization: "Bearer synthetic-access-token" },
    });
  });

  it("throws a typed error when no connection is configured", async () => {
    const selectConnection = chainable({ data: null, error: null });
    const from = vi.fn().mockReturnValue(selectConnection);
    supabase.createClient.mockReturnValue({ from });

    const { listTaskLists, ConnectionNotFoundError } = await importSubject();
    await expect(listTaskLists(userId, env)).rejects.toBeInstanceOf(ConnectionNotFoundError);
  });
});

describe("disconnectGoogleTasks", () => {
  beforeEach(() => {
    crypto.parseKekKeyring.mockReturnValue({ activeVersion: 1, keys: { 1: "synthetic" } });
    crypto.decryptValue.mockResolvedValue("1//refresh-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("detaches and disables dependent action rules before deleting the credential", async () => {
    const selectConnection = chainable({
      data: {
        credential_ciphertext: "\\xaa",
        credential_nonce: "\\xaa",
        wrapped_data_key: "\\xaa",
        wrap_nonce: "\\xaa",
        key_version: 1,
        provider: "google-tasks",
      },
      error: null,
    });
    const selectDependentRules = chainable({ data: [{ id: "rule-1" }], error: null });
    const updateRules = chainable({ error: null });
    const deleteConnection = chainable({ error: null });
    const insertAudit = chainable({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(selectConnection)
      .mockReturnValueOnce(selectDependentRules)
      .mockReturnValueOnce(updateRules)
      .mockReturnValueOnce(deleteConnection)
      .mockReturnValueOnce(insertAudit);
    supabase.createClient.mockReturnValue({ from });

    const { disconnectGoogleTasks } = await importSubject();
    const result = await disconnectGoogleTasks(userId, connectionId, env);

    expect(result).toEqual({ deleted: true, revoked: true });
    expect(updateRules.update).toHaveBeenCalledWith({ enabled: false, connection_id: null });
    expect(updateRules.in).toHaveBeenCalledWith("id", ["rule-1"]);
  });

  it("still deletes when revocation fails and nothing depends on the connection", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 400 }));
    const selectConnection = chainable({
      data: {
        credential_ciphertext: "\\xaa",
        credential_nonce: "\\xaa",
        wrapped_data_key: "\\xaa",
        wrap_nonce: "\\xaa",
        key_version: 1,
        provider: "google-tasks",
      },
      error: null,
    });
    const selectDependentRules = chainable({ data: [], error: null });
    const deleteConnection = chainable({ error: null });
    const insertAudit = chainable({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(selectConnection)
      .mockReturnValueOnce(selectDependentRules)
      .mockReturnValueOnce(deleteConnection)
      .mockReturnValueOnce(insertAudit);
    supabase.createClient.mockReturnValue({ from });

    const { disconnectGoogleTasks } = await importSubject();
    const result = await disconnectGoogleTasks(userId, connectionId, env);
    expect(result).toEqual({ deleted: true, revoked: false });
  });

  it("reports nothing deleted when the connection does not exist, without deleting anything", async () => {
    const selectConnection = chainable({ data: null, error: null });
    const from = vi.fn().mockReturnValueOnce(selectConnection);
    supabase.createClient.mockReturnValue({ from });

    const { disconnectGoogleTasks } = await importSubject();
    const result = await disconnectGoogleTasks(userId, connectionId, env);
    expect(result).toEqual({ deleted: false, revoked: false });
    expect(from).toHaveBeenCalledTimes(1);
  });
});
