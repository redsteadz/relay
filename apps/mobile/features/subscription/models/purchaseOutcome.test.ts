import { describe, expect, it } from "vitest";

import {
  changesEntitlement,
  isUserCancelled,
  outcomeFromPaywallResult,
  outcomeFromThrown,
  purchaseFailedMessage,
  restoreFailedMessage,
} from "./purchaseOutcome";

describe("outcomeFromPaywallResult", () => {
  it("maps every result the paywall can return", () => {
    expect(outcomeFromPaywallResult("PURCHASED")).toEqual({ kind: "purchased" });
    expect(outcomeFromPaywallResult("RESTORED")).toEqual({ kind: "restored" });
    expect(outcomeFromPaywallResult("CANCELLED")).toEqual({ kind: "cancelled" });
    expect(outcomeFromPaywallResult("NOT_PRESENTED")).toEqual({ kind: "not-presented" });
    expect(outcomeFromPaywallResult("ERROR")).toEqual({
      kind: "failed",
      message: purchaseFailedMessage,
    });
  });

  // A result this build does not know is a failure, not a silent success.
  it("treats an unknown result as a failure", () => {
    expect(outcomeFromPaywallResult("SOMETHING_NEW")).toEqual({
      kind: "failed",
      message: purchaseFailedMessage,
    });
  });
});

describe("isUserCancelled", () => {
  // The SDK reports a cancellation two ways and the boolean is deprecated, so both are accepted.
  it("accepts either signal", () => {
    expect(isUserCancelled({ userCancelled: true })).toBe(true);
    expect(isUserCancelled({ code: "PURCHASE_CANCELLED_ERROR" })).toBe(true);
  });

  it("is not fooled by an ordinary failure", () => {
    expect(isUserCancelled({ code: "NETWORK_ERROR", userCancelled: false })).toBe(false);
    expect(isUserCancelled(new Error("boom"))).toBe(false);
    expect(isUserCancelled(null)).toBe(false);
    expect(isUserCancelled(undefined)).toBe(false);
    expect(isUserCancelled("PURCHASE_CANCELLED_ERROR")).toBe(false);
  });
});

describe("outcomeFromThrown", () => {
  /** Backing out of a store sheet is not a failure and must not be reported as one. */
  it("reads a cancellation as a cancellation", () => {
    expect(outcomeFromThrown({ userCancelled: true }, purchaseFailedMessage)).toEqual({
      kind: "cancelled",
    });
  });

  it("uses the caller's fixed message for a real failure", () => {
    expect(outcomeFromThrown(new Error("boom"), restoreFailedMessage)).toEqual({
      kind: "failed",
      message: restoreFailedMessage,
    });
  });

  /**
   * The SDK's message is written for a developer and can name a store account, so it must never
   * reach the screen.
   */
  it("never surfaces the thrown value's own message", () => {
    const outcome = outcomeFromThrown(
      { message: "Store account tester@example.test is not eligible" },
      purchaseFailedMessage,
    );
    expect(outcome).toEqual({ kind: "failed", message: purchaseFailedMessage });
  });
});

describe("changesEntitlement", () => {
  it("is true only when access actually changed", () => {
    expect(changesEntitlement({ kind: "purchased" })).toBe(true);
    expect(changesEntitlement({ kind: "restored" })).toBe(true);
    expect(changesEntitlement({ kind: "cancelled" })).toBe(false);
    expect(changesEntitlement({ kind: "not-presented" })).toBe(false);
    expect(changesEntitlement({ kind: "failed", message: purchaseFailedMessage })).toBe(false);
  });
});
