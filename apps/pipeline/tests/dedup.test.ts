import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IngressEnvelope } from "@relay/contracts";
import { encryptValue, generateKek, parseKekKeyring } from "@relay/crypto";

import {
  CONTENT_FINGERPRINT_ALGORITHM_VERSION,
  E2E_RESULT_PREFIX,
  handleE2EResultRequest,
  processIngressMessage,
  runMaintenanceAlarm,
  type E2EResult,
} from "../src/dedup";
import { sourceItemEncryptionContext } from "../src/encryption";
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
    sourceItemEncryptionContext(userId, item.id),
  );
  return {
    schemaVersion: 1,
    userId,
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
  return { keyring: parseKekKeyring(serialized), serialized };
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
    const { storage } = fakeStorage();
    const message = await buildMessage(keyring, {});

    const first = await processIngressMessage(storage, env, message);
    expect(await first.json()).toMatchObject({ accepted: true, reason: "persisted" });

    // Simulated Durable Object restart: fresh call, no shared in-memory JS state, only the same
    // durable storage map. This is the acceptance criterion "DO restart tests produce one durable
    // row" — nothing besides `storage` could possibly remember the first call happened.
    const second = await processIngressMessage(storage, env, message);
    expect(await second.json()).toEqual({ accepted: false, reason: "duplicate" });
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
});

describe("processIngressMessage — Supabase-backed persistence", () => {
  it("is exactly one durable row even if the local cache race is lost entirely", async () => {
    // Two Queue deliveries land close enough together that BOTH read the local identity/fingerprint
    // cache before either has written it — the worst case for the DO-local fast path, forced here
    // deterministically (real Promise.all timing against an in-memory fake resolves too fast to be a
    // reliable race, as an earlier version of this test found out). What must still hold: Supabase's
    // unique constraint is final arbitration, so exactly one delivery is accepted regardless.
    const { keyring, serialized } = keyMaterial();
    const { storage } = fakeStorage({ forceMiss: true });

    let rpcCalls = 0;
    const fetchMock = vi.fn(() => {
      rpcCalls += 1;
      return Promise.resolve(Response.json(rpcCalls === 1));
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("reconciles a lost HTTP response after the database already committed", async () => {
    const { keyring, serialized } = keyMaterial();
    let rpcCalls = 0;
    const fetchMock = vi.fn(() => {
      rpcCalls += 1;
      if (rpcCalls === 1)
        return Promise.reject(new TypeError("synthetic network failure after commit"));
      // Retry: the row from the first (network-lost) attempt is already durable in Postgres, so the
      // unique constraint now reports a duplicate rather than inserting a second row.
      return Promise.resolve(Response.json(false));
    });
    const { env } = supabaseEnv(serialized, fetchMock);
    const { storage } = fakeStorage();
    const message = await buildMessage(keyring, {});

    const lost = await processIngressMessage(storage, env, message);
    expect(await lost.json()).toEqual({ accepted: false, failureCode: "persistence_unavailable" });
    expect(lost.status).toBe(503);

    const retried = await processIngressMessage(storage, env, message);
    expect(await retried.json()).toEqual({ accepted: false, reason: "duplicate" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    const fetchMock = vi.fn(() => Promise.resolve(Response.json(true)));
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
    vi.unstubAllGlobals();
  });

  it("records e2e result markers for source-identity and fingerprint duplicates distinctly", async () => {
    const { keyring, serialized } = keyMaterial();
    const fetchMock = vi.fn(() => Promise.resolve(Response.json(true)));
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
    const message = await buildMessage(keyring, {});

    const post = await handleE2EResultRequest(
      storage,
      new Request("http://do.test/e2e/result", {
        method: "POST",
        body: JSON.stringify(message),
      }),
    );
    expect(post.status).toBe(204);

    const get = await handleE2EResultRequest(
      storage,
      new Request(`http://do.test/e2e/result?envelopeId=${message.envelopeId}`),
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
