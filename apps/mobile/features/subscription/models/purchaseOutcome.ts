/**
 * What came back from a paywall, a purchase, or a restore, in Relay's own vocabulary.
 *
 * The SDK reports a cancellation as an error on the purchase path and as a result value on the
 * paywall path. Both are normal: a person closing a store sheet has not hit a failure and must not
 * be shown one. Mapping that here keeps the rule in one tested place rather than in each caller.
 */

export type PurchaseOutcome =
  /** The entitlement was granted. */
  | { kind: "purchased" }
  /** A previous purchase was reattached to this install. */
  | { kind: "restored" }
  /** The person closed the sheet. Not an error, and nothing is shown. */
  | { kind: "cancelled" }
  /** The paywall was not shown because the entitlement was already active. */
  | { kind: "not-presented" }
  /** Something went wrong. `message` is safe to display. */
  | { kind: "failed"; message: string };

/**
 * Mirrors `PAYWALL_RESULT` without importing the UI package into a pure module.
 *
 * Widened to `string` on purpose. The SDK's enum is the real input, and a release that adds a case
 * must reach the `default` below rather than failing to compile against a narrowed copy kept here.
 * Known values: `CANCELLED`, `ERROR`, `NOT_PRESENTED`, `PURCHASED`, `RESTORED`.
 */
export type PaywallResultValue = string;

export const purchaseFailedMessage =
  "That purchase could not be completed. No charge was made. Please try again.";

export const restoreFailedMessage =
  "Previous purchases could not be restored. Please try again, or check that you are signed in to the right store account.";

export const restoreFoundNothingMessage =
  "No previous Relay Pro purchase was found for this store account.";

/** Normalizes a paywall result. */
export function outcomeFromPaywallResult(result: PaywallResultValue): PurchaseOutcome {
  switch (result) {
    case "CANCELLED":
      return { kind: "cancelled" };
    case "NOT_PRESENTED":
      return { kind: "not-presented" };
    case "PURCHASED":
      return { kind: "purchased" };
    case "RESTORED":
      return { kind: "restored" };
    default:
      return { kind: "failed", message: purchaseFailedMessage };
  }
}

/**
 * Whether a thrown value is the SDK's "the person backed out" signal.
 *
 * Checked structurally. The SDK exposes both `userCancelled` and a `PURCHASE_CANCELLED_ERROR` code,
 * and the former is deprecated, so both are accepted rather than betting on one surviving.
 */
export function isUserCancelled(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; userCancelled?: unknown };
  return candidate.userCancelled === true || candidate.code === "PURCHASE_CANCELLED_ERROR";
}

/**
 * Normalizes a thrown purchase or restore failure.
 *
 * The SDK's own message is never surfaced: it is written for a developer, can name a store account,
 * and is not a sentence Relay chose. A fixed message is returned instead, and the original is
 * preserved as the `cause` of the logged `AppError` at the call site.
 */
export function outcomeFromThrown(error: unknown, fallbackMessage: string): PurchaseOutcome {
  if (isUserCancelled(error)) return { kind: "cancelled" };
  return { kind: "failed", message: fallbackMessage };
}

/** Whether an outcome means the cached entitlement is stale and should be re-read. */
export function changesEntitlement(outcome: PurchaseOutcome): boolean {
  return outcome.kind === "purchased" || outcome.kind === "restored";
}
