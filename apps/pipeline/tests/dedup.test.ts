import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ingressQueueMessageSchema, type IngressEnvelope } from "@relay/contracts";
import {
  decryptValue,
  encryptValue,
  generateKek,
  parseKekKeyring,
  rewrapValue,
} from "@relay/crypto";

import {
  CONTENT_FINGERPRINT_ALGORITHM_VERSION,
  E2E_RESULT_PREFIX,
  handleE2EResultRequest,
  processIngressMessage,
  runMaintenanceAlarm,
  type E2EResult,
} from "../src/dedup";
import { postgresByteaToBase64, sourceItemEncryptionContext } from "../src/encryption";
import type { Env, IngressQueueMessage } from "../src/env";

// --- Minimal in-memory fake of `DurableObjectStorage`. It is deliberately just a `Map`: real
// `DurableObjectStorage` is durable and survives a Durable Object eviction/restart, but nothing in
// `processIngressMessage`/`runMaintenanceAlarm` keeps any state outside the `storage` argument they
// are given. So reusing one fake storage instance across two separate calls *is* a faithful restart
// simulation — there is no extra in-memory cache anywhere else to reset.
//
// Returns both the `DurableObjectStorage`-shaped object to pass into production code and the bare
// `vi.fn()` mocks to assert against, since referencing `storage.get` etc. directly in an `expect(...)`
// call trips `@typescript-eslint/unbound-method`.
function fakeStorage(options: { forceMiss?: boolean } = {}): {
  storage: DurableObjectStorage;
  mocks: StorageMocks;
} {
  const map = new Map<string, unknown>();
  let alarm: number | null = null;

  const get = vi.fn((key: string | string[]) => {
    if (options.forceMiss === true) {
      return Promise.resolve(Array.isArray(key) ? new Map<string, unknown>() : undefined);
    }
    if (Array.isArray(key)) {
      const result = new Map<string, unknown>();
      for (const k of key) if (map.has(k)) result.set(k, map.get(k));
      return Promise.resolve(result);
    }
    return Promise.resolve(map.get(key));
  });
  const put = vi.fn((keyOrEntries: string | Record<string, unknown>, value?: unknown) => {
    if (typeof keyOrEntries === "string") {
      map.set(keyOrEntries, value);
    } else {
      for (const [k, v] of Object.entries(keyOrEntries)) map.set(k, v);
    }
    return Promise.resolve();
  });
  const del = vi.fn((key: string | string[]) => {
    if (Array.isArray(key)) {
      let count = 0;
      for (const k of key) if (map.delete(k)) count += 1;
      return Promise.resolve(count);
    }
    return Promise.resolve(map.delete(key));
  });
  const list = vi.fn((options?: { prefix?: string }) => {
    const result = new Map<string, unknown>();
    for (const [k, v] of map) {
      if (options?.prefix === undefined || k.startsWith(options.prefix)) result.set(k, v);
    }
    return Promise.resolve(result);
  });
  const getAlarm = vi.fn(() => Promise.resolve(alarm));
  const setAlarm = vi.fn((time: number | Date) => {
    alarm = time instanceof Date ? time.getTime() : time;
    return Promise.resolve();
  });

  const mocks = { get, put, delete: del, list, getAlarm, setAlarm };
  return { storage: mocks as unknown as DurableObjectStorage, mocks };
}

type StorageMocks = {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  getAlarm: ReturnType<typeof vi.fn>;
  setAlarm: ReturnType<typeof vi.fn>;
};

const userId = "638ce145-a77d-4c32-b798-cb398e881fc9";

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime("2026-08-24T10:00:02.000Z");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function envelope(overrides: Partial<IngressEnvelope> = {}): IngressEnvelope {
  return {
    schemaVersion: 1,
    id: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
    occurredAt: "2026-08-24T10:00:00.000Z",
    capturedAt: "2026-08-24T10:00:01.000Z",
    source: { kind: "notification", externalId: "synthetic-external-id" },
    sender: "synthetic-sender",
    subject: "synthetic-subject",
    body: "synthetic-body",
    attributes: {},
    ...overrides,
  };
}

async function buildMessage(
  keyring: ReturnType<typeof parseKekKeyring>,
  envelopeOverrides: Partial<IngressEnvelope> = {},
  wireUserId = userId,
): Promise<IngressQueueMessage> {
  const item = envelope(envelopeOverrides);
  const acceptedAt = "2026-08-24T10:00:00.000Z";
  const rawExpiresAt = "2026-08-31T10:00:00.000Z";
  const plaintext = JSON.stringify({
    schemaVersion: 1,
    acceptedAt,
    rawExpiresAt,
    envelope: item,
  });
  const encrypted = await encryptValue(
    plaintext,
    keyring,
    sourceItemEncryptionContext(wireUserId, item.id),
  );
  return {
    schemaVersion: 1,
    userId: wireUserId,
    envelopeId: item.id,
    acceptedAt,
    rawExpiresAt,
    encryptionEnvironment: "development",
    recoveryId: item.id,
    encrypted,
  };
}

function keyMaterial() {
  const raw = generateKek();
  const serialized = JSON.stringify({ activeVersion: 1, keys: { 1: raw } });
  return { keyring: parseKekKeyring(serialized), raw, serialized };
}

function localEnv(serializedKeyring: string, overrides: Partial<Env> = {}): Env {
  return {
    RELAY_ALLOW_LOCAL_DURABILITY: "true",
    RELAY_CREDENTIAL_KEK_KEYRING: serializedKeyring,
    RELAY_ENVIRONMENT: "development",
    ...overrides,
  } as unknown as Env;
}

function supabaseEnv(
  serializedKeyring: string,
  fetchMock: typeof fetch,
  overrides: Partial<Env> = {},
): { env: Env; writeDataPoint: ReturnType<typeof vi.fn> } {
  vi.stubGlobal("fetch", fetchMock);
  const writeDataPoint = vi.fn();
  const env = {
    PIPELINE_METRICS: { writeDataPoint },
    RELAY_CREDENTIAL_KEK_KEYRING: serializedKeyring,
    RELAY_ENVIRONMENT: "development",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_synthetic_backend_key_12345",
    SUPABASE_URL: "http://127.0.0.1:55321",
    ...overrides,
  } as unknown as Env;
  return { env, writeDataPoint };
}

describe("processIngressMessage — local development durability", () => {
  it("persists a first message and detects an exact retry as a duplicate", async () => {
    const { keyring, serialized } = keyMaterial();
    const env = localEnv(serialized);
    const { storage, mocks } = fakeStorage();
    const message = await buildMessage(keyring, {});

    const first = await processIngressMessage(storage, env, message);
    expect(await first.json()).toMatchObject({ accepted: true, reason: "persisted" });
    const factSet = await storage.get(`source-facts:${message.envelopeId}:v1`);
    const factSetFingerprint = await storage.get(`fact-set-fingerprint:${message.envelopeId}`);
    expect(JSON.stringify(factSet)).not.toContain("synthetic-body");
    expect(factSet).toMatchObject({ sourceItemId: message.envelopeId, normalizerVersion: 1 });
    expect(factSetFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(mocks.put).toHaveBeenCalledOnce();
    const [localRecords] = mocks.put.mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(localRecords)).toEqual(
      expect.arrayContaining([
        `source-item:${message.envelopeId}`,
        `source-facts:${message.envelopeId}:v1`,
        `fact-set-fingerprint:${message.envelopeId}`,
        `source-binding:${message.envelopeId}`,
      ]),
    );
    expect(localRecords[`source-item:${message.envelopeId}`]).toMatchObject({
      encrypted: message.encrypted,
    });

    // Simulated Durable Object restart: fresh call, no shared in-memory JS state, only the same
    // durable storage map. This is the acceptance criterion "DO restart tests produce one durable
    // row" — nothing besides `storage` could possibly remember the first call happened.
    mocks.put.mockClear();
    const second = await processIngressMessage(storage, env, message);
    expect(await second.json()).toEqual({ accepted: false, reason: "duplicate" });
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("binds case-only UUID retries to one canonical local source", async () => {
    const { keyring, raw, serialized } = keyMaterial();
    const env = localEnv(serialized);
    const { storage, mocks } = fakeStorage();
    const lowercaseId = "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8";
    const uppercaseId = lowercaseId.toUpperCase();
    const uppercaseUserId = userId.toUpperCase();
    const uppercaseWireMessage = await buildMessage(keyring, { id: uppercaseId }, uppercaseUserId);
    const first = ingressQueueMessageSchema.parse(uppercaseWireMessage);
    const retry = ingressQueueMessageSchema.parse(await buildMessage(keyring, { id: lowercaseId }));

    expect(first.userId).toBe(uppercaseUserId);
    expect(first.envelopeId).toBe(uppercaseId);
    expect(await (await processIngressMessage(storage, env, first)).json()).toEqual({
      accepted: true,
      reason: "persisted",
    });
    expect(await storage.get(`source-binding:${lowercaseId}`)).toMatchObject({
      sourceItemId: lowercaseId,
    });
    const storedSource = await storage.get<{ encrypted: IngressQueueMessage["encrypted"] }>(
      `source-item:${lowercaseId}`,
    );
    expect(storedSource).toBeDefined();
    expect(await storage.get(`source-facts:${lowercaseId}:v1`)).toMatchObject({
      sourceItemId: lowercaseId,
    });
    expect(await storage.get(`source-binding:${uppercaseId}`)).toBeUndefined();
    expect(await storage.get(`source-item:${uppercaseId}`)).toBeUndefined();
    expect(await storage.get(`source-facts:${uppercaseId}:v1`)).toBeUndefined();
    if (storedSource === undefined) throw new TypeError("Expected canonical encrypted source");
    const rawContext = sourceItemEncryptionContext(uppercaseUserId, uppercaseId);
    const canonicalContext = sourceItemEncryptionContext(userId, lowercaseId);
    const originalPlaintext = await decryptValue(first.encrypted, keyring, rawContext);
    await expect(decryptValue(storedSource.encrypted, keyring, canonicalContext)).resolves.toBe(
      originalPlaintext,
    );
    await expect(decryptValue(storedSource.encrypted, keyring, rawContext)).rejects.toThrow();
    const rotatingKeyring = parseKekKeyring(
      JSON.stringify({ activeVersion: 2, keys: { 1: raw, 2: generateKek() } }),
    );
    const rewrapped = await rewrapValue(storedSource.encrypted, rotatingKeyring, canonicalContext);
    await expect(decryptValue(rewrapped, rotatingKeyring, canonicalContext)).resolves.toBe(
      originalPlaintext,
    );
    mocks.put.mockClear();

    expect(await (await processIngressMessage(storage, env, retry)).json()).toEqual({
      accepted: false,
      reason: "duplicate",
    });
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("detects a content-fingerprint duplicate under a different external id", async () => {
    const { keyring, serialized } = keyMaterial();
    const env = localEnv(serialized);
    const { storage } = fakeStorage();

    const first = await buildMessage(keyring, {
      source: { kind: "notification", externalId: "a" },
    });
    await processIngressMessage(storage, env, first);

    const second = await buildMessage(keyring, {
      id: "06f96f7d-3e1a-4a66-b98e-58be9766b96e",
      source: { kind: "notification", externalId: "b" },
    });
    const response = await processIngressMessage(storage, env, second);
    expect(await response.json()).toEqual({ accepted: false, reason: "duplicate" });
  });

  it.each([
    {
      name: "source identity",
      overrides: {
        source: { kind: "notification" as const, externalId: "changed-identity" },
      },
    },
    { name: "body content", overrides: { body: "changed-body" } },
    { name: "fact attributes", overrides: { attributes: { amount: "99.00" } } },
  ])("fails closed without overwriting local facts for changed $name", async ({ overrides }) => {
    const { keyring, serialized } = keyMaterial();
    const env = localEnv(serialized);
    const { storage, mocks } = fakeStorage();
    const first = await buildMessage(keyring, { attributes: { amount: "14.20" } });
    const changed = await buildMessage(keyring, overrides);

    await processIngressMessage(storage, env, first);
    const storedFingerprint = await storage.get(`fact-set-fingerprint:${first.envelopeId}`);
    mocks.put.mockClear();

    const response = await processIngressMessage(storage, env, changed);

    expect(await response.json()).toEqual({
      accepted: false,
      failureCode: "fact_integrity_conflict",
    });
    expect(await storage.get(`fact-set-fingerprint:${first.envelopeId}`)).toBe(storedFingerprint);
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("fails closed for a legacy local source without a fact digest", async () => {
    const { keyring, serialized } = keyMaterial();
    const env = localEnv(serialized);
    const { storage } = fakeStorage();
    const message = await buildMessage(keyring);
    await storage.put(`source-item:${message.envelopeId}`, {
      encrypted: message.encrypted,
      expiresAt: Date.parse(message.rawExpiresAt),
    });

    const response = await processIngressMessage(storage, env, message);

    expect(await response.json()).toEqual({
      accepted: false,
      failureCode: "fact_integrity_conflict",
    });
  });
});

describe("processIngressMessage — Supabase-backed persistence", () => {
  it("canonicalizes uppercase ingress IDs before source and fact persistence", async () => {
    const { keyring, serialized } = keyMaterial();
    const lowercaseId = "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8";
    const uppercaseId = lowercaseId.toUpperCase();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(Response.json("stored"));
    });
    const { env } = supabaseEnv(serialized, fetchMock);
    const { storage } = fakeStorage();
    const uppercaseUserId = userId.toUpperCase();
    const wireMessage = await buildMessage(
      keyring,
      {
        id: uppercaseId,
        attributes: { amount: "14.20" },
      },
      uppercaseUserId,
    );
    const message = ingressQueueMessageSchema.parse(wireMessage);

    const response = await processIngressMessage(storage, env, message);

    expect(await response.json()).toEqual({ accepted: true, reason: "persisted" });
    expect(message).toMatchObject({ envelopeId: uppercaseId, userId: uppercaseUserId });
    const sourceCall = fetchMock.mock.calls.find(([input]) =>
      requestUrl(input).endsWith("persist_encrypted_source_item_v3"),
    );
    const factCall = fetchMock.mock.calls.find(([input]) =>
      requestUrl(input).endsWith("persist_source_facts"),
    );
    if (typeof sourceCall?.[1]?.body !== "string" || typeof factCall?.[1]?.body !== "string") {
      throw new TypeError("Expected JSON persistence requests");
    }
    const sourceBody = JSON.parse(sourceCall[1].body) as {
      p_id: string;
      p_key_version: number;
      p_raw_ciphertext: unknown;
      p_raw_nonce: unknown;
      p_user_id: string;
      p_wrap_nonce: unknown;
      p_wrapped_data_key: unknown;
    };
    const factBody = JSON.parse(factCall[1].body) as {
      p_facts: { sourceItemId: string }[];
      p_source_item_id: string;
      p_user_id: string;
    };
    expect(sourceBody).toMatchObject({ p_id: lowercaseId, p_user_id: userId });
    expect(factBody).toMatchObject({ p_source_item_id: lowercaseId, p_user_id: userId });
    expect(factBody.p_facts.every((fact) => fact.sourceItemId === lowercaseId)).toBe(true);
    const durableEncrypted = {
      algorithm: "AES-GCM-256" as const,
      ciphertext: postgresByteaToBase64(sourceBody.p_raw_ciphertext),
      keyVersion: sourceBody.p_key_version,
      nonce: postgresByteaToBase64(sourceBody.p_raw_nonce, 12),
      wrappedKey: postgresByteaToBase64(sourceBody.p_wrapped_data_key, 48),
      wrapNonce: postgresByteaToBase64(sourceBody.p_wrap_nonce, 12),
    };
    await expect(
      decryptValue(durableEncrypted, keyring, sourceItemEncryptionContext(userId, lowercaseId)),
    ).resolves.toContain(lowercaseId.toUpperCase());
    await expect(
      decryptValue(
        durableEncrypted,
        keyring,
        sourceItemEncryptionContext(uppercaseUserId, uppercaseId),
      ),
    ).rejects.toThrow();
  });

  it("is exactly one durable row even if the local cache race is lost entirely", async () => {
    // Two Queue deliveries land close enough together that BOTH read the local identity/fingerprint
    // cache before either has written it — the worst case for the DO-local fast path, forced here
    // deterministically (real Promise.all timing against an in-memory fake resolves too fast to be a
    // reliable race, as an earlier version of this test found out). What must still hold: Supabase's
    // unique constraint is final arbitration, so exactly one delivery is accepted regardless.
    const { keyring, serialized } = keyMaterial();
    const { storage } = fakeStorage({ forceMiss: true });

    let sourceCalls = 0;
    let factCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (requestUrl(input).endsWith("persist_encrypted_source_item_v3")) {
        sourceCalls += 1;
        return Promise.resolve(Response.json(sourceCalls === 1 ? "stored" : "duplicate"));
      }
      factCalls += 1;
      return Promise.resolve(Response.json(factCalls === 1 ? "stored" : "duplicate"));
    });
    const { env } = supabaseEnv(serialized, fetchMock);
    const message = await buildMessage(keyring, {});

    const [a, b] = await Promise.all([
      processIngressMessage(storage, env, message),
      processIngressMessage(storage, env, message),
    ]);
    const results = await Promise.all([a.json(), b.json()]);

    expect(results).toContainEqual({ accepted: true, reason: "persisted" });
    expect(results).toContainEqual({ accepted: false, reason: "duplicate" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    vi.unstubAllGlobals();
  });

  it("reconciles a lost HTTP response after the database already committed", async () => {
    const { keyring, serialized } = keyMaterial();
    let sourceCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (requestUrl(input).endsWith("persist_source_facts")) {
        return Promise.resolve(Response.json("stored"));
      }
      sourceCalls += 1;
      if (sourceCalls === 1)
        return Promise.reject(new TypeError("synthetic network failure after commit"));
      // Retry: the row from the first (network-lost) attempt is already durable in Postgres, so the
      // unique constraint now reports a duplicate rather than inserting a second row.
      return Promise.resolve(Response.json("duplicate"));
    });
    const { env } = supabaseEnv(serialized, fetchMock);
    const { storage } = fakeStorage();
    const message = await buildMessage(keyring, {});

    const lost = await processIngressMessage(storage, env, message);
    expect(await lost.json()).toEqual({ accepted: false, failureCode: "persistence_unavailable" });
    expect(lost.status).toBe(503);

    const retried = await processIngressMessage(storage, env, message);
    expect(await retried.json()).toEqual({ accepted: false, reason: "duplicate" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });

  it("retries safely after the fact RPC commits but its response is lost", async () => {
    const { keyring, serialized } = keyMaterial();
    let sourceCalls = 0;
    let factCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (requestUrl(input).endsWith("persist_encrypted_source_item_v3")) {
        sourceCalls += 1;
        return Promise.resolve(Response.json(sourceCalls === 1 ? "stored" : "duplicate"));
      }
      factCalls += 1;
      if (factCalls === 1) {
        return Promise.reject(new TypeError("synthetic fact response lost after commit"));
      }
      return Promise.resolve(Response.json("duplicate"));
    });
    const { env } = supabaseEnv(serialized, fetchMock);
    const { storage, mocks } = fakeStorage();
    const message = await buildMessage(keyring, {
      attributes: { amount: "14.20", currency: "USD" },
    });

    const lost = await processIngressMessage(storage, env, message);
    expect(await lost.json()).toEqual({
      accepted: false,
      failureCode: "persistence_unavailable",
    });
    expect(lost.status).toBe(503);
    expect(mocks.put).not.toHaveBeenCalled();

    const retried = await processIngressMessage(storage, env, message);
    expect(await retried.json()).toEqual({ accepted: false, reason: "duplicate" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    vi.unstubAllGlobals();
  });

  it("attaches no facts when attributes alone change under the same source ID", async () => {
    const { keyring, serialized } = keyMaterial();
    const { storage, mocks } = fakeStorage({ forceMiss: true });
    let sourceCalls = 0;
    let factCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (requestUrl(input).endsWith("persist_encrypted_source_item_v3")) {
        sourceCalls += 1;
        return Promise.resolve(
          Response.json(sourceCalls === 1 ? "stored" : "fact-integrity-conflict"),
        );
      }
      factCalls += 1;
      return Promise.resolve(Response.json("stored"));
    });
    const { env } = supabaseEnv(serialized, fetchMock);
    const first = await buildMessage(keyring, { attributes: { amount: "14.20" } });
    const changed = await buildMessage(keyring, {
      attributes: { amount: "99.00" },
    });

    expect(await (await processIngressMessage(storage, env, first)).json()).toEqual({
      accepted: true,
      reason: "persisted",
    });
    mocks.put.mockClear();

    const response = await processIngressMessage(storage, env, changed);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      accepted: false,
      failureCode: "fact_integrity_conflict",
    });
    expect(sourceCalls).toBe(2);
    expect(factCalls).toBe(1);
    expect(mocks.put).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("maps a fact version HTTP conflict to dedicated integrity metadata", async () => {
    const { keyring, serialized } = keyMaterial();
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        requestUrl(input).endsWith("persist_source_facts")
          ? new Response(null, { status: 409 })
          : Response.json("stored"),
      ),
    );
    const { env } = supabaseEnv(serialized, fetchMock);
    const { storage, mocks } = fakeStorage();

    const response = await processIngressMessage(storage, env, await buildMessage(keyring));

    expect(await response.json()).toEqual({
      accepted: false,
      failureCode: "fact_integrity_conflict",
    });
    expect(mocks.put).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("treats impossible stored-source missing facts as an integrity conflict", async () => {
    const { keyring, serialized } = keyMaterial();
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        Response.json(
          requestUrl(input).endsWith("persist_source_facts") ? "source-missing" : "stored",
        ),
      ),
    );
    const { env } = supabaseEnv(serialized, fetchMock);
    const { storage } = fakeStorage();

    const response = await processIngressMessage(storage, env, await buildMessage(keyring));

    expect(await response.json()).toEqual({
      accepted: false,
      failureCode: "fact_integrity_conflict",
    });
    vi.unstubAllGlobals();
  });

  it("keeps source-missing after a database duplicate as normal dedupe", async () => {
    const { keyring, serialized } = keyMaterial();
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        Response.json(
          requestUrl(input).endsWith("persist_source_facts") ? "source-missing" : "duplicate",
        ),
      ),
    );
    const { env } = supabaseEnv(serialized, fetchMock);
    const { storage } = fakeStorage();

    const response = await processIngressMessage(storage, env, await buildMessage(keyring));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: false, reason: "duplicate" });
    vi.unstubAllGlobals();
  });

  it("never populates the local cache from a failed persistence attempt", async () => {
    const { keyring, serialized } = keyMaterial();
    const fetchMock = vi.fn(() => Promise.reject(new TypeError("synthetic network failure")));
    const { env } = supabaseEnv(serialized, fetchMock);
    const { storage, mocks } = fakeStorage();
    const message = await buildMessage(keyring, {});

    await processIngressMessage(storage, env, message);

    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("records only fixed metric names and numeric values, never content", async () => {
    const { keyring, serialized } = keyMaterial();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(Response.json("stored"));
    });
    const { env, writeDataPoint } = supabaseEnv(serialized, fetchMock);
    const { storage } = fakeStorage();
    const message = await buildMessage(keyring, {
      sender: "sensitive-sender@example.test",
      subject: "sensitive subject line",
      body: "sensitive body content",
    });

    await processIngressMessage(storage, env, message);

    expect(writeDataPoint).toHaveBeenCalledOnce();
    const [point] = writeDataPoint.mock.calls[0] as [{ doubles: number[]; indexes: string[] }];
    expect(point.indexes).toEqual(["source_item_persisted"]);
    expect(point.doubles.every((value) => typeof value === "number")).toBe(true);
    expect(JSON.stringify(point)).not.toContain("sensitive");
    const factCall = fetchMock.mock.calls.find(([input]) =>
      requestUrl(input).endsWith("persist_source_facts"),
    );
    expect(JSON.stringify(factCall?.[1]?.body)).not.toContain("sensitive body content");
    expect(JSON.stringify(factCall?.[1]?.body)).not.toContain("sensitive subject line");
    vi.unstubAllGlobals();
  });

  it("records e2e result markers for source-identity and fingerprint duplicates distinctly", async () => {
    const { keyring, serialized } = keyMaterial();
    const fetchMock = vi.fn(() => Promise.resolve(Response.json("stored")));
    const { env } = supabaseEnv(serialized, fetchMock, { RELAY_E2E_MODE: "true" });
    const { storage } = fakeStorage();
    const message = await buildMessage(keyring, {});

    await processIngressMessage(storage, env, message);
    const duplicate = await processIngressMessage(storage, env, message);
    expect(await duplicate.json()).toEqual({ accepted: false, reason: "duplicate" });

    const stored = await storage.get<E2EResult>(`${E2E_RESULT_PREFIX}${message.envelopeId}`);
    expect(stored).toMatchObject({ status: "duplicate-source" });

    const fingerprintMessage = await buildMessage(keyring, {
      id: "06f96f7d-3e1a-4a66-b98e-58be9766b96e",
      source: { kind: "notification", externalId: "different-external-id" },
    });
    const fingerprintDuplicate = await processIngressMessage(storage, env, fingerprintMessage);
    expect(await fingerprintDuplicate.json()).toEqual({
      accepted: false,
      reason: "duplicate",
    });

    const fingerprintStored = await storage.get<E2EResult>(
      `${E2E_RESULT_PREFIX}${fingerprintMessage.envelopeId}`,
    );
    expect(fingerprintStored).toMatchObject({ status: "duplicate-fingerprint" });
  });
});

describe("handleE2EResultRequest", () => {
  it("returns 404 for an envelope with no recorded result", async () => {
    const { storage } = fakeStorage();
    const response = await handleE2EResultRequest(
      storage,
      new Request("http://do.test/e2e/result?envelopeId=5e106d7a-85aa-4a08-9a1f-cb13b42df1f8"),
    );
    expect(response.status).toBe(404);
  });

  it("round-trips a posted result through a GET lookup", async () => {
    const { storage } = fakeStorage();
    const { keyring } = keyMaterial();
    const lowercaseId = "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8";
    const uppercaseId = lowercaseId.toUpperCase();
    const message = await buildMessage(keyring, { id: uppercaseId }, userId.toUpperCase());

    const post = await handleE2EResultRequest(
      storage,
      new Request("http://do.test/e2e/result", {
        method: "POST",
        body: JSON.stringify(message),
      }),
    );
    expect(post.status).toBe(204);
    expect(await storage.get(`${E2E_RESULT_PREFIX}${lowercaseId}`)).toBeDefined();
    expect(await storage.get(`${E2E_RESULT_PREFIX}${uppercaseId}`)).toBeUndefined();

    const get = await handleE2EResultRequest(
      storage,
      new Request(`http://do.test/e2e/result?envelopeId=${uppercaseId}`),
    );
    expect(await get.json()).toMatchObject({ status: "dead-letter" });
  });
});

describe("runMaintenanceAlarm", () => {
  it("deletes only expired local source-item records and reschedules the next alarm", async () => {
    const { storage } = fakeStorage();
    const now = Date.now();
    await storage.put({
      "source-item:expired": { encrypted: {}, expiresAt: now - 1000 },
      "source-item:future": { encrypted: {}, expiresAt: now + 100_000 },
    });

    await runMaintenanceAlarm(storage);

    expect(await storage.get("source-item:expired")).toBeUndefined();
    expect(await storage.get("source-item:future")).toBeDefined();
    expect(await storage.getAlarm()).toBe(now + 100_000);
  });
});

describe("CONTENT_FINGERPRINT_ALGORITHM_VERSION", () => {
  it("is explicitly pinned so a future canonicalization change is a deliberate version bump", () => {
    expect(CONTENT_FINGERPRINT_ALGORITHM_VERSION).toBe(1);
  });
});
