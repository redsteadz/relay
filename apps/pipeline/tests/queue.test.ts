import { describe, expect, it, vi } from "vitest";

import type { Env, IngressQueueMessage } from "../src/env";
import {
  prepareIngressQueueMessage,
  processIngressQueue,
  publishIngressQueueMessage,
} from "../src/queue";

function queueMessage(envelopeId: string): IngressQueueMessage {
  return {
    userId: "638ce145-a77d-4c32-b798-cb398e881fc9",
    envelopeId,
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

function message(body: IngressQueueMessage) {
  const ack = vi.fn();
  const retry = vi.fn();
  return {
    ack,
    retry,
    value: { body, ack, retry } as unknown as Message<IngressQueueMessage>,
  };
}

describe("processIngressQueue", () => {
  it("acks e2e dead-letter messages only after durable metadata storage", async () => {
    const deadLetter = message(queueMessage("5e106d7a-85aa-4a08-9a1f-cb13b42df1f8"));
    const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    const env = {
      RELAY_E2E_DEAD_LETTER_QUEUE: "relay-ingress-dead-letter-e2e-local",
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
    expect(deadLetter.ack).toHaveBeenCalledOnce();
    expect(deadLetter.retry).not.toHaveBeenCalled();
  });

  it("retries one failed message without blocking later acknowledgements", async () => {
    const failed = message(queueMessage("5e106d7a-85aa-4a08-9a1f-cb13b42df1f8"));
    const accepted = message(queueMessage("06f96f7d-3e1a-4a66-b98e-58be9766b96e"));
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("synthetic decryption failure"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
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
          ciphertext: "A".repeat(119_600),
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
