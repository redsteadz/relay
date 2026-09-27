import type { IngressEnvelope } from "@relay/contracts";
import {
  extractSourceEvents,
  normalizeSourceFacts,
  sha256Hex,
  sourceEventSetFingerprint,
  sourceFactSetFingerprint,
  SOURCE_EVENT_EXTRACTOR_VERSION,
  SOURCE_FACT_NORMALIZER_VERSION,
} from "@relay/domain";
import { beforeAll, describe, expect, it, vi } from "vitest";

// expo-crypto is a native module. Its digest is delegated to WebCrypto here so the adapter's wiring --
// the algorithm it names and the ArrayBuffer it unwraps -- is what gets exercised, and a known vector
// below pins the result to a value neither implementation can drift from quietly.
vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digest: (algorithm: string, data: BufferSource) => crypto.subtle.digest(algorithm, data),
}));

const { mobileSha256 } = await import("./digest");
const { deriveCapture } = await import("./capture-derivation");

/** A card-purchase notification: a sender, an amount, a currency, a merchant. */
const purchase: IngressEnvelope = {
  schemaVersion: 1,
  id: "20000000-0000-4000-8000-0000000000a1",
  occurredAt: "2026-09-27T10:00:00Z",
  capturedAt: "2026-09-27T10:00:01Z",
  source: {
    kind: "notification",
    externalId: "synthetic-notification-a1",
    applicationId: "com.example.syntheticbank",
  },
  sender: "Example Bank",
  subject: "Synthetic card purchase",
  body: "USD 14.20 at Example Station",
  attributes: { amount: "14.20", currency: "USD", merchant: "Example Station" },
};

/**
 * An envelope the contract rejects: the identifier is not a UUID, so the fact set fails to parse.
 *
 * There is no envelope that simply yields nothing -- `occurredAt` and `capturedAt` always canonicalize
 * into date facts -- so the only way the normalizer refuses a capture is by its shape.
 */
const malformed = {
  schemaVersion: 1,
  id: "not-a-uuid",
  occurredAt: "2026-09-27T10:00:00Z",
  capturedAt: "2026-09-27T10:00:01Z",
  source: { kind: "notification", externalId: "synthetic-notification-a2" },
  attributes: {},
} as unknown as IngressEnvelope;

describe("mobileSha256", () => {
  it("produces the standard SHA-256 of a known input", async () => {
    // Pins algorithm and hex rendering independently of any other implementation in this repo.
    expect(await sha256Hex(new TextEncoder().encode("abc"), mobileSha256)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("deriveCapture", () => {
  it("produces exactly what the shared normalizer and extractor produce", async () => {
    const derivation = await deriveCapture(purchase, mobileSha256);
    expect(derivation.status).toBe("derived");
    if (derivation.status !== "derived") return;

    // The pipeline calls these same two functions in this same order, so equality here is the parity
    // claim: the device adds nothing to the derivation and takes nothing away.
    const factSet = normalizeSourceFacts(purchase);
    expect(derivation.derived.factSet).toEqual(factSet);
    expect(derivation.derived.eventSet).toEqual(extractSourceEvents(factSet));
  });

  it("fingerprints to the same value the default WebCrypto digest would produce", async () => {
    const derivation = await deriveCapture(purchase, mobileSha256);
    expect(derivation.status).toBe("derived");
    if (derivation.status !== "derived") return;

    // If the digest port changed the fingerprint, a device row could never match a server row derived
    // from the same capture, and the integrity check that compares digests within one version would
    // start reporting conflicts that are not conflicts.
    expect(derivation.derived.factSetFingerprint).toBe(
      await sourceFactSetFingerprint(derivation.derived.factSet),
    );
    expect(derivation.derived.eventSetFingerprint).toBe(
      await sourceEventSetFingerprint(derivation.derived.eventSet),
    );
    expect(derivation.derived.factSetFingerprint).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("records the versions that produced the derivation", async () => {
    const derivation = await deriveCapture(purchase, mobileSha256);
    if (derivation.status !== "derived") throw new Error("expected a derivation");

    expect(derivation.derived.factSet.normalizerVersion).toBe(SOURCE_FACT_NORMALIZER_VERSION);
    expect(derivation.derived.eventSet.extractorVersion).toBe(SOURCE_EVENT_EXTRACTOR_VERSION);
    expect(derivation.derived.eventSet.normalizerVersion).toBe(SOURCE_FACT_NORMALIZER_VERSION);
  });

  it("derives one event per capture, as the extractor does", async () => {
    const derivation = await deriveCapture(purchase, mobileSha256);
    if (derivation.status !== "derived") throw new Error("expected a derivation");
    expect(derivation.derived.eventSet.events).toHaveLength(1);
  });

  it("always derives a date fact from the envelope's own timestamps", async () => {
    // Worth pinning, because it is why "no facts" is not a reachable outcome: occurredAt and capturedAt
    // are required by the envelope contract and always canonicalize.
    const sparse: IngressEnvelope = {
      schemaVersion: 1,
      id: "20000000-0000-4000-8000-0000000000a3",
      occurredAt: "2026-09-27T10:00:00Z",
      capturedAt: "2026-09-27T10:00:01Z",
      source: { kind: "notification", externalId: "synthetic-notification-a3" },
      attributes: {},
    };
    const derivation = await deriveCapture(sparse, mobileSha256);
    if (derivation.status !== "derived") throw new Error("expected a derivation");
    expect(derivation.derived.factSet.facts.map((fact) => fact.kind)).toEqual(["date", "date"]);
  });

  it("reports a capture the contract rejects rather than throwing", async () => {
    // One malformed capture must not stop a pass from deriving the rest.
    expect(() => normalizeSourceFacts(malformed)).toThrow();
    await expect(deriveCapture(malformed, mobileSha256)).resolves.toEqual({
      status: "not-derivable",
    });
  });

  it("is deterministic across repeated derivation of one capture", async () => {
    const first = await deriveCapture(purchase, mobileSha256);
    const second = await deriveCapture(purchase, mobileSha256);
    expect(first).toEqual(second);
  });
});

describe("digest independence", () => {
  let injected = 0;

  beforeAll(() => {
    injected = 0;
  });

  it("uses the digest it is given rather than a global", async () => {
    const counting = async (bytes: Uint8Array<ArrayBuffer>) => {
      injected += 1;
      return mobileSha256(bytes);
    };
    await deriveCapture(purchase, counting);
    // One fact-set fingerprint and one event-set fingerprint.
    expect(injected).toBe(2);
  });
});
