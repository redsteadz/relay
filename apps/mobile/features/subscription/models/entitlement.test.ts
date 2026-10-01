import { describe, expect, it } from "vitest";

import {
  entitlementSummary,
  freeEntitlement,
  isLifetime,
  proEntitlementFrom,
  type CustomerInfoSnapshot,
  type EntitlementSnapshot,
} from "./entitlement";

function entitlement(overrides: Partial<EntitlementSnapshot> = {}): EntitlementSnapshot {
  return {
    billingIssueDetectedAt: null,
    expirationDate: "2027-01-01T00:00:00Z",
    isActive: true,
    periodType: "NORMAL",
    productIdentifier: "yearly",
    store: "PLAY_STORE",
    willRenew: true,
    ...overrides,
  };
}

function customerInfo(
  active: Record<string, EntitlementSnapshot> = {},
  managementURL: string | null = null,
): CustomerInfoSnapshot {
  return { entitlements: { active }, managementURL };
}

describe("proEntitlementFrom", () => {
  it("reads the Relay Pro entitlement", () => {
    const result = proEntitlementFrom(
      customerInfo({ relay_pro: entitlement() }, "https://play.test/manage"),
    );

    expect(result).toMatchObject({
      active: true,
      billingIssue: false,
      managementUrl: "https://play.test/manage",
      productIdentifier: "yearly",
      store: "PLAY_STORE",
      willRenew: true,
    });
  });

  it("ignores another entitlement the account happens to hold", () => {
    expect(proEntitlementFrom(customerInfo({ some_other_tier: entitlement() })).active).toBe(false);
  });

  it("reports no entitlement when none is active", () => {
    expect(proEntitlementFrom(customerInfo())).toEqual(freeEntitlement);
  });

  /** `active` should only ever hold active entitlements, but the flag is read rather than assumed. */
  it("does not trust the key alone", () => {
    expect(
      proEntitlementFrom(customerInfo({ relay_pro: entitlement({ isActive: false }) })).active,
    ).toBe(false);
  });

  it("surfaces a billing problem without withdrawing access", () => {
    const result = proEntitlementFrom(
      customerInfo({ relay_pro: entitlement({ billingIssueDetectedAt: "2026-09-30T00:00:00Z" }) }),
    );
    expect(result).toMatchObject({ active: true, billingIssue: true });
  });

  // The store's management link is still useful to someone whose subscription has lapsed.
  it("keeps the management link when the entitlement is inactive", () => {
    expect(proEntitlementFrom(customerInfo({}, "https://play.test/manage")).managementUrl).toBe(
      "https://play.test/manage",
    );
  });
});

describe("isLifetime", () => {
  it("is a purchase that neither renews nor expires", () => {
    const lifetime = proEntitlementFrom(
      customerInfo({
        relay_pro: entitlement({
          expirationDate: null,
          productIdentifier: "lifetime",
          willRenew: false,
        }),
      }),
    );
    expect(isLifetime(lifetime)).toBe(true);
  });

  it("is not a cancelled subscription, which still has an end date", () => {
    const cancelled = proEntitlementFrom(
      customerInfo({ relay_pro: entitlement({ willRenew: false }) }),
    );
    expect(isLifetime(cancelled)).toBe(false);
  });
});

describe("entitlementSummary", () => {
  it("distinguishes renewing, lapsing and lifetime", () => {
    const renewing = proEntitlementFrom(customerInfo({ relay_pro: entitlement() }));
    const cancelled = proEntitlementFrom(
      customerInfo({ relay_pro: entitlement({ willRenew: false }) }),
    );
    const lifetime = proEntitlementFrom(
      customerInfo({ relay_pro: entitlement({ expirationDate: null, willRenew: false }) }),
    );

    expect(entitlementSummary(renewing)).toContain("renews on");
    expect(entitlementSummary(cancelled)).toContain("stays active until");
    expect(entitlementSummary(lifetime)).toContain("lifetime");
  });

  it("says plainly when Relay Pro is not active", () => {
    expect(entitlementSummary(freeEntitlement)).toBe("Relay Pro is not active on this device.");
  });

  it("leads with a billing problem", () => {
    const billing = proEntitlementFrom(
      customerInfo({ relay_pro: entitlement({ billingIssueDetectedAt: "2026-09-30T00:00:00Z" }) }),
    );
    expect(entitlementSummary(billing)).toContain("billing problem");
  });

  // A stored date that cannot be parsed must not render "Invalid Date" at someone.
  it("degrades a malformed date into words", () => {
    const malformed = proEntitlementFrom(
      customerInfo({ relay_pro: entitlement({ expirationDate: "not-a-date" }) }),
    );
    expect(entitlementSummary(malformed)).toContain("an unknown date");
  });
});
