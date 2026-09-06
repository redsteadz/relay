import {
  deviceIngressAcknowledgementSchema,
  ingressEnvelopeSchema,
  type IngressEnvelope,
} from "@relay/contracts";
import { httpResponseError } from "@relay/observability";

import { logMobileError } from "./observability";

export const CAPTURE_QUEUE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function isCaptureExpired(capturedAt: string, now: number): boolean {
  return Date.parse(capturedAt) + CAPTURE_QUEUE_MAX_AGE_MS <= now;
}

/**
 * The statuses that mean this capture will never be accepted.
 *
 * Deliberately an allowlist of what `POST /api/ingest` returns about the payload itself: a malformed
 * envelope and one over the size limit. Everything else -- an expired token, a device not yet
 * active, a rate limit, an outage, and a 404 from a base URL pointing somewhere that is not Relay --
 * describes the environment rather than the capture, and a capture is never discarded for it.
 *
 * The inverse spelling is what made this dangerous: treating every 4xx except 408 as terminal
 * discarded a capture because a token had expired, which is the one failure that is certain to
 * resolve on its own.
 */
const DISCARDING_STATUSES: ReadonlySet<number> = new Set([400, 413]);

export type QueuedCapture = {
  /**
   * The queue's own key for the row.
   *
   * Acknowledgement and failure address the row by this rather than by an ID read back out of the
   * stored envelope, so a row whose payload cannot be parsed can still be resolved, and a row whose
   * payload disagrees with its key can still be deleted instead of uploading on every pass forever.
   */
  envelopeId: string;
  /** Validated here rather than by the reader, so one unreadable row cannot strand the batch. */
  envelope: unknown;
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

export type DrainResult = {
  /** Uploaded and acknowledged, and so removed from the queue. */
  accepted: number;
  /** Refused as unacceptable and removed from consideration. */
  discarded: number;
  ready: number;
  /** True when the pass stopped at an unavailable Relay rather than reaching the end. */
  stopped: boolean;
};

/**
 * Uploads a snapshot of the queue.
 *
 * A pass stops at the first sign that Relay is unavailable instead of continuing through the
 * remaining captures. Continuing sent every queued capture at an endpoint already known to be
 * failing and recorded an attempt against each, so one bad foreground consumed the whole queue's
 * retry budget at once; stopping means an outage costs one attempt rather than fifty.
 *
 * Stable envelope IDs are owned by capture and never regenerated here.
 */
export async function drainCaptureQueue(
  store: CaptureQueueStore,
  tenantId: string,
  transport: CaptureTransport,
  now = Date.now(),
): Promise<DrainResult> {
  const entries = await store.ready(tenantId, now);
  const result: DrainResult = {
    accepted: 0,
    discarded: 0,
    ready: entries.length,
    stopped: false,
  };

  for (const entry of entries) {
    const parsedEnvelope = ingressEnvelopeSchema.safeParse(entry.envelope);
    if (!parsedEnvelope.success) {
      // Unreadable by this build and unreadable by every later one, so it is resolved rather than
      // re-read on every pass. Only this row is affected.
      await store.fail(tenantId, entry.envelopeId, true);
      result.discarded += 1;
      continue;
    }

    let response: { body: unknown; status: number };
    try {
      response = await transport(parsedEnvelope.data);
    } catch (error: unknown) {
      logMobileError("background.capture_transport_failed", error, {
        code: "CAPTURE_TRANSPORT_FAILED",
        integration: "relay-api",
        metadata: { attempt: entry.attempts + 1 },
        operation: "uploadCapture",
      });
      await store.fail(tenantId, entry.envelopeId, false);
      result.stopped = true;
      return result;
    }

    const acknowledgement = deviceIngressAcknowledgementSchema.safeParse(response.body);
    if (
      response.status === 202 &&
      acknowledgement.success &&
      acknowledgement.data.id === parsedEnvelope.data.id
    ) {
      await store.acknowledge(tenantId, entry.envelopeId);
      result.accepted += 1;
      continue;
    }

    if (DISCARDING_STATUSES.has(response.status)) {
      // Discarding a capture is the one outcome nothing else records, so it is logged where it is
      // decided rather than inferred later from a queue that simply became shorter.
      logMobileError(
        "background.capture_discarded",
        httpResponseError(response, {
          code: "CAPTURE_DISCARDED",
          integration: "relay-api",
          operation: "uploadCapture",
        }),
        {
          code: "CAPTURE_DISCARDED",
          integration: "relay-api",
          metadata: { attempt: entry.attempts + 1, statusCode: response.status },
          operation: "uploadCapture",
        },
      );
      await store.fail(tenantId, entry.envelopeId, true);
      result.discarded += 1;
      continue;
    }

    // Relay did not accept and did not refuse the payload, so the capture is still deliverable and
    // the queue holds it. The attempt is recorded so a queue that is being tried is distinguishable
    // from one nothing has reached, which is the state this drain could previously not be told apart
    // from being broken.
    logMobileError(
      "background.capture_upload_unavailable",
      httpResponseError(response, {
        code: "CAPTURE_UPLOAD_UNAVAILABLE",
        integration: "relay-api",
        operation: "uploadCapture",
      }),
      {
        code: "CAPTURE_UPLOAD_UNAVAILABLE",
        integration: "relay-api",
        metadata: { attempt: entry.attempts + 1, statusCode: response.status },
        operation: "uploadCapture",
      },
    );
    await store.fail(tenantId, entry.envelopeId, false);
    result.stopped = true;
    return result;
  }

  return result;
}
