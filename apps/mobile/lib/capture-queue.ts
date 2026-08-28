import {
  deviceIngressAcknowledgementSchema,
  ingressEnvelopeSchema,
  type IngressEnvelope,
} from "@relay/contracts";

export const CAPTURE_QUEUE_MAX_ATTEMPTS = 8;
export const CAPTURE_QUEUE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function isCaptureExpired(capturedAt: string, now: number): boolean {
  return Date.parse(capturedAt) + CAPTURE_QUEUE_MAX_AGE_MS <= now;
}

export type QueuedCapture = {
  envelope: IngressEnvelope;
  attempts: number;
};

export type CaptureQueueStore = {
  acknowledge(tenantId: string, envelopeId: string): Promise<void>;
  fail(tenantId: string, envelopeId: string, terminal: boolean): Promise<void>;
  ready(tenantId: string, now: number): Promise<QueuedCapture[]>;
};

export type CaptureTransport = (
  envelope: IngressEnvelope,
) => Promise<{ body: unknown; status: number }>;

export type DrainResult = { acknowledged: number; failed: number; pending: number };

/** Drains a snapshot. Stable envelope IDs are owned by capture and never regenerated here. */
export async function drainCaptureQueue(
  store: CaptureQueueStore,
  tenantId: string,
  transport: CaptureTransport,
  now = Date.now(),
): Promise<DrainResult> {
  const entries = await store.ready(tenantId, now);
  const result: DrainResult = { acknowledged: 0, failed: 0, pending: 0 };

  for (const entry of entries) {
    const parsedEnvelope = ingressEnvelopeSchema.safeParse(entry.envelope);
    if (!parsedEnvelope.success) {
      await store.fail(tenantId, entry.envelope.id, true);
      result.failed += 1;
      continue;
    }

    try {
      const response = await transport(parsedEnvelope.data);
      const acknowledgement = deviceIngressAcknowledgementSchema.safeParse(response.body);
      if (
        response.status === 202 &&
        acknowledgement.success &&
        acknowledgement.data.id === parsedEnvelope.data.id
      ) {
        await store.acknowledge(tenantId, parsedEnvelope.data.id);
        result.acknowledged += 1;
      } else {
        const terminal =
          (response.status >= 400 && response.status < 500 && response.status !== 408) ||
          entry.attempts + 1 >= CAPTURE_QUEUE_MAX_ATTEMPTS;
        await store.fail(tenantId, parsedEnvelope.data.id, terminal);
        if (terminal) result.failed += 1;
        else result.pending += 1;
      }
    } catch {
      await store.fail(
        tenantId,
        parsedEnvelope.data.id,
        entry.attempts + 1 >= CAPTURE_QUEUE_MAX_ATTEMPTS,
      );
      if (entry.attempts + 1 >= CAPTURE_QUEUE_MAX_ATTEMPTS) result.failed += 1;
      else result.pending += 1;
    }
  }

  return result;
}
