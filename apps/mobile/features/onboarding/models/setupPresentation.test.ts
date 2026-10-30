import { describe, expect, it } from "vitest";

import type { DeviceCapabilities } from "@/modules/relay-device-ingress";

import {
  backgroundPermission,
  continueLabel,
  notificationPermission,
  setupComplete,
  visibleRows,
  type BackgroundDeliveryInput,
} from "./setupPresentation";

function capabilities(overrides: Partial<DeviceCapabilities> = {}): DeviceCapabilities {
  return {
    buildVariant: "development",
    notificationAllowedPackages: [],
    notificationCapturePaused: true,
    notificationListener: false,
    notificationSilenceKillSwitch: false,
    notificationSilenceMode: "off",
    notificationSilenceRevision: 0,
    notificationSilenceRuleCount: 0,
    platform: "android",
    smsAllowedSenders: [],
    smsAvailable: false,
    smsCapturePaused: true,
    smsPermissionGranted: false,
    smsQueuedCount: 0,
    ...overrides,
  };
}

function delivery(overrides: Partial<BackgroundDeliveryInput> = {}): BackgroundDeliveryInput {
  return { busy: false, enabled: false, restricted: false, supported: true, ...overrides };
}

describe("notification permission", () => {
  it("waits on the first capability read", () => {
    expect(notificationPermission(undefined, false).state).toBe("checking");
  });

  it("still offers the control when the read failed", () => {
    expect(notificationPermission(undefined, true).state).toBe("needed");
  });

  it("asks until Android grants listener access", () => {
    expect(notificationPermission(capabilities(), false).state).toBe("needed");
    expect(notificationPermission(capabilities({ notificationListener: true }), false).state).toBe(
      "granted",
    );
  });

  it("is unavailable off Android", () => {
    expect(notificationPermission(capabilities({ platform: "ios" }), false).state).toBe(
      "unavailable",
    );
  });

  it("does not ask for an app list", () => {
    // ADR-0023: naming an application in a rule is what authorizes it. An empty allowlist is not a
    // missing step.
    const granted = notificationPermission(
      capabilities({ notificationAllowedPackages: [], notificationListener: true }),
      false,
    );
    expect(setupComplete(granted)).toBe(true);
  });
});

describe("background permission", () => {
  it("reports each delivery state", () => {
    expect(backgroundPermission(delivery({ supported: false })).state).toBe("unavailable");
    expect(backgroundPermission(delivery({ busy: true })).state).toBe("checking");
    expect(backgroundPermission(delivery()).state).toBe("needed");
    expect(backgroundPermission(delivery({ enabled: true })).state).toBe("granted");
  });

  it("names the system setting when Android restricts it", () => {
    const restricted = backgroundPermission(delivery({ restricted: true }));
    expect(restricted.state).toBe("restricted");
    expect(restricted.detail).toContain("battery settings");
  });
});

describe("setup completion", () => {
  it("is gated on notification access only", () => {
    const notifications = notificationPermission(capabilities(), false);
    expect(setupComplete(notifications)).toBe(false);
    expect(continueLabel(notifications)).toBe("Waiting for notification access");
  });

  it("lets a device that cannot capture continue", () => {
    const notifications = notificationPermission(capabilities({ platform: "web" }), false);
    expect(setupComplete(notifications)).toBe(true);
    expect(continueLabel(notifications)).toBe("Continue");
  });

  it("says it is checking before the first read lands", () => {
    expect(continueLabel(notificationPermission(undefined, false))).toBe("Checking access");
  });

  it("hides permissions this device cannot grant", () => {
    const rows = visibleRows([
      notificationPermission(capabilities({ notificationListener: true }), false),
      backgroundPermission(delivery({ supported: false })),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["notifications"]);
  });
});
