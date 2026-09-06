import { StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui";
import { useRelayTheme } from "@/theme";

import {
  dataHoldings,
  holdingAccessibilityLabel,
  holdingMarks,
  holdingPlaces,
  type HoldingLevel,
} from "../models/dataHoldings";

/**
 * Where each kind of data lives.
 *
 * A grid rather than five paragraphs, because the question underneath it -- "does this leave the
 * device" -- is a comparison, and a comparison is what a grid answers in one glance. Each mark is
 * coloured by how exposed it is, and every row carries the sentence its four marks cannot make on
 * their own.
 *
 * Screen readers get the full sentence per row rather than the marks, since a column of symbols
 * read left to right conveys nothing without its header.
 */
export function DataHoldingsTable() {
  const theme = useRelayTheme();
  const { borders, colors, spacing } = theme.relay;

  const markColor: Readonly<Record<HoldingLevel, string>> = {
    full: colors.text,
    "n/a": colors.borderSubtle,
    none: colors.textMuted,
    partial: colors.warning,
  };

  return (
    <View style={[styles.table, { gap: spacing.md }]}>
      <View
        aria-hidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.row,
          {
            borderBottomColor: colors.borderSubtle,
            borderBottomWidth: borders.hairline,
            paddingBottom: spacing.xs,
          },
        ]}
      >
        <View style={styles.label} />
        {holdingPlaces.map((place) => (
          <AppText key={place} style={styles.cell} tone="muted" variant="monoMeta">
            {place.slice(0, 3).toUpperCase()}
          </AppText>
        ))}
      </View>

      {dataHoldings.map((holding) => (
        <View
          accessibilityLabel={holdingAccessibilityLabel(holding)}
          key={holding.label}
          style={[styles.entry, { gap: spacing.xs }]}
        >
          <View style={styles.row}>
            <View style={[styles.label, { paddingRight: spacing.sm }]}>
              <AppText variant="bodyStrong">{holding.label}</AppText>
              <AppText tone="muted" variant="monoMeta">
                {holding.sublabel}
              </AppText>
            </View>
            {holding.levels.map((level, index) => (
              <AppText
                key={holdingPlaces[index]}
                style={[styles.cell, { color: markColor[level] }]}
                variant="mono"
              >
                {holdingMarks[level]}
              </AppText>
            ))}
          </View>
          <AppText tone="muted" variant="caption">
            {holding.note}
          </AppText>
        </View>
      ))}

      <View style={[styles.legend, { gap: spacing.md }]}>
        {(["full", "partial", "none", "n/a"] as const).map((level) => (
          <AppText key={level} tone="muted" variant="monoMeta">
            {`${holdingMarks[level]} ${level === "n/a" ? "n/a" : level}`}
          </AppText>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cell: { flexBasis: 0, flexGrow: 1, textAlign: "center" },
  entry: { width: "100%" },
  label: { flexBasis: 0, flexGrow: 3, flexShrink: 1 },
  legend: { flexDirection: "row", flexWrap: "wrap" },
  row: { alignItems: "center", flexDirection: "row", width: "100%" },
  table: { width: "100%" },
});
