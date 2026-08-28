export type RelayColorScheme = "light" | "dark";
export type ThemePreference = RelayColorScheme | "system";

export type RelaySemanticTokens = {
  colors: {
    background: string;
    surface: string;
    surfaceRaised: string;
    border: string;
    text: string;
    textMuted: string;
    accent: string;
    onAccent: string;
    accentSubtle: string;
    onAccentSubtle: string;
    danger: string;
    onDanger: string;
    dangerSurface: string;
    onDangerSurface: string;
    warning: string;
    warningSurface: string;
    onWarningSurface: string;
    success: string;
    successSurface: string;
    onSuccessSurface: string;
    info: string;
    infoSurface: string;
    onInfoSurface: string;
    focus: string;
  };
  spacing: typeof spacing;
  radii: typeof radii;
  borders: typeof borders;
  elevation: typeof elevation;
  interaction: typeof interaction;
  typography: typeof typography;
};

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  pageBottom: 48,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const borders = {
  hairline: 1,
  focus: 2,
} as const;

export const elevation = {
  flat: 0,
  panel: 1,
  overlay: 3,
} as const;

export const interaction = {
  disabledOpacity: 0.42,
  pressedOpacity: 0.76,
  minimumTarget: 48,
} as const;

export const typography = {
  hero: { fontSize: 34, fontWeight: "700", letterSpacing: -1.1, lineHeight: 40 },
  heading: { fontSize: 21, fontWeight: "700", letterSpacing: -0.2, lineHeight: 27 },
  title: { fontSize: 17, fontWeight: "700", letterSpacing: 0, lineHeight: 23 },
  body: { fontSize: 14, fontWeight: "400", letterSpacing: 0, lineHeight: 21 },
  bodyStrong: { fontSize: 14, fontWeight: "700", letterSpacing: 0, lineHeight: 21 },
  label: { fontSize: 13, fontWeight: "700", letterSpacing: 0.1, lineHeight: 18 },
  caption: { fontSize: 12, fontWeight: "600", letterSpacing: 0.1, lineHeight: 17 },
  eyebrow: { fontSize: 11, fontWeight: "800", letterSpacing: 1.5, lineHeight: 16 },
} as const;

const lightColors: RelaySemanticTokens["colors"] = {
  background: "#F4F7F5",
  surface: "#FFFFFF",
  surfaceRaised: "#E8EFEA",
  border: "#C4D1C8",
  text: "#15221A",
  textMuted: "#526258",
  accent: "#176B45",
  onAccent: "#FFFFFF",
  accentSubtle: "#D9F2E3",
  onAccentSubtle: "#103D29",
  danger: "#B3261E",
  onDanger: "#FFFFFF",
  dangerSurface: "#F9DEDC",
  onDangerSurface: "#410E0B",
  warning: "#855300",
  warningSurface: "#FFE8C2",
  onWarningSurface: "#3D2600",
  success: "#176B3A",
  successSurface: "#D8F3E1",
  onSuccessSurface: "#103920",
  info: "#315E91",
  infoSurface: "#D9E9FA",
  onInfoSurface: "#173653",
  focus: "#245CC7",
};

const darkColors: RelaySemanticTokens["colors"] = {
  background: "#0F1511",
  surface: "#171E19",
  surfaceRaised: "#202923",
  border: "#3E4B42",
  text: "#EDF5EF",
  textMuted: "#A9B7AD",
  accent: "#8DDBAF",
  onAccent: "#07351F",
  accentSubtle: "#164A31",
  onAccentSubtle: "#C3F3D4",
  danger: "#FFB4AB",
  onDanger: "#690005",
  dangerSurface: "#5A1A17",
  onDangerSurface: "#FFDAD6",
  warning: "#FFD08A",
  warningSurface: "#4B3210",
  onWarningSurface: "#FFE7C1",
  success: "#8EDBA8",
  successSurface: "#173D27",
  onSuccessSurface: "#B8F1C9",
  info: "#A8C8F0",
  infoSurface: "#203B5C",
  onInfoSurface: "#D7E8FF",
  focus: "#8AB4FF",
};

export const relayTokens: Record<RelayColorScheme, RelaySemanticTokens> = {
  light: {
    colors: lightColors,
    spacing,
    radii,
    borders,
    elevation,
    interaction,
    typography,
  },
  dark: {
    colors: darkColors,
    spacing,
    radii,
    borders,
    elevation,
    interaction,
    typography,
  },
};

export function resolveColorScheme(
  preference: ThemePreference,
  systemScheme: string | null | undefined,
): RelayColorScheme {
  if (preference !== "system") return preference;
  return systemScheme === "dark" ? "dark" : "light";
}
