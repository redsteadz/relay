/**
 * The plans an offering actually contains, in the order a reader should meet them.
 *
 * The paywall itself is RevenueCat's, configured in their dashboard. This exists for the places
 * Relay has to say something about the plans in its own voice -- the settings row, an error state,
 * and the tests that prove an offering is wired up before anyone opens a store sheet.
 */

/** Mirrors `PACKAGE_TYPE` without importing the SDK, so this file stays testable in isolation. */
export type PackageTypeSnapshot = string;

export type PackageSnapshot = {
  readonly identifier: string;
  readonly packageType: PackageTypeSnapshot;
  readonly product: {
    readonly description: string;
    readonly identifier: string;
    readonly priceString: string;
    readonly title: string;
  };
};

export type OfferingSnapshot = {
  readonly availablePackages: readonly PackageSnapshot[];
  readonly identifier: string;
};

export type PlanRow = {
  /** The package identifier, which is what a purchase is made against. */
  identifier: string;
  /** True for a one-off purchase rather than a subscription. */
  lifetime: boolean;
  /** Already localized and currency-formatted by the store. Never recomputed here. */
  priceString: string;
  productIdentifier: string;
  title: string;
};

/**
 * Ascending commitment: monthly, then yearly, then lifetime.
 *
 * Anything the catalogue adds later sorts after the three known types rather than being dropped, so
 * a new package shows up in the UI instead of silently disappearing.
 */
const packageTypeOrder: Readonly<Record<string, number>> = {
  ANNUAL: 1,
  LIFETIME: 2,
  MONTHLY: 0,
};

/**
 * Relay's catalogue, by the store product identifier.
 *
 * Package identifiers are RevenueCat's own (`$rc_monthly`, `$rc_annual`, `$rc_lifetime` in the live
 * `default` offering), while these are the products behind them. Matching on the product rather
 * than the package is what lets a package typed `CUSTOM` in the dashboard still sort correctly.
 */
const productOrder: Readonly<Record<string, number>> = {
  lifetime: 2,
  monthly: 0,
  yearly: 1,
};

/** RevenueCat's reserved package identifiers, for an SDK build that reports no package type. */
const reservedPackageOrder: Readonly<Record<string, number>> = {
  $rc_annual: 1,
  $rc_lifetime: 2,
  $rc_monthly: 0,
};

function rank(entry: PackageSnapshot): number {
  return (
    packageTypeOrder[entry.packageType] ??
    reservedPackageOrder[entry.identifier] ??
    productOrder[entry.product.identifier.toLowerCase()] ??
    Number.MAX_SAFE_INTEGER
  );
}

function isLifetimePackage(entry: PackageSnapshot): boolean {
  return (
    entry.packageType === "LIFETIME" ||
    entry.identifier === "$rc_lifetime" ||
    entry.product.identifier.toLowerCase() === "lifetime"
  );
}

/**
 * Human title for a plan.
 *
 * The store's own product title wins when it has one, because that is the name the person will see
 * again on their receipt and in their store subscriptions list.
 */
export function planTitle(entry: PackageSnapshot): string {
  const title = entry.product.title.trim();
  if (title !== "") return title;
  if (isLifetimePackage(entry)) return "Lifetime";
  switch (entry.packageType) {
    case "ANNUAL":
      return "Yearly";
    case "MONTHLY":
      return "Monthly";
    default:
      return entry.identifier;
  }
}

export function planRows(offering: OfferingSnapshot | undefined): PlanRow[] {
  if (offering === undefined) return [];
  return [...offering.availablePackages]
    .sort(
      (left, right) => rank(left) - rank(right) || left.identifier.localeCompare(right.identifier),
    )
    .map((entry) => ({
      identifier: entry.identifier,
      lifetime: isLifetimePackage(entry),
      priceString: entry.product.priceString,
      productIdentifier: entry.product.identifier,
      title: planTitle(entry),
    }));
}

/**
 * Whether there is anything to sell.
 *
 * An offering with no packages is a configuration mistake rather than an empty catalogue, and it is
 * worth distinguishing from "offerings could not be loaded" before a paywall is opened onto nothing.
 */
export function hasPurchasablePlans(offering: OfferingSnapshot | undefined): boolean {
  return planRows(offering).length > 0;
}
