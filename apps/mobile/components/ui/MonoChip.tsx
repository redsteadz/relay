import { StyleSheet, View } from "react-native";

import { useRelayTheme } from "@/theme";

import { AppText } from "./AppText";

/**
 * A quoted value, boxed.
 *
 * The same shape a fact takes on a receipt, so a field named in a rule's disclosure list reads as
 * the same kind of thing as the fact that would fill it. Monospace throughout: these are exact
 * strings, not prose about them.
 */
export function MonoChip({ label, value }: { label?: string | undefined; value: string }) {
  const theme = useRelayTheme();
  const { colors, radii, spacing } = theme.relay;
  return (
    <View
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
      {label === undefined ? null : (
        <AppText tone="muted" variant="mono">
          {label}{" "}
        </AppText>
      )}
      <AppText variant="mono">{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", flexShrink: 1 },
});
