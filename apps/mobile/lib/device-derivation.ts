/**
 * Deriving every capture the device is still holding.
 *
 * Runs before upload, not after, and that ordering is the whole point. A capture's envelope lives in
 * the encrypted queue only until it is acknowledged, so anything derived from it has to be derived
 * while it is still there. Running first also means derivation does not depend on a session, a device
 * registration, or a reachable API -- a phone with no signal still learns what it captured.
 *
 * The pass is advisory. It reports what it did and never throws into the sync path, because a capture
 * that stays underived is derived on the next pass, and failing the sync would also stop the upload
 * that was going to work.
 */

import { SOURCE_EVENT_EXTRACTOR_VERSION, SOURCE_FACT_NORMALIZER_VERSION } from "@relay/domain";

import RelayDeviceIngress from "../modules/relay-device-ingress";
import { deriveCapture } from "./capture-derivation";
import {
  derivedCaptureIds,
  localStoreSupported,
  openLocalStore,
  persistDerivedCapture,
  pruneLocalStore,
} from "./local-store";
import { logMobileError } from "./observability";

export type DerivationPassResult = {
  /** Captures whose facts and event were written. */
  derived: number;
  /** Captures that yielded no facts, so there was nothing to write. */
  notDerivable: number;
  /** Captures already derived at the current normalizer and extractor versions. */
  skipped: number;
};

const EMPTY_PASS: DerivationPassResult = { derived: 0, notDerivable: 0, skipped: 0 };

/**
 * Derives the captures still in the queue into the local store.
 *
 * Retention runs at the end of a pass that wrote something, so the store is bounded by the same sweep
 * that fills it rather than by a separate schedule that could be missed.
 */
export async function deriveQueuedCaptures(
  tenantId: string,
  now = Date.now(),
): Promise<DerivationPassResult> {
  if (!localStoreSupported()) return EMPTY_PASS;

  try {
    const queued = await RelayDeviceIngress.getReadyCaptures(tenantId, now);
    if (queued.length === 0) return EMPTY_PASS;

    const database = await openLocalStore();
    const already = await derivedCaptureIds(
      database,
      tenantId,
      SOURCE_FACT_NORMALIZER_VERSION,
      SOURCE_EVENT_EXTRACTOR_VERSION,
    );

    const result: DerivationPassResult = { ...EMPTY_PASS };
    for (const entry of queued) {
      if (already.has(entry.envelope.id)) {
        result.skipped += 1;
        continue;
      }
      const derivation = await deriveCapture(entry.envelope);
      if (derivation.status === "not-derivable") {
        result.notDerivable += 1;
        continue;
      }
      await persistDerivedCapture(database, tenantId, entry.envelope, derivation.derived);
      result.derived += 1;
    }

    if (result.derived > 0) await pruneLocalStore(database, tenantId, now);
    return result;
  } catch (error: unknown) {
    // Counts only. No envelope id, no capture content, no SQL reaches the log.
    logMobileError("background.capture_derivation_failed", error, {
      code: "CAPTURE_DERIVATION_FAILED",
      integration: "relay-device-ingress",
      operation: "deriveQueuedCaptures",
    });
    return EMPTY_PASS;
  }
}
