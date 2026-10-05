import { StyleSheet, View } from "react-native";

import { useRelayTheme } from "@/theme";

import { AppText } from "./AppText";

export type Metric = {
  /** Draws the number in the accent. Reserved for the one count a reader is being asked to act on. */
  emphasis?: boolean;
  key: string;
  label: string;
  value: number;
};

/**
 * Three counts, side by side, as the first thing on the home screen.
 *
 * The number leads and the label follows it in muted caption type, which is the opposite of how
 * Relay used to set this: a label read louder than its value tells a person what kind of thing they
 * are not yet looking at. Mono figures keep the three columns aligned as counts change.
 */
export function MetricRow({ metrics }: { metrics: readonly Metric[] }) {
  const theme = useRelayTheme();
  const { borders, colors, radii, spacing } = theme.relay;
  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: colors.surface,
          borderColor: colors.borderSubtle,
          borderRadius: radii.lg,
          borderWidth: borders.hairline,
          paddingVertical: spacing.lg,
        },
      ]}
    >
      {metrics.map((metric, index) => (
        <View
          accessibilityLabel={`${String(metric.value)} ${metric.label}`}
          key={metric.key}
          style={[
            styles.tile,
            { gap: spacing.xxs, paddingHorizontal: spacing.sm },
            index > 0 && {
              borderLeftColor: colors.borderSubtle,
              borderLeftWidth: borders.hairline,
            },
          ]}
        >
          <AppText
            style={metric.emphasis === true ? { color: colors.accent } : undefined}
            variant="metric"
          >
            {String(metric.value)}
          </AppText>
          <AppText numberOfLines={1} style={styles.label} tone="muted" variant="caption">
            {metric.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { textAlign: "center" },
  row: { flexDirection: "row", width: "100%" },
  tile: { alignItems: "center", flex: 1 },
});
