import type { Session } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCapabilities = vi.hoisted(() => vi.fn());
const syncSmsInbox = vi.hoisted(() => vi.fn());
const registerInstallation = vi.hoisted(() => vi.fn());
const syncQueuedCaptures = vi.hoisted(() => vi.fn());
const deriveQueuedCaptures = vi.hoisted(() => vi.fn());

vi.mock("../modules/relay-device-ingress", () => ({
  default: { getCapabilities, syncSmsInbox },
}));
vi.mock("./device", () => ({ registerInstallation }));
vi.mock("./capture-sync", () => ({ syncQueuedCaptures }));
vi.mock("./device-derivation", () => ({ deriveQueuedCaptures }));

import { syncDeviceCaptures } from "./device-capture-sync";

const userId = "638ce145-a77d-4c32-b798-cb398e881fc9";
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

describe("syncDeviceCaptures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncSmsInbox.mockResolvedValue(0);
    registerInstallation.mockResolvedValue({ id: "19784902-e7a4-4f7f-b04d-e3a78c876629" });
    deriveQueuedCaptures.mockResolvedValue({ derived: 0, notDerivable: 0, skipped: 0 });
  });

  it("does not read or upload without an active consented source", async () => {
    getCapabilities.mockResolvedValue(inactive);
    await syncDeviceCaptures(session);
    expect(syncSmsInbox).not.toHaveBeenCalled();
    expect(registerInstallation).not.toHaveBeenCalled();
    expect(syncQueuedCaptures).not.toHaveBeenCalled();
    // Consent gates derivation as well as upload: a paused source is not read for either.
    expect(deriveQueuedCaptures).not.toHaveBeenCalled();
  });

  it("uploads an active notification queue without reading SMS", async () => {
    getCapabilities.mockResolvedValue({
      ...inactive,
      notificationListener: true,
      notificationCapturePaused: false,
    });
    await syncDeviceCaptures(session);
    expect(syncSmsInbox).not.toHaveBeenCalled();
    expect(syncQueuedCaptures).toHaveBeenCalledWith(
      userId,
      "19784902-e7a4-4f7f-b04d-e3a78c876629",
      accessToken,
    );
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
    expect(syncQueuedCaptures).toHaveBeenCalledWith(
      userId,
      "19784902-e7a4-4f7f-b04d-e3a78c876629",
      accessToken,
    );
  });

  it("derives before registering, so derivation never waits on the network", async () => {
    const order: string[] = [];
    deriveQueuedCaptures.mockImplementation(() => {
      order.push("derive");
      return Promise.resolve({ derived: 1, notDerivable: 0, skipped: 0 });
    });
    registerInstallation.mockImplementation(() => {
      order.push("register");
      return Promise.resolve({ id: "19784902-e7a4-4f7f-b04d-e3a78c876629" });
    });
    syncQueuedCaptures.mockImplementation(() => {
      order.push("upload");
      return Promise.resolve({ acknowledged: 1, failed: 0, pending: 0 });
    });
    getCapabilities.mockResolvedValue({
      ...inactive,
      notificationListener: true,
      notificationCapturePaused: false,
    });

    await syncDeviceCaptures(session);

    // Upload deletes a capture's envelope from the queue, so deriving afterwards would derive
    // nothing; and registering first would make an offline phone skip derivation entirely.
    expect(order).toEqual(["derive", "register", "upload"]);
    expect(deriveQueuedCaptures).toHaveBeenCalledWith(userId);
  });

  it("still derives when registration fails, because the local rows do not depend on it", async () => {
    deriveQueuedCaptures.mockResolvedValue({ derived: 2, notDerivable: 0, skipped: 0 });
    registerInstallation.mockRejectedValue(new Error("synthetic registration failure"));
    getCapabilities.mockResolvedValue({
      ...inactive,
      notificationListener: true,
      notificationCapturePaused: false,
    });

    await expect(syncDeviceCaptures(session)).rejects.toThrow();

    expect(deriveQueuedCaptures).toHaveBeenCalledOnce();
    expect(syncQueuedCaptures).not.toHaveBeenCalled();
  });
});
