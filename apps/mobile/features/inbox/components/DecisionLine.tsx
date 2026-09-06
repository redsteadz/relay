import { StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui";
import { useRelayTheme } from "@/theme";

import type { ReceiptDecision } from "../models/receiptPresentation";

/**
 * How this item was filed, in one line.
 *
 * The mark carries the claim the line is making. A check means deterministic checks decided it and
 * nothing was sent anywhere; a tilde means a model was asked, or that Relay could not resolve the
 * item at all. Those are different enough that the receipt states which one every time, rather than
 * only when something went wrong.
 */
export function DecisionLine({ decision }: { decision: ReceiptDecision }) {
  const theme = useRelayTheme();
  const { spacing } = theme.relay;
  return (
    <View
      accessibilityLabel={
        decision.certain
          ? `Filed by deterministic checks. ${decision.text}`
          : `Filed with uncertainty. ${decision.text}`
      }
      style={[styles.line, { gap: spacing.xs }]}
    >
      <AppText tone={decision.certain ? "success" : "warning"} variant="caption">
        {decision.certain ? "✓" : "~"}
      </AppText>
      <AppText numberOfLines={2} style={styles.text} tone="muted" variant="caption">
        {decision.text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { alignItems: "center", flexDirection: "row" },
  text: { flexShrink: 1 },
});
