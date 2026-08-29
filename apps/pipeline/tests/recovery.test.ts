import { describe, expect, it, vi } from "vitest";

import type { Env, IngressQueueMessage } from "../src/env";
import {
  completeDeadLetterReplay,
  listDeadLetterItems,
  recordDeadLetterItem,
  replayDeadLetterItem,
} from "../src/recovery";

const message: IngressQueueMessage = {
  schemaVersion: 1,
  userId: "638ce145-a77d-4c32-b798-cb398e881fc9",
  envelopeId: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
  recoveryId: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
  acceptedAt: "2026-08-24T10:00:00.000Z",
  rawExpiresAt: "2026-08-31T10:00:00.000Z",
  encryptionEnvironment: "production",
  encrypted: {
    algorithm: "AES-GCM-256",
    ciphertext: "AAAAAAAAAAAAAAAAAAAAAA==",
    keyVersion: 1,
    nonce: "AAAAAAAAAAAAAAAA",
    wrappedKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    wrapNonce: "AAAAAAAAAAAAAAAA",
  },
};

function environment(send = vi.fn(() => Promise.resolve())): Env {
  return {
    INGRESS_QUEUE: { send } as unknown as Queue<IngressQueueMessage>,
    RELAY_CREDENTIAL_KEK_KEYRING: JSON.stringify({
      activeVersion: 1,
      keys: { 1: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" },
    }),
    RELAY_ENVIRONMENT: "production",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_synthetic_backend_key_12345",
    SUPABASE_URL: "https://supabase.example.test",
  } as unknown as Env;
}

function claimedRow() {
  return {
    id: message.recoveryId,
    user_id: message.userId,
    envelope_id: message.envelopeId,
    encryption_aad_user_id: null,
    encryption_aad_envelope_id: null,
    accepted_at: message.acceptedAt,
    raw_expires_at: message.rawExpiresAt,
    encryption_environment: message.encryptionEnvironment,
    ciphertext: `\\x${"00".repeat(16)}`,
    nonce: `\\x${"00".repeat(12)}`,
    wrapped_data_key: `\\x${"00".repeat(48)}`,
    wrap_nonce: `\\x${"00".repeat(12)}`,
    key_version: 1,
  };
}

function requestBody(init?: RequestInit): Record<string, unknown> {
  if (typeof init?.body !== "string") throw new Error("Synthetic request body is missing");
  return JSON.parse(init.body) as Record<string, unknown>;
}

describe("dead-letter recovery", () => {
  it("persists only encrypted fields and stable failure metadata", async () => {
    let body: Record<string, unknown> | undefined;
    const fetcher = vi.fn((_input: string, init?: RequestInit) => {
      body = requestBody(init);
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      return Promise.resolve(Response.json(true));
    });

    await recordDeadLetterItem(environment(), message, "retry_exhausted_unknown", fetcher);

    expect(body).toMatchObject({
      p_encryption_aad_envelope_id: message.envelopeId,
      p_encryption_aad_user_id: message.userId,
      p_envelope_id: message.envelopeId,
      p_failure_code: "retry_exhausted_unknown",
      p_id: message.recoveryId,
      p_user_id: message.userId,
    });
    expect(Object.keys(body ?? {})).not.toContain("envelope");
    expect(JSON.stringify(body)).not.toContain("rawPayload");
  });

  it("records and replays uppercase AAD IDs with exact ciphertext", async () => {
    const uppercaseMessage = {
      ...message,
      userId: message.userId.toUpperCase(),
      envelopeId: message.envelopeId.toUpperCase(),
    };
    let recorded: Record<string, unknown> | undefined;
    const recordFetcher = vi.fn((_input: string, init?: RequestInit) => {
      recorded = requestBody(init);
      return Promise.resolve(Response.json(true));
    });

    await recordDeadLetterItem(
      environment(),
      uppercaseMessage,
      "retry_exhausted_unknown",
      recordFetcher,
    );

    expect(recorded).toMatchObject({
      p_encryption_aad_envelope_id: uppercaseMessage.envelopeId,
      p_encryption_aad_user_id: uppercaseMessage.userId,
      p_ciphertext: `\\x${"00".repeat(16)}`,
    });
    const send = vi.fn(() => Promise.resolve());
    const claimFetcher = vi.fn(() =>
      Promise.resolve(
        Response.json([
          {
            ...claimedRow(),
            encryption_aad_user_id: uppercaseMessage.userId,
            encryption_aad_envelope_id: uppercaseMessage.envelopeId,
          },
        ]),
      ),
    );
    const requestId = "06f96f7d-3e1a-4a66-b98e-58be9766b96e";

    await expect(
      replayDeadLetterItem(environment(send), message.recoveryId, requestId, claimFetcher),
    ).resolves.toBe(true);
    expect(send).toHaveBeenCalledWith({
      ...uppercaseMessage,
      replayRequestId: requestId,
    });
  });

  it("maps metadata-only operator inventory", async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        Response.json([
          {
            id: message.recoveryId,
            envelope_id: message.envelopeId,
            failure_code: "retry_exhausted_unknown",
            status: "available",
            accepted_at: message.acceptedAt,
            raw_expires_at: message.rawExpiresAt,
            key_version: 1,
            replay_count: 0,
            first_failed_at: "2026-08-25T10:00:00.000Z",
            last_failed_at: "2026-08-25T10:00:00.000Z",
            last_replayed_at: null,
            completed_at: null,
          },
        ]),
      ),
    );

    await expect(listDeadLetterItems(environment(), 100, fetcher)).resolves.toEqual([
      {
        id: message.recoveryId,
        envelopeId: message.envelopeId,
        failureCode: "retry_exhausted_unknown",
        status: "available",
        acceptedAt: message.acceptedAt,
        rawExpiresAt: message.rawExpiresAt,
        keyVersion: 1,
        replayCount: 0,
        firstFailedAt: "2026-08-25T10:00:00.000Z",
        lastFailedAt: "2026-08-25T10:00:00.000Z",
        lastReplayedAt: null,
        completedAt: null,
      },
    ]);
  });

  it("publishes exact claimed ciphertext with stable replay identity", async () => {
    const send = vi.fn(() => Promise.resolve());
    const requestId = "06f96f7d-3e1a-4a66-b98e-58be9766b96e";
    const fetcher = vi.fn(() => Promise.resolve(Response.json([claimedRow()])));

    await expect(
      replayDeadLetterItem(environment(send), message.recoveryId, requestId, fetcher),
    ).resolves.toBe(true);

    expect(send).toHaveBeenCalledWith({ ...message, replayRequestId: requestId });
  });

  it("retains request claim after ambiguous Queue publication failure", async () => {
    const send = vi.fn(() => Promise.reject(new Error("synthetic Queue failure")));
    const requestId = "06f96f7d-3e1a-4a66-b98e-58be9766b96e";
    const rpcs: string[] = [];
    const fetcher = vi.fn((input: string) => {
      const rpc = new URL(input).pathname.split("/").at(-1) ?? "";
      rpcs.push(rpc);
      return Promise.resolve(Response.json([claimedRow()]));
    });

    await expect(
      replayDeadLetterItem(environment(send), message.recoveryId, requestId, fetcher),
    ).rejects.toThrow("synthetic Queue failure");
    expect(rpcs).toEqual(["claim_dead_letter_replay"]);
  });

  it("releases claim after definite pre-publication size rejection", async () => {
    const requestId = "06f96f7d-3e1a-4a66-b98e-58be9766b96e";
    const rpcs: string[] = [];
    const fetcher = vi.fn((input: string) => {
      const rpc = new URL(input).pathname.split("/").at(-1) ?? "";
      rpcs.push(rpc);
      return Promise.resolve(
        Response.json(
          rpc === "claim_dead_letter_replay"
            ? [{ ...claimedRow(), ciphertext: `\\x${"00".repeat(89_700)}` }]
            : true,
        ),
      );
    });

    await expect(
      replayDeadLetterItem(environment(), message.recoveryId, requestId, fetcher),
    ).rejects.toThrow("exceeds Queue budget");
    expect(rpcs).toEqual(["claim_dead_letter_replay", "release_dead_letter_replay"]);
  });

  it("requires exact request identity to complete replay", async () => {
    const replayMessage = {
      ...message,
      replayRequestId: "06f96f7d-3e1a-4a66-b98e-58be9766b96e",
    };
    let body: Record<string, unknown> | undefined;
    const fetcher = vi.fn((_input: string, init?: RequestInit) => {
      body = requestBody(init);
      return Promise.resolve(Response.json(true));
    });

    await completeDeadLetterReplay(environment(), replayMessage, "duplicate", fetcher);
    expect(body).toEqual({
      p_id: message.recoveryId,
      p_request_id: replayMessage.replayRequestId,
      p_result: "duplicate",
    });
  });
});
