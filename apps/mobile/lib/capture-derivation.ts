/**
 * Deriving a capture's facts and its event on the device that made it.
 *
 * Nothing here decides anything new. `normalizeSourceFacts` and `extractSourceEvents` are the same
 * pure functions the pipeline calls in `apps/pipeline/src/dedup.ts`, so a capture derived here
 * produces the facts and the event it would have produced on the server. That is the point: the
 * device stops waiting for a round trip to find out what it already had enough information to work
 * out.
 *
 * What is device-specific is only the digest -- Hermes has no `crypto.subtle` -- and the decision
 * about what to do when a capture yields nothing.
 */

import type { IngressEnvelope, SourceEventSet, SourceFactSet } from "@relay/contracts";
import {
  extractSourceEvents,
  normalizeSourceFacts,
  sourceEventSetFingerprint,
  sourceFactSetFingerprint,
  type Sha256Digest,
} from "@relay/domain";

import { mobileSha256 } from "./digest";

export type DerivedCapture = {
  eventSet: SourceEventSet;
  eventSetFingerprint: string;
  factSet: SourceFactSet;
  factSetFingerprint: string;
};

/**
 * A capture the normalizer would not accept.
 *
 * Not the empty case: every well-formed envelope derives at least two date facts, because `occurredAt`
 * and `capturedAt` are always present and always canonicalize. What this covers is an envelope the
 * contract rejects -- an identifier that is not a UUID, a field outside its bounds -- where
 * `normalizeSourceFacts` throws from inside `sourceFactSetSchema.parse`.
 *
 * It exists so one capture cannot stop a pass. The pipeline turns the same rejection into a fixed
 * invalid outcome rather than an exception worth a stack trace, and so does this: the capture is
 * reported as not derivable and the remaining captures are still derived.
 */
export type CaptureDerivation =
  { derived: DerivedCapture; status: "derived" } | { status: "not-derivable" };

/**
 * Derives one capture, or reports that it cannot be.
 *
 * The envelope is validated by the native adapter that built it and again by the contract schemas
 * inside the normalizer, so nothing here re-parses it. No value read from the envelope reaches a log.
 */
export async function deriveCapture(
  envelope: IngressEnvelope,
  digest: Sha256Digest = mobileSha256,
): Promise<CaptureDerivation> {
  let factSet: SourceFactSet;
  try {
    factSet = normalizeSourceFacts(envelope);
  } catch {
    // Deliberately swallowed without the cause. A Zod message is built from the value that failed it,
    // so passing it on would put envelope content into an error, and the observability guide requires
    // an intentional parse rejection of source data to stay a fixed outcome.
    return { status: "not-derivable" };
  }

  const eventSet = extractSourceEvents(factSet);
  const [factSetFingerprint, eventSetFingerprint] = await Promise.all([
    sourceFactSetFingerprint(factSet, digest),
    sourceEventSetFingerprint(eventSet, digest),
  ]);

  return {
    derived: { eventSet, eventSetFingerprint, factSet, factSetFingerprint },
    status: "derived",
  };
}
