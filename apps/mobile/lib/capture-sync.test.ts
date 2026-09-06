import type { IngressEnvelope } from "@relay/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const acknowledgeCapture = vi.hoisted(() => vi.fn());
const failCapture = vi.hoisted(() => vi.fn());
const getReadyCaptures = vi.hoisted(() => vi.fn());

vi.mock("../modules/relay-device-ingress", () => ({
  default: { acknowledgeCapture, failCapture, getReadyCaptures },
}));
vi.mock("./observability", () => ({ logMobileError: vi.fn(), mobileRequestId: () => "request" }));

import { syncQueuedCaptures } from "./capture-sync";

const tenantId = "638ce145-a77d-4c32-b798-cb398e881fc9";
const deviceId = "19784902-e7a4-4f7f-b04d-e3a78c876629";

const envelope: IngressEnvelope = {
  schemaVersion: 1,
  id: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
  occurredAt: "2026-08-24T10:00:00Z",
  capturedAt: "2026-08-24T10:00:01Z",
  source: { kind: "notification", externalId: "synthetic-1" },
  attributes: {},
};

const second: IngressEnvelope = { ...envelope, id: "9c7f4a2b-0d51-4a3e-9d7a-1f2b3c4d5e6f" };

/** What the upload actually put on the wire, read back the way the API would read it. */
function sentBody(init: RequestInit | undefined): { deviceId: string; envelope: IngressEnvelope } {
  const body = init?.body;
  if (typeof body !== "string") throw new Error("Capture upload sent no JSON body");
  return JSON.parse(body) as { deviceId: string; envelope: IngressEnvelope };
}

function accepted(sent: IngressEnvelope): Response {
  return {
    status: 202,
    json: () => Promise.resolve({ accepted: true, durable: true, id: sent.id }),
  } as unknown as Response;
}

describe("syncQueuedCaptures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("EXPO_PUBLIC_API_URL", "https://api.relay.test");
    getReadyCaptures.mockResolvedValue([]);
    acknowledgeCapture.mockResolvedValue(undefined);
    failCapture.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  // The queue used to address `http://localhost:3000` when this was unset, which on a phone is the
  // phone. That turned a missing setting into an ordinary network failure nothing pointed at.
  it("refuses to upload rather than addressing localhost when no origin is configured", async () => {
    vi.stubEnv("EXPO_PUBLIC_API_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      syncQueuedCaptures(tenantId, () => Promise.resolve(deviceId), "token"),
    ).rejects.toMatchObject({ category: "configuration" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a queued capture to the configured origin and acknowledges it", async () => {
    getReadyCaptures.mockResolvedValue([{ attempts: 0, envelope, envelopeId: envelope.id }]);
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(accepted(envelope)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncQueuedCaptures(tenantId, () => Promise.resolve(deviceId), "token");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.relay.test/api/ingest",
      expect.objectContaining({ method: "POST" }),
    );
    expect(sentBody(fetchMock.mock.lastCall?.[1])).toEqual({ deviceId, envelope });
    expect(acknowledgeCapture).toHaveBeenCalledWith(tenantId, envelope.id);
    expect(result).toEqual({ accepted: 1, discarded: 0, ready: 1, stopped: false });
  });

  it("does not register a device when the queue is empty", async () => {
    const resolveDeviceId = vi.fn(() => Promise.resolve(deviceId));
    vi.stubGlobal("fetch", vi.fn());

    await syncQueuedCaptures(tenantId, resolveDeviceId, "token");

    expect(resolveDeviceId).not.toHaveBeenCalled();
  });

  it("registers once for a pass however many captures it sends", async () => {
    getReadyCaptures.mockResolvedValue([
      { attempts: 0, envelope, envelopeId: envelope.id },
      { attempts: 0, envelope: second, envelopeId: second.id },
    ]);
    const resolveDeviceId = vi.fn(() => Promise.resolve(deviceId));
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>((_url, init) => Promise.resolve(accepted(sentBody(init).envelope))),
    );

    const result = await syncQueuedCaptures(tenantId, resolveDeviceId, "token");

    expect(resolveDeviceId).toHaveBeenCalledTimes(1);
    expect(result.accepted).toBe(2);
  });

  // Registration failing is a fact about the environment, so the capture stays queued rather than
  // being spent. It used to happen before the queue was read at all, which stopped the drain dead.
  it("keeps a capture queued when the device cannot be registered", async () => {
    getReadyCaptures.mockResolvedValue([{ attempts: 0, envelope, envelopeId: envelope.id }]);
    vi.stubGlobal("fetch", vi.fn());

    const result = await syncQueuedCaptures(
      tenantId,
      () => Promise.reject(new Error("registration refused")),
      "token",
    );

    expect(failCapture).toHaveBeenCalledWith(tenantId, envelope.id, false);
    expect(acknowledgeCapture).not.toHaveBeenCalled();
    expect(result.stopped).toBe(true);
  });
});
