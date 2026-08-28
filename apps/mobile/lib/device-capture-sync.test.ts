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
  });

  it("does not read or upload without an active consented source", async () => {
    getCapabilities.mockResolvedValue(inactive);
    await syncDeviceCaptures(session);
    expect(syncSmsInbox).not.toHaveBeenCalled();
    expect(registerInstallation).not.toHaveBeenCalled();
    expect(syncQueuedCaptures).not.toHaveBeenCalled();
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
});
