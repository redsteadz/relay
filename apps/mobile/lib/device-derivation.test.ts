import type { IngressEnvelope } from "@relay/contracts";
import { SOURCE_EVENT_EXTRACTOR_VERSION, SOURCE_FACT_NORMALIZER_VERSION } from "@relay/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getReadyCaptures = vi.hoisted(() => vi.fn());
const derivedCaptureIds = vi.hoisted(() => vi.fn());
const persistDerivedCapture = vi.hoisted(() => vi.fn());
const pruneLocalStore = vi.hoisted(() => vi.fn());
const openLocalStore = vi.hoisted(() => vi.fn());
const localStoreSupported = vi.hoisted(() => vi.fn());

vi.mock("../modules/relay-device-ingress", () => ({ default: { getReadyCaptures } }));
// The digest is delegated to WebCrypto so the fingerprints this pass produces are real values rather
// than placeholders; expo-crypto itself is a native module and cannot load here.
vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digest: (algorithm: string, data: BufferSource) => crypto.subtle.digest(algorithm, data),
}));
vi.mock("./local-store", () => ({
  derivedCaptureIds,
  localStoreSupported,
  openLocalStore,
  persistDerivedCapture,
  pruneLocalStore,
}));

const { deriveQueuedCaptures } = await import("./device-derivation");

function queued(suffix: string): { attempts: number; envelope: IngressEnvelope } {
  return {
    attempts: 0,
    envelope: {
      schemaVersion: 1,
      id: `20000000-0000-4000-8000-00000000${suffix}`,
      occurredAt: "2026-09-27T10:00:00Z",
      capturedAt: "2026-09-27T10:00:01Z",
      source: {
        kind: "notification",
        externalId: `synthetic-${suffix}`,
        applicationId: "com.example.app",
      },
      sender: "Example Bank",
      subject: "Synthetic card purchase",
      attributes: { amount: "14.20", currency: "USD" },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStoreSupported.mockReturnValue(true);
  openLocalStore.mockResolvedValue({});
  derivedCaptureIds.mockResolvedValue(new Set<string>());
  persistDerivedCapture.mockResolvedValue({ events: 1, facts: 4 });
  pruneLocalStore.mockResolvedValue(0);
});

describe("deriveQueuedCaptures", () => {
  it("derives every queued capture and prunes once afterwards", async () => {
    getReadyCaptures.mockResolvedValue([queued("0001"), queued("0002")]);

    await expect(deriveQueuedCaptures("tenant-a", 1_000)).resolves.toEqual({
      derived: 2,
      notDerivable: 0,
      skipped: 0,
    });
    expect(persistDerivedCapture).toHaveBeenCalledTimes(2);
    // One sweep per pass, not one per capture.
    expect(pruneLocalStore).toHaveBeenCalledTimes(1);
  });

  it("skips a capture already derived at the current versions", async () => {
    const entry = queued("0003");
    getReadyCaptures.mockResolvedValue([entry]);
    derivedCaptureIds.mockResolvedValue(new Set([entry.envelope.id]));

    await expect(deriveQueuedCaptures("tenant-a")).resolves.toEqual({
      derived: 0,
      notDerivable: 0,
      skipped: 1,
    });
    expect(persistDerivedCapture).not.toHaveBeenCalled();
    // Nothing was written, so nothing needs sweeping.
    expect(pruneLocalStore).not.toHaveBeenCalled();
  });

  it("asks for already-derived captures at the versions it is about to produce", async () => {
    getReadyCaptures.mockResolvedValue([queued("0004")]);

    await deriveQueuedCaptures("tenant-a");

    expect(derivedCaptureIds).toHaveBeenCalledWith(
      {},
      "tenant-a",
      SOURCE_FACT_NORMALIZER_VERSION,
      SOURCE_EVENT_EXTRACTOR_VERSION,
    );
  });

  it("counts a capture the contract rejects and still derives the rest", async () => {
    const broken = queued("0005");
    broken.envelope = { ...broken.envelope, id: "not-a-uuid" };
    getReadyCaptures.mockResolvedValue([broken, queued("0006")]);

    await expect(deriveQueuedCaptures("tenant-a")).resolves.toEqual({
      derived: 1,
      notDerivable: 1,
      skipped: 0,
    });
    expect(persistDerivedCapture).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the queue is empty", async () => {
    getReadyCaptures.mockResolvedValue([]);

    await expect(deriveQueuedCaptures("tenant-a")).resolves.toEqual({
      derived: 0,
      notDerivable: 0,
      skipped: 0,
    });
    expect(openLocalStore).not.toHaveBeenCalled();
  });

  it("does nothing on a platform without a local store", async () => {
    localStoreSupported.mockReturnValue(false);

    await expect(deriveQueuedCaptures("tenant-a")).resolves.toEqual({
      derived: 0,
      notDerivable: 0,
      skipped: 0,
    });
    expect(getReadyCaptures).not.toHaveBeenCalled();
  });

  it("reports one incident and returns an empty pass when the queue cannot be read", async () => {
    const loggedError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    getReadyCaptures.mockRejectedValue(new Error("synthetic native detail"));

    // A failed derivation must not fail the sync that was about to upload.
    await expect(deriveQueuedCaptures("tenant-a")).resolves.toEqual({
      derived: 0,
      notDerivable: 0,
      skipped: 0,
    });

    expect(loggedError).toHaveBeenCalledOnce();
    const entry = JSON.parse(loggedError.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(entry).toMatchObject({
      event: "background.capture_derivation_failed",
      error: { code: "CAPTURE_DERIVATION_FAILED" },
    });
    expect(loggedError.mock.calls[0]?.[0]).not.toContain("synthetic native detail");
    expect(loggedError.mock.calls[0]?.[0]).not.toContain("tenant-a");
  });

  it("passes the capture's own envelope to persistence", async () => {
    const entry = queued("0007");
    getReadyCaptures.mockResolvedValue([entry]);

    await deriveQueuedCaptures("tenant-a");

    const call = persistDerivedCapture.mock.calls[0] as
      [unknown, string, IngressEnvelope, { factSetFingerprint: string }] | undefined;
    expect(call?.[1]).toBe("tenant-a");
    expect(call?.[2]).toEqual(entry.envelope);
    // A real fingerprint, so the pass is persisting what it derived rather than a placeholder.
    expect(call?.[3].factSetFingerprint).toMatch(/^[0-9a-f]{64}$/u);
  });
});
