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
    await expect(validateOpenAiKey("sk-synthetic")).resolves.toBe(true);
  });

  it("rejects a key OpenAI answers as unauthorized", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));
    const { validateOpenAiKey } = await importSubject();
    await expect(validateOpenAiKey("sk-synthetic")).resolves.toBe(false);
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

  it("deletes the credential and disables filter rules that need semantic evaluation", async () => {
    const selectExisting = chainable({ data: { id: connectionId }, error: null });
    const deleteConnection = chainable({ error: null });
    const selectEnabledRules = chainable({
      data: [
        { id: "rule-semantic", plan: { semantic: { question: "is this urgent?" } } },
        { id: "rule-deterministic", plan: { deterministic: { field: "sender" } } },
      ],
      error: null,
    });
    const updateRules = chainable({ error: null });
    const insertAudit = chainable({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(selectExisting)
      .mockReturnValueOnce(deleteConnection)
      .mockReturnValueOnce(selectEnabledRules)
      .mockReturnValueOnce(updateRules)
      .mockReturnValueOnce(insertAudit);
    supabase.createClient.mockReturnValue({ from });

    const { revokeOpenAiCredential } = await importSubject();
    const result = await revokeOpenAiCredential(userId, env);

    expect(result.revoked).toBe(true);
    expect(updateRules.update).toHaveBeenCalledWith({ enabled: false });
    expect(updateRules.in).toHaveBeenCalledWith("id", ["rule-semantic"]);
  });

  it("reports nothing to revoke when no credential is configured", async () => {
    const selectExisting = chainable({ data: null, error: null });
    const from = vi.fn().mockReturnValue(selectExisting);
    supabase.createClient.mockReturnValue({ from });

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
