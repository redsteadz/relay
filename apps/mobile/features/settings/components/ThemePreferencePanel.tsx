import { StyleSheet, View } from "react-native";
import { SegmentedButtons } from "react-native-paper";

import { AppText } from "@/components/ui";
import { useRelayTheme, useThemePreference, type ThemePreference } from "@/theme";

const choices = [
  { icon: "theme-light-dark", label: "System", value: "system" },
  { icon: "white-balance-sunny", label: "Light", value: "light" },
  { icon: "moon-waning-crescent", label: "Dark", value: "dark" },
] as const;

/**
 * The theme picker, as a control rather than an essay.
 *
 * It used to be a titled card with a sentence explaining that a theme follows the device or does
 * not, which is what the word "System" already says. What is worth stating is the thing a reader
 * cannot see: both schemes are contrast-tested, so neither choice is the degraded one.
 */
export function ThemePreferencePanel() {
  const theme = useRelayTheme();
  const { borders, colors, radii, sizes, spacing } = theme.relay;

  const { colorScheme, preference, setPreference } = useThemePreference();

  return (
    <View
      style={[
        styles.panel,
        {
          backgroundColor: colors.surface,
          borderColor: colors.borderSubtle,
          borderRadius: radii.lg,
          borderWidth: borders.hairline,
          gap: spacing.md,
          padding: spacing.lg,
        },
      ]}
    >
      <View style={[styles.head, { gap: spacing.sm }]}>
        <AppText variant="label">Appearance</AppText>
        <AppText tone="muted" variant="monoMeta">
          {`${colorScheme} active`}
        </AppText>
      </View>
      <SegmentedButtons
        buttons={choices.map((choice) => ({
          ...choice,
          accessibilityLabel: `${choice.label} theme`,
          checkedColor: colors.onAccentSubtle,
          style: { backgroundColor: preference === choice.value ? colors.accentSubtle : undefined },
          uncheckedColor: colors.textMuted,
        }))}
        density="regular"
        onValueChange={(value: ThemePreference) => setPreference(value)}
        style={{ minHeight: sizes.control }}
        value={preference}
      />
      <AppText tone="muted" variant="caption">
        Both themes are contrast-tested, so neither is the degraded one.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
  },
  panel: { width: "100%" },
});
