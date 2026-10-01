/**
 * Whether this build talks to RevenueCat at all, and with which key.
 *
 * Kept pure and keyed on explicit inputs so the decision is testable without a platform, an
 * environment, or the SDK itself. Every caller resolves it once and branches on the result rather
 * than re-reading `process.env` at each call site.
 */

/** The entitlement that unlocks Relay Pro. Configured under this identifier in RevenueCat. */
export const RELAY_PRO_ENTITLEMENT = "relay_pro";

export type SubscriptionConfiguration =
  | {
      configured: true;
      apiKey: string;
    }
  | {
      configured: false;
      /**
       * Why the SDK is inert. Carried so a screen can distinguish "this build does not sell
       * anything" from "this build is misconfigured", which are different things to show a person.
       */
      reason: "demo-build" | "missing-api-key" | "unsupported-platform";
    };

export type SubscriptionConfigurationInput = {
  androidApiKey: string | undefined;
  /**
   * `demoModeEnabled()`. The demo build talks to nothing by design, so it must not carry a billing
   * identity or reach a hosted service.
   */
  demo: boolean;
  iosApiKey: string | undefined;
  /** `Platform.OS`. */
  platformOS: string;
};

function trimmedKey(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

/**
 * Resolves the store key for this platform, or the reason there is none.
 *
 * Demo is checked before the platform and before the key: a demo build is inert even if a key
 * happens to be present in the environment that built it.
 */
export function resolveSubscriptionConfiguration(
  input: SubscriptionConfigurationInput,
): SubscriptionConfiguration {
  if (input.demo) return { configured: false, reason: "demo-build" };

  // Purchases exist only where a store does. Web and anything else resolve to no store rather than
  // to a key that could not complete a transaction.
  if (input.platformOS !== "android" && input.platformOS !== "ios") {
    return { configured: false, reason: "unsupported-platform" };
  }

  const apiKey = trimmedKey(input.platformOS === "ios" ? input.iosApiKey : input.androidApiKey);
  if (apiKey === undefined) return { configured: false, reason: "missing-api-key" };

  return { apiKey, configured: true };
}

/**
 * What a person is told when the SDK is inert.
 *
 * `undefined` for a demo build: the demo deliberately shows every surface without a store, and a
 * warning about billing configuration would be noise rather than information.
 */
export function subscriptionUnavailableMessage(
  configuration: SubscriptionConfiguration,
): string | undefined {
  if (configuration.configured) return undefined;
  switch (configuration.reason) {
    case "demo-build":
      return undefined;
    case "missing-api-key":
      return "Relay Pro is unavailable in this build.";
    case "unsupported-platform":
      return "Relay Pro can only be purchased on Android or iOS.";
  }
}
