import { SegmentedButtons } from "react-native-paper";

import { AppText, EditorialSurface } from "@/components/ui";
import { useRelayTheme, useThemePreference, type ThemePreference } from "@/theme";

const choices = [
  { icon: "theme-light-dark", label: "System", value: "system" },
  { icon: "white-balance-sunny", label: "Light", value: "light" },
  { icon: "moon-waning-crescent", label: "Dark", value: "dark" },
] as const;

export function ThemePreferencePanel() {
  const theme = useRelayTheme();
  const { colorScheme, preference, setPreference } = useThemePreference();

  return (
    <EditorialSurface icon="palette-outline" title="Appearance" meta={`${colorScheme} active`}>
      <AppText tone="muted">
        Follow this device automatically, or keep Relay in one contrast-tested theme.
      </AppText>
      <SegmentedButtons
        buttons={choices.map((choice) => ({
          ...choice,
          accessibilityLabel: `${choice.label} theme`,
        }))}
        density="regular"
        onValueChange={(value: ThemePreference) => setPreference(value)}
        style={{ minHeight: theme.relay.sizes.control }}
        value={preference}
      />
    </EditorialSurface>
  );
}
