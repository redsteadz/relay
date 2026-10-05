import { Pressable, StyleSheet, View } from "react-native";

import { useRelayTheme } from "@/theme";

import { AppText } from "./AppText";
import { TintTile } from "./TintTile";

type ShareBarProps = {
  accessibilityHint?: string | undefined;
  count: number;
  label: string;
  onPress?: (() => void) | undefined;
  /** The largest count in the set, which the bar is drawn as a fraction of. */
  peak: number;
  /** Keeps one source the same colour here as in the list it links to. */
  tintKey?: string | undefined;
};

/**
 * One source's share of what arrived.
 *
 * The bar is relative to the loudest source rather than to the total, because the question is which
 * app is worst and by how much, and a share of the total renders every bar as a sliver once there
 * are more than a few sources.
 */
export function ShareBar({
  accessibilityHint,
  count,
  label,
  onPress,
  peak,
  tintKey,
}: ShareBarProps) {
  const theme = useRelayTheme();
  const { colors, interaction, radii, sizes, spacing } = theme.relay;
  const share = peak <= 0 ? 0 : Math.max(count / peak, 0);

  const body = (
    <View style={[styles.row, { gap: spacing.md, paddingVertical: spacing.sm }]}>
      <TintTile compact label={label} tintKey={tintKey} />
      <View style={[styles.copy, { gap: spacing.xs }]}>
        <View style={[styles.head, { gap: spacing.sm }]}>
          <AppText numberOfLines={1} style={styles.name} variant="label">
            {label}
          </AppText>
          <AppText style={{ color: colors.accent }} variant="monoMeta">
            {String(count)}
          </AppText>
        </View>
        <View
          style={[
            styles.track,
            {
              backgroundColor: colors.surfaceRaised,
              borderRadius: radii.pill,
              height: sizes.barTrack,
            },
          ]}
        >
          <View
            style={[
              styles.fill,
              {
                backgroundColor: colors.accent,
                borderRadius: radii.pill,
                width: `${Math.round(share * 100)}%`,
              },
            ]}
          />
        </View>
      </View>
    </View>
  );

  if (onPress === undefined) return body;
  return (
    <Pressable
      {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
      accessibilityLabel={`${label}, ${String(count)}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => (pressed ? { opacity: interaction.pressedOpacity } : undefined)}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  copy: { flex: 1 },
  fill: { height: "100%" },
  head: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  name: { flexShrink: 1 },
  row: { alignItems: "center", flexDirection: "row", width: "100%" },
  track: { overflow: "hidden", width: "100%" },
});
