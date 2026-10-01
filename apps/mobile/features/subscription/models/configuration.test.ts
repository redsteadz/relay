import { describe, expect, it } from "vitest";

import { resolveSubscriptionConfiguration, subscriptionUnavailableMessage } from "./configuration";

const keys = {
  androidApiKey: "goog_synthetic",
  iosApiKey: "appl_synthetic",
};

describe("resolveSubscriptionConfiguration", () => {
  it("uses the platform's own key", () => {
    expect(
      resolveSubscriptionConfiguration({ ...keys, demo: false, platformOS: "android" }),
    ).toEqual({ apiKey: "goog_synthetic", configured: true });
    expect(resolveSubscriptionConfiguration({ ...keys, demo: false, platformOS: "ios" })).toEqual({
      apiKey: "appl_synthetic",
      configured: true,
    });
  });

  /**
   * The demo build talks to nothing by design. Checked before the key so a demo built in an
   * environment that happens to carry one is still inert.
   */
  it("stays inert in a demo build even when a key is present", () => {
    expect(
      resolveSubscriptionConfiguration({ ...keys, demo: true, platformOS: "android" }),
    ).toEqual({ configured: false, reason: "demo-build" });
  });

  it("reports a missing key for the platform it is missing on", () => {
    expect(
      resolveSubscriptionConfiguration({
        androidApiKey: undefined,
        demo: false,
        iosApiKey: "appl_synthetic",
        platformOS: "android",
      }),
    ).toEqual({ configured: false, reason: "missing-api-key" });
  });

  // An unset Expo variable can arrive as an empty string rather than undefined.
  it("treats a blank key as missing", () => {
    expect(
      resolveSubscriptionConfiguration({
        androidApiKey: "   ",
        demo: false,
        iosApiKey: undefined,
        platformOS: "android",
      }),
    ).toEqual({ configured: false, reason: "missing-api-key" });
  });

  it("refuses a platform with no store", () => {
    expect(resolveSubscriptionConfiguration({ ...keys, demo: false, platformOS: "web" })).toEqual({
      configured: false,
      reason: "unsupported-platform",
    });
  });
});

describe("subscriptionUnavailableMessage", () => {
  it("says nothing for a configured build", () => {
    expect(
      subscriptionUnavailableMessage({ apiKey: "goog_synthetic", configured: true }),
    ).toBeUndefined();
  });

  // The demo deliberately shows every surface without a store; a billing warning would be noise.
  it("says nothing for a demo build", () => {
    expect(
      subscriptionUnavailableMessage({ configured: false, reason: "demo-build" }),
    ).toBeUndefined();
  });

  it("explains a build that cannot sell", () => {
    expect(subscriptionUnavailableMessage({ configured: false, reason: "missing-api-key" })).toBe(
      "Relay Pro is unavailable in this build.",
    );
    expect(
      subscriptionUnavailableMessage({ configured: false, reason: "unsupported-platform" }),
    ).toBe("Relay Pro can only be purchased on Android or iOS.");
  });
});
