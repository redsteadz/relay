/**
 * The Relay Pro entitlement, read from whatever RevenueCat last told us.
 *
 * Structural input rather than the SDK's `CustomerInfo`, so the rule that decides what a person may
 * use is testable without a store, a network, or a native module. The SDK's type is assignable to
 * it, which is what keeps the two in step.
 */

import { RELAY_PRO_ENTITLEMENT } from "./configuration";

export type EntitlementSnapshot = {
  readonly billingIssueDetectedAt: string | null;
  readonly expirationDate: string | null;
  readonly isActive: boolean;
  readonly periodType: string;
  readonly productIdentifier: string;
  readonly store: string;
  readonly willRenew: boolean;
};

export type CustomerInfoSnapshot = {
  readonly entitlements: {
    readonly active: Readonly<Record<string, EntitlementSnapshot | undefined>>;
  };
  readonly managementURL: string | null;
};

export type ProEntitlement = {
  /** True only when RevenueCat reports the entitlement active right now. */
  active: boolean;
  /** The store reported a payment problem. The entitlement may still be active during a grace period. */
  billingIssue: boolean;
  expiresAt: string | undefined;
  /** Deep link to the store's subscription management screen, when the store provides one. */
  managementUrl: string | undefined;
  periodType: string | undefined;
  productIdentifier: string | undefined;
  store: string | undefined;
  /** False for a lifetime purchase and for a subscription the person has cancelled. */
  willRenew: boolean;
};

/**
 * No entitlement.
 *
 * This is the value every failure resolves to, which is the point: an unreachable entitlement
 * service, a misconfigured build and a person who has simply not subscribed all produce the same
 * state, and that state leaves the app working. Failing the other way would mean an outage at
 * RevenueCat could lock someone out of a local, offline product.
 */
export const freeEntitlement: ProEntitlement = {
  active: false,
  billingIssue: false,
  expiresAt: undefined,
  managementUrl: undefined,
  periodType: undefined,
  productIdentifier: undefined,
  store: undefined,
  willRenew: false,
};

/** Reads the Relay Pro entitlement out of a customer-info snapshot. */
export function proEntitlementFrom(customerInfo: CustomerInfoSnapshot): ProEntitlement {
  const entitlement = customerInfo.entitlements.active[RELAY_PRO_ENTITLEMENT];
  // `active` is keyed by identifier and only ever holds entitlements RevenueCat considers active,
  // but the flag is read anyway rather than inferred from the key being present.
  if (entitlement === undefined || !entitlement.isActive) {
    return {
      ...freeEntitlement,
      managementUrl: customerInfo.managementURL ?? undefined,
    };
  }

  return {
    active: true,
    billingIssue: entitlement.billingIssueDetectedAt !== null,
    expiresAt: entitlement.expirationDate ?? undefined,
    managementUrl: customerInfo.managementURL ?? undefined,
    periodType: entitlement.periodType,
    productIdentifier: entitlement.productIdentifier,
    store: entitlement.store,
    willRenew: entitlement.willRenew,
  };
}

/** A lifetime purchase never renews and never expires, which reads differently from a cancellation. */
export function isLifetime(entitlement: ProEntitlement): boolean {
  return entitlement.active && !entitlement.willRenew && entitlement.expiresAt === undefined;
}

/**
 * One line describing the current standing, for a settings row.
 *
 * Deliberately says nothing a store has not confirmed: no trial countdowns, no renewal price, and
 * no claim about what happens next beyond what `willRenew` and `expiresAt` already state.
 */
export function entitlementSummary(entitlement: ProEntitlement): string {
  if (!entitlement.active) return "Relay Pro is not active on this device.";
  if (entitlement.billingIssue) {
    return "Relay Pro is active, but the store reported a billing problem.";
  }
  if (isLifetime(entitlement)) return "Relay Pro is active for the lifetime of the app.";
  if (entitlement.expiresAt === undefined) return "Relay Pro is active.";
  return entitlement.willRenew
    ? `Relay Pro renews on ${formatDay(entitlement.expiresAt)}.`
    : `Relay Pro stays active until ${formatDay(entitlement.expiresAt)}.`;
}

/**
 * Day-precision only.
 *
 * A renewal time to the minute is precision the reader cannot act on, and it would change with the
 * device's timezone between two renders of the same fact.
 */
export function formatDay(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "an unknown date";
  return parsed.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}
