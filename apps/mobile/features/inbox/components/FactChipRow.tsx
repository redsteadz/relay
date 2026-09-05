import { StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui";
import { useRelayTheme } from "@/theme";

import type { InboxEvidence } from "../models/inboxPresentation";
import { receiptFactValue } from "../models/receiptPresentation";

/**
 * The facts Relay read, as chips.
 *
 * Set in monospace and keyed by name, because these are quoted values rather than Relay's own prose:
 * a reader checks them against what they remember, and that check is easier when the key is quiet,
 * the value is not, and two amounts line up.
 *
 * An uncertain fact is coloured as a warning and marked in its accessibility label rather than
 * dropped. A value Relay is unsure of is still the value it holds, and hiding it would make the
 * receipt look more confident than the pipeline was.
 */
export function FactChipRow({
  evidence,
  now,
}: {
  evidence: readonly InboxEvidence[];
  /** Fixed clock for tests. Production reads the reader's own. */
  now?: Date | undefined;
}) {
  const theme = useRelayTheme();
  const { colors, radii, spacing } = theme.relay;
  if (evidence.length === 0) return null;
  return (
    <View style={[styles.row, { gap: spacing.xs }]}>
      {evidence.map((fact, index) => {
        const value = receiptFactValue(fact, now);
        return (
          <View
            accessibilityLabel={
              fact.certain ? `${fact.key} ${value}` : `${fact.key} ${value}, read as uncertain`
            }
            key={`${fact.kind}-${fact.key}-${String(index)}`}
            style={[
              styles.chip,
              {
                backgroundColor: colors.surfaceRaised,
                borderRadius: radii.xs,
                paddingHorizontal: spacing.sm,
                paddingVertical: spacing.xxs,
              },
            ]}
          >
            <AppText tone="muted" variant="mono">
              {fact.key}{" "}
            </AppText>
            <AppText tone={fact.certain ? "default" : "warning"} variant="mono">
              {value}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", flexShrink: 1 },
  row: { flexDirection: "row", flexWrap: "wrap" },
});
