import { useState } from "react";

import { AppButton, AppText, StatusMessage } from "@/components/ui";

import { useSubscription } from "../context/subscription-context";
import { entitlementSummary } from "../models/entitlement";
import type { PurchaseOutcome } from "../models/purchaseOutcome";

/**
 * Relay Pro, in Settings.
 *
 * Thin by design: every decision it renders comes from `useSubscription` and the pure models beside
 * it, and the purchase and management flows themselves are RevenueCat's own screens rather than
 * anything reimplemented here.
 */
export function RelayProPanel() {
  const {
    entitlement,
    loading,
    openCustomerCenter,
    openPaywall,
    pro,
    restore,
    unavailableMessage,
  } = useSubscription();
  const [busy, setBusy] = useState<"manage" | "purchase" | "restore">();
  const [notice, setNotice] = useState<{ text: string; tone: "error" | "success" }>();

  async function run(kind: "manage" | "purchase" | "restore") {
    setBusy(kind);
    setNotice(undefined);
    try {
      if (kind === "manage") {
        const presented = await openCustomerCenter();
        if (!presented) {
          setNotice({ text: "Subscription management is unavailable right now.", tone: "error" });
        }
        return;
      }
      const outcome = kind === "purchase" ? await openPaywall() : await restore();
      setNotice(noticeFor(outcome, kind));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <>
      <AppText tone="muted" variant="caption">
        {loading ? "Checking your subscription..." : entitlementSummary(entitlement)}
      </AppText>

      {unavailableMessage === undefined ? null : (
        <StatusMessage tone="warning">{unavailableMessage}</StatusMessage>
      )}

      {entitlement.billingIssue ? (
        <StatusMessage tone="warning">
          Update your payment method in the store to keep Relay Pro active.
        </StatusMessage>
      ) : null}

      {pro ? (
        <AppButton
          label={busy === "manage" ? "Opening..." : "Manage subscription"}
          loading={busy === "manage"}
          onPress={() => void run("manage")}
          tone="secondary"
        />
      ) : (
        <AppButton
          label={busy === "purchase" ? "Opening..." : "See Relay Pro plans"}
          loading={busy === "purchase"}
          onPress={() => void run("purchase")}
          tone="secondary"
        />
      )}

      <AppButton
        label={busy === "restore" ? "Restoring..." : "Restore purchases"}
        loading={busy === "restore"}
        onPress={() => void run("restore")}
        tone="secondary"
      />

      {notice === undefined ? null : (
        <StatusMessage tone={notice.tone}>{notice.text}</StatusMessage>
      )}
    </>
  );
}

/**
 * What to say after a flow closes.
 *
 * A cancellation says nothing at all. Someone who closed the sheet already knows what they did, and
 * reporting it as an outcome reads as a failure they need to act on.
 */
function noticeFor(
  outcome: PurchaseOutcome,
  kind: "purchase" | "restore",
): { text: string; tone: "error" | "success" } | undefined {
  switch (outcome.kind) {
    case "cancelled":
      return undefined;
    case "failed":
      return { text: outcome.message, tone: "error" };
    case "not-presented":
      return kind === "restore"
        ? {
            text: "No previous Relay Pro purchase was found for this store account.",
            tone: "error",
          }
        : undefined;
    case "purchased":
      return { text: "Relay Pro is active. Thank you.", tone: "success" };
    case "restored":
      return { text: "Relay Pro has been restored on this device.", tone: "success" };
  }
}
