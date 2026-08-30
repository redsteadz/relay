import type { PropsWithChildren } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import {
  configureFonts,
  MD3DarkTheme,
  MD3LightTheme,
  PaperProvider,
  useTheme,
  type MD3Theme,
} from "react-native-paper";

import { readThemePreference, writeThemePreference } from "./storage";
import {
  fontFamilies,
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
    fonts: configureFonts({ config: { fontFamily: fontFamilies.body }, isV3: true }),
    colors: {
      ...base.colors,
      primary: colors.action,
      onPrimary: colors.onAction,
      primaryContainer: colors.actionSubtle,
      onPrimaryContainer: colors.onActionSubtle,
      secondary: colors.info,
      onSecondary: colors.surface,
      secondaryContainer: colors.infoSurface,
      onSecondaryContainer: colors.onInfoSurface,
      tertiary: colors.accent,
      onTertiary: colors.onAccent,
      tertiaryContainer: colors.accentSubtle,
      onTertiaryContainer: colors.onAccentSubtle,
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
      outlineVariant: colors.borderSubtle,
      surfaceDisabled: colors.surfaceRaised,
      onSurfaceDisabled: colors.textMuted,
      backdrop: colors.scrim,
      elevation: {
        level0: colors.surface,
        level1: colors.surfaceRaised,
        level2: colors.surfaceRaised,
        level3: colors.surface,
        level4: colors.surface,
        level5: colors.surface,
      },
    },
    relay: tokens,
  };
}

export function RelayThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    let active = true;
    void readThemePreference()
      .then((storedPreference) => {
        if (active) setPreferenceState(storedPreference);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const setPreference = useCallback((nextPreference: ThemePreference) => {
    setPreferenceState(nextPreference);
    void writeThemePreference(nextPreference).catch(() => undefined);
  }, []);
  const colorScheme = resolveColorScheme(preference, systemScheme);
  const theme = useMemo(() => createRelayTheme(colorScheme), [colorScheme]);
  const context = useMemo(
    () => ({ colorScheme, preference, setPreference }),
    [colorScheme, preference, setPreference],
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
