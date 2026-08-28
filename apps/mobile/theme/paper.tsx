import type { PropsWithChildren } from "react";
import { createContext, useContext, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import {
  MD3DarkTheme,
  MD3LightTheme,
  PaperProvider,
  useTheme,
  type MD3Theme,
} from "react-native-paper";

import {
  relayTokens,
  resolveColorScheme,
  type RelayColorScheme,
  type RelaySemanticTokens,
  type ThemePreference,
} from "./tokens";

export type RelayTheme = MD3Theme & { relay: RelaySemanticTokens };

type ThemePreferenceContextValue = {
  colorScheme: RelayColorScheme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

const ThemePreferenceContext = createContext<ThemePreferenceContextValue | undefined>(undefined);

export function createRelayTheme(colorScheme: RelayColorScheme): RelayTheme {
  const base = colorScheme === "dark" ? MD3DarkTheme : MD3LightTheme;
  const tokens = relayTokens[colorScheme];
  const { colors } = tokens;

  return {
    ...base,
    dark: colorScheme === "dark",
    roundness: tokens.radii.md,
    colors: {
      ...base.colors,
      primary: colors.accent,
      onPrimary: colors.onAccent,
      primaryContainer: colors.accentSubtle,
      onPrimaryContainer: colors.onAccentSubtle,
      secondary: colors.info,
      onSecondary: colorScheme === "dark" ? colors.background : colors.onAccent,
      secondaryContainer: colors.infoSurface,
      onSecondaryContainer: colors.onInfoSurface,
      tertiary: colors.warning,
      onTertiary: colorScheme === "dark" ? colors.background : colors.onAccent,
      tertiaryContainer: colors.warningSurface,
      onTertiaryContainer: colors.onWarningSurface,
      error: colors.danger,
      onError: colors.onDanger,
      errorContainer: colors.dangerSurface,
      onErrorContainer: colors.onDangerSurface,
      background: colors.background,
      onBackground: colors.text,
      surface: colors.surface,
      onSurface: colors.text,
      surfaceVariant: colors.surfaceRaised,
      onSurfaceVariant: colors.textMuted,
      outline: colors.border,
      outlineVariant: colors.border,
      surfaceDisabled: colors.surfaceRaised,
      onSurfaceDisabled: colors.textMuted,
    },
    relay: tokens,
  };
}

export function RelayThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const [preference, setPreference] = useState<ThemePreference>("system");
  const colorScheme = resolveColorScheme(preference, systemScheme);
  const theme = useMemo(() => createRelayTheme(colorScheme), [colorScheme]);
  const context = useMemo(
    () => ({ colorScheme, preference, setPreference }),
    [colorScheme, preference],
  );

  return (
    <ThemePreferenceContext.Provider value={context}>
      <PaperProvider theme={theme}>{children}</PaperProvider>
    </ThemePreferenceContext.Provider>
  );
}

export function useRelayTheme() {
  return useTheme<RelayTheme>();
}

export function useThemePreference() {
  const context = useContext(ThemePreferenceContext);
  if (context === undefined) {
    throw new Error("useThemePreference must be used within RelayThemeProvider");
  }
  return context;
}
