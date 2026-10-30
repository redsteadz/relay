import { StyleSheet, View } from "react-native";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";

import { AppText, TintTile } from "@/components/ui";
import { useRelayTheme, type RelayTintName } from "@/theme";

/** Synthetic noise: the kind of thing Relay exists to keep out of the way. */
const NOISE: readonly { icon: string; label: string; tint: RelayTintName }[] = [
  { icon: "tag-outline", label: "20% off everything", tint: "rose" },
  { icon: "heart-outline", label: "Someone liked your post", tint: "violet" },
  { icon: "timer-sand", label: "Sale ends tonight", tint: "amber" },
];

/**
 * Many notifications in, one receipt out.
 *
 * The product's claim drawn rather than written: three dimmed notifications fan in from the top and
 * resolve into the one item Relay kept, filed. It is decoration, so assistive technology skips it and
 * reads the heading beneath instead.
 */
export function SignalIllustration() {
  const theme = useRelayTheme();
  const { borders, colors, interaction, motion, radii, sizes, spacing } = theme.relay;
  const offsets = [-spacing.lg, spacing.md, -spacing.xs];
  const fades = [interaction.disabledOpacity, interaction.pressedOpacity, 1];

  function entrance(order: number) {
    return FadeInDown.delay(order * motion.duration.fast)
      .duration(motion.duration.emphasis)
      .reduceMotion(ReduceMotion.System);
  }

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.frame, { maxWidth: sizes.noticeMaxWidth }]}
    >
      {NOISE.map((signal, index) => (
        <Animated.View
          entering={entrance(index)}
          key={signal.label}
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: colors.borderSubtle,
              borderRadius: radii.lg,
              borderWidth: borders.hairline,
              gap: spacing.md,
              marginTop: index === 0 ? 0 : -spacing.sm,
              opacity: fades[index],
              padding: spacing.md,
              transform: [{ translateX: offsets[index] ?? 0 }],
            },
          ]}
        >
          <TintTile compact icon={signal.icon} label={signal.label} tint={signal.tint} />
          <View style={[styles.lines, { gap: spacing.xs }]}>
            <AppText numberOfLines={1} tone="muted" variant="caption">
              {signal.label}
            </AppText>
            <View
              style={[
                styles.bar,
                {
                  backgroundColor: colors.borderSubtle,
                  borderRadius: radii.pill,
                  height: spacing.xs,
                },
              ]}
            />
          </View>
        </Animated.View>
      ))}

      <Animated.View
        entering={entrance(NOISE.length)}
        style={[
          styles.connector,
          { backgroundColor: colors.accent, height: spacing.xl, width: borders.emphasis },
        ]}
      />

      <Animated.View
        entering={entrance(NOISE.length + 1)}
        style={[
          styles.card,
          {
            backgroundColor: colors.surfaceRaised,
            borderColor: colors.accent,
            borderRadius: radii.lg,
            borderWidth: borders.emphasis,
            gap: spacing.md,
            padding: spacing.md,
          },
        ]}
      >
        <TintTile icon="package-variant-closed" label="Delivery" tint="mint" />
        <View style={[styles.lines, { gap: spacing.xxs }]}>
          <AppText numberOfLines={1} variant="bodyStrong">
            Parcel arrives today
          </AppText>
          <AppText numberOfLines={1} tone="success" variant="monoMeta">
            ✓ Filed · Deliveries
          </AppText>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { width: "60%" },
  card: { alignItems: "center", flexDirection: "row", width: "100%" },
  connector: { alignSelf: "center" },
  frame: { alignItems: "center", alignSelf: "center", width: "100%" },
  lines: { flex: 1 },
});
