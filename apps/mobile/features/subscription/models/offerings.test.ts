import { describe, expect, it } from "vitest";

import {
  hasPurchasablePlans,
  planRows,
  planTitle,
  type OfferingSnapshot,
  type PackageSnapshot,
} from "./offerings";

function entry(
  packageIdentifier: string,
  packageType: string,
  productIdentifier: string,
  title = "",
  priceString = "$1.00",
): PackageSnapshot {
  return {
    identifier: packageIdentifier,
    packageType,
    product: { description: "", identifier: productIdentifier, priceString, title },
  };
}

/**
 * The `default` offering exactly as RevenueCat serves it for this project: RevenueCat's reserved
 * package identifiers, each wrapping one of Relay's three products. Taken from a live
 * `GET /v1/subscribers/{id}/offerings` against the test key, deliberately out of order.
 */
const liveDefaultOffering: OfferingSnapshot = {
  availablePackages: [
    entry("$rc_lifetime", "LIFETIME", "lifetime"),
    entry("$rc_monthly", "MONTHLY", "monthly"),
    entry("$rc_annual", "ANNUAL", "yearly"),
  ],
  identifier: "default",
};

describe("planRows", () => {
  it("orders the live offering by ascending commitment", () => {
    expect(planRows(liveDefaultOffering).map((row) => row.productIdentifier)).toEqual([
      "monthly",
      "yearly",
      "lifetime",
    ]);
  });

  // A purchase is made against the package, so the package identifier must survive the mapping.
  it("keeps the package identifier a purchase is made against", () => {
    expect(planRows(liveDefaultOffering).map((row) => row.identifier)).toEqual([
      "$rc_monthly",
      "$rc_annual",
      "$rc_lifetime",
    ]);
  });

  /**
   * A package typed `CUSTOM` in the dashboard reports no standard type, so the order has to come
   * from the product identifier behind it instead.
   */
  it("falls back to the product identifier when the package type is custom", () => {
    const rows = planRows({
      availablePackages: [
        entry("pro_lifetime", "CUSTOM", "lifetime"),
        entry("pro_yearly", "CUSTOM", "yearly"),
        entry("pro_monthly", "CUSTOM", "monthly"),
      ],
      identifier: "default",
    });

    expect(rows.map((row) => row.productIdentifier)).toEqual(["monthly", "yearly", "lifetime"]);
  });

  it("falls back to RevenueCat's reserved identifiers when no package type is reported", () => {
    const rows = planRows({
      availablePackages: [
        entry("$rc_lifetime", "UNKNOWN", "a"),
        entry("$rc_annual", "UNKNOWN", "b"),
        entry("$rc_monthly", "UNKNOWN", "c"),
      ],
      identifier: "default",
    });

    expect(rows.map((row) => row.identifier)).toEqual([
      "$rc_monthly",
      "$rc_annual",
      "$rc_lifetime",
    ]);
  });

  // A plan nobody anticipated must still be purchasable rather than vanish from the list.
  it("keeps an unrecognized package, after the known ones", () => {
    const rows = planRows({
      availablePackages: [
        entry("$rc_three_month", "THREE_MONTH", "quarterly"),
        entry("$rc_monthly", "MONTHLY", "monthly"),
      ],
      identifier: "default",
    });

    expect(rows.map((row) => row.productIdentifier)).toEqual(["monthly", "quarterly"]);
  });

  it("marks the one-off purchase in the live offering", () => {
    const rows = planRows(liveDefaultOffering);

    expect(rows.find((row) => row.productIdentifier === "lifetime")?.lifetime).toBe(true);
    expect(rows.find((row) => row.productIdentifier === "yearly")?.lifetime).toBe(false);
    expect(rows.find((row) => row.productIdentifier === "monthly")?.lifetime).toBe(false);
  });

  // The store already localized and formatted it; recomputing would be a second source of truth.
  it("passes the store's formatted price through untouched", () => {
    const rows = planRows({
      availablePackages: [entry("$rc_annual", "ANNUAL", "yearly", "Yearly", "€39,99")],
      identifier: "default",
    });

    expect(rows[0]?.priceString).toBe("€39,99");
  });

  it("is empty when offerings could not be read", () => {
    expect(planRows(undefined)).toEqual([]);
  });
});

describe("planTitle", () => {
  it("prefers the store's own product title", () => {
    expect(planTitle(entry("$rc_annual", "ANNUAL", "yearly", "Relay Pro, yearly"))).toBe(
      "Relay Pro, yearly",
    );
  });

  it("names the plan when the store gives no title", () => {
    expect(planTitle(entry("$rc_monthly", "MONTHLY", "monthly"))).toBe("Monthly");
    expect(planTitle(entry("$rc_annual", "ANNUAL", "yearly"))).toBe("Yearly");
    expect(planTitle(entry("$rc_lifetime", "LIFETIME", "lifetime"))).toBe("Lifetime");
  });

  it("falls back to the package identifier for anything else", () => {
    expect(planTitle(entry("$rc_three_month", "THREE_MONTH", "quarterly"))).toBe("$rc_three_month");
  });
});

describe("hasPurchasablePlans", () => {
  // An offering configured with no packages is a dashboard mistake, and opening a paywall onto it
  // shows an empty sheet.
  it("separates an empty offering from an unreadable one", () => {
    expect(hasPurchasablePlans({ availablePackages: [], identifier: "default" })).toBe(false);
    expect(hasPurchasablePlans(undefined)).toBe(false);
    expect(hasPurchasablePlans(liveDefaultOffering)).toBe(true);
  });
});
