/**
 * How long the device keeps the rows it derived, and what it drops first.
 *
 * The bounds are deliberately the same as `capture_content`'s in
 * `modules/relay-device-ingress/android/src/main/java/com/redsteadz/relaydeviceingress/CaptureQueueStore.kt`:
 * thirty days and two thousand captures. That is not a coincidence to be tidied away later. The
 * inbox renders what a capture said from `capture_content`, so a derived row that outlived the
 * content it describes would produce an item whose text had silently gone -- present in the list,
 * empty when opened. Matching the bounds means a capture and its explanation expire together.
 *
 * Retention is per capture rather than per row. Dropping a capture drops its facts, its event and
 * its classification, because a fact with no capture explains nothing.
 */

/** Thirty days, matching `CAPTURE_CONTENT_MAX_AGE_MS`. */
export const LOCAL_STORE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Two thousand captures, matching `CAPTURE_CONTENT_MAX_ITEMS`. */
export const LOCAL_STORE_MAX_CAPTURES = 2000;

/** The minimum a retention pass needs to know about a capture to decide its fate. */
export type PrunableCapture = {
  /** ISO-8601, as stored. */
  capturedAt: string;
  sourceItemId: string;
};

export type PruneBounds = {
  maxAgeMs?: number;
  maxCaptures?: number;
};

/**
 * Which captures a retention pass should drop, oldest first.
 *
 * Age is applied before count, so a pass never evicts a capture that was inside the window in order
 * to make room for one that was already outside it.
 *
 * An unparseable `capturedAt` is dropped rather than kept. A row whose age cannot be established
 * cannot be shown to be inside the retention window, and keeping it would mean retaining source-derived
 * data for an unbounded time on the strength of a value the device failed to read.
 *
 * The order is total: capture time ascending, then `sourceItemId`. Two captures sharing a timestamp
 * therefore resolve the same way on every pass, so a full store does not evict a different row each
 * time it is swept.
 */
export function capturesToPrune(
  captures: readonly PrunableCapture[],
  now: number,
  bounds: PruneBounds = {},
): string[] {
  const maxAgeMs = bounds.maxAgeMs ?? LOCAL_STORE_MAX_AGE_MS;
  const maxCaptures = bounds.maxCaptures ?? LOCAL_STORE_MAX_CAPTURES;

  const doomed: string[] = [];
  const surviving: { at: number; id: string }[] = [];

  for (const capture of captures) {
    const at = Date.parse(capture.capturedAt);
    if (Number.isNaN(at) || at + maxAgeMs <= now) {
      doomed.push(capture.sourceItemId);
      continue;
    }
    surviving.push({ at, id: capture.sourceItemId });
  }

  const excess = surviving.length - maxCaptures;
  if (excess <= 0) return doomed;

  surviving.sort((left, right) => left.at - right.at || left.id.localeCompare(right.id));
  for (const capture of surviving.slice(0, excess)) doomed.push(capture.id);
  return doomed;
}

/** Whether a capture is old enough that retention would drop it. Shares one definition of age. */
export function isLocalCaptureExpired(
  capturedAt: string,
  now: number,
  maxAgeMs = LOCAL_STORE_MAX_AGE_MS,
): boolean {
  const at = Date.parse(capturedAt);
  return Number.isNaN(at) || at + maxAgeMs <= now;
}
