import { describe, expect, it } from "vitest";

import type { DeviceCapabilities } from "@/modules/relay-device-ingress";

import {
  notificationControlIntent,
  notificationStatus,
  smsControlIntent,
  smsStatus,
} from "./capturePresentation";

const base: DeviceCapabilities = {
  buildVariant: "development",
  notificationAllowedPackages: ["com.example.app"],
  notificationCapturePaused: true,
  notificationListener: false,
  platform: "android",
  smsAllowedSenders: ["+15551234567"],
  smsAvailable: true,
  smsCapturePaused: true,
  smsPermissionGranted: false,
  smsQueuedCount: 0,
};

describe("source presentation", () => {
  it("maps permission and pause controls from native capability state", () => {
    expect(notificationControlIntent(base)).toBe("authorize");
    expect(notificationStatus(base).label).toBe("No access");
    expect(notificationControlIntent({ ...base, notificationListener: true })).toBe("resume");
    expect(
      notificationControlIntent({
        ...base,
        notificationCapturePaused: false,
        notificationListener: true,
      }),
    ).toBe("pause");
    expect(smsControlIntent(base)).toBe("authorize");
    expect(smsControlIntent({ ...base, smsPermissionGranted: true })).toBe("resume");
    expect(
      smsControlIntent({
        ...base,
        smsCapturePaused: false,
        smsPermissionGranted: true,
      }),
    ).toBe("pause");
  });

  it("preserves the required unsupported SMS label", () => {
    expect(smsStatus({ ...base, smsAvailable: false }).label).toBe("NOT IN THIS BUILD");
  });
});
