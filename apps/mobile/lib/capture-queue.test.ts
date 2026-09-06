import type { IngressEnvelope } from "@relay/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  CAPTURE_QUEUE_MAX_AGE_MS,
  drainCaptureQueue,
  isCaptureExpired,
  type CaptureQueueStore,
  type QueuedCapture,
} from "./capture-queue";

vi.mock("./observability", () => ({ logMobileError: vi.fn(), mobileRequestId: () => "request" }));

const envelope: IngressEnvelope = {
  schemaVersion: 1,
  id: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
  occurredAt: "2026-08-24T10:00:00Z",
  capturedAt: "2026-08-24T10:00:01Z",
  source: { kind: "notification", externalId: "synthetic-1" },
  attributes: {},
};

const second: IngressEnvelope = { ...envelope, id: "9c7f4a2b-0d51-4a3e-9d7a-1f2b3c4d5e6f" };

function queued(value: IngressEnvelope, attempts = 0): QueuedCapture {
  return { attempts, envelope: value, envelopeId: value.id };
}

function memoryStore(initial: QueuedCapture[]) {
  const rows = new Map(initial.map((entry) => [entry.envelopeId, entry]));
  const failed = new Set<string>();
  const store: CaptureQueueStore = {
    acknowledge(_tenantId, id) {
      rows.delete(id);
      return Promise.resolve();
    },
    fail(_tenantId, id, terminal) {
      const row = rows.get(id);
      if (row) row.attempts += 1;
      if (terminal) failed.add(id);
      return Promise.resolve();
    },
    ready() {
      return Promise.resolve([...rows.values()].filter((row) => !failed.has(row.envelopeId)));
    },
  };
  return { failed, rows, store };
}

const accepts = (sent: IngressEnvelope) =>
  Promise.resolve({ status: 202, body: { accepted: true, durable: true, id: sent.id } });

describe("drainCaptureQueue", () => {
  it("retains a stable ID across offline restart and retry", async () => {
    const state = memoryStore([queued(envelope)]);
    await drainCaptureQueue(state.store, "tenant", () => Promise.reject(new Error("offline")));
    expect(state.rows.get(envelope.id)?.envelopeId).toBe(envelope.id);
    await drainCaptureQueue(state.store, "tenant", accepts);
    expect(state.rows.size).toBe(0);
  });

  it("does not delete for a bare 202 or mismatched acknowledgement", async () => {
    const state = memoryStore([queued(envelope)]);
    await drainCaptureQueue(state.store, "tenant", () =>
      Promise.resolve({ status: 202, body: { accepted: true } }),
    );
    expect(state.rows.has(envelope.id)).toBe(true);
    expect(state.failed.has(envelope.id)).toBe(false);
  });

  it("makes a duplicate durable acknowledgement idempotent", async () => {
    const state = memoryStore([queued(envelope)]);
    await drainCaptureQueue(state.store, "tenant", accepts);
    await drainCaptureQueue(state.store, "tenant", accepts);
    expect(state.rows.size).toBe(0);
  });

  it("reports what it found and what it sent", async () => {
    const state = memoryStore([queued(envelope), queued(second)]);
    const result = await drainCaptureQueue(state.store, "tenant", accepts);
    expect(result).toEqual({ accepted: 2, discarded: 0, ready: 2, stopped: false });
  });

  // The queue holds captures already taken under consent. Only Relay judging the payload itself
  // unacceptable removes one; anything about the environment leaves it to be sent later.
  describe("keeps a capture Relay did not refuse", () => {
    it.each([
      ["an expired access token", 401],
      ["a device that is not active yet", 403],
      ["a rate limit", 429],
      ["an outage", 503],
      ["a base URL that is not Relay", 404],
    ])("retries after %s", async (_name, status) => {
      const state = memoryStore([queued(envelope)]);
      await drainCaptureQueue(state.store, "tenant", () => Promise.resolve({ status, body: {} }));

      expect(state.failed.has(envelope.id)).toBe(false);
      expect(state.rows.get(envelope.id)?.attempts).toBe(1);

      await drainCaptureQueue(state.store, "tenant", accepts);
      expect(state.rows.size).toBe(0);
    });
  });

  // Repeating an unavailable answer must not become a way to lose a capture, so no number of
  // attempts turns one of these into a discard.
  it("never discards a capture for repeated unavailability", async () => {
    const state = memoryStore([queued(envelope, 50)]);
    await drainCaptureQueue(state.store, "tenant", () =>
      Promise.resolve({ status: 503, body: {} }),
    );
    expect(state.failed.has(envelope.id)).toBe(false);
    expect(state.rows.has(envelope.id)).toBe(true);
  });

  describe("discards a capture Relay will never accept", () => {
    it.each([
      ["a malformed envelope", 400],
      ["a payload over the size limit", 413],
    ])("retires it after %s", async (_name, status) => {
      const state = memoryStore([queued(envelope)]);
      const result = await drainCaptureQueue(state.store, "tenant", () =>
        Promise.resolve({ status, body: {} }),
      );
      expect(state.failed.has(envelope.id)).toBe(true);
      expect(result.discarded).toBe(1);
    });
  });

  // One capture the current build cannot read used to throw out of the read that produced the batch,
  // so every queued capture was stranded by a single bad neighbour and none was ever attempted.
  it("retires an unreadable capture without stranding the rest", async () => {
    const state = memoryStore([
      { attempts: 0, envelope: { schemaVersion: 1, id: "not-a-uuid" }, envelopeId: "broken" },
      queued(second),
    ]);

    const result = await drainCaptureQueue(state.store, "tenant", accepts);

    expect(state.failed.has("broken")).toBe(true);
    expect(result).toEqual({ accepted: 1, discarded: 1, ready: 2, stopped: false });
    expect(state.rows.has(second.id)).toBe(false);
  });

  it("resolves an unreadable capture by its queue key rather than its payload", async () => {
    const state = memoryStore([{ attempts: 0, envelope: undefined, envelopeId: "undecodable" }]);

    await drainCaptureQueue(state.store, "tenant", accepts);

    expect(state.failed.has("undecodable")).toBe(true);
  });

  // Sending the rest of the queue at an endpoint already known to be failing recorded an attempt
  // against every capture, so a single bad foreground spent the whole queue's budget at once.
  it("stops the pass at the first unavailable answer", async () => {
    const state = memoryStore([queued(envelope), queued(second)]);
    const transport = vi.fn(() => Promise.resolve({ status: 503, body: {} }));

    const result = await drainCaptureQueue(state.store, "tenant", transport);

    expect(transport).toHaveBeenCalledTimes(1);
    expect(result.stopped).toBe(true);
    expect(state.rows.get(second.id)?.attempts).toBe(0);
  });

  it("stops the pass when the upload throws", async () => {
    const state = memoryStore([queued(envelope), queued(second)]);
    const transport = vi.fn(() => Promise.reject(new Error("offline")));

    const result = await drainCaptureQueue(state.store, "tenant", transport);

    expect(transport).toHaveBeenCalledTimes(1);
    expect(result.stopped).toBe(true);
    expect(state.rows.get(second.id)?.attempts).toBe(0);
  });

  it("expires captures exactly seven days after capture", () => {
    const capturedAt = Date.parse(envelope.capturedAt);
    expect(isCaptureExpired(envelope.capturedAt, capturedAt + CAPTURE_QUEUE_MAX_AGE_MS - 1)).toBe(
      false,
    );
    expect(isCaptureExpired(envelope.capturedAt, capturedAt + CAPTURE_QUEUE_MAX_AGE_MS)).toBe(true);
  });
});
