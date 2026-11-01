import { decryptValue, encryptValue, generateKek, parseKekKeyring } from "@relay/crypto";
import { AppError } from "@relay/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data?: unknown; error: unknown };
type Call = { method: string; args: unknown[] };
type Operation = { calls: Call[]; table: string };

const fake = vi.hoisted(() => ({
  operations: [] as Operation[],
  results: new Map<string, Result[]>(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from(table: string) {
      const operation: Operation = { calls: [], table };
      fake.operations.push(operation);
      const settle = () => Promise.resolve(fake.results.get(table)?.shift() ?? { error: null });
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "insert", "update", "eq"]) {
        builder[method] = (...args: unknown[]) => {
          operation.calls.push({ method, args });
          return builder;
        };
      }
      builder.maybeSingle = () => settle();
      builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
        settle().then(resolve, reject);
      return builder;
    },
  }),
}));

const {
  createWebhookConnection,
  rotateWebhookConnection,
  WebhookConnectionNotFoundError,
  WebhookDestinationInvalidError,
  WebhookRotationConflictError,
} = await import("./webhook-connections");

const userId = "638ce145-a77d-4c32-b798-cb398e881fc9";
const connectionId = "19784902-e7a4-4f7f-b04d-e3a78c876629";
const kekKeyring = JSON.stringify({ activeVersion: 1, keys: { 1: generateKek() } });
const env = {
  kekKeyring,
  relayEnvironment: "development",
  supabaseServiceRoleKey: "synthetic-service-key",
  supabaseUrl: "https://relay.example.test",
};
const now = new Date("2026-10-31T12:00:00.000Z");
const oldSecret = "c".repeat(64);
const olderSecret = "d".repeat(64);

function context(id: string): string {
  return `connection:${userId}:${id}:credential`;
}

function toBytea(base64: string): string {
  return `\\x${Buffer.from(base64, "base64").toString("hex")}`;
}

function fromBytea(value: unknown): string {
  return Buffer.from(String(value).slice(2), "hex").toString("base64");
}

async function decryptColumns(columns: Record<string, unknown>, id: string): Promise<unknown> {
  const plaintext = await decryptValue(
    {
      algorithm: "AES-GCM-256",
      ciphertext: fromBytea(columns.credential_ciphertext),
      keyVersion: columns.key_version as number,
      nonce: fromBytea(columns.credential_nonce),
      wrapNonce: fromBytea(columns.wrap_nonce),
      wrappedKey: fromBytea(columns.wrapped_data_key),
    },
    parseKekKeyring(kekKeyring),
    context(id),
  );
  return JSON.parse(plaintext);
}

async function storedRow(credential: Record<string, unknown>, metadata?: Record<string, unknown>) {
  const encrypted = await encryptValue(
    JSON.stringify(credential),
    parseKekKeyring(kekKeyring),
    context(connectionId),
  );
  return {
    credential_ciphertext: toBytea(encrypted.ciphertext),
    credential_nonce: toBytea(encrypted.nonce),
    encryption_environment: "development",
    id: connectionId,
    key_version: encrypted.keyVersion,
    metadata: metadata ?? { host: "hooks.example.com", signatureVersion: "v1" },
    wrap_nonce: toBytea(encrypted.wrapNonce),
    wrapped_data_key: toBytea(encrypted.wrappedKey),
  };
}

function argument(table: string, method: string, index = 0): Record<string, unknown> {
  const operation = fake.operations.filter((entry) => entry.table === table)[index];
  const call = operation?.calls.find((entry) => entry.method === method);
  if (call === undefined) throw new Error(`no ${method} on ${table}`);
  return call.args[0] as Record<string, unknown>;
}

beforeEach(() => {
  fake.operations.length = 0;
  fake.results.clear();
});

describe("createWebhookConnection", () => {
  it("encrypts the URL with the secret and keeps only the host in plain metadata", async () => {
    const url = "https://hooks.example.com/t/receiver-token?key=abc";
    const created = await createWebhookConnection(userId, url, env);

    expect(created.secret).toMatch(/^[0-9a-f]{64}$/u);
    expect(created.host).toBe("hooks.example.com");
    expect(created.previousSecretExpiresAt).toBeNull();

    const row = argument("connections", "insert");
    expect(row.id).toBe(created.connectionId);
    expect(row.external_account_id).toBe(created.connectionId);
    expect(row.provider).toBe("webhook");
    expect(row.metadata).toEqual({ host: "hooks.example.com", signatureVersion: "v1" });
    expect(JSON.stringify(row)).not.toContain("receiver-token");
    expect(JSON.stringify(row)).not.toContain(created.secret);
    await expect(decryptColumns(row, created.connectionId)).resolves.toEqual({
      secret: created.secret,
      url,
    });

    expect(argument("audit_log", "insert")).toMatchObject({
      action: "connector.configured",
      metadata: { provider: "webhook" },
      target_id: created.connectionId,
    });
  });

  it("gives every connection its own secret", async () => {
    const first = await createWebhookConnection(userId, "https://a.example.com/", env);
    const second = await createWebhookConnection(userId, "https://a.example.com/", env);
    expect(first.secret).not.toBe(second.secret);
    expect(first.connectionId).not.toBe(second.connectionId);
  });

  it.each(["http://hooks.example.com/", "https://10.0.0.5/", "https://user:pw@hooks.example.com/"])(
    "refuses %s before storing anything",
    async (url) => {
      await expect(createWebhookConnection(userId, url, env)).rejects.toBeInstanceOf(
        WebhookDestinationInvalidError,
      );
      expect(fake.operations).toHaveLength(0);
    },
  );

  it("reports a failed insert as a database error and writes no audit row", async () => {
    fake.results.set("connections", [{ error: { code: "XX000", message: "synthetic" } }]);
    const error = await createWebhookConnection(userId, "https://a.example.com/", env).catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("WEBHOOK_CONNECTION_STORE_FAILED");
    expect(fake.operations.some((entry) => entry.table === "audit_log")).toBe(false);
  });
});

describe("rotateWebhookConnection", () => {
  it("keeps the old secret signing for the overlap window and keeps the URL", async () => {
    const row = await storedRow({ secret: oldSecret, url: "https://hooks.example.com/t/x" });
    fake.results.set("connections", [
      { data: row, error: null },
      { data: [{ id: connectionId }], error: null },
    ]);

    const rotated = await rotateWebhookConnection(userId, connectionId, env, now);

    expect(rotated.secret).toMatch(/^[0-9a-f]{64}$/u);
    expect(rotated.secret).not.toBe(oldSecret);
    expect(rotated.previousSecretExpiresAt).toBe("2026-11-01T12:00:00.000Z");

    const update = argument("connections", "update", 1);
    expect(update.metadata).toEqual({
      host: "hooks.example.com",
      previousSecretExpiresAt: "2026-11-01T12:00:00.000Z",
      signatureVersion: "v1",
    });
    await expect(decryptColumns(update, connectionId)).resolves.toEqual({
      previousSecret: oldSecret,
      secret: rotated.secret,
      url: "https://hooks.example.com/t/x",
    });
    expect(argument("audit_log", "insert")).toMatchObject({ action: "connector.rotated" });
  });

  it("writes only if the credential is still the one it read", async () => {
    const row = await storedRow({ secret: oldSecret, url: "https://hooks.example.com/" });
    fake.results.set("connections", [
      { data: row, error: null },
      { data: [{ id: connectionId }], error: null },
    ]);
    await rotateWebhookConnection(userId, connectionId, env, now);

    const filters = fake.operations
      .filter((entry) => entry.table === "connections")[1]
      ?.calls.filter((call) => call.method === "eq")
      .map((call) => call.args);
    expect(filters).toContainEqual(["credential_nonce", row.credential_nonce]);
    expect(filters).toContainEqual(["user_id", userId]);
  });

  it("drops the oldest secret when rotating again inside the window", async () => {
    const row = await storedRow(
      { previousSecret: olderSecret, secret: oldSecret, url: "https://hooks.example.com/" },
      {
        host: "hooks.example.com",
        previousSecretExpiresAt: "2026-10-31T20:00:00.000Z",
        signatureVersion: "v1",
      },
    );
    fake.results.set("connections", [
      { data: row, error: null },
      { data: [{ id: connectionId }], error: null },
    ]);
    const rotated = await rotateWebhookConnection(userId, connectionId, env, now);
    const stored = await decryptColumns(argument("connections", "update", 1), connectionId);
    expect(stored).toEqual({
      previousSecret: oldSecret,
      secret: rotated.secret,
      url: "https://hooks.example.com/",
    });
    expect(JSON.stringify(stored)).not.toContain(olderSecret);
  });

  it("reports a lost race as a conflict and writes no audit row", async () => {
    const row = await storedRow({ secret: oldSecret, url: "https://hooks.example.com/" });
    fake.results.set("connections", [
      { data: row, error: null },
      { data: [], error: null },
    ]);
    await expect(rotateWebhookConnection(userId, connectionId, env, now)).rejects.toBeInstanceOf(
      WebhookRotationConflictError,
    );
    expect(fake.operations.some((entry) => entry.table === "audit_log")).toBe(false);
  });

  it("reports a connection this tenant does not have as not found", async () => {
    fake.results.set("connections", [{ data: null, error: null }]);
    await expect(rotateWebhookConnection(userId, connectionId, env, now)).rejects.toBeInstanceOf(
      WebhookConnectionNotFoundError,
    );
    const filters = fake.operations[0]?.calls
      .filter((call) => call.method === "eq")
      .map((call) => call.args);
    expect(filters).toContainEqual(["user_id", userId]);
    expect(filters).toContainEqual(["provider", "webhook"]);
    expect(filters).toContainEqual(["status", "active"]);
  });

  it("refuses a credential written for another environment without decrypting it", async () => {
    const row = await storedRow({ secret: oldSecret, url: "https://hooks.example.com/" });
    fake.results.set("connections", [
      { data: { ...row, encryption_environment: "production" }, error: null },
    ]);
    const error = await rotateWebhookConnection(userId, connectionId, env, now).catch(
      (reason: unknown) => reason,
    );
    expect((error as AppError).code).toBe("WEBHOOK_CREDENTIAL_UNREADABLE");
    expect(fake.operations.filter((entry) => entry.table === "connections")).toHaveLength(1);
  });
});
