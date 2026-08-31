import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Env, IngressQueueMessage } from "../src/env";
import { completeDeadLetterReplay, recordDeadLetterItem } from "../src/recovery";
import {
  prepareIngressQueueMessage,
  processIngressQueue,
  publishIngressQueueMessage,
} from "../src/queue";

vi.mock("../src/recovery", () => ({
  completeDeadLetterReplay: vi.fn(() => Promise.resolve()),
  recordDeadLetterItem: vi.fn(() => Promise.resolve()),
}));

function queueMessage(envelopeId: string): IngressQueueMessage {
  return {
    schemaVersion: 1,
    userId: "638ce145-a77d-4c32-b798-cb398e881fc9",
    envelopeId,
    acceptedAt: "2026-08-24T10:00:00.000Z",
    rawExpiresAt: "2026-08-31T10:00:00.000Z",
    encryptionEnvironment: "production",
    recoveryId: envelopeId,
    encrypted: {
      algorithm: "AES-GCM-256",
      ciphertext: "AAAAAAAAAAAAAAAAAAAAAA==",
      keyVersion: 1,
      nonce: "AAAAAAAAAAAAAAAA",
      wrappedKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      wrapNonce: "AAAAAAAAAAAAAAAA",
    },
  };
}

function message(body: IngressQueueMessage, attempts = 1) {
  const ack = vi.fn();
  const retry = vi.fn();
  return {
    ack,
    retry,
    value: { attempts, body, ack, retry } as unknown as Message<IngressQueueMessage>,
  };
}

describe("processIngressQueue", () => {
  beforeEach(() => {
    // The fixture pins a real retention window -- accepted 24 August, raw payload expiring 31
    // August -- and `processIngressQueue` compares that expiry against the clock to decide whether
    // to park ciphertext or drop it. Read against the wall clock those dates stopped being a
    // retention window and became the past, so the suite silently started exercising the expired
    // branch while still asserting the unexpired one. Freezing the clock inside the window is what
    // makes the fixture deterministic; only `Date` is faked, so nothing else in the file changes.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-28T10:00:00.000Z"));
    vi.clearAllMocks();
    vi.mocked(completeDeadLetterReplay).mockResolvedValue();
    vi.mocked(recordDeadLetterItem).mockResolvedValue();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("routes uppercase Queue user IDs canonically without changing authenticated wire data", async () => {
    const uppercaseMessage = {
      ...queueMessage("5E106D7A-85AA-4A08-9A1F-CB13B42DF1F8"),
      userId: "638CE145-A77D-4C32-B798-CB398E881FC9",
    };
    const queued = message(uppercaseMessage);
    const fetch = vi.fn(() => Promise.resolve(Response.json({ reason: "persisted" })));
    const getByName = vi.fn(() => ({ fetch }));
    const env = { TENANT_COORDINATOR: { getByName } } as unknown as Env;

    await processIngressQueue(
      { messages: [queued.value] } as unknown as MessageBatch<IngressQueueMessage>,
      env,
    );

    expect(getByName).toHaveBeenCalledWith("638ce145-a77d-4c32-b798-cb398e881fc9");
    expect(fetch).toHaveBeenCalledWith("https://coordinator.internal/process", {
      method: "POST",
      body: JSON.stringify(uppercaseMessage),
    });
    expect(queued.ack).toHaveBeenCalledOnce();
  });

  it("acks e2e dead-letter messages only after durable metadata storage", async () => {
    const deadLetter = message(queueMessage("5e106d7a-85aa-4a08-9a1f-cb13b42df1f8"));
    const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    const env = {
      RELAY_DEAD_LETTER_QUEUE: "relay-ingress-dead-letter-e2e-local",
      RELAY_E2E_MODE: "true",
      TENANT_COORDINATOR: { getByName: vi.fn(() => ({ fetch })) },
    } as unknown as Env;

    await processIngressQueue(
      {
        messages: [deadLetter.value],
        queue: "relay-ingress-dead-letter-e2e-local",
      } as unknown as MessageBatch<IngressQueueMessage>,
      env,
    );

    expect(fetch).toHaveBeenCalledOnce();
    expect(recordDeadLetterItem).toHaveBeenCalledWith(
      env,
      deadLetter.value.body,
      "retry_exhausted_unknown",
    );
    expect(deadLetter.ack).toHaveBeenCalledOnce();
    expect(deadLetter.retry).not.toHaveBeenCalled();
  });

  it("completes a replay claim before acknowledging Queue delivery", async () => {
    const replay = message({
      ...queueMessage("5e106d7a-85aa-4a08-9a1f-cb13b42df1f8"),
      replayRequestId: "06f96f7d-3e1a-4a66-b98e-58be9766b96e",
    });
    const fetch = vi.fn(() => Promise.resolve(Response.json({ reason: "duplicate" })));
    const env = {
      TENANT_COORDINATOR: { getByName: vi.fn(() => ({ fetch })) },
    } as unknown as Env;

    await processIngressQueue(
      { messages: [replay.value] } as unknown as MessageBatch<IngressQueueMessage>,
      env,
    );

    expect(completeDeadLetterReplay).toHaveBeenCalledWith(env, replay.value.body, "duplicate");
    expect(replay.ack).toHaveBeenCalledOnce();
  });

  it("parks unexpired DLQ ciphertext when durable recovery storage is unavailable", async () => {
    vi.mocked(recordDeadLetterItem).mockRejectedValueOnce(new Error("synthetic Supabase outage"));
    const deadLetter = message(queueMessage("5e106d7a-85aa-4a08-9a1f-cb13b42df1f8"));
    const send = vi.fn(() => Promise.resolve());
    const env = {
      DEAD_LETTER_QUEUE: { send },
      RELAY_DEAD_LETTER_QUEUE: "relay-ingress-dead-letter-production",
    } as unknown as Env;

    await processIngressQueue(
      {
        messages: [deadLetter.value],
        queue: "relay-ingress-dead-letter-production",
      } as unknown as MessageBatch<IngressQueueMessage>,
      env,
    );

    expect(send).toHaveBeenCalledWith(deadLetter.value.body, { delaySeconds: 300 });
    expect(deadLetter.ack).toHaveBeenCalledOnce();
    expect(deadLetter.retry).not.toHaveBeenCalled();
  });

  it("uses delayed platform retry when DLQ parking publication also fails", async () => {
    vi.mocked(recordDeadLetterItem).mockRejectedValueOnce(new Error("synthetic Supabase outage"));
    const deadLetter = message(queueMessage("5e106d7a-85aa-4a08-9a1f-cb13b42df1f8"));
    const send = vi.fn(() => Promise.reject(new Error("synthetic Queue producer outage")));
    const env = {
      DEAD_LETTER_QUEUE: { send },
      RELAY_DEAD_LETTER_QUEUE: "relay-ingress-dead-letter-production",
    } as unknown as Env;

    await processIngressQueue(
      {
        messages: [deadLetter.value],
        queue: "relay-ingress-dead-letter-production",
      } as unknown as MessageBatch<IngressQueueMessage>,
      env,
    );

    expect(deadLetter.retry).toHaveBeenCalledWith({ delaySeconds: 600 });
    expect(deadLetter.ack).not.toHaveBeenCalled();
  });

  it("routes terminal fact integrity failure into existing DLQ", async () => {
    const failed = message(queueMessage("5e106d7a-85aa-4a08-9a1f-cb13b42df1f8"), 5);
    const coordinatorFetch = vi.fn(() =>
      Promise.resolve(Response.json({ failureCode: "fact_integrity_conflict" }, { status: 503 })),
    );
    const send = vi.fn(() => Promise.resolve());
    const env = {
      DEAD_LETTER_QUEUE: { send },
      TENANT_COORDINATOR: { getByName: vi.fn(() => ({ fetch: coordinatorFetch })) },
    } as unknown as Env;

    await processIngressQueue(
      { messages: [failed.value] } as unknown as MessageBatch<IngressQueueMessage>,
      env,
    );

    expect(send).toHaveBeenCalledWith({
      ...failed.value.body,
      failureCode: "fact_integrity_conflict",
    });
    expect(failed.ack).toHaveBeenCalledOnce();
  });

  it("retries fact persistence failures before dead-lettering", async () => {
    const failed = message(queueMessage("5e106d7a-85aa-4a08-9a1f-cb13b42df1f8"), 1);
    const coordinatorFetch = vi.fn(() =>
      Promise.resolve(Response.json({ failureCode: "persistence_unavailable" }, { status: 503 })),
    );
    const send = vi.fn();
    const env = {
      DEAD_LETTER_QUEUE: { send },
      TENANT_COORDINATOR: { getByName: vi.fn(() => ({ fetch: coordinatorFetch })) },
    } as unknown as Env;

    await processIngressQueue(
      { messages: [failed.value] } as unknown as MessageBatch<IngressQueueMessage>,
      env,
    );

    expect(failed.retry).toHaveBeenCalledOnce();
    expect(failed.ack).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("retries one failed message without blocking later acknowledgements", async () => {
    const failed = message(queueMessage("5e106d7a-85aa-4a08-9a1f-cb13b42df1f8"));
    const accepted = message(queueMessage("06f96f7d-3e1a-4a66-b98e-58be9766b96e"));
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("synthetic decryption failure"))
      .mockResolvedValueOnce(Response.json({ accepted: true, reason: "persisted" }));
    const env = {
      TENANT_COORDINATOR: { getByName: vi.fn(() => ({ fetch })) },
    } as unknown as Env;

    await processIngressQueue(
      { messages: [failed.value, accepted.value] } as unknown as MessageBatch<IngressQueueMessage>,
      env,
    );

    expect(failed.retry).toHaveBeenCalledOnce();
    expect(failed.ack).not.toHaveBeenCalled();
    expect(accepted.ack).toHaveBeenCalledOnce();
    expect(accepted.retry).not.toHaveBeenCalled();
  });

  it("drops malformed encrypted metadata before coordinator dispatch", async () => {
    const malformed = message({
      ...queueMessage("5e106d7a-85aa-4a08-9a1f-cb13b42df1f8"),
      encrypted: {
        ...queueMessage("5e106d7a-85aa-4a08-9a1f-cb13b42df1f8").encrypted,
        keyVersion: 2_147_483_648,
      },
    });
    const getByName = vi.fn();
    const env = { TENANT_COORDINATOR: { getByName } } as unknown as Env;

    await processIngressQueue(
      { messages: [malformed.value] } as unknown as MessageBatch<IngressQueueMessage>,
      env,
    );

    expect(malformed.ack).toHaveBeenCalledOnce();
    expect(malformed.retry).not.toHaveBeenCalled();
    expect(getByName).not.toHaveBeenCalled();
  });
});

describe("prepareIngressQueueMessage", () => {
  it("rejects non-UUID users before publication", () => {
    expect(
      prepareIngressQueueMessage({
        ...queueMessage("5e106d7a-85aa-4a08-9a1f-cb13b42df1f8"),
        userId: "development-user",
      }),
    ).toBeUndefined();
  });

  it("rejects ciphertext that cannot fit the Queue message budget", () => {
    expect(
      prepareIngressQueueMessage({
        ...queueMessage("5e106d7a-85aa-4a08-9a1f-cb13b42df1f8"),
        encrypted: {
          ...queueMessage("5e106d7a-85aa-4a08-9a1f-cb13b42df1f8").encrypted,
          ciphertext: "A".repeat(119_800),
        },
      }),
    ).toBeUndefined();
  });

  it("accepts ciphertext within the serialized Queue budget", () => {
    expect(
      prepareIngressQueueMessage({
        ...queueMessage("5e106d7a-85aa-4a08-9a1f-cb13b42df1f8"),
        encrypted: {
          ...queueMessage("5e106d7a-85aa-4a08-9a1f-cb13b42df1f8").encrypted,
          ciphertext: "A".repeat(119_200),
        },
      }),
    ).toBeDefined();
  });

  it("does not publish an oversized message", async () => {
    const send = vi.fn();
    const queue = { send } as unknown as Queue<IngressQueueMessage>;
    const published = await publishIngressQueueMessage(queue, {
      ...queueMessage("5e106d7a-85aa-4a08-9a1f-cb13b42df1f8"),
      encrypted: {
        ...queueMessage("5e106d7a-85aa-4a08-9a1f-cb13b42df1f8").encrypted,
        ciphertext: "A".repeat(119_800),
      },
    });

    expect(published).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
