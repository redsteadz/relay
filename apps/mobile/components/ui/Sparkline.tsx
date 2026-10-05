import { StyleSheet, View } from "react-native";

import { useRelayTheme } from "@/theme";

import { AppText } from "./AppText";

type SparklineProps = {
  /** One count per bucket, in order. Twenty-four of them makes a day. */
  buckets: readonly number[];
  /** Spoken in place of the bars, which carry no text of their own. */
  label: string;
  /** Written under the first, middle, and last bucket. */
  ticks: readonly string[];
};

/**
 * When things arrived, as bars.
 *
 * A count alone says how loud a day was; this says when it was loud, which is the question a person
 * actually has about their notifications. Drawn from plain views rather than a charting dependency:
 * twenty-four rectangles do not justify a library, and the alternative would be the second one in
 * the app able to draw a colour.
 *
 * An empty bucket keeps a visible floor rather than vanishing, so the axis stays readable and a
 * quiet hour is distinguishable from a missing one.
 */
export function Sparkline({ buckets, label, ticks }: SparklineProps) {
  const theme = useRelayTheme();
  const { colors, radii, sizes, spacing } = theme.relay;
  const peak = Math.max(...buckets, 1);

  return (
    <View accessibilityLabel={label} style={[styles.chart, { gap: spacing.sm }]}>
      <View style={[styles.bars, { gap: spacing.xxs, height: sizes.sparkline }]}>
        {buckets.map((count, index) => (
          <View
            key={index}
            style={[
              styles.bar,
              {
                backgroundColor: count === 0 ? colors.surfaceRaised : colors.accent,
                borderRadius: radii.xs,
                height: count === 0 ? sizes.sparkBar : (count / peak) * sizes.sparkline,
                minWidth: sizes.sparkBar,
              },
            ]}
          />
        ))}
      </View>
      <View style={styles.ticks}>
        {ticks.map((tick) => (
          <AppText key={tick} tone="muted" variant="monoMeta">
            {tick}
          </AppText>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flex: 1 },
  bars: { alignItems: "flex-end", flexDirection: "row", width: "100%" },
  chart: { width: "100%" },
  ticks: { flexDirection: "row", justifyContent: "space-between", width: "100%" },
});
