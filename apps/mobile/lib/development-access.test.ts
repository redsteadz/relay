import { describe, expect, it } from "vitest";

import {
  canEnterApp,
  canEnterSignIn,
  localDevelopmentAccessEnabled,
  notificationCaptureMode,
  notificationCaptureTenantId,
} from "./development-access";

describe("debug-only local access", () => {
  it("keeps sign-in reachable while local development access opens the app shell", () => {
    expect(canEnterApp(false, true)).toBe(true);
    expect(canEnterSignIn(false)).toBe(true);
    expect(canEnterSignIn(true)).toBe(false);
  });

  it("enters the app and assigns a stable synthetic Android capture tenant in development", () => {
    const localAccess = localDevelopmentAccessEnabled(true, "development");
    expect(canEnterApp(false, localAccess)).toBe(true);
    expect(notificationCaptureTenantId(undefined, localAccess, "android")).toBe(
      "relay-synthetic-local-development-notification-capture",
    );
  });

  it("does not bypass authentication in development-profile release builds", () => {
    const localAccess = localDevelopmentAccessEnabled(false, "development");
    expect(canEnterApp(false, localAccess)).toBe(false);
    expect(notificationCaptureTenantId(undefined, localAccess, "android")).toBeUndefined();
  });

  it("uses the same local diagnostic tenant in sideload debug builds", () => {
    const localAccess = localDevelopmentAccessEnabled(true, "sideload");
    expect(canEnterApp(false, localAccess)).toBe(true);
    expect(notificationCaptureTenantId(undefined, localAccess, "android")).toBe(
      "relay-synthetic-local-development-notification-capture",
    );
  });

  it("does not bypass authentication in sideload release builds", () => {
    const localAccess = localDevelopmentAccessEnabled(false, "sideload");
    expect(canEnterApp(false, localAccess)).toBe(false);
    expect(notificationCaptureTenantId(undefined, localAccess, "android")).toBeUndefined();
  });

  it("does not expose the synthetic capture tenant on unsupported platforms", () => {
    expect(notificationCaptureTenantId(undefined, true, "ios")).toBeUndefined();
    expect(notificationCaptureTenantId(undefined, true, "web")).toBeUndefined();
  });

  it("preserves authenticated access and tenant identity in every build", () => {
    const tenantId = "638ce145-a77d-4c32-b798-cb398e881fc9";
    expect(canEnterApp(true, false)).toBe(true);
    expect(notificationCaptureTenantId(tenantId, false, "android")).toBe(tenantId);
    expect(notificationCaptureTenantId(tenantId, true, "android")).toBe(tenantId);
  });

  it("preserves synthetic state only for unauthenticated Android local development", () => {
    expect(notificationCaptureMode(undefined, true, "android")).toEqual({
      cleanupTenantId: undefined,
      developmentLocal: true,
      stateKey: "development-local",
      tenantId: "relay-synthetic-local-development-notification-capture",
    });
  });

  it.each([
    { authenticatedTenantId: undefined, localAccess: false },
    {
      authenticatedTenantId: "638ce145-a77d-4c32-b798-cb398e881fc9",
      localAccess: false,
    },
    {
      authenticatedTenantId: "638ce145-a77d-4c32-b798-cb398e881fc9",
      localAccess: true,
    },
  ])(
    "cleans synthetic Android state outside unauthenticated local development: %o",
    ({ authenticatedTenantId, localAccess }) => {
      const mode = notificationCaptureMode(authenticatedTenantId, localAccess, "android");
      expect(mode.cleanupTenantId).toBe("relay-synthetic-local-development-notification-capture");
      expect(mode.developmentLocal).toBe(false);
    },
  );

  it("uses a new state key and fresh authenticated tenant after local sign-in", () => {
    const local = notificationCaptureMode(undefined, true, "android");
    const authenticated = notificationCaptureMode(
      "638ce145-a77d-4c32-b798-cb398e881fc9",
      true,
      "android",
    );

    expect(authenticated.stateKey).not.toBe(local.stateKey);
    expect(authenticated.tenantId).toBe("638ce145-a77d-4c32-b798-cb398e881fc9");
    expect(authenticated.cleanupTenantId).toBe(
      "relay-synthetic-local-development-notification-capture",
    );
  });

  it("does not expose synthetic cleanup identity to unsupported native adapters", () => {
    expect(notificationCaptureMode(undefined, false, "ios").cleanupTenantId).toBeUndefined();
    expect(notificationCaptureMode(undefined, false, "web").cleanupTenantId).toBeUndefined();
  });
});
