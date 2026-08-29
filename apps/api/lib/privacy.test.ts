import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const crypto = vi.hoisted(() => ({
  decryptValue: vi.fn(),
  parseKekKeyring: vi.fn(),
}));
const googleTasks = vi.hoisted(() => ({ revokeGoogleToken: vi.fn() }));
const pipeline = vi.hoisted(() => ({ publishGmailDisconnect: vi.fn() }));
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock("@relay/crypto", () => crypto);
vi.mock("@supabase/supabase-js", () => ({ createClient: supabase.createClient }));
vi.mock("./google-tasks", () => googleTasks);
vi.mock("./pipeline", () => pipeline);

import {
  ACCOUNT_DELETION_GMAIL_DISCONNECT_TIMEOUT_MS,
  deleteAccount,
  type PrivacyEnv,
} from "./privacy";

type ChainResult = { data: unknown; error: unknown };
type Builder = {
  eq: ReturnType<typeof vi.fn>;
  like: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  then: Promise<ChainResult>["then"];
};

function chainable(result: ChainResult): Builder {
  const builder = {} as Builder;
  const self = () => builder;
  builder.eq = vi.fn(self);
  builder.like = vi.fn(self);
  builder.select = vi.fn(self);
  builder.then = (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected);
  return builder;
}

const userId = "638ce145-a77d-4c32-b798-cb398e881fc9";
const gmailConnectionId = "19784902-e7a4-4f7f-b04d-e3a78c876629";
const tasksConnectionId = "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8";
const env: PrivacyEnv = {
  kekKeyring: '{"activeVersion":1,"keys":{"1":"synthetic"}}',
  supabaseServiceRoleKey: "sb_secret_synthetic_backend_key_12345",
  supabaseUrl: "https://supabase.example.test",
};
const completedDeletion = {
  attempt_count: 1,
  completed_at: "2026-08-29T10:00:00.000Z",
  connectors_revoked_at: "2026-08-29T09:59:00.000Z",
  requested_at: "2026-08-29T09:58:00.000Z",
  state: "completed",
};
const encryptedTasksCredential = {
  credential_ciphertext: "\\x11111111111111111111111111111111",
  credential_nonce: "\\x121212121212121212121212",
  id: tasksConnectionId,
  key_version: 1,
  provider: "google-tasks",
  wrap_nonce: "\\x141414141414141414141414",
  wrapped_data_key: `\\x${"13".repeat(48)}`,
};

function installClient(builders: Builder[], authErrors: unknown[] = [null]) {
  const from = vi.fn();
  for (const builder of builders) from.mockReturnValueOnce(builder);
  const rpc = vi.fn((name: string) =>
    Promise.resolve(
      name === "finalize_account_deletion"
        ? { data: completedDeletion, error: null }
        : { data: null, error: null },
    ),
  );
  const deleteUser = vi.fn(() =>
    Promise.resolve({ error: authErrors.length === 0 ? null : authErrors.shift() }),
  );
  supabase.createClient.mockReturnValue({ auth: { admin: { deleteUser } }, from, rpc });
  return { deleteUser, from, rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
  crypto.parseKekKeyring.mockReturnValue({ activeVersion: 1, keys: { 1: "synthetic" } });
  crypto.decryptValue.mockResolvedValue("synthetic-tasks-refresh-token");
  googleTasks.revokeGoogleToken.mockResolvedValue(true);
  pipeline.publishGmailDisconnect.mockResolvedValue(Response.json({ disconnected: true }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("account deletion provider cleanup", () => {
  it("delegates active Gmail to Pipeline while preserving Google Tasks and OpenAI behavior", async () => {
    const connectionMetadata = chainable({
      data: [
        { id: gmailConnectionId, provider: "gmail", status: "active" },
        { id: tasksConnectionId, provider: "google-tasks", status: "active" },
        {
          id: "06f96f7d-3e1a-4a66-b98e-58be9766b96e",
          provider: "openai",
          status: "active",
        },
      ],
      error: null,
    });
    const googleCredentials = chainable({ data: [encryptedTasksCredential], error: null });
    const { rpc } = installClient([connectionMetadata, googleCredentials]);

    const result = await deleteAccount(userId, env);

    expect(result).toMatchObject({ failedRevocations: 0, revokedCredentials: 2 });
    expect(connectionMetadata.select).toHaveBeenCalledWith("id, provider, status");
    expect(googleCredentials.like).toHaveBeenCalledWith("provider", "google%");
    expect(pipeline.publishGmailDisconnect).toHaveBeenCalledOnce();
    const [request, signal] = pipeline.publishGmailDisconnect.mock.calls[0] as [
      Record<string, unknown>,
      AbortSignal,
    ];
    expect(request).toEqual({ schemaVersion: 1, connectionId: gmailConnectionId, userId });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(request)).not.toContain("credential");
    expect(JSON.stringify(request)).not.toContain("refresh-token");
    expect(crypto.decryptValue).toHaveBeenCalledOnce();
    expect(crypto.decryptValue.mock.calls[0]?.[2]).toBe(
      `connection:${userId}:${tasksConnectionId}:credential`,
    );
    expect(googleTasks.revokeGoogleToken).toHaveBeenCalledWith("synthetic-tasks-refresh-token");
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "request_account_deletion",
      "mark_account_connectors_revoked",
      "finalize_account_deletion",
    ]);
  });

  it("bounds failed Gmail delivery and continues irreversible local finalization", async () => {
    vi.useFakeTimers();
    const connectionMetadata = chainable({
      data: [{ id: gmailConnectionId, provider: "gmail", status: "active" }],
      error: null,
    });
    const googleCredentials = chainable({ data: [], error: null });
    const { deleteUser, rpc } = installClient([connectionMetadata, googleCredentials]);
    let boundSignal: AbortSignal | undefined;
    pipeline.publishGmailDisconnect.mockImplementation(
      (_request: unknown, signal: AbortSignal) =>
        new Promise<Response>((_resolve, reject) => {
          boundSignal = signal;
          signal.addEventListener("abort", () => reject(new Error("synthetic timeout")), {
            once: true,
          });
        }),
    );

    const deletion = deleteAccount(userId, env);
    await vi.waitFor(() => expect(boundSignal).toBeDefined());
    await vi.advanceTimersByTimeAsync(ACCOUNT_DELETION_GMAIL_DISCONNECT_TIMEOUT_MS);
    const result = await deletion;

    expect(boundSignal?.aborted).toBe(true);
    expect(result).toMatchObject({ failedRevocations: 1, revokedCredentials: 0 });
    expect(crypto.decryptValue).not.toHaveBeenCalled();
    expect(googleTasks.revokeGoogleToken).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("finalize_account_deletion", { p_user_id: userId });
    expect(deleteUser).toHaveBeenCalledWith(userId);
    expect(rpc.mock.invocationCallOrder.at(-1)).toBeGreaterThan(
      pipeline.publishGmailDisconnect.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("uses one bounded deadline across concurrent Gmail disconnects before local finalization", async () => {
    vi.useFakeTimers();
    const gmailConnectionIds = [
      "19784902-e7a4-4f7f-b04d-e3a78c876629",
      "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
      "06f96f7d-3e1a-4a66-b98e-58be9766b96e",
      "42ad95f2-20b0-4b23-83af-ebcb560219df",
      "1c05d9f8-752b-4c5d-8712-436c67b28cdd",
      "54ade2a4-fde1-4ee1-89a5-382f2fa5dcbb",
    ];
    const connectionMetadata = chainable({
      data: gmailConnectionIds.map((id) => ({ id, provider: "gmail", status: "active" })),
      error: null,
    });
    const googleCredentials = chainable({ data: [], error: null });
    const { deleteUser, rpc } = installClient([connectionMetadata, googleCredentials]);
    const signals: AbortSignal[] = [];
    let active = 0;
    let maxActive = 0;
    pipeline.publishGmailDisconnect.mockImplementation(
      (request: { connectionId: string }, signal: AbortSignal) => {
        signals.push(signal);
        active += 1;
        maxActive = Math.max(maxActive, active);
        const index = gmailConnectionIds.indexOf(request.connectionId);
        if (index < 2) {
          return Promise.resolve(Response.json({ disconnected: true })).finally(() => {
            active -= 1;
          });
        }
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              active -= 1;
              reject(new Error("synthetic shared deadline"));
            },
            { once: true },
          );
        });
      },
    );

    const deletion = deleteAccount(userId, env);
    await vi.waitFor(() => expect(pipeline.publishGmailDisconnect).toHaveBeenCalledTimes(6));
    expect(maxActive).toBe(4);
    expect(active).toBe(4);
    expect(new Set(signals).size).toBe(1);
    expect(deleteUser).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(ACCOUNT_DELETION_GMAIL_DISCONNECT_TIMEOUT_MS);
    const result = await deletion;

    expect(active).toBe(0);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(result).toMatchObject({ failedRevocations: 4, revokedCredentials: 2 });
    expect(connectionMetadata.select).toHaveBeenCalledWith("id, provider, status");
    expect(crypto.decryptValue).not.toHaveBeenCalled();
    expect(googleTasks.revokeGoogleToken).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("finalize_account_deletion", { p_user_id: userId });
    expect(deleteUser).toHaveBeenCalledWith(userId);
  });

  it("retries completed local deletion without revoking Gmail twice", async () => {
    const firstMetadata = chainable({
      data: [{ id: gmailConnectionId, provider: "gmail", status: "active" }],
      error: null,
    });
    const firstGoogleCredentials = chainable({ data: [], error: null });
    const retryMetadata = chainable({ data: [], error: null });
    const retryGoogleCredentials = chainable({ data: [], error: null });
    const authFailure = { message: "synthetic auth deletion outage" };
    const { rpc } = installClient(
      [firstMetadata, firstGoogleCredentials, retryMetadata, retryGoogleCredentials],
      [authFailure, null],
    );

    await expect(deleteAccount(userId, env)).rejects.toThrow(
      "Account identity could not be removed",
    );
    await expect(deleteAccount(userId, env)).resolves.toMatchObject({
      failedRevocations: 0,
      revokedCredentials: 0,
      status: { state: "completed" },
    });

    expect(pipeline.publishGmailDisconnect).toHaveBeenCalledOnce();
    expect(rpc.mock.calls.filter(([name]) => name === "finalize_account_deletion")).toHaveLength(2);
  });
});
