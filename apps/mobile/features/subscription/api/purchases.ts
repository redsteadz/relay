/**
 * Everything that touches the RevenueCat SDK.
 *
 * The rest of the app imports from here rather than from `react-native-purchases`, so there is one
 * place where the store is configured, one place that decides what reaches a log, and one place to
 * check against when asking what Relay sends to a third party.
 *
 * Two rules hold throughout:
 *
 * - **Failures resolve to the free tier.** Relay's local loop does not need a store, so an
 *   unreachable entitlement service must never be able to block the app. Every read here catches,
 *   logs once, and returns `freeEntitlement`.
 * - **Nothing from the SDK reaches a log.** Its errors carry store messages and account context, so
 *   the original is preserved as an `AppError` cause and only fixed codes and booleans are logged,
 *   per `docs/memory/observability.md`.
 */

import Purchases, {
  LOG_LEVEL,
  type CustomerInfo,
  type PurchasesOffering,
} from "react-native-purchases";
import RevenueCatUI from "react-native-purchases-ui";

import { logMobileError, runInBackground } from "@/lib/observability";

import { RELAY_PRO_ENTITLEMENT, type SubscriptionConfiguration } from "../models/configuration";
import { freeEntitlement, proEntitlementFrom, type ProEntitlement } from "../models/entitlement";
import {
  outcomeFromPaywallResult,
  outcomeFromThrown,
  purchaseFailedMessage,
  restoreFailedMessage,
  type PurchaseOutcome,
} from "../models/purchaseOutcome";

let configuredKey: string | undefined;

/**
 * Configures the SDK once per process.
 *
 * No `appUserID` is passed, so RevenueCat generates an anonymous identifier. Relay's Supabase user
 * id and the account email are deliberately never used here: they would hand a billing provider a
 * stable handle on an identity the rest of the product keeps to itself.
 *
 * Device-identifier collection is turned off explicitly rather than left at its default, which is
 * on. Diagnostics are turned off too. Both are configuration rather than discipline, so neither
 * depends on nobody later calling an attribution method.
 */
export function configureSubscriptions(configuration: SubscriptionConfiguration): boolean {
  if (!configuration.configured) return false;
  if (configuredKey === configuration.apiKey) return true;

  try {
    // Log level is a preference, not a precondition: failing to set it must not stop configuration.
    runInBackground(
      Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.WARN : LOG_LEVEL.ERROR),
      "subscription.log_level_failed",
      {
        code: "SUBSCRIPTION_LOG_LEVEL_FAILED",
        integration: "revenuecat",
        operation: "setLogLevel",
      },
    );
    Purchases.configure({
      apiKey: configuration.apiKey,
      automaticDeviceIdentifierCollectionEnabled: false,
      diagnosticsEnabled: false,
    });
    configuredKey = configuration.apiKey;
    return true;
  } catch (error: unknown) {
    logMobileError("subscription.configure_failed", error, {
      code: "SUBSCRIPTION_CONFIGURE_FAILED",
      integration: "revenuecat",
      operation: "configure",
    });
    return false;
  }
}

/** Whether `configureSubscriptions` has succeeded in this process. */
export function subscriptionsConfigured(): boolean {
  return configuredKey !== undefined;
}

/**
 * The current Relay Pro entitlement.
 *
 * Resolves to `freeEntitlement` when the SDK is not configured or the read fails, so a caller never
 * has to decide what an error means for access.
 */
export async function getProEntitlement(): Promise<ProEntitlement> {
  if (!subscriptionsConfigured()) return freeEntitlement;
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    return proEntitlementFrom(customerInfo);
  } catch (error: unknown) {
    logMobileError("subscription.customer_info_failed", error, {
      code: "SUBSCRIPTION_CUSTOMER_INFO_FAILED",
      integration: "revenuecat",
      operation: "getCustomerInfo",
    });
    return freeEntitlement;
  }
}

/**
 * The offering the paywall will show.
 *
 * `undefined` means no offering could be read or none is marked current in the dashboard. Both are
 * reasons not to open a paywall onto an empty sheet.
 */
export async function getCurrentOffering(): Promise<PurchasesOffering | undefined> {
  if (!subscriptionsConfigured()) return undefined;
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current ?? undefined;
  } catch (error: unknown) {
    logMobileError("subscription.offerings_failed", error, {
      code: "SUBSCRIPTION_OFFERINGS_FAILED",
      integration: "revenuecat",
      operation: "getOfferings",
    });
    return undefined;
  }
}

/**
 * Subscribes to entitlement changes.
 *
 * The store can grant or revoke outside the app -- a renewal, a refund, a family share -- so the
 * listener is what keeps a long-lived screen honest rather than polling.
 */
export function addEntitlementListener(
  onChange: (entitlement: ProEntitlement) => void,
): () => void {
  if (!subscriptionsConfigured()) return () => undefined;
  const listener = (customerInfo: CustomerInfo) => {
    onChange(proEntitlementFrom(customerInfo));
  };
  Purchases.addCustomerInfoUpdateListener(listener);
  return () => {
    Purchases.removeCustomerInfoUpdateListener(listener);
  };
}

/** Presents RevenueCat's configured paywall. */
export async function presentPaywall(offering?: PurchasesOffering): Promise<PurchaseOutcome> {
  if (!subscriptionsConfigured()) {
    return { kind: "failed", message: purchaseFailedMessage };
  }
  try {
    const result = await RevenueCatUI.presentPaywall(offering === undefined ? {} : { offering });
    return outcomeFromPaywallResult(result);
  } catch (error: unknown) {
    logMobileError("subscription.paywall_failed", error, {
      code: "SUBSCRIPTION_PAYWALL_FAILED",
      integration: "revenuecat",
      operation: "presentPaywall",
    });
    return outcomeFromThrown(error, purchaseFailedMessage);
  }
}

/**
 * Presents the paywall only when Relay Pro is not already active.
 *
 * The entitlement check is RevenueCat's own, which makes this the right call for a gate: it cannot
 * disagree with the entitlement the SDK would report a moment later.
 */
export async function presentPaywallIfNeeded(
  offering?: PurchasesOffering,
): Promise<PurchaseOutcome> {
  if (!subscriptionsConfigured()) {
    return { kind: "failed", message: purchaseFailedMessage };
  }
  try {
    const result = await RevenueCatUI.presentPaywallIfNeeded({
      requiredEntitlementIdentifier: RELAY_PRO_ENTITLEMENT,
      ...(offering === undefined ? {} : { offering }),
    });
    return outcomeFromPaywallResult(result);
  } catch (error: unknown) {
    logMobileError("subscription.paywall_failed", error, {
      code: "SUBSCRIPTION_PAYWALL_FAILED",
      integration: "revenuecat",
      operation: "presentPaywallIfNeeded",
    });
    return outcomeFromThrown(error, purchaseFailedMessage);
  }
}

/**
 * Presents the Customer Center.
 *
 * This is where a subscriber cancels, requests a refund, or changes plan. Relay does not reimplement
 * any of that: those flows belong to the store, and a hand-rolled cancellation screen would be both
 * wrong and, on some stores, against policy.
 */
export async function presentCustomerCenter(): Promise<boolean> {
  if (!subscriptionsConfigured()) return false;
  try {
    await RevenueCatUI.presentCustomerCenter();
    return true;
  } catch (error: unknown) {
    logMobileError("subscription.customer_center_failed", error, {
      code: "SUBSCRIPTION_CUSTOMER_CENTER_FAILED",
      integration: "revenuecat",
      operation: "presentCustomerCenter",
    });
    return false;
  }
}

/**
 * Reattaches a previous purchase to this install.
 *
 * Required by both stores, and the only route back for someone who reinstalled or changed device
 * while Relay keeps no server-side billing identity of its own.
 */
export async function restorePurchases(): Promise<{
  entitlement: ProEntitlement;
  outcome: PurchaseOutcome;
}> {
  if (!subscriptionsConfigured()) {
    return {
      entitlement: freeEntitlement,
      outcome: { kind: "failed", message: restoreFailedMessage },
    };
  }
  try {
    const customerInfo = await Purchases.restorePurchases();
    const entitlement = proEntitlementFrom(customerInfo);
    return {
      entitlement,
      // A restore that finds nothing is a successful call with an empty result, not a failure.
      outcome: entitlement.active ? { kind: "restored" } : { kind: "not-presented" },
    };
  } catch (error: unknown) {
    logMobileError("subscription.restore_failed", error, {
      code: "SUBSCRIPTION_RESTORE_FAILED",
      integration: "revenuecat",
      operation: "restorePurchases",
    });
    return {
      entitlement: freeEntitlement,
      outcome: outcomeFromThrown(error, restoreFailedMessage),
    };
  }
}
