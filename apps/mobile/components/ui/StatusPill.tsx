import { StyleSheet, View } from "react-native";

import { useRelayTheme } from "@/theme";

import { AppText } from "./AppText";

export type StatusPillTone = "accent" | "danger" | "muted" | "success" | "warning";

/**
 * A source's state, as a pill.
 *
 * Filled rather than outlined: on a screen listing several sources, state is what a person scans
 * for, and a filled surface is legible in one pass where a coloured word beside an icon is not.
 * Each tone carries its own foreground token, so contrast holds in both themes.
 */
export function StatusPill({ label, tone }: { label: string; tone: StatusPillTone }) {
  const theme = useRelayTheme();
  const { colors, radii, spacing } = theme.relay;
  const surface = {
    accent: { background: colors.accentSubtle, foreground: colors.onAccentSubtle },
    danger: { background: colors.dangerSurface, foreground: colors.onDangerSurface },
    muted: { background: colors.surfaceRaised, foreground: colors.textMuted },
    success: { background: colors.successSurface, foreground: colors.onSuccessSurface },
    warning: { background: colors.warningSurface, foreground: colors.onWarningSurface },
  }[tone];

  return (
    <View
      accessibilityLabel={`Status: ${label}`}
      accessibilityLiveRegion="polite"
      style={[
        styles.pill,
        {
          backgroundColor: surface.background,
          borderRadius: radii.xs,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xxs,
        },
      ]}
    >
      <AppText numberOfLines={1} style={{ color: surface.foreground }} variant="monoMeta">
        {label.toUpperCase()}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexShrink: 0 },
});
