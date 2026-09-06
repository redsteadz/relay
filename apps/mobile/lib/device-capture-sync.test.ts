import type { Session } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCapabilities = vi.hoisted(() => vi.fn());
const syncSmsInbox = vi.hoisted(() => vi.fn());
const registerInstallation = vi.hoisted(() => vi.fn());
const syncQueuedCaptures = vi.hoisted(() => vi.fn());

vi.mock("../modules/relay-device-ingress", () => ({
  default: { getCapabilities, syncSmsInbox },
}));
vi.mock("./device", () => ({ registerInstallation }));
vi.mock("./capture-sync", () => ({ syncQueuedCaptures }));

import { syncDeviceCaptures } from "./device-capture-sync";

const userId = "638ce145-a77d-4c32-b798-cb398e881fc9";
const deviceId = "19784902-e7a4-4f7f-b04d-e3a78c876629";
const accessToken = "synthetic-token";
const session = {
  access_token: accessToken,
  user: { id: userId },
} as unknown as Session;

const inactive = {
  notificationListener: false,
  notificationCapturePaused: true,
  smsAvailable: false,
  smsPermissionGranted: false,
  smsCapturePaused: true,
};

/** The device id the sync hands to the uploader, resolved the way the uploader would resolve it. */
async function resolvedDeviceId(): Promise<string> {
  const resolve = syncQueuedCaptures.mock.calls[0]?.[1] as () => Promise<string>;
  return resolve();
}

describe("syncDeviceCaptures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncSmsInbox.mockResolvedValue(0);
    registerInstallation.mockResolvedValue({ id: deviceId });
    syncQueuedCaptures.mockResolvedValue({
      accepted: 0,
      discarded: 0,
      ready: 0,
      stopped: false,
    });
  });

  // Captures in the queue were taken under the consent that applied when they were taken. Pausing a
  // source stops new reads; it is deleting queued captures that removes them. Uploading only while a
  // source happened to be live left already-taken captures with no way out at all.
  it("uploads what is already held even when no source is active now", async () => {
    getCapabilities.mockResolvedValue(inactive);

    await syncDeviceCaptures(session);

    expect(syncQueuedCaptures).toHaveBeenCalledWith(userId, expect.any(Function), accessToken);
  });

  it("does not read new SMS while that source is inactive", async () => {
    getCapabilities.mockResolvedValue(inactive);
    await syncDeviceCaptures(session);
    expect(syncSmsInbox).not.toHaveBeenCalled();
  });

  it("uploads an active notification queue without reading SMS", async () => {
    getCapabilities.mockResolvedValue({
      ...inactive,
      notificationListener: true,
      notificationCapturePaused: false,
    });

    await syncDeviceCaptures(session);

    expect(syncSmsInbox).not.toHaveBeenCalled();
    expect(syncQueuedCaptures).toHaveBeenCalledWith(userId, expect.any(Function), accessToken);
    await expect(resolvedDeviceId()).resolves.toBe(deviceId);
  });

  it("syncs provider-backed SMS before uploading the queue", async () => {
    getCapabilities.mockResolvedValue({
      ...inactive,
      smsAvailable: true,
      smsPermissionGranted: true,
      smsCapturePaused: false,
    });

    await syncDeviceCaptures(session);

    expect(syncSmsInbox).toHaveBeenCalledWith(userId);
    expect(syncSmsInbox.mock.invocationCallOrder[0]).toBeLessThan(
      syncQueuedCaptures.mock.invocationCallOrder[0] ?? 0,
    );
  });

  // Registering ran before the queue could be read, so a device that could not register never
  // reached its own queue and left every row untouched.
  it("does not register a device before knowing there is something to upload", async () => {
    getCapabilities.mockResolvedValue(inactive);

    await syncDeviceCaptures(session);

    expect(registerInstallation).not.toHaveBeenCalled();
  });

  // Reading new messages and sending held ones are independent. A read that cannot answer used to
  // take the upload down with it, holding back captures that had nothing to do with the failure.
  it("still uploads when the SMS inbox cannot be read", async () => {
    getCapabilities.mockResolvedValue({
      ...inactive,
      smsAvailable: true,
      smsPermissionGranted: true,
      smsCapturePaused: false,
    });
    syncSmsInbox.mockRejectedValue(new Error("inbox unavailable"));

    await syncDeviceCaptures(session);

    expect(syncQueuedCaptures).toHaveBeenCalledWith(userId, expect.any(Function), accessToken);
  });

  it("still uploads when capabilities cannot be read", async () => {
    getCapabilities.mockRejectedValue(new Error("capabilities unavailable"));

    await syncDeviceCaptures(session);

    expect(syncQueuedCaptures).toHaveBeenCalledWith(userId, expect.any(Function), accessToken);
  });
});
