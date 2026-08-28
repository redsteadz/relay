import type { Session } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCapabilities = vi.hoisted(() => vi.fn());
const registerInstallation = vi.hoisted(() => vi.fn());
const syncQueuedCaptures = vi.hoisted(() => vi.fn());

vi.mock("../modules/relay-device-ingress", () => ({ default: { getCapabilities } }));
vi.mock("./device", () => ({ registerInstallation }));
vi.mock("./capture-sync", () => ({ syncQueuedCaptures }));

import { syncNotificationCaptures } from "./notification-capture-sync";

const userId = "638ce145-a77d-4c32-b798-cb398e881fc9";
const accessToken = "synthetic-token";
const session = {
  access_token: accessToken,
  user: { id: userId },
} as unknown as Session;

describe("syncNotificationCaptures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerInstallation.mockResolvedValue({ id: "19784902-e7a4-4f7f-b04d-e3a78c876629" });
  });

  it.each([
    { notificationListener: false, notificationCapturePaused: false },
    { notificationListener: true, notificationCapturePaused: true },
  ])("does not upload without active consent controls: %o", async (capabilities) => {
    getCapabilities.mockResolvedValue(capabilities);
    await syncNotificationCaptures(session);
    expect(registerInstallation).not.toHaveBeenCalled();
    expect(syncQueuedCaptures).not.toHaveBeenCalled();
  });

  it("registers the installation and uploads an active queue snapshot", async () => {
    getCapabilities.mockResolvedValue({
      notificationListener: true,
      notificationCapturePaused: false,
    });
    await syncNotificationCaptures(session);
    expect(syncQueuedCaptures).toHaveBeenCalledWith(
      userId,
      "19784902-e7a4-4f7f-b04d-e3a78c876629",
      accessToken,
    );
  });
});
