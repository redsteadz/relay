import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IngressEnvelope, IngressProducer } from "@relay/contracts";
import { encryptValue, generateKek, parseKekKeyring } from "@relay/crypto";

import { base64ToPostgresBytea, connectionCredentialEncryptionContext } from "../src/encryption";
import type { Env, IngressQueueMessage } from "../src/env";
import type { IngressPublicationResult } from "../src/ingress";
import {
  acceptGmailCursor,
  acceptGmailDisconnect,
  acceptGmailMaintenance,
  compareHistoryIds,
  coordinateGmailDisconnect,
  handleVerifiedGmailCursor,
  GMAIL_ALARM_DEADLINE_MS,
  loadGmailConnectionCredential,
  readGmailConnectionOwnership,
  runGmailAlarm,
  runGmailAlarmReliably,
  runGmailDisconnect,
  type GmailIdentity,
} from "../src/gmail";
import { GMAIL_EXTERNAL_OPERATION_TIMEOUT_MS } from "../src/gmail-provider";
import { SerialExecutor } from "../src/serialization";

const userId = "638ce145-a77d-4c32-b798-cb398e881fc9";
const connectionId = "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8";
const identity: GmailIdentity = { schemaVersion: 1, connectionId, userId };
const keyringValue = JSON.stringify({ activeVersion: 1, keys: { 1: generateKek() } });
type TestPublisher = (
  env: Env,
  userId: string,
  envelope: IngressEnvelope,
  producer: IngressProducer,
) => Promise<IngressPublicationResult>;
type GmailAlarmRetryFixture = { attempts: number; nextAttemptAt: number };

function fakeStorage(
  values = new Map<string, unknown>(),
  options: { failBaselineReady?: boolean; hangGetKey?: string } = {},
) {
  let alarm: number | null = null;
  const storage = {
    get: vi.fn((key: string | string[]) => {
      if (key === options.hangGetKey) {
        return new Promise<never>(() => undefined);
      }
      if (Array.isArray(key)) {
        return Promise.resolve(
          new Map(
            key.filter((entry) => values.has(entry)).map((entry) => [entry, values.get(entry)]),
          ),
        );
      }
      return Promise.resolve(values.get(key));
    }),
    put: vi.fn((keyOrEntries: string | Record<string, unknown>, value?: unknown) => {
      if (
        options.failBaselineReady === true &&
        keyOrEntries === "gmail:initialization" &&
        typeof value === "object" &&
        value !== null &&
        "phase" in value &&
        value.phase === "baseline-ready"
      ) {
        return Promise.reject(new Error("synthetic baseline persistence failure"));
      }
      if (typeof keyOrEntries === "string") values.set(keyOrEntries, value);
      else for (const [key, entry] of Object.entries(keyOrEntries)) values.set(key, entry);
      return Promise.resolve();
    }),
    delete: vi.fn((key: string | string[]) => {
      if (Array.isArray(key)) {
        let deleted = 0;
        for (const entry of key) if (values.delete(entry)) deleted += 1;
        return Promise.resolve(deleted);
      }
      return Promise.resolve(values.delete(key));
    }),
    setAlarm: vi.fn((time: number | Date) => {
      alarm = time instanceof Date ? time.getTime() : time;
      return Promise.resolve();
    }),
    getAlarm: vi.fn(() => Promise.resolve(alarm)),
    deleteAlarm: vi.fn(() => {
      alarm = null;
      return Promise.resolve();
    }),
    list: vi.fn((options?: { limit?: number; prefix?: string }) => {
      const entries = [...values.entries()]
        .filter(([key]) => options?.prefix === undefined || key.startsWith(options.prefix))
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, options?.limit);
      return Promise.resolve(new Map(entries));
    }),
    transaction: vi.fn(
      async <T>(callback: (transaction: DurableObjectTransaction) => Promise<T>): Promise<T> =>
        callback({
          delete: async (key: string | string[]) => storage.delete(key),
          get: async (key: string | string[]) => storage.get(key),
          put: async (key: string, value: unknown) => storage.put(key, value),
        } as unknown as DurableObjectTransaction),
    ),
  };
  return { storage: storage as unknown as DurableObjectStorage, values };
}

function environment(overrides: Partial<Env> = {}): Env {
  return {
    GOOGLE_CLIENT_ID: "synthetic-client-id",
    GOOGLE_CLIENT_SECRET: "synthetic-client-secret",
    GOOGLE_GMAIL_PUBSUB_TOPIC: "projects/synthetic-project/topics/relay-gmail",
    GOOGLE_PUBSUB_MESSAGE_RETENTION_SECONDS: "604800",
    INGRESS_QUEUE: { send: vi.fn(() => Promise.resolve()) },
    RELAY_CREDENTIAL_KEK_KEYRING: keyringValue,
    RELAY_ENVIRONMENT: "development",
    RELAY_INGEST_SHARED_SECRET: "synthetic-secret",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_synthetic_backend_key_12345",
    SUPABASE_URL: "https://supabase.example.test",
    TENANT_COORDINATOR: { getByName: vi.fn() },
    ...overrides,
  } as unknown as Env;
}

function cursor(mailbox = "mailbox@example.test") {
  return { schemaVersion: 1 as const, emailAddress: mailbox, historyId: "90071992547409931234" };
}

function requestPath(input: string): string {
  return new URL(input).pathname;
}

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== "string") throw new Error("missing synthetic request body");
  return JSON.parse(init.body) as Record<string, unknown>;
}

function interruptedResponse(): Response {
  return new Response(
    new ReadableStream({
      pull(controller) {
        controller.error(new Error("synthetic response interruption"));
      },
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime("2026-08-29T10:00:00.000Z");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Gmail ownership and cursor coordination", () => {
  it("returns non-success before ownership lookup when provider configuration is incomplete", async () => {
    const fetcher = vi.fn();
    const env = environment();
    delete env.GOOGLE_CLIENT_ID;
    const response = await handleVerifiedGmailCursor(env, cursor(), fetcher);

    expect(response.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("compares and coalesces History IDs without Number conversion across restart", async () => {
    expect(compareHistoryIds("90071992547409931234", "90071992547409931235")).toBe(-1);
    const { storage, values } = fakeStorage();

    expect((await acceptGmailCursor(storage, identity, "90071992547409931234")).status).toBe(202);
    expect((await acceptGmailCursor(storage, identity, "90071992547409931233")).status).toBe(202);
    expect((await acceptGmailCursor(storage, identity, "90071992547409931235")).status).toBe(202);

    expect(values.get("gmail:pending-history-id")).toBe("90071992547409931235");
    expect(values.get("gmail:identity")).toEqual(identity);
  });

  it("fails closed when same coordinator receives another user or connection", async () => {
    const { storage } = fakeStorage();
    await acceptGmailCursor(storage, identity, "10");

    const response = await acceptGmailCursor(
      storage,
      { ...identity, userId: "06f96f7d-3e1a-4a66-b98e-58be9766b96e" },
      "11",
    );

    expect(response.status).toBe(409);
  });

  it.each([
    [[], 404],
    [
      [
        { connection_id: connectionId, target_status: "active", user_id: userId },
        {
          connection_id: "06f96f7d-3e1a-4a66-b98e-58be9766b96e",
          target_status: "active",
          user_id: "42ad95f2-20b0-4b23-83af-ebcb560219df",
        },
      ],
      409,
    ],
  ])("returns non-success for unresolved ownership", async (rows, expectedStatus) => {
    const getByName = vi.fn();
    const response = await handleVerifiedGmailCursor(
      environment({ TENANT_COORDINATOR: { getByName } as unknown as DurableObjectNamespace }),
      cursor(),
      vi.fn(() => Promise.resolve(Response.json(rows))),
    );

    expect(response.status).toBe(expectedStatus);
    expect(getByName).not.toHaveBeenCalled();
  });

  it("acknowledges only after mailbox DO durably accepts cursor", async () => {
    const coordinatorFetch = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })));
    const getByName = vi.fn(() => ({ fetch: coordinatorFetch }));
    const response = await handleVerifiedGmailCursor(
      environment({ TENANT_COORDINATOR: { getByName } as unknown as DurableObjectNamespace }),
      cursor(),
      vi.fn(() =>
        Promise.resolve(
          Response.json([
            { connection_id: connectionId, target_status: "active", user_id: userId },
          ]),
        ),
      ),
    );

    expect(response.status).toBe(202);
    expect(getByName).toHaveBeenCalledWith(`gmail:${connectionId}`);
    expect(coordinatorFetch).toHaveBeenCalledWith(
      "https://coordinator.internal/gmail/cursor",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("acknowledges a known disconnect tombstone without routing mailbox work", async () => {
    const getByName = vi.fn();
    const response = await handleVerifiedGmailCursor(
      environment({ TENANT_COORDINATOR: { getByName } as unknown as DurableObjectNamespace }),
      cursor(),
      vi.fn(() =>
        Promise.resolve(
          Response.json([
            { connection_id: connectionId, target_status: "tombstone", user_id: userId },
          ]),
        ),
      ),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ accepted: true, tombstone: true });
    expect(getByName).not.toHaveBeenCalled();
  });

  it("rejects active/tombstone ownership ambiguity without routing work", async () => {
    const getByName = vi.fn();
    const response = await handleVerifiedGmailCursor(
      environment({ TENANT_COORDINATOR: { getByName } as unknown as DurableObjectNamespace }),
      cursor(),
      vi.fn(() =>
        Promise.resolve(
          Response.json([
            { connection_id: connectionId, target_status: "tombstone", user_id: userId },
            {
              connection_id: "06f96f7d-3e1a-4a66-b98e-58be9766b96e",
              target_status: "active",
              user_id: "42ad95f2-20b0-4b23-83af-ebcb560219df",
            },
          ]),
        ),
      ),
    );

    expect(response.status).toBe(409);
    expect(getByName).not.toHaveBeenCalled();
  });

  it("parses active, completed, cross-user, and random disconnect ownership status", async () => {
    const statuses: ("absent" | "active" | "completed")[] = [
      "active",
      "completed",
      "absent",
      "absent",
    ];
    const fetcher = vi.fn(() => Promise.resolve(Response.json(statuses.shift())));

    await expect(readGmailConnectionOwnership(environment(), identity, fetcher)).resolves.toBe(
      "active",
    );
    await expect(readGmailConnectionOwnership(environment(), identity, fetcher)).resolves.toBe(
      "completed",
    );
    await expect(
      readGmailConnectionOwnership(
        environment(),
        { ...identity, userId: "42ad95f2-20b0-4b23-83af-ebcb560219df" },
        fetcher,
      ),
    ).resolves.toBe("absent");
    await expect(
      readGmailConnectionOwnership(
        environment(),
        { ...identity, connectionId: "06f96f7d-3e1a-4a66-b98e-58be9766b96e" },
        fetcher,
      ),
    ).resolves.toBe("absent");
  });
});

async function encryptedCredential(refreshToken = "synthetic-refresh-token") {
  const encrypted = await encryptValue(
    refreshToken,
    parseKekKeyring(keyringValue),
    connectionCredentialEncryptionContext(userId, connectionId),
  );
  return {
    credential_ciphertext: base64ToPostgresBytea(encrypted.ciphertext),
    credential_nonce: base64ToPostgresBytea(encrypted.nonce),
    encryption_environment: "development",
    history_cursor: "100",
    key_version: encrypted.keyVersion,
    sync_status: "active",
    wrap_nonce: base64ToPostgresBytea(encrypted.wrapNonce),
    wrapped_data_key: base64ToPostgresBytea(encrypted.wrappedKey),
  };
}

describe("Gmail provider processing retries", () => {
  it("decrypts credential only with matching connection and user AAD", async () => {
    const row = await encryptedCredential();
    const loaded = await loadGmailConnectionCredential(
      environment(),
      identity,
      vi.fn(() => Promise.resolve(Response.json([row]))),
    );

    expect(loaded).toEqual({
      historyCursor: "100",
      refreshToken: "synthetic-refresh-token",
      syncStatus: "active",
    });
    await expect(
      loadGmailConnectionCredential(
        environment(),
        { ...identity, userId: "06f96f7d-3e1a-4a66-b98e-58be9766b96e" },
        vi.fn(() => Promise.resolve(Response.json([row]))),
      ),
    ).rejects.toThrow("Gmail credential is unavailable");
  });

  it("retries ambiguous Queue response with same deterministic envelope ID before cursor advance", async () => {
    const row = await encryptedCredential();
    const { storage, values } = fakeStorage();
    await acceptGmailCursor(storage, identity, "200");
    const sent: IngressQueueMessage[] = [];
    const send = vi.fn((message: IngressQueueMessage) => {
      sent.push(message);
      return sent.length === 1
        ? Promise.reject(new Error("synthetic lost Queue response"))
        : Promise.resolve();
    });
    let advances = 0;
    const fetcher = vi.fn((input: string) => {
      const path = requestPath(input);
      if (path.endsWith("/load_gmail_connection_v1")) return Promise.resolve(Response.json([row]));
      if (path.endsWith("/token"))
        return Promise.resolve(Response.json({ access_token: "access" }));
      if (path.endsWith("/history")) {
        return Promise.resolve(
          Response.json({
            history: [
              { id: "150", messagesAdded: [{ message: { id: "message-1" } }] },
              { id: "151", messagesAdded: [{ message: { id: "message-1" } }] },
            ],
            historyId: "200",
          }),
        );
      }
      if (path.includes("/messages/")) return Promise.resolve(Response.json(gmailMessage()));
      if (path.endsWith("/advance_gmail_history_cursor_v1")) {
        advances += 1;
        return Promise.resolve(Response.json(true));
      }
      throw new Error("unexpected synthetic request");
    });
    const env = environment({ INGRESS_QUEUE: { send } as unknown as Queue<IngressQueueMessage> });

    await expect(runGmailAlarm(storage, env, fetcher)).resolves.toBe(true);
    await expect(runGmailAlarm(storage, env, fetcher)).resolves.toBe(true);
    await expect(runGmailAlarm(storage, env, fetcher)).rejects.toThrow();
    expect(advances).toBe(0);
    const restartedStorage = fakeStorage(values).storage;
    await expect(runGmailAlarm(restartedStorage, env, fetcher)).resolves.toBe(true);
    await expect(runGmailAlarm(restartedStorage, env, fetcher)).resolves.toBe(true);

    expect(sent).toHaveLength(2);
    expect(sent[0]!.envelopeId).toBe(sent[1]!.envelopeId);
    expect(advances).toBe(1);
  });

  it("converges after lost cursor-advance response without republishing", async () => {
    const baseRow = await encryptedCredential();
    const { storage, values } = fakeStorage();
    await acceptGmailCursor(storage, identity, "200");
    let databaseCursor = "100";
    let lost = false;
    const send = vi.fn((_message: IngressQueueMessage) => {
      void _message;
      return Promise.resolve();
    });
    const fetcher = vi.fn((input: string) => {
      const path = requestPath(input);
      if (path.endsWith("/load_gmail_connection_v1")) {
        return Promise.resolve(Response.json([{ ...baseRow, history_cursor: databaseCursor }]));
      }
      if (path.endsWith("/token"))
        return Promise.resolve(Response.json({ access_token: "access" }));
      if (path.endsWith("/history")) {
        return Promise.resolve(
          Response.json({
            history: [{ id: "150", messagesAdded: [{ message: { id: "message-1" } }] }],
            historyId: "200",
          }),
        );
      }
      if (path.includes("/messages/")) return Promise.resolve(Response.json(gmailMessage()));
      if (path.endsWith("/advance_gmail_history_cursor_v1")) {
        databaseCursor = "200";
        if (!lost) {
          lost = true;
          return Promise.reject(new Error("synthetic lost Supabase response"));
        }
        return Promise.resolve(Response.json(true));
      }
      throw new Error("unexpected synthetic request");
    });
    const env = environment({ INGRESS_QUEUE: { send } as unknown as Queue<IngressQueueMessage> });

    await expect(runGmailAlarm(storage, env, fetcher)).resolves.toBe(true);
    await expect(runGmailAlarm(storage, env, fetcher)).resolves.toBe(true);
    await expect(runGmailAlarm(storage, env, fetcher)).resolves.toBe(true);
    await expect(runGmailAlarm(storage, env, fetcher)).rejects.toThrow();
    expect(send).toHaveBeenCalledOnce();
    const restartedStorage = fakeStorage(values).storage;
    await expect(runGmailAlarm(restartedStorage, env, fetcher)).resolves.toBe(true);
    await expect(runGmailAlarm(restartedStorage, env, fetcher)).resolves.toBe(true);

    expect(send).toHaveBeenCalledOnce();
    expect(values.has("gmail:pending-history-id")).toBe(false);
  });

  it("persists initial watch baseline and runs periodic reconciliation through same DO", async () => {
    const baseRow = await encryptedCredential();
    let databaseCursor: string | null = null;
    const { storage } = fakeStorage();
    await acceptGmailMaintenance(storage, { ...identity, reconcile: true, renewWatch: true });
    const paths: string[] = [];
    const fetcher = vi.fn((input: string) => {
      const path = requestPath(input);
      paths.push(path);
      if (path.endsWith("/load_gmail_connection_v1")) {
        return Promise.resolve(Response.json([{ ...baseRow, history_cursor: databaseCursor }]));
      }
      if (path.endsWith("/token"))
        return Promise.resolve(Response.json({ access_token: "access" }));
      if (path.endsWith("/watch")) {
        return Promise.resolve(
          Response.json({
            historyId: "100",
            expiration: Date.parse("2026-09-05T10:00:00Z").toString(),
          }),
        );
      }
      if (path.endsWith("/set_gmail_history_baseline_v1")) {
        databaseCursor = "100";
        return Promise.resolve(Response.json(true));
      }
      if (path.endsWith("/record_gmail_watch_v1")) {
        return Promise.resolve(Response.json(true));
      }
      if (path.endsWith("/advance_gmail_history_cursor_v1")) {
        return Promise.resolve(Response.json(true));
      }
      if (path.endsWith("/history")) return Promise.resolve(Response.json({ historyId: "100" }));
      throw new Error("unexpected synthetic request");
    });

    for (let invocation = 0; invocation < 7; invocation += 1) {
      await expect(runGmailAlarm(storage, environment(), fetcher)).resolves.toBe(true);
    }

    expect(paths).toContain("/gmail/v1/users/me/watch");
    expect(paths).toContain("/rest/v1/rpc/set_gmail_history_baseline_v1");
    expect(paths).toContain("/gmail/v1/users/me/history");
  });

  it("commits persisted baseline before processing immediate push accepted after watch response", async () => {
    const baseRow = await encryptedCredential();
    let databaseCursor: string | null = null;
    let watchCalls = 0;
    let staleCalls = 0;
    const { storage, values } = fakeStorage();
    await acceptGmailMaintenance(storage, { ...identity, reconcile: false, renewWatch: true });
    const fetcher = vi.fn((input: string) => {
      const path = requestPath(input);
      if (path.endsWith("/load_gmail_connection_v1")) {
        return Promise.resolve(Response.json([{ ...baseRow, history_cursor: databaseCursor }]));
      }
      if (path.endsWith("/token")) {
        return Promise.resolve(Response.json({ access_token: "access" }));
      }
      if (path.endsWith("/watch")) {
        watchCalls += 1;
        return Promise.resolve(
          Response.json({
            historyId: "100",
            expiration: Date.parse("2026-09-05T10:00:00Z").toString(),
          }),
        );
      }
      if (path.endsWith("/record_gmail_watch_v1")) return Promise.resolve(Response.json(true));
      if (path.endsWith("/set_gmail_history_baseline_v1")) {
        databaseCursor = "100";
        return Promise.resolve(Response.json(true));
      }
      if (path.endsWith("/mark_gmail_resync_required_v1")) {
        staleCalls += 1;
        return Promise.resolve(Response.json(true));
      }
      throw new Error("unexpected synthetic request");
    });

    await runGmailAlarm(storage, environment(), fetcher);
    expect(values.get("gmail:initialization")).toMatchObject({
      baselineHistoryId: "100",
      phase: "baseline-ready",
    });
    await acceptGmailCursor(storage, identity, "200");

    let restartedStorage = fakeStorage(values).storage;
    await runGmailAlarm(restartedStorage, environment(), fetcher);
    expect(databaseCursor).toBe("100");
    expect(values.get("gmail:pending-history-id")).toBe("200");
    expect(values.has("gmail:initialization")).toBe(false);

    restartedStorage = fakeStorage(values).storage;
    await runGmailAlarm(restartedStorage, environment(), fetcher);
    expect(values.get("gmail:history-work")).toMatchObject({
      startHistoryId: "100",
      targetHistoryId: "200",
    });
    expect(watchCalls).toBe(1);
    expect(staleCalls).toBe(0);
  });

  it("preserves a higher cursor accepted while established watch renewal is in flight", async () => {
    const row = await encryptedCredential();
    const { storage, values } = fakeStorage();
    await acceptGmailMaintenance(storage, { ...identity, reconcile: false, renewWatch: true });
    const fetcher = vi.fn(async (input: string) => {
      const path = requestPath(input);
      if (path.endsWith("/load_gmail_connection_v1")) return Response.json([row]);
      if (path.endsWith("/token")) return Response.json({ access_token: "access" });
      if (path.endsWith("/watch")) {
        return Response.json({
          historyId: "200",
          expiration: Date.parse("2026-09-05T10:00:00Z").toString(),
        });
      }
      if (path.endsWith("/record_gmail_watch_v1")) {
        await acceptGmailCursor(storage, identity, "300");
        return Response.json(true);
      }
      throw new Error("unexpected synthetic request");
    });

    await expect(runGmailAlarm(storage, environment(), fetcher)).resolves.toBe(true);

    expect(values.get("gmail:pending-history-id")).toBe("300");
    expect(values.has("gmail:history-work")).toBe(false);
  });

  it("retries a definitive 429 first-watch rejection without creating an ambiguous baseline", async () => {
    const baseRow = { ...(await encryptedCredential()), history_cursor: null };
    const { storage, values } = fakeStorage();
    await acceptGmailMaintenance(storage, { ...identity, reconcile: true, renewWatch: true });
    await storage.deleteAlarm();
    let watchCalls = 0;
    const fetcher = vi.fn((input: string) => {
      const path = requestPath(input);
      if (path.endsWith("/load_gmail_connection_v1")) {
        return Promise.resolve(Response.json([baseRow]));
      }
      if (path.endsWith("/token"))
        return Promise.resolve(Response.json({ access_token: "access" }));
      if (path.endsWith("/watch")) {
        watchCalls += 1;
        return Promise.resolve(
          watchCalls === 1
            ? new Response(null, { status: 429 })
            : Response.json({
                historyId: "100",
                expiration: Date.parse("2026-09-05T10:00:00Z").toString(),
              }),
        );
      }
      if (path.endsWith("/mark_gmail_resync_required_v1")) {
        throw new Error("rejected watch must not mark resync required");
      }
      throw new Error("unexpected synthetic request");
    });

    await expect(runGmailAlarmReliably(storage, environment(), fetcher)).resolves.toBe(true);
    expect(values.has("gmail:initialization")).toBe(false);
    expect(values.get("gmail:renew-watch")).toBe(true);
    const retry = values.get("gmail:alarm-retry") as { nextAttemptAt: number };

    vi.setSystemTime(retry.nextAttemptAt);
    await expect(
      runGmailAlarmReliably(fakeStorage(values).storage, environment(), fetcher),
    ).resolves.toBe(true);

    expect(watchCalls).toBe(2);
    expect(values.get("gmail:initialization")).toMatchObject({
      baselineHistoryId: "100",
      phase: "baseline-ready",
    });
    expect(values.has("gmail:alarm-retry")).toBe(false);
  });

  it.each([408, 503, "fetch-rejection"] as const)(
    "marks first-watch %s ambiguous without repeating provider call",
    async (status) => {
      const baseRow = { ...(await encryptedCredential()), history_cursor: null };
      const { storage, values } = fakeStorage();
      await acceptGmailMaintenance(storage, { ...identity, reconcile: true, renewWatch: true });
      let watchCalls = 0;
      let resyncReason: string | undefined;
      const fetcher = vi.fn((input: string, init?: RequestInit) => {
        const path = requestPath(input);
        if (path.endsWith("/load_gmail_connection_v1")) {
          return Promise.resolve(Response.json([baseRow]));
        }
        if (path.endsWith("/token")) {
          return Promise.resolve(Response.json({ access_token: "access" }));
        }
        if (path.endsWith("/watch")) {
          watchCalls += 1;
          return typeof status === "number"
            ? Promise.resolve(new Response(null, { status }))
            : Promise.reject(new Error("synthetic watch fetch rejection"));
        }
        if (path.endsWith("/mark_gmail_resync_required_v1")) {
          resyncReason = String(requestBody(init).p_error_code);
          return Promise.resolve(Response.json(true));
        }
        throw new Error("unexpected synthetic request");
      });

      await expect(runGmailAlarm(storage, environment(), fetcher)).resolves.toBe(true);
      await expect(
        runGmailAlarm(fakeStorage(values).storage, environment(), fetcher),
      ).resolves.toBe(true);

      expect(watchCalls).toBe(1);
      expect(resyncReason).toBe("initialization-ambiguous");
      expect(values.has("gmail:renew-watch")).toBe(false);
    },
  );

  it("marks persisted in-flight initial watch stale after restart without repeating watch", async () => {
    const baseRow = { ...(await encryptedCredential()), history_cursor: null };
    let stale = false;
    let watchCalls = 0;
    let recordedReason: string | undefined;
    const { storage, values } = fakeStorage(new Map(), { failBaselineReady: true });
    await acceptGmailMaintenance(storage, { ...identity, reconcile: true, renewWatch: true });
    const fetcher = vi.fn((input: string, init?: RequestInit) => {
      const path = requestPath(input);
      if (path.endsWith("/load_gmail_connection_v1")) {
        return Promise.resolve(
          Response.json([{ ...baseRow, sync_status: stale ? "stale" : "active" }]),
        );
      }
      if (path.endsWith("/token")) {
        return Promise.resolve(Response.json({ access_token: "access" }));
      }
      if (path.endsWith("/watch")) {
        watchCalls += 1;
        return Promise.resolve(
          Response.json({
            historyId: "100",
            expiration: Date.parse("2026-09-05T10:00:00Z").toString(),
          }),
        );
      }
      if (path.endsWith("/mark_gmail_resync_required_v1")) {
        if (typeof init?.body !== "string") throw new Error("missing synthetic request body");
        const parsed: unknown = JSON.parse(init.body);
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          !("p_error_code" in parsed) ||
          typeof parsed.p_error_code !== "string"
        ) {
          throw new Error("invalid synthetic request body");
        }
        recordedReason = parsed.p_error_code;
        stale = true;
        return Promise.resolve(Response.json(true));
      }
      throw new Error("unexpected synthetic request");
    });

    await expect(runGmailAlarm(storage, environment(), fetcher)).rejects.toThrow(
      "synthetic baseline persistence failure",
    );
    expect(values.get("gmail:initialization")).toMatchObject({ phase: "watch-call-in-flight" });
    const restartedStorage = fakeStorage(values).storage;
    await expect(runGmailAlarm(restartedStorage, environment(), fetcher)).resolves.toBe(true);

    expect(watchCalls).toBe(1);
    expect(recordedReason).toBe("initialization-ambiguous");
    expect(values.has("gmail:initialization")).toBe(false);
  });

  it("marks stale History 404 without guessing a full sync", async () => {
    const row = await encryptedCredential();
    const { storage } = fakeStorage();
    await acceptGmailCursor(storage, identity, "200");
    const send = vi.fn();
    let markedStale = false;
    const fetcher = vi.fn((input: string) => {
      const path = requestPath(input);
      if (path.endsWith("/load_gmail_connection_v1")) return Promise.resolve(Response.json([row]));
      if (path.endsWith("/token"))
        return Promise.resolve(Response.json({ access_token: "access" }));
      if (path.endsWith("/history")) return Promise.resolve(new Response(null, { status: 404 }));
      if (path.endsWith("/mark_gmail_resync_required_v1")) {
        markedStale = true;
        return Promise.resolve(Response.json(true));
      }
      throw new Error("unexpected synthetic request");
    });

    const env = environment({
      INGRESS_QUEUE: { send } as unknown as Queue<IngressQueueMessage>,
    });
    await expect(runGmailAlarm(storage, env, fetcher)).resolves.toBe(true);
    await expect(runGmailAlarm(storage, env, fetcher)).resolves.toBe(true);

    expect(markedStale).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it("marks definitive History 400 with durable page token resync-required", async () => {
    const row = await encryptedCredential();
    const { storage, values } = fakeStorage();
    await acceptGmailCursor(storage, identity, "200");
    let resyncReason: string | undefined;
    const pageTokens: (string | null)[] = [];
    const fetcher = vi.fn((input: string, init?: RequestInit) => {
      const url = new URL(input);
      const path = url.pathname;
      if (path.endsWith("/load_gmail_connection_v1")) return Promise.resolve(Response.json([row]));
      if (path.endsWith("/token"))
        return Promise.resolve(Response.json({ access_token: "access" }));
      if (path.endsWith("/history")) {
        const pageToken = url.searchParams.get("pageToken");
        pageTokens.push(pageToken);
        return Promise.resolve(
          pageToken === null
            ? Response.json({ historyId: "150", nextPageToken: "durable-page-2" })
            : new Response(null, { status: 400 }),
        );
      }
      if (path.endsWith("/mark_gmail_resync_required_v1")) {
        resyncReason = String(requestBody(init).p_error_code);
        return Promise.resolve(Response.json(true));
      }
      throw new Error("unexpected synthetic request");
    });

    await runGmailAlarm(storage, environment(), fetcher);
    await runGmailAlarm(storage, environment(), fetcher);
    expect(values.get("gmail:history-work")).toMatchObject({
      pageToken: "durable-page-2",
      phase: "fetch-page",
    });
    await expect(runGmailAlarm(storage, environment(), fetcher)).resolves.toBe(true);

    expect(pageTokens).toEqual([null, "durable-page-2"]);
    expect(resyncReason).toBe("continuation-invalid");
    expect(values.has("gmail:history-work")).toBe(false);
  });

  it("retries interrupted History response from same durable page state", async () => {
    const row = await encryptedCredential();
    const { storage, values } = fakeStorage();
    await acceptGmailCursor(storage, identity, "200");
    let databaseCursor = "100";
    let historyCalls = 0;
    const fetcher = vi.fn((input: string) => {
      const path = requestPath(input);
      if (path.endsWith("/load_gmail_connection_v1")) {
        return Promise.resolve(Response.json([{ ...row, history_cursor: databaseCursor }]));
      }
      if (path.endsWith("/token"))
        return Promise.resolve(Response.json({ access_token: "access" }));
      if (path.endsWith("/history")) {
        historyCalls += 1;
        return Promise.resolve(
          historyCalls === 1 ? interruptedResponse() : Response.json({ historyId: "200" }),
        );
      }
      if (path.endsWith("/advance_gmail_history_cursor_v1")) {
        databaseCursor = "200";
        return Promise.resolve(Response.json(true));
      }
      if (path.endsWith("/mark_gmail_resync_required_v1")) {
        throw new Error("interrupted History response must not mark stale");
      }
      throw new Error("unexpected synthetic request");
    });

    await runGmailAlarm(storage, environment(), fetcher);
    await storage.deleteAlarm();
    await runGmailAlarmReliably(storage, environment(), fetcher);
    expect(values.get("gmail:history-work")).toMatchObject({ phase: "fetch-page" });
    const retry = values.get("gmail:alarm-retry") as { nextAttemptAt: number };

    vi.setSystemTime(retry.nextAttemptAt);
    let restarted = fakeStorage(values).storage;
    await runGmailAlarmReliably(restarted, environment(), fetcher);
    expect(values.has("gmail:alarm-retry")).toBe(false);
    for (let invocation = 0; invocation < 4 && values.has("gmail:history-work"); invocation += 1) {
      restarted = fakeStorage(values).storage;
      await runGmailAlarm(restarted, environment(), fetcher);
    }

    expect(historyCalls).toBe(2);
    expect(databaseCursor).toBe("200");
    expect(values.has("gmail:history-work")).toBe(false);
  });

  it("bounds busy pagination across alarms and preserves higher pending cursor after restart", async () => {
    const baseRow = await encryptedCredential();
    let databaseCursor = "100";
    const { storage, values } = fakeStorage();
    await acceptGmailCursor(storage, identity, "200");
    const firstPageIds = Array.from({ length: 12 }, (_, index) => `message-${index + 1}`);
    let historyCalls = 0;
    let messageCalls = 0;
    let advances = 0;
    const send = vi.fn((_message: IngressQueueMessage) => {
      void _message;
      return Promise.resolve();
    });
    const fetcher = vi.fn((input: string) => {
      const url = new URL(input);
      const path = url.pathname;
      if (path.endsWith("/load_gmail_connection_v1")) {
        return Promise.resolve(Response.json([{ ...baseRow, history_cursor: databaseCursor }]));
      }
      if (path.endsWith("/token")) {
        return Promise.resolve(Response.json({ access_token: "access" }));
      }
      if (path.endsWith("/history")) {
        historyCalls += 1;
        return Promise.resolve(
          url.searchParams.get("pageToken") === null
            ? Response.json({
                history: [
                  {
                    id: "200",
                    messagesAdded: firstPageIds.map((id) => ({ message: { id } })),
                  },
                ],
                historyId: "200",
                nextPageToken: "page-2",
              })
            : Response.json({
                history: [
                  {
                    id: "250",
                    messagesAdded: [
                      { message: { id: "message-12" } },
                      { message: { id: "message-13" } },
                    ],
                  },
                ],
                historyId: "250",
              }),
        );
      }
      if (path.includes("/messages/")) {
        messageCalls += 1;
        return Promise.resolve(Response.json(gmailMessage(path.split("/").at(-1))));
      }
      if (path.endsWith("/advance_gmail_history_cursor_v1")) {
        databaseCursor = "250";
        advances += 1;
        return Promise.resolve(Response.json(true));
      }
      throw new Error("unexpected synthetic request");
    });
    const env = environment({ INGRESS_QUEUE: { send } as unknown as Queue<IngressQueueMessage> });

    await runGmailAlarm(storage, env, fetcher);
    await runGmailAlarm(storage, env, fetcher);
    const workBeforeHigherPush = values.get("gmail:history-work") as { targetHistoryId: string };
    expect(workBeforeHigherPush.targetHistoryId).toBe("200");
    await acceptGmailCursor(storage, identity, "300");
    expect((values.get("gmail:history-work") as { targetHistoryId: string }).targetHistoryId).toBe(
      "200",
    );

    let activeStorage = fakeStorage(values).storage;
    await runGmailAlarm(activeStorage, env, fetcher);
    activeStorage = fakeStorage(values).storage;
    await runGmailAlarm(activeStorage, env, fetcher);
    expect(values.get("gmail:history-work")).toMatchObject({
      pageToken: "page-2",
      phase: "fetch-page",
    });
    expect(
      [...values.keys()].some(
        (key) =>
          key.startsWith("gmail:history-page:") ||
          key.startsWith("gmail:history-seen:") ||
          key.startsWith("gmail:history-chunk:"),
      ),
    ).toBe(false);
    activeStorage = fakeStorage(values).storage;
    for (let invocation = 0; invocation < 12; invocation += 1) {
      const historyBefore = historyCalls;
      const messagesBefore = messageCalls;
      await runGmailAlarm(activeStorage, env, fetcher);
      expect(historyCalls - historyBefore).toBeLessThanOrEqual(1);
      expect(messageCalls - messagesBefore).toBeLessThanOrEqual(10);
      activeStorage = fakeStorage(values).storage;
      if (advances === 1 && !values.has("gmail:history-work")) break;
    }

    expect(historyCalls).toBe(2);
    expect(messageCalls).toBe(14);
    expect(send).toHaveBeenCalledTimes(14);
    const publishedEnvelopeIds = send.mock.calls.map(([message]) => message.envelopeId);
    expect(new Set(publishedEnvelopeIds).size).toBe(13);
    expect(advances).toBe(1);
    expect(values.get("gmail:pending-history-id")).toBe("300");
  });

  it("durably drains more than one hundred messages across chunk boundaries and cleanup", async () => {
    const baseRow = await encryptedCredential();
    let databaseCursor = "100";
    const { storage, values } = fakeStorage();
    await acceptGmailCursor(storage, identity, "200");
    const messageIds = Array.from({ length: 205 }, (_, index) => `bulk-${index + 1}`);
    let historyCalls = 0;
    let messageCalls = 0;
    const send = vi.fn(() => Promise.resolve());
    const fetcher = vi.fn((input: string) => {
      const path = requestPath(input);
      if (path.endsWith("/load_gmail_connection_v1")) {
        return Promise.resolve(Response.json([{ ...baseRow, history_cursor: databaseCursor }]));
      }
      if (path.endsWith("/token"))
        return Promise.resolve(Response.json({ access_token: "access" }));
      if (path.endsWith("/history")) {
        historyCalls += 1;
        return Promise.resolve(
          Response.json({
            history: [
              {
                id: "200",
                messagesAdded: messageIds.map((id) => ({ message: { id } })),
              },
            ],
            historyId: "200",
          }),
        );
      }
      if (path.includes("/messages/")) {
        messageCalls += 1;
        return Promise.resolve(Response.json(gmailMessage(path.split("/").at(-1))));
      }
      if (path.endsWith("/advance_gmail_history_cursor_v1")) {
        databaseCursor = "200";
        return Promise.resolve(Response.json(true));
      }
      throw new Error("unexpected synthetic request");
    });
    const env = environment({ INGRESS_QUEUE: { send } as unknown as Queue<IngressQueueMessage> });

    await runGmailAlarm(storage, env, fetcher);
    await runGmailAlarm(storage, env, fetcher);
    expect([...values.keys()].filter((key) => key.startsWith("gmail:history-chunk:"))).toHaveLength(
      3,
    );

    let activeStorage = fakeStorage(values).storage;
    for (let invocation = 0; invocation < 10; invocation += 1) {
      const before = messageCalls;
      await runGmailAlarm(activeStorage, env, fetcher);
      expect(messageCalls - before).toBeLessThanOrEqual(10);
      activeStorage = fakeStorage(values).storage;
    }
    expect(values.get("gmail:history-work")).toMatchObject({ chunkIndex: 1, messageIndex: 0 });
    expect([...values.keys()].filter((key) => key.startsWith("gmail:history-chunk:"))).toHaveLength(
      2,
    );

    for (let invocation = 0; invocation < 40 && values.has("gmail:history-work"); invocation += 1) {
      const before = messageCalls;
      await runGmailAlarm(activeStorage, env, fetcher);
      expect(messageCalls - before).toBeLessThanOrEqual(10);
      activeStorage = fakeStorage(values).storage;
    }

    expect(historyCalls).toBe(1);
    expect(messageCalls).toBe(205);
    expect(send).toHaveBeenCalledTimes(205);
    expect(values.has("gmail:history-work")).toBe(false);
    expect([...values.keys()].some((key) => key.startsWith("gmail:history-chunk:"))).toBe(false);
    expect([...values.keys()].some((key) => key.startsWith("gmail:history-seen:"))).toBe(false);
  });

  it("truncates over-header and Queue-expanding messages so later messages still progress", async () => {
    const row = await encryptedCredential();
    const { storage, values } = fakeStorage();
    await acceptGmailCursor(storage, identity, "200");
    const send = vi.fn(() => Promise.resolve());
    let databaseCursor = "100";
    const fetcher = vi.fn((input: string) => {
      const path = requestPath(input);
      if (path.endsWith("/load_gmail_connection_v1")) {
        return Promise.resolve(Response.json([{ ...row, history_cursor: databaseCursor }]));
      }
      if (path.endsWith("/token"))
        return Promise.resolve(Response.json({ access_token: "access" }));
      if (path.endsWith("/history")) {
        return Promise.resolve(
          Response.json({
            history: [
              {
                id: "200",
                messagesAdded: [
                  { message: { id: "a-over-header" } },
                  { message: { id: "b-queue-budget" } },
                  { message: { id: "z-later" } },
                ],
              },
            ],
            historyId: "200",
          }),
        );
      }
      if (path.endsWith("/messages/a-over-header")) {
        return Promise.resolve(
          Response.json({
            ...gmailMessage("a-over-header"),
            payload: {
              ...gmailMessage("a-over-header").payload,
              headers: [
                { name: "From", value: "sender@example.test" },
                ...Array.from({ length: 200 }, (_, index) => ({
                  name: `X-Synthetic-${index}`,
                  value: "x",
                })),
              ],
            },
          }),
        );
      }
      if (path.endsWith("/messages/b-queue-budget")) {
        const source = "\u0000".repeat(48_000);
        return Promise.resolve(
          Response.json({
            ...gmailMessage("b-queue-budget"),
            payload: {
              ...gmailMessage("b-queue-budget").payload,
              body: { data: btoa(source), size: 48_000 },
            },
          }),
        );
      }
      if (path.endsWith("/messages/z-later")) {
        return Promise.resolve(Response.json(gmailMessage("z-later")));
      }
      if (path.endsWith("/advance_gmail_history_cursor_v1")) {
        databaseCursor = "200";
        return Promise.resolve(Response.json(true));
      }
      if (path.endsWith("/record_gmail_terminal_message_v1")) {
        throw new Error("bounded messages must not become terminal receipts");
      }
      throw new Error("unexpected synthetic request");
    });
    const env = environment({ INGRESS_QUEUE: { send } as unknown as Queue<IngressQueueMessage> });

    for (
      let invocation = 0;
      invocation < 8 &&
      (values.has("gmail:pending-history-id") || values.has("gmail:history-work"));
      invocation += 1
    ) {
      await runGmailAlarm(storage, env, fetcher);
    }

    expect(send).toHaveBeenCalledTimes(3);
    expect(databaseCursor).toBe("200");
    expect(values.has("gmail:history-work")).toBe(false);
  });

  it.each([
    ["a-oversized", "provider-response-too-large"],
    ["a-malformed", "provider-response-invalid"],
    ["a-missing", "provider-message-missing"],
  ] as const)(
    "durably records %s provider message failure after a lost response and continues later",
    async (failedMessageId, expectedReason) => {
      const row = await encryptedCredential();
      const { storage, values } = fakeStorage();
      await acceptGmailCursor(storage, identity, "200");
      const send = vi.fn(() => Promise.resolve());
      let databaseCursor = "100";
      let terminalRpcCalls = 0;
      let terminalReceiptCommitted = false;
      const reasons: string[] = [];
      const fetcher = vi.fn((input: string, init?: RequestInit) => {
        const path = requestPath(input);
        if (path.endsWith("/load_gmail_connection_v1")) {
          return Promise.resolve(Response.json([{ ...row, history_cursor: databaseCursor }]));
        }
        if (path.endsWith("/token")) {
          return Promise.resolve(Response.json({ access_token: "access" }));
        }
        if (path.endsWith("/history")) {
          return Promise.resolve(
            Response.json({
              history: [
                {
                  id: "200",
                  messagesAdded: [
                    { message: { id: failedMessageId } },
                    { message: { id: "z-later" } },
                  ],
                },
              ],
              historyId: "200",
            }),
          );
        }
        if (path.endsWith(`/messages/${failedMessageId}`)) {
          return Promise.resolve(
            failedMessageId === "a-oversized"
              ? new Response("{}", { headers: { "content-length": "1000001" } })
              : failedMessageId === "a-missing"
                ? new Response(null, { status: 404 })
                : Response.json({ ...gmailMessage(failedMessageId), id: "different-message" }),
          );
        }
        if (path.endsWith("/messages/z-later")) {
          return Promise.resolve(Response.json(gmailMessage("z-later")));
        }
        if (path.endsWith("/record_gmail_terminal_message_v1")) {
          terminalRpcCalls += 1;
          const body = requestBody(init);
          reasons.push(String(body.p_reason));
          expect(body.p_message_digest).toMatch(/^[0-9a-f]{64}$/u);
          if (!terminalReceiptCommitted) {
            terminalReceiptCommitted = true;
            return Promise.reject(new Error("synthetic lost terminal receipt response"));
          }
          return Promise.resolve(Response.json(true));
        }
        if (path.endsWith("/advance_gmail_history_cursor_v1")) {
          databaseCursor = "200";
          return Promise.resolve(Response.json(true));
        }
        throw new Error("unexpected synthetic request");
      });
      const env = environment({ INGRESS_QUEUE: { send } as unknown as Queue<IngressQueueMessage> });

      await runGmailAlarm(storage, env, fetcher);
      await runGmailAlarm(storage, env, fetcher);
      await expect(runGmailAlarm(storage, env, fetcher)).rejects.toThrow(
        "synthetic lost terminal receipt response",
      );
      let activeStorage = fakeStorage(values).storage;
      for (
        let invocation = 0;
        invocation < 8 &&
        (values.has("gmail:pending-history-id") || values.has("gmail:history-work"));
        invocation += 1
      ) {
        await runGmailAlarm(activeStorage, env, fetcher);
        activeStorage = fakeStorage(values).storage;
      }

      expect(terminalRpcCalls).toBe(2);
      expect(reasons).toEqual([expectedReason, expectedReason]);
      expect(send).toHaveBeenCalledOnce();
      expect(databaseCursor).toBe("200");
      expect(values.has("gmail:history-work")).toBe(false);
    },
  );

  it("retries an interrupted message body without writing terminal receipt or duplicate publication", async () => {
    const row = await encryptedCredential();
    const { storage, values } = fakeStorage();
    await acceptGmailCursor(storage, identity, "200");
    let databaseCursor = "100";
    let messageCalls = 0;
    const publisher = vi.fn<TestPublisher>(() => Promise.resolve({ accepted: true as const }));
    const fetcher = vi.fn((input: string) => {
      const path = requestPath(input);
      if (path.endsWith("/load_gmail_connection_v1")) {
        return Promise.resolve(Response.json([{ ...row, history_cursor: databaseCursor }]));
      }
      if (path.endsWith("/token"))
        return Promise.resolve(Response.json({ access_token: "access" }));
      if (path.endsWith("/history")) {
        return Promise.resolve(
          Response.json({
            history: [{ id: "200", messagesAdded: [{ message: { id: "message-1" } }] }],
            historyId: "200",
          }),
        );
      }
      if (path.endsWith("/messages/message-1")) {
        messageCalls += 1;
        return Promise.resolve(
          messageCalls === 1 ? interruptedResponse() : Response.json(gmailMessage()),
        );
      }
      if (path.endsWith("/record_gmail_terminal_message_v1")) {
        throw new Error("interrupted response must remain retryable");
      }
      if (path.endsWith("/advance_gmail_history_cursor_v1")) {
        databaseCursor = "200";
        return Promise.resolve(Response.json(true));
      }
      throw new Error("unexpected synthetic request");
    });

    await runGmailAlarm(storage, environment(), fetcher, publisher);
    await runGmailAlarm(storage, environment(), fetcher, publisher);
    await expect(runGmailAlarm(storage, environment(), fetcher, publisher)).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(publisher).not.toHaveBeenCalled();

    let restarted = fakeStorage(values).storage;
    for (let invocation = 0; invocation < 5 && values.has("gmail:history-work"); invocation += 1) {
      await runGmailAlarm(restarted, environment(), fetcher, publisher);
      restarted = fakeStorage(values).storage;
    }

    expect(messageCalls).toBe(2);
    expect(publisher).toHaveBeenCalledOnce();
    const publicationCall = publisher.mock.calls[0];
    expect(publicationCall).toBeDefined();
    expect(publicationCall?.[1]).toBe(userId);
    expect(publicationCall?.[2].source.kind).toBe("gmail");
    expect(publicationCall?.[3]).toBe("gmail-provider");
    expect(databaseCursor).toBe("200");
  });

  it("records Queue budget rejection as terminal and continues later messages", async () => {
    const row = await encryptedCredential();
    const { storage, values } = fakeStorage();
    await acceptGmailCursor(storage, identity, "200");
    let databaseCursor = "100";
    const terminalReasons: string[] = [];
    const fetcher = vi.fn((input: string, init?: RequestInit) => {
      const path = requestPath(input);
      if (path.endsWith("/load_gmail_connection_v1")) {
        return Promise.resolve(Response.json([{ ...row, history_cursor: databaseCursor }]));
      }
      if (path.endsWith("/token"))
        return Promise.resolve(Response.json({ access_token: "access" }));
      if (path.endsWith("/history")) {
        return Promise.resolve(
          Response.json({
            history: [
              {
                id: "200",
                messagesAdded: [
                  { message: { id: "a-queue-rejected" } },
                  { message: { id: "z-later" } },
                ],
              },
            ],
            historyId: "200",
          }),
        );
      }
      if (path.includes("/messages/")) {
        return Promise.resolve(Response.json(gmailMessage(path.split("/").at(-1))));
      }
      if (path.endsWith("/record_gmail_terminal_message_v1")) {
        const body = requestBody(init);
        terminalReasons.push(String(body.p_reason));
        return Promise.resolve(Response.json(true));
      }
      if (path.endsWith("/advance_gmail_history_cursor_v1")) {
        databaseCursor = "200";
        return Promise.resolve(Response.json(true));
      }
      throw new Error("unexpected synthetic request");
    });
    const publisher = vi
      .fn<TestPublisher>()
      .mockResolvedValueOnce({ accepted: false, reason: "queue-message-too-large" })
      .mockResolvedValue({ accepted: true });

    for (
      let invocation = 0;
      invocation < 8 &&
      (values.has("gmail:pending-history-id") || values.has("gmail:history-work"));
      invocation += 1
    ) {
      await runGmailAlarm(storage, environment(), fetcher, publisher);
    }

    expect(publisher).toHaveBeenCalledTimes(2);
    expect(publisher.mock.calls.every((call) => call[3] === "gmail-provider")).toBe(true);
    expect(terminalReasons).toEqual(["queue-budget-exceeded"]);
    expect(databaseCursor).toBe("200");
    expect(values.has("gmail:history-work")).toBe(false);
  });
});

describe("Gmail durable alarm retries", () => {
  it.each(["supabase", "provider"] as const)(
    "aborts a never-resolving %s operation at external deadline and schedules durable retry",
    async (stage) => {
      const row = await encryptedCredential();
      const { storage, values } = fakeStorage();
      await acceptGmailCursor(storage, identity, "200");
      let operationSignal: AbortSignal | undefined;
      const fetcher = vi.fn((input: string, init?: RequestInit) => {
        const path = requestPath(input);
        if (path.endsWith("/load_gmail_connection_v1")) {
          if (stage === "supabase") {
            operationSignal = init?.signal ?? undefined;
            return new Promise<Response>(() => undefined);
          }
          return Promise.resolve(Response.json([row]));
        }
        if (path.endsWith("/token")) {
          operationSignal = init?.signal ?? undefined;
          return new Promise<Response>(() => undefined);
        }
        throw new Error("unexpected synthetic request");
      });

      if (stage === "provider") await runGmailAlarm(storage, environment(), fetcher);
      await storage.deleteAlarm();

      const outcome = runGmailAlarmReliably(storage, environment(), fetcher);
      await vi.waitFor(() => expect(operationSignal).toBeDefined());
      expect(operationSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(GMAIL_EXTERNAL_OPERATION_TIMEOUT_MS);
      await expect(outcome).resolves.toBe(true);

      expect(operationSignal?.aborted).toBe(true);
      expect(values.get("gmail:alarm-retry")).toMatchObject({ attempts: 1 });
      expect(await storage.getAlarm()).toBeGreaterThan(Date.now());
    },
  );

  it("bounds whole alarm when local work never resolves and preserves durable retry", async () => {
    const options: { hangGetKey?: string } = {};
    const { storage, values } = fakeStorage(new Map(), options);
    await acceptGmailCursor(storage, identity, "200");
    await storage.deleteAlarm();
    options.hangGetKey = "gmail:alarm-retry";

    const outcome = runGmailAlarmReliably(storage, environment());
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(GMAIL_ALARM_DEADLINE_MS);
    await expect(outcome).resolves.toBe(true);

    expect(values.get("gmail:alarm-retry")).toMatchObject({ attempts: 1 });
    expect(await storage.getAlarm()).toBeGreaterThan(Date.now());
  });

  it("retries never-resolving Queue publication after restart with same envelope ID", async () => {
    const row = await encryptedCredential();
    const { storage, values } = fakeStorage();
    await acceptGmailCursor(storage, identity, "200");
    const sent: IngressQueueMessage[] = [];
    let queueAvailable = false;
    const send = vi.fn((message: IngressQueueMessage) => {
      sent.push(message);
      return queueAvailable ? Promise.resolve() : new Promise<void>(() => undefined);
    });
    let databaseCursor = "100";
    const fetcher = vi.fn((input: string) => {
      const path = requestPath(input);
      if (path.endsWith("/load_gmail_connection_v1")) {
        return Promise.resolve(Response.json([{ ...row, history_cursor: databaseCursor }]));
      }
      if (path.endsWith("/token"))
        return Promise.resolve(Response.json({ access_token: "access" }));
      if (path.endsWith("/history")) {
        return Promise.resolve(
          Response.json({
            history: [{ id: "200", messagesAdded: [{ message: { id: "message-1" } }] }],
            historyId: "200",
          }),
        );
      }
      if (path.endsWith("/messages/message-1")) {
        return Promise.resolve(Response.json(gmailMessage()));
      }
      if (path.endsWith("/advance_gmail_history_cursor_v1")) {
        databaseCursor = "200";
        return Promise.resolve(Response.json(true));
      }
      throw new Error("unexpected synthetic request");
    });
    const env = environment({ INGRESS_QUEUE: { send } as unknown as Queue<IngressQueueMessage> });

    await runGmailAlarm(storage, env, fetcher);
    await runGmailAlarm(storage, env, fetcher);
    await storage.deleteAlarm();
    const timedOut = runGmailAlarmReliably(storage, env, fetcher);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(GMAIL_EXTERNAL_OPERATION_TIMEOUT_MS);
    await expect(timedOut).resolves.toBe(true);
    expect(values.get("gmail:history-work")).toMatchObject({ messageIndex: 0, phase: "messages" });

    const retry = values.get("gmail:alarm-retry") as GmailAlarmRetryFixture;
    vi.setSystemTime(retry.nextAttemptAt);
    queueAvailable = true;
    let restarted = fakeStorage(values).storage;
    for (let invocation = 0; invocation < 4 && values.has("gmail:history-work"); invocation += 1) {
      await runGmailAlarmReliably(restarted, env, fetcher);
      restarted = fakeStorage(values).storage;
    }

    expect(sent).toHaveLength(2);
    expect(sent[0]!.envelopeId).toBe(sent[1]!.envelopeId);
    expect(databaseCursor).toBe("200");
    expect(values.has("gmail:alarm-retry")).toBe(false);
  });

  it("recovers after more than six transient failures and resets retry state on progress", async () => {
    const row = await encryptedCredential();
    const { storage, values } = fakeStorage();
    await acceptGmailCursor(storage, identity, "200");
    let failing = true;
    const fetcher = vi.fn((input: string) => {
      const path = requestPath(input);
      if (path.endsWith("/load_gmail_connection_v1")) {
        return failing
          ? Promise.resolve(new Response(null, { status: 503 }))
          : Promise.resolve(Response.json([row]));
      }
      throw new Error("unexpected synthetic request");
    });

    for (let attempt = 1; attempt <= 7; attempt += 1) {
      await storage.deleteAlarm();
      await expect(runGmailAlarmReliably(storage, environment(), fetcher)).resolves.toBe(true);
      const retry = values.get("gmail:alarm-retry") as {
        attempts: number;
        nextAttemptAt: number;
      };
      expect(retry.attempts).toBe(attempt);
      expect(await storage.getAlarm()).toBe(retry.nextAttemptAt);
      vi.setSystemTime(retry.nextAttemptAt);
    }

    failing = false;
    await storage.deleteAlarm();
    await expect(runGmailAlarmReliably(storage, environment(), fetcher)).resolves.toBe(true);

    expect(values.has("gmail:alarm-retry")).toBe(false);
    expect(values.get("gmail:history-work")).toMatchObject({
      startHistoryId: "100",
      targetHistoryId: "200",
    });
    expect(await storage.getAlarm()).not.toBeNull();
  });

  it("loads retry attempts after restart and preserves an earlier unrelated alarm", async () => {
    const { storage, values } = fakeStorage();
    await acceptGmailCursor(storage, identity, "200");
    const fetcher = vi.fn(() => Promise.resolve(new Response(null, { status: 503 })));
    await storage.deleteAlarm();
    await runGmailAlarmReliably(storage, environment(), fetcher);
    const firstRetry = values.get("gmail:alarm-retry") as {
      attempts: number;
      nextAttemptAt: number;
    };

    vi.setSystemTime(firstRetry.nextAttemptAt);
    const restarted = fakeStorage(values).storage;
    const unrelatedAlarm = firstRetry.nextAttemptAt + 1_000;
    await restarted.setAlarm(unrelatedAlarm);
    await runGmailAlarmReliably(restarted, environment(), fetcher);

    expect(values.get("gmail:alarm-retry")).toMatchObject({ attempts: 2 });
    expect(await restarted.getAlarm()).toBe(unrelatedAlarm);
  });

  it("keeps failed durable disconnect work scheduled until provider completion", async () => {
    const { storage, values } = fakeStorage();
    await acceptGmailDisconnect(storage, identity);
    await storage.deleteAlarm();

    await expect(
      runGmailAlarmReliably(
        storage,
        environment(),
        vi.fn(() => Promise.resolve(new Response(null, { status: 503 }))),
      ),
    ).resolves.toBe(true);

    expect(values.get("gmail:disconnect-work")).toMatchObject({ phase: "stop" });
    expect(values.get("gmail:alarm-retry")).toMatchObject({ attempts: 1 });
    expect(await storage.getAlarm()).toBeGreaterThan(Date.now());
  });

  it("resumes automatic invalid_grant cleanup after lost response without another provider call", async () => {
    const row = await encryptedCredential();
    const { storage, values } = fakeStorage();
    await acceptGmailCursor(storage, identity, "200");
    let tokenCalls = 0;
    let disconnectCalls = 0;
    let databaseCommitted = false;
    const disconnectBodies: Record<string, unknown>[] = [];
    const fetcher = vi.fn((input: string, init?: RequestInit) => {
      const path = requestPath(input);
      if (path.endsWith("/load_gmail_connection_v1")) return Promise.resolve(Response.json([row]));
      if (path.endsWith("/token")) {
        tokenCalls += 1;
        return Promise.resolve(Response.json({ error: "invalid_grant" }, { status: 400 }));
      }
      if (path.endsWith("/disconnect_gmail_connection_v1")) {
        disconnectCalls += 1;
        disconnectBodies.push(requestBody(init));
        if (disconnectCalls === 1) {
          return Promise.reject(new Error("synthetic database unavailable"));
        }
        if (disconnectCalls === 2) {
          databaseCommitted = true;
          return Promise.reject(new Error("synthetic lost committed cleanup response"));
        }
        expect(databaseCommitted).toBe(true);
        return Promise.resolve(Response.json(true));
      }
      throw new Error("unexpected synthetic request");
    });

    await runGmailAlarm(storage, environment(), fetcher);
    await storage.deleteAlarm();
    await expect(runGmailAlarmReliably(storage, environment(), fetcher)).resolves.toBe(true);
    const durableWork = values.get("gmail:revocation-work");
    expect(durableWork).toMatchObject({
      connectionId,
      reason: "provider-grant-revoked",
      userId,
    });
    expect(values.get("gmail:alarm-retry")).toMatchObject({ attempts: 1 });
    expect(values.get("gmail:removed")).toMatchObject({ phase: "pending" });

    const callsBeforePendingRetries = fetcher.mock.calls.length;
    const pendingCursor = await acceptGmailCursor(fakeStorage(values).storage, identity, "300");
    expect(pendingCursor.status).toBe(503);
    const pendingMaintenance = await acceptGmailMaintenance(fakeStorage(values).storage, {
      ...identity,
      reconcile: true,
      renewWatch: true,
    });
    expect(pendingMaintenance.status).toBe(503);
    const pendingDisconnect = await coordinateGmailDisconnect(
      fakeStorage(values).storage,
      environment(),
      identity,
      fetcher,
    );
    expect(pendingDisconnect.status).toBe(503);
    await expect(pendingDisconnect.json()).resolves.toEqual({
      disconnected: false,
      reason: "removal-pending",
    });
    expect(fetcher).toHaveBeenCalledTimes(callsBeforePendingRetries);

    const firstRetry = values.get("gmail:alarm-retry") as GmailAlarmRetryFixture;
    vi.setSystemTime(firstRetry.nextAttemptAt);
    await expect(
      runGmailAlarmReliably(fakeStorage(values).storage, environment(), fetcher),
    ).resolves.toBe(true);
    expect(values.get("gmail:removed")).toMatchObject({ phase: "pending" });
    expect(values.get("gmail:alarm-retry")).toMatchObject({ attempts: 2 });

    const retryAfterLostCommit = await coordinateGmailDisconnect(
      fakeStorage(values).storage,
      environment(),
      identity,
      fetcher,
    );
    expect(retryAfterLostCommit.status).toBe(503);

    const secondRetry = values.get("gmail:alarm-retry") as GmailAlarmRetryFixture;
    vi.setSystemTime(secondRetry.nextAttemptAt);
    await expect(
      runGmailAlarmReliably(fakeStorage(values).storage, environment(), fetcher),
    ).resolves.toBe(true);

    expect(tokenCalls).toBe(1);
    expect(databaseCommitted).toBe(true);
    expect(disconnectCalls).toBe(3);
    expect(disconnectBodies[0]).toEqual(disconnectBodies[1]);
    expect(disconnectBodies[1]).toEqual(disconnectBodies[2]);
    expect(disconnectBodies[0]).toMatchObject({
      p_connection_id: connectionId,
      p_provider_already_revoked: true,
      p_pubsub_retention_seconds: 604_800,
      p_reason: "provider-grant-revoked",
      p_token_revoked: true,
      p_user_id: userId,
      p_watch_stopped: false,
    });
    expect(disconnectBodies[0]?.p_action_id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(fetcher.mock.calls.some(([input]) => requestPath(input).endsWith("/stop"))).toBe(false);
    expect(fetcher.mock.calls.some(([input]) => requestPath(input).endsWith("/revoke"))).toBe(
      false,
    );
    const marker = values.get("gmail:removed") as {
      actionId: string;
      connectionId: string;
      expiresAt: number;
      phase: string;
      reason: string;
      schemaVersion: number;
      userId: string;
    };
    expect(Object.keys(marker).sort()).toEqual([
      "actionId",
      "connectionId",
      "expiresAt",
      "phase",
      "reason",
      "schemaVersion",
      "userId",
    ]);
    expect(marker).toMatchObject({
      actionId: disconnectBodies[0]?.p_action_id,
      connectionId,
      phase: "completed",
      reason: "provider-grant-revoked",
      schemaVersion: 1,
      userId,
    });
    expect(marker.expiresAt).toBeGreaterThan(Date.now() + 604_800_000);
    expect(values.get("gmail:identity")).toEqual(identity);
    expect(values.has("gmail:revocation-work")).toBe(false);
    expect(values.has("gmail:alarm-retry")).toBe(false);

    const providerCallCount = fetcher.mock.calls.length;
    let restarted = fakeStorage(values).storage;
    const cursorResponse = await acceptGmailCursor(restarted, identity, "300");
    expect(cursorResponse.status).toBe(202);
    await expect(cursorResponse.json()).resolves.toMatchObject({ removed: true });
    const maintenanceResponse = await acceptGmailMaintenance(restarted, {
      ...identity,
      reconcile: true,
      renewWatch: true,
    });
    expect(maintenanceResponse.status).toBe(202);
    await expect(maintenanceResponse.json()).resolves.toMatchObject({ removed: true });
    const disconnectAcceptance = await acceptGmailDisconnect(restarted, identity);
    expect(disconnectAcceptance.status).toBe(202);
    await expect(disconnectAcceptance.json()).resolves.toMatchObject({ removed: true });
    const repeatedDisconnect = await coordinateGmailDisconnect(
      restarted,
      environment(),
      identity,
      fetcher,
    );
    expect(repeatedDisconnect.status).toBe(200);
    await expect(repeatedDisconnect.json()).resolves.toEqual({ disconnected: true });
    expect(values.has("gmail:pending-history-id")).toBe(false);
    expect(values.has("gmail:reconcile")).toBe(false);
    expect(values.has("gmail:renew-watch")).toBe(false);
    expect(values.has("gmail:disconnect-work")).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(providerCallCount);

    vi.setSystemTime(marker.expiresAt - 1);
    await restarted.deleteAlarm();
    await expect(runGmailAlarmReliably(restarted, environment(), fetcher)).resolves.toBe(true);
    expect(values.get("gmail:removed")).toEqual(marker);
    expect(values.get("gmail:identity")).toEqual(identity);
    expect(fetcher).toHaveBeenCalledTimes(providerCallCount);

    vi.setSystemTime(marker.expiresAt);
    restarted = fakeStorage(values).storage;
    await expect(runGmailAlarmReliably(restarted, environment(), fetcher)).resolves.toBe(true);
    expect(values.has("gmail:removed")).toBe(false);
    expect(values.has("gmail:identity")).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(providerCallCount);
  });
});

describe("Gmail disconnect retries", () => {
  it.each([
    {
      expectedOwnershipCalls: 0,
      intentKey: `gmail:disconnect-intent:${userId}`,
      intentValue: { schemaVersion: 1 },
      name: "malformed",
      ownership: undefined,
    },
    {
      expectedOwnershipCalls: 0,
      intentKey: `gmail:disconnect-intent:${userId}`,
      intentValue: {
        ...identity,
        userId: "42ad95f2-20b0-4b23-83af-ebcb560219df",
      },
      name: "conflicting",
      ownership: undefined,
    },
    {
      expectedOwnershipCalls: 1,
      intentKey: `gmail:disconnect-intent:${userId}`,
      intentValue: identity,
      name: "already-completed",
      ownership: "completed",
    },
    {
      expectedOwnershipCalls: 0,
      intentKey: "gmail:disconnect-intent:42ad95f2-20b0-4b23-83af-ebcb560219df",
      intentValue: {
        ...identity,
        userId: "42ad95f2-20b0-4b23-83af-ebcb560219df",
      },
      name: "cross-user",
      ownership: undefined,
    },
  ] as const)(
    "reschedules initialized Gmail work after deleting $name disconnect intent",
    async ({ expectedOwnershipCalls, intentKey, intentValue, ownership }) => {
      const row = await encryptedCredential();
      const { storage, values } = fakeStorage();
      await acceptGmailCursor(storage, identity, "200");
      await acceptGmailMaintenance(storage, {
        ...identity,
        reconcile: false,
        renewWatch: true,
      });
      await storage.put(intentKey, intentValue);
      await storage.deleteAlarm();
      let ownershipCalls = 0;
      let watchCalls = 0;
      const fetcher = vi.fn((input: string) => {
        const path = requestPath(input);
        if (path.endsWith("/gmail_connection_ownership_v1")) {
          ownershipCalls += 1;
          return Promise.resolve(Response.json(ownership));
        }
        if (path.endsWith("/load_gmail_connection_v1")) {
          return Promise.resolve(Response.json([row]));
        }
        if (path.endsWith("/token")) {
          return Promise.resolve(Response.json({ access_token: "access" }));
        }
        if (path.endsWith("/watch")) {
          watchCalls += 1;
          return Promise.resolve(
            Response.json({
              expiration: Date.parse("2026-09-05T10:00:00Z").toString(),
              historyId: "200",
            }),
          );
        }
        if (path.endsWith("/record_gmail_watch_v1")) {
          return Promise.resolve(Response.json(true));
        }
        throw new Error("unexpected synthetic request");
      });

      await expect(runGmailAlarm(storage, environment(), fetcher)).resolves.toBe(true);

      expect(values.has(intentKey)).toBe(false);
      expect(values.get("gmail:pending-history-id")).toBe("200");
      expect(values.get("gmail:renew-watch")).toBe(true);
      expect(ownershipCalls).toBe(expectedOwnershipCalls);
      expect(watchCalls).toBe(0);
      expect(await storage.getAlarm()).toBe(Date.now());

      await expect(
        runGmailAlarm(fakeStorage(values).storage, environment(), fetcher),
      ).resolves.toBe(true);
      expect(values.has("gmail:renew-watch")).toBe(false);
      expect(values.get("gmail:pending-history-id")).toBe("200");
      expect(watchCalls).toBe(1);
    },
  );

  it("preempts initialized Gmail work after ownership timeout and releases serialization", async () => {
    const row = await encryptedCredential();
    const { storage, values } = fakeStorage();
    await acceptGmailCursor(storage, identity, "200");
    const executor = new SerialExecutor();
    let ownershipAvailable = false;
    let disconnectProviderAvailable = false;
    let ownershipSignal: AbortSignal | undefined;
    let laterWorkStarted = false;
    let providerEffects = 0;
    const fetcher = vi.fn((input: string, init?: RequestInit) => {
      const path = requestPath(input);
      if (path.endsWith("/gmail_connection_ownership_v1")) {
        if (ownershipAvailable) return Promise.resolve(Response.json("active"));
        ownershipSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      }
      if (path.endsWith("/load_gmail_connection_v1")) return Promise.resolve(Response.json([row]));
      if (path.endsWith("/token"))
        return Promise.resolve(Response.json({ access_token: "access" }));
      if (path.endsWith("/stop")) {
        if (!disconnectProviderAvailable) {
          return Promise.resolve(new Response(null, { status: 503 }));
        }
        providerEffects += 1;
        return Promise.resolve(Response.json({}));
      }
      if (path.endsWith("/revoke")) {
        providerEffects += 1;
        return Promise.resolve(Response.json({}));
      }
      if (path.endsWith("/disconnect_gmail_connection_v1")) {
        return Promise.resolve(Response.json(true));
      }
      throw new Error("unexpected synthetic request");
    });

    const disconnect = executor.run(() =>
      coordinateGmailDisconnect(storage, environment(), identity, fetcher),
    );
    const laterWork = executor.run(() => {
      laterWorkStarted = true;
      return Promise.resolve();
    });
    await vi.waitFor(() => expect(ownershipSignal).toBeDefined());
    expect(laterWorkStarted).toBe(false);
    await vi.advanceTimersByTimeAsync(GMAIL_EXTERNAL_OPERATION_TIMEOUT_MS);

    await expect(disconnect).resolves.toMatchObject({ status: 503 });
    await expect(laterWork).resolves.toBeUndefined();
    expect(ownershipSignal?.aborted).toBe(true);
    expect(laterWorkStarted).toBe(true);
    expect(values.has("gmail:disconnect-work")).toBe(false);
    expect(values.get(`gmail:disconnect-intent:${userId}`)).toEqual(identity);
    expect(values.get("gmail:pending-history-id")).toBe("200");
    expect(await storage.getAlarm()).not.toBeNull();

    ownershipAvailable = true;
    await storage.deleteAlarm();
    const firstAlarmStorage = fakeStorage(values).storage;
    await expect(runGmailAlarmReliably(firstAlarmStorage, environment(), fetcher)).resolves.toBe(
      true,
    );
    expect(values.get(`gmail:disconnect-intent:${userId}`)).toEqual(identity);
    expect(values.get("gmail:disconnect-work")).toMatchObject({ phase: "stop" });
    expect(values.get("gmail:pending-history-id")).toBe("200");
    expect(values.get("gmail:alarm-retry")).toMatchObject({ attempts: 1 });
    const retry = values.get("gmail:alarm-retry") as GmailAlarmRetryFixture;
    expect(await firstAlarmStorage.getAlarm()).not.toBeNull();

    disconnectProviderAvailable = true;
    vi.setSystemTime(retry.nextAttemptAt);
    await expect(
      runGmailAlarmReliably(fakeStorage(values).storage, environment(), fetcher),
    ).resolves.toBe(true);
    expect(values.has(`gmail:disconnect-intent:${userId}`)).toBe(false);
    expect(values.get("gmail:disconnect-work")).toMatchObject({ phase: "done" });
    expect(values.has("gmail:pending-history-id")).toBe(false);
    expect(providerEffects).toBe(2);
    expect(
      fetcher.mock.calls.some(([input]) => {
        const path = requestPath(input);
        return path.endsWith("/history") || path.endsWith("/watch") || path.includes("/messages/");
      }),
    ).toBe(false);
  });

  it("retains accepted disconnect after provider timeout and completes from alarm", async () => {
    const row = await encryptedCredential();
    const { storage, values } = fakeStorage();
    let providerAvailable = false;
    let providerSignal: AbortSignal | undefined;
    let stopCalls = 0;
    let revokeCalls = 0;
    let disconnectCalls = 0;
    const fetcher = vi.fn((input: string, init?: RequestInit) => {
      const path = requestPath(input);
      if (path.endsWith("/gmail_connection_ownership_v1")) {
        return Promise.resolve(Response.json("active"));
      }
      if (path.endsWith("/load_gmail_connection_v1")) return Promise.resolve(Response.json([row]));
      if (path.endsWith("/token")) {
        if (providerAvailable) return Promise.resolve(Response.json({ access_token: "access" }));
        providerSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      }
      if (path.endsWith("/stop")) {
        stopCalls += 1;
        return Promise.resolve(Response.json({}));
      }
      if (path.endsWith("/revoke")) {
        revokeCalls += 1;
        return Promise.resolve(Response.json({}));
      }
      if (path.endsWith("/disconnect_gmail_connection_v1")) {
        disconnectCalls += 1;
        return Promise.resolve(Response.json(true));
      }
      throw new Error("unexpected synthetic request");
    });

    const response = coordinateGmailDisconnect(storage, environment(), identity, fetcher);
    await vi.waitFor(() => expect(providerSignal).toBeDefined());
    expect(values.get("gmail:disconnect-work")).toMatchObject({ phase: "stop" });
    expect(await storage.getAlarm()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(GMAIL_EXTERNAL_OPERATION_TIMEOUT_MS);
    await expect(response).resolves.toMatchObject({ status: 503 });
    expect(providerSignal?.aborted).toBe(true);
    expect(values.get(`gmail:disconnect-intent:${userId}`)).toEqual(identity);
    expect(await storage.getAlarm()).not.toBeNull();

    providerAvailable = true;
    await storage.deleteAlarm();
    await expect(
      runGmailAlarmReliably(fakeStorage(values).storage, environment(), fetcher),
    ).resolves.toBe(true);

    expect(values.get("gmail:disconnect-work")).toMatchObject({ phase: "done" });
    expect(values.has(`gmail:disconnect-intent:${userId}`)).toBe(false);
    expect(stopCalls).toBe(1);
    expect(revokeCalls).toBe(1);
    expect(disconnectCalls).toBe(1);
  });

  it("retains delete phase after database completion timeout and retries without provider effects", async () => {
    const row = await encryptedCredential();
    const { storage, values } = fakeStorage();
    let databaseAvailable = false;
    let databaseSignal: AbortSignal | undefined;
    let stopCalls = 0;
    let revokeCalls = 0;
    const disconnectBodies: Record<string, unknown>[] = [];
    const fetcher = vi.fn((input: string, init?: RequestInit) => {
      const path = requestPath(input);
      if (path.endsWith("/gmail_connection_ownership_v1")) {
        return Promise.resolve(Response.json("active"));
      }
      if (path.endsWith("/load_gmail_connection_v1")) return Promise.resolve(Response.json([row]));
      if (path.endsWith("/token"))
        return Promise.resolve(Response.json({ access_token: "access" }));
      if (path.endsWith("/stop")) {
        stopCalls += 1;
        return Promise.resolve(Response.json({}));
      }
      if (path.endsWith("/revoke")) {
        revokeCalls += 1;
        return Promise.resolve(Response.json({}));
      }
      if (path.endsWith("/disconnect_gmail_connection_v1")) {
        disconnectBodies.push(requestBody(init));
        if (databaseAvailable) return Promise.resolve(Response.json(true));
        databaseSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      }
      throw new Error("unexpected synthetic request");
    });

    const response = coordinateGmailDisconnect(storage, environment(), identity, fetcher);
    await vi.waitFor(() => expect(databaseSignal).toBeDefined());
    expect(values.get("gmail:disconnect-work")).toMatchObject({ phase: "delete" });
    expect(await storage.getAlarm()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(GMAIL_EXTERNAL_OPERATION_TIMEOUT_MS);
    await expect(response).resolves.toMatchObject({ status: 503 });
    expect(databaseSignal?.aborted).toBe(true);
    expect(values.get(`gmail:disconnect-intent:${userId}`)).toEqual(identity);

    databaseAvailable = true;
    await storage.deleteAlarm();
    await expect(
      runGmailAlarmReliably(fakeStorage(values).storage, environment(), fetcher),
    ).resolves.toBe(true);

    expect(values.get("gmail:disconnect-work")).toMatchObject({ phase: "done" });
    expect(values.has(`gmail:disconnect-intent:${userId}`)).toBe(false);
    expect(stopCalls).toBe(1);
    expect(revokeCalls).toBe(1);
    expect(disconnectBodies).toHaveLength(2);
    expect(disconnectBodies[0]).toEqual(disconnectBodies[1]);
  });

  it("returns same success from completed receipt without requiring deleted active credential", async () => {
    const { storage, values } = fakeStorage();
    const fetcher = vi.fn((input: string) => {
      expect(requestPath(input)).toBe("/rest/v1/rpc/gmail_connection_ownership_v1");
      return Promise.resolve(Response.json("completed"));
    });

    const response = await coordinateGmailDisconnect(storage, environment(), identity, fetcher);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ disconnected: true });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(values.size).toBe(0);
  });

  it("does not leak cross-user or random absent connection IDs", async () => {
    const fetcher = vi.fn(() => Promise.resolve(Response.json("absent")));
    for (const candidate of [
      { ...identity, userId: "42ad95f2-20b0-4b23-83af-ebcb560219df" },
      { ...identity, connectionId: "06f96f7d-3e1a-4a66-b98e-58be9766b96e" },
    ]) {
      const { storage, values } = fakeStorage();
      const response = await coordinateGmailDisconnect(storage, environment(), candidate, fetcher);
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ disconnected: false, reason: "not-found" });
      expect(values.size).toBe(0);
    }
  });

  it("retains encrypted credential and stop phase until Gmail delivery stop succeeds", async () => {
    const row = await encryptedCredential();
    const { storage, values } = fakeStorage();
    await acceptGmailDisconnect(storage, identity);
    let stopAttempts = 0;
    let disconnectCalls = 0;
    const paths: string[] = [];
    const fetcher = vi.fn((input: string) => {
      const path = requestPath(input);
      paths.push(path);
      if (path.endsWith("/load_gmail_connection_v1")) return Promise.resolve(Response.json([row]));
      if (path.endsWith("/token"))
        return Promise.resolve(Response.json({ access_token: "access" }));
      if (path.endsWith("/stop")) {
        stopAttempts += 1;
        return Promise.resolve(
          stopAttempts === 1 ? new Response(null, { status: 503 }) : Response.json({}),
        );
      }
      if (path.endsWith("/revoke")) return Promise.resolve(Response.json({}));
      if (path.endsWith("/disconnect_gmail_connection_v1")) {
        disconnectCalls += 1;
        return Promise.resolve(Response.json(true));
      }
      throw new Error("unexpected synthetic request");
    });

    await expect(runGmailDisconnect(storage, environment(), fetcher)).rejects.toThrow();
    expect(values.get("gmail:disconnect-work")).toMatchObject({ phase: "stop" });
    expect(disconnectCalls).toBe(0);

    await expect(
      runGmailDisconnect(fakeStorage(values).storage, environment(), fetcher),
    ).resolves.toBe("completed");
    expect(values.get("gmail:disconnect-work")).toMatchObject({ phase: "done" });
    expect(stopAttempts).toBe(2);
    expect(paths.indexOf("/gmail/v1/users/me/stop")).toBeLessThan(paths.indexOf("/revoke"));
    expect(disconnectCalls).toBe(1);
  });

  it("resumes durable delete phase after lost database response without repeating provider effects", async () => {
    const row = await encryptedCredential();
    const { storage, values } = fakeStorage();
    await acceptGmailDisconnect(storage, identity);
    let stopCalls = 0;
    let revokeCalls = 0;
    let disconnectCalls = 0;
    const disconnectBodies: Record<string, unknown>[] = [];
    const fetcher = vi.fn((input: string, init?: RequestInit) => {
      const path = requestPath(input);
      if (path.endsWith("/load_gmail_connection_v1")) return Promise.resolve(Response.json([row]));
      if (path.endsWith("/token"))
        return Promise.resolve(Response.json({ access_token: "access" }));
      if (path.endsWith("/stop")) {
        stopCalls += 1;
        return Promise.resolve(Response.json({}));
      }
      if (path.endsWith("/revoke")) {
        revokeCalls += 1;
        return Promise.resolve(Response.json({}));
      }
      if (path.endsWith("/disconnect_gmail_connection_v1")) {
        disconnectCalls += 1;
        disconnectBodies.push(requestBody(init));
        return disconnectCalls === 1
          ? Promise.reject(new Error("synthetic lost disconnect response"))
          : Promise.resolve(Response.json(true));
      }
      throw new Error("unexpected synthetic request");
    });

    await expect(runGmailDisconnect(storage, environment(), fetcher)).rejects.toThrow();
    expect(values.get("gmail:disconnect-work")).toMatchObject({ phase: "delete" });
    await expect(
      runGmailDisconnect(fakeStorage(values).storage, environment(), fetcher),
    ).resolves.toBe("completed");

    expect(stopCalls).toBe(1);
    expect(revokeCalls).toBe(1);
    expect(disconnectCalls).toBe(2);
    expect(disconnectBodies[0]).toEqual(disconnectBodies[1]);
    expect(disconnectBodies[0]).toMatchObject({ p_reason: "user-disconnect" });
    expect(disconnectBodies[0]?.p_action_id).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("completes disconnect with accurate evidence when token refresh reports invalid_grant", async () => {
    const row = await encryptedCredential();
    const { storage, values } = fakeStorage();
    await acceptGmailDisconnect(storage, identity);
    const disconnectBodies: Record<string, unknown>[] = [];
    const fetcher = vi.fn((input: string, init?: RequestInit) => {
      const path = requestPath(input);
      if (path.endsWith("/load_gmail_connection_v1")) return Promise.resolve(Response.json([row]));
      if (path.endsWith("/token")) {
        return Promise.resolve(Response.json({ error: "invalid_grant" }, { status: 400 }));
      }
      if (path.endsWith("/disconnect_gmail_connection_v1")) {
        disconnectBodies.push(requestBody(init));
        return Promise.resolve(Response.json(true));
      }
      throw new Error("unexpected synthetic request");
    });

    await expect(runGmailDisconnect(storage, environment(), fetcher)).resolves.toBe("completed");

    expect(values.get("gmail:disconnect-work")).toMatchObject({
      phase: "done",
      providerAlreadyRevoked: true,
      tokenRevoked: true,
      watchStopped: false,
    });
    expect(disconnectBodies).toEqual([
      expect.objectContaining({
        p_provider_already_revoked: true,
        p_pubsub_retention_seconds: 604_800,
        p_token_revoked: true,
        p_watch_stopped: false,
      }),
    ]);
    expect(fetcher.mock.calls.some(([input]) => requestPath(input).endsWith("/stop"))).toBe(false);
    expect(fetcher.mock.calls.some(([input]) => requestPath(input).endsWith("/revoke"))).toBe(
      false,
    );
  });
});

function gmailMessage(messageId = "message-1") {
  const body = btoa("Synthetic bounded message").replace(/\+/g, "-").replace(/\//g, "_");
  return {
    id: messageId,
    threadId: "thread-1",
    internalDate: Date.parse("2026-08-29T09:00:00Z").toString(),
    labelIds: ["INBOX"],
    payload: {
      mimeType: "text/plain",
      filename: "",
      headers: [
        { name: "From", value: "Synthetic Sender <sender@example.test>" },
        { name: "Subject", value: "Synthetic subject" },
      ],
      body: { data: body, size: 25 },
    },
  };
}
