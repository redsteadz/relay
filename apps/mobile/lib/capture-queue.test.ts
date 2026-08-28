import type { IngressEnvelope } from "@relay/contracts";
import { describe, expect, it } from "vitest";

import {
  CAPTURE_QUEUE_MAX_AGE_MS,
  drainCaptureQueue,
  isCaptureExpired,
  type CaptureQueueStore,
  type QueuedCapture,
} from "./capture-queue";

const envelope: IngressEnvelope = {
  schemaVersion: 1,
  id: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
  occurredAt: "2026-08-24T10:00:00Z",
  capturedAt: "2026-08-24T10:00:01Z",
  source: { kind: "notification", externalId: "synthetic-1" },
  attributes: {},
};

function memoryStore(initial: QueuedCapture[]) {
  const rows = new Map(initial.map((entry) => [entry.envelope.id, entry]));
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
      return Promise.resolve([...rows.values()].filter((row) => !failed.has(row.envelope.id)));
    },
  };
  return { failed, rows, store };
}

describe("drainCaptureQueue", () => {
  it("retains a stable ID across offline restart and retry", async () => {
    const state = memoryStore([{ envelope, attempts: 0 }]);
    await drainCaptureQueue(state.store, "tenant", () => Promise.reject(new Error("offline")));
    expect(state.rows.get(envelope.id)?.envelope.id).toBe(envelope.id);
    await drainCaptureQueue(state.store, "tenant", (sent) =>
      Promise.resolve({ status: 202, body: { accepted: true, durable: true, id: sent.id } }),
    );
    expect(state.rows.size).toBe(0);
  });

  it("does not delete for a bare 202 or mismatched acknowledgement", async () => {
    const state = memoryStore([{ envelope, attempts: 0 }]);
    await drainCaptureQueue(state.store, "tenant", () =>
      Promise.resolve({ status: 202, body: { accepted: true } }),
    );
    expect(state.rows.has(envelope.id)).toBe(true);
  });

  it("makes a duplicate durable acknowledgement idempotent", async () => {
    const state = memoryStore([{ envelope, attempts: 0 }]);
    const transport = () =>
      Promise.resolve({
        status: 202,
        body: { accepted: true, durable: true, id: envelope.id },
      });
    await drainCaptureQueue(state.store, "tenant", transport);
    await drainCaptureQueue(state.store, "tenant", transport);
    expect(state.rows.size).toBe(0);
  });

  it("moves non-retryable responses to explicit failure", async () => {
    const state = memoryStore([{ envelope, attempts: 0 }]);
    await drainCaptureQueue(state.store, "tenant", () =>
      Promise.resolve({ status: 403, body: {} }),
    );
    expect(state.failed.has(envelope.id)).toBe(true);
  });

  it("moves exhausted retryable responses to explicit failure", async () => {
    const state = memoryStore([{ envelope, attempts: 7 }]);
    await drainCaptureQueue(state.store, "tenant", () =>
      Promise.resolve({ status: 503, body: {} }),
    );
    expect(state.failed.has(envelope.id)).toBe(true);
  });

  it("expires captures exactly seven days after capture", () => {
    const capturedAt = Date.parse(envelope.capturedAt);
    expect(isCaptureExpired(envelope.capturedAt, capturedAt + CAPTURE_QUEUE_MAX_AGE_MS - 1)).toBe(
      false,
    );
    expect(isCaptureExpired(envelope.capturedAt, capturedAt + CAPTURE_QUEUE_MAX_AGE_MS)).toBe(true);
  });
});
