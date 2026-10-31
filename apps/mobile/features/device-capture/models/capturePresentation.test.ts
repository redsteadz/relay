import { describe, expect, it } from "vitest";

import type { DeviceCapabilities } from "@/modules/relay-device-ingress";

import {
  captureSwitchCopy,
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
  notificationSilenceKillSwitch: true,
  notificationSilenceMode: "off",
  notificationSilenceRevision: 0,
  notificationSilenceRuleCount: 0,
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

  it("says No access on the switch, not Paused, when Android has not granted access", () => {
    for (const source of ["notifications", "sms"] as const) {
      const intent =
        source === "notifications" ? notificationControlIntent(base) : smsControlIntent(base);
      expect(captureSwitchCopy(source, intent).label).toBe("No access");
    }
    // The switch and the status label above it describe one state, so they must agree.
    expect(captureSwitchCopy("notifications", notificationControlIntent(base)).label).toBe(
      notificationStatus(base).label,
    );
    expect(captureSwitchCopy("sms", smsControlIntent(base)).label).toBe(smsStatus(base).label);
  });

  it("keeps Paused for a pause the reader chose, and claims nothing before the first read", () => {
    const granted = { ...base, notificationListener: true, smsPermissionGranted: true };
    expect(captureSwitchCopy("notifications", notificationControlIntent(granted)).label).toBe(
      "Paused",
    );
    expect(captureSwitchCopy("sms", smsControlIntent(granted)).label).toBe("Paused");
    expect(
      captureSwitchCopy(
        "notifications",
        notificationControlIntent({ ...granted, notificationCapturePaused: false }),
      ).label,
    ).toBe("Capturing");
    expect(captureSwitchCopy("notifications", undefined)).toEqual({ label: "Checking access" });
  });

  it("preserves the required unsupported SMS label", () => {
    expect(smsStatus({ ...base, smsAvailable: false }).label).toBe("NOT IN THIS BUILD");
  });
});
