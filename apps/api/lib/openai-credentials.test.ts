import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const crypto = vi.hoisted(() => ({
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
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected);
  return builder;
}

const supabase = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: supabase.createClient }));

const userId = "638ce145-a77d-4c32-b798-cb398e881fc9";
const connectionId = "19784902-e7a4-4f7f-b04d-e3a78c876629";
const env = {
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
  return import("./openai-credentials");
}

describe("validateOpenAiKey", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("accepts a key OpenAI answers with a successful status", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));
    const { validateOpenAiKey } = await importSubject();
    await expect(validateOpenAiKey("sk-synthetic")).resolves.toBe("valid");
  });

  it("rejects a key OpenAI answers as unauthorized", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));
    const { validateOpenAiKey } = await importSubject();
    await expect(validateOpenAiKey("sk-synthetic")).resolves.toBe("rejected");
  });

  it("throws without storing a body when the provider is unreachable", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));
    const { validateOpenAiKey, CredentialValidationUnavailableError } = await importSubject();
    await expect(validateOpenAiKey("sk-synthetic")).rejects.toBeInstanceOf(
      CredentialValidationUnavailableError,
    );
  });

  it("throws when the provider answers with an unexpected server error", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500 }));
    const { validateOpenAiKey, CredentialValidationUnavailableError } = await importSubject();
    await expect(validateOpenAiKey("sk-synthetic")).rejects.toBeInstanceOf(
      CredentialValidationUnavailableError,
    );
  });
});

describe("submitOpenAiCredential", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    crypto.parseKekKeyring.mockReturnValue({ activeVersion: 1, keys: { 1: "synthetic" } });
    crypto.encryptValue.mockResolvedValue(encryptedValue);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("stores an envelope-encrypted credential and records disclosure-free status", async () => {
    const insertConnection = chainable({ error: null });
    const insertAudit = chainable({ error: null });
    const from = vi.fn().mockReturnValueOnce(insertConnection).mockReturnValueOnce(insertAudit);
    supabase.createClient.mockReturnValue({ from });

    const { submitOpenAiCredential } = await importSubject();
    const status = await submitOpenAiCredential(userId, "sk-synthetic", env);

    expect(status.configured).toBe(true);
    expect(status.provider).toBe("openai");
    expect(insertConnection.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: userId,
        provider: "openai",
        key_version: 1,
        encryption_environment: "development",
      }),
    );
    const insertedRow = vi.mocked(insertConnection.insert).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(insertedRow)).not.toContain("sk-synthetic");
  });

  it("rejects a key the provider does not accept before any persistence", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));
    const from = vi.fn();
    supabase.createClient.mockReturnValue({ from });

    const { submitOpenAiCredential, CredentialRejectedError } = await importSubject();
    await expect(submitOpenAiCredential(userId, "sk-bad", env)).rejects.toBeInstanceOf(
      CredentialRejectedError,
    );
    expect(from).not.toHaveBeenCalled();
  });

  it("surfaces a conflict when a key is already configured", async () => {
    const insertConnection = chainable({ error: { code: "23505" } });
    const from = vi.fn().mockReturnValue(insertConnection);
    supabase.createClient.mockReturnValue({ from });

    const { submitOpenAiCredential, CredentialConflictError } = await importSubject();
    await expect(submitOpenAiCredential(userId, "sk-synthetic", env)).rejects.toBeInstanceOf(
      CredentialConflictError,
    );
  });
});

describe("rotateOpenAiCredential", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    crypto.parseKekKeyring.mockReturnValue({ activeVersion: 2, keys: { 1: "old", 2: "new" } });
    crypto.encryptValue.mockResolvedValue({ ...encryptedValue, keyVersion: 2 });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("re-encrypts with the active key version and leaves the connection id stable", async () => {
    const selectExisting = chainable({ data: { id: connectionId }, error: null });
    const updateConnection = chainable({ error: null });
    const insertAudit = chainable({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(selectExisting)
      .mockReturnValueOnce(updateConnection)
      .mockReturnValueOnce(insertAudit);
    supabase.createClient.mockReturnValue({ from });

    const { rotateOpenAiCredential } = await importSubject();
    const status = await rotateOpenAiCredential(userId, "sk-rotated", env);

    expect(status.configured).toBe(true);
    expect(updateConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({ key_version: 2 }),
    );
  });

  it("refuses to rotate a credential that was never configured", async () => {
    const selectExisting = chainable({ data: null, error: null });
    const from = vi.fn().mockReturnValue(selectExisting);
    supabase.createClient.mockReturnValue({ from });

    const { rotateOpenAiCredential, CredentialNotFoundError } = await importSubject();
    await expect(rotateOpenAiCredential(userId, "sk-rotated", env)).rejects.toBeInstanceOf(
      CredentialNotFoundError,
    );
  });
});

describe("revokeOpenAiCredential", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("atomically revokes the credential and dependent semantic rules", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { revoked: true, connectionId, disabledRuleCount: 1 },
      error: null,
    });
    supabase.createClient.mockReturnValue({ rpc });

    const { revokeOpenAiCredential } = await importSubject();
    const result = await revokeOpenAiCredential(userId, env);

    expect(result.revoked).toBe(true);
    expect(rpc).toHaveBeenCalledWith("revoke_openai_connection", { p_user_id: userId });
  });

  it("fails closed when atomic revocation is unavailable", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "synthetic-failure" },
    });
    supabase.createClient.mockReturnValue({ rpc });

    const { revokeOpenAiCredential } = await importSubject();
    await expect(revokeOpenAiCredential(userId, env)).rejects.toThrow(
      "Failed to revoke OpenAI credential",
    );
  });

  it("reports nothing to revoke when no credential is configured", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { revoked: false, disabledRuleCount: 0 },
      error: null,
    });
    supabase.createClient.mockReturnValue({ rpc });

    const { revokeOpenAiCredential } = await importSubject();
    await expect(revokeOpenAiCredential(userId, env)).resolves.toEqual({ revoked: false });
  });
});

describe("getOpenAiCredentialStatus", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("never includes credential columns, only configuration metadata", async () => {
    const selectStatus = chainable({
      data: { metadata: { lastValidatedAt: "2026-08-27T00:00:00Z" } },
      error: null,
    });
    const from = vi.fn().mockReturnValue(selectStatus);
    supabase.createClient.mockReturnValue({ from });

    const { getOpenAiCredentialStatus } = await importSubject();
    const status = await getOpenAiCredentialStatus(userId, env);

    expect(status).toEqual({
      provider: "openai",
      configured: true,
      lastValidatedAt: "2026-08-27T00:00:00Z",
      validated: true,
    });
    expect(selectStatus.select).toHaveBeenCalledWith("metadata");
  });

  it("reports not configured when no row exists", async () => {
    const selectStatus = chainable({ data: null, error: null });
    const from = vi.fn().mockReturnValue(selectStatus);
    supabase.createClient.mockReturnValue({ from });

    const { getOpenAiCredentialStatus } = await importSubject();
    await expect(getOpenAiCredentialStatus(userId, env)).resolves.toEqual({
      provider: "openai",
      configured: false,
    });
  });
});

describe("configurable endpoint", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    crypto.parseKekKeyring.mockReturnValue({ activeVersion: 1, keys: { 1: "synthetic" } });
    crypto.encryptValue.mockResolvedValue(encryptedValue);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("validates a key against the endpoint it is for, not against OpenAI", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));
    const { validateOpenAiKey } = await importSubject();

    await expect(
      validateOpenAiKey("sk-deepseek-synthetic", "https://api.deepseek.com/v1"),
    ).resolves.toBe("valid");
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("https://api.deepseek.com/v1/models");
  });

  it("defaults to OpenAI when no endpoint is given", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));
    const { validateOpenAiKey } = await importSubject();

    await validateOpenAiKey("sk-synthetic");
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/models");
  });

  it.each([404, 405])("reports %s as unsupported rather than rejecting the key", async (status) => {
    // An endpoint with no model listing has told us nothing about the key. Refusing would lock
    // out usable servers; claiming validation would be a lie.
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status }));
    const { validateOpenAiKey } = await importSubject();
    await expect(validateOpenAiKey("synthetic", "https://models.example.test/v1")).resolves.toBe(
      "unsupported",
    );
  });

  it("stores a submitted endpoint beside the key and validates against it", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));
    const insert = chainable({ error: null });
    const audit = chainable({ error: null });
    const from = vi.fn().mockReturnValueOnce(insert).mockReturnValueOnce(audit);
    supabase.createClient.mockReturnValue({ from });

    const { submitOpenAiCredential } = await importSubject();
    const status = await submitOpenAiCredential(userId, "sk-deepseek-synthetic", env, {
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      responseFormat: "json-object",
    });

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("https://api.deepseek.com/v1/models");
    const stored = insert.insert.mock.calls[0]?.[0] as { metadata: Record<string, unknown> };
    expect(stored.metadata).toMatchObject({
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      responseFormat: "json-object",
    });
    // The key itself is never part of the metadata that describes where it is used.
    expect(JSON.stringify(stored.metadata)).not.toContain("sk-deepseek-synthetic");
    expect(status.endpoint).toEqual({
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      responseFormat: "json-object",
    });
    expect(status.validated).toBe(true);
  });

  it("stores a key an endpoint could not confirm, and says it is unvalidated", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 404 }));
    const insert = chainable({ error: null });
    const audit = chainable({ error: null });
    const from = vi.fn().mockReturnValueOnce(insert).mockReturnValueOnce(audit);
    supabase.createClient.mockReturnValue({ from });

    const { submitOpenAiCredential } = await importSubject();
    const status = await submitOpenAiCredential(userId, "synthetic", env, {
      baseUrl: "https://models.example.test/v1",
    });

    expect(status.validated).toBe(false);
    expect(status.lastValidatedAt).toBeUndefined();
    const stored = insert.insert.mock.calls[0]?.[0] as { metadata: Record<string, unknown> };
    expect(stored.metadata.lastValidatedAt).toBeUndefined();
  });

  it.each([
    ["a private address", "https://10.0.0.5/v1"],
    ["cloud metadata", "https://169.254.169.254/latest"],
    ["plain http to a public host", "http://gateway.example.test/v1"],
    ["a credential in the query string", "https://gateway.example.test/v1?key=secret"],
  ])("refuses %s before any network call or write", async (_name, baseUrl) => {
    const from = vi.fn();
    supabase.createClient.mockReturnValue({ from });

    const { submitOpenAiCredential, CredentialEndpointInvalidError } = await importSubject();
    await expect(
      submitOpenAiCredential(userId, "sk-synthetic", env, { baseUrl }),
    ).rejects.toBeInstanceOf(CredentialEndpointInvalidError);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("allows a loopback endpoint in development, for a locally hosted model", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));
    const insert = chainable({ error: null });
    const audit = chainable({ error: null });
    const from = vi.fn().mockReturnValueOnce(insert).mockReturnValueOnce(audit);
    supabase.createClient.mockReturnValue({ from });

    const { submitOpenAiCredential } = await importSubject();
    const status = await submitOpenAiCredential(userId, "ollama", env, {
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "llama3.3",
    });
    expect(status.endpoint?.baseUrl).toBe("http://127.0.0.1:11434/v1");
  });

  it("refuses the same loopback endpoint in a production deployment", async () => {
    const from = vi.fn();
    supabase.createClient.mockReturnValue({ from });

    const { submitOpenAiCredential, CredentialEndpointInvalidError } = await importSubject();
    await expect(
      submitOpenAiCredential(
        userId,
        "ollama",
        { ...env, relayEnvironment: "production" },
        { baseUrl: "http://127.0.0.1:11434/v1" },
      ),
    ).rejects.toBeInstanceOf(CredentialEndpointInvalidError);
    expect(from).not.toHaveBeenCalled();
  });

  it("keeps the stored endpoint when a rotation does not name one", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));
    const existing = chainable({
      data: {
        id: connectionId,
        metadata: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
      },
      error: null,
    });
    const update = chainable({ error: null });
    const audit = chainable({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(existing)
      .mockReturnValueOnce(update)
      .mockReturnValueOnce(audit);
    supabase.createClient.mockReturnValue({ from });

    const { rotateOpenAiCredential } = await importSubject();
    const status = await rotateOpenAiCredential(userId, "sk-deepseek-replacement", env);

    // Silently moving a replacement key back to OpenAI would break the connection.
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("https://api.deepseek.com/v1/models");
    expect(status.endpoint?.baseUrl).toBe("https://api.deepseek.com/v1");
  });

  it("surfaces a stored endpoint in the status without touching credential columns", async () => {
    const selectStatus = chainable({
      data: {
        metadata: {
          baseUrl: "https://openrouter.ai/api/v1",
          model: "anthropic/claude-sonnet-4",
          lastValidatedAt: "2026-08-30T00:00:00Z",
        },
      },
      error: null,
    });
    const from = vi.fn().mockReturnValue(selectStatus);
    supabase.createClient.mockReturnValue({ from });

    const { getOpenAiCredentialStatus } = await importSubject();
    const status = await getOpenAiCredentialStatus(userId, env);

    expect(status.endpoint).toEqual({
      baseUrl: "https://openrouter.ai/api/v1",
      model: "anthropic/claude-sonnet-4",
    });
    expect(selectStatus.select).toHaveBeenCalledWith("metadata");
  });
});
