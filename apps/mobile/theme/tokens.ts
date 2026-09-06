import palette from "./palette.json";

export type RelayColorScheme = "light" | "dark";
export type ThemePreference = RelayColorScheme | "system";

export const themePreferences = ["system", "light", "dark"] as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radii = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;
export const borders = {
  hairline: 1,
  emphasis: 2,
  focus: 2,
  /** Line weight for the icon set, light enough to sit beside 12px body text without shouting. */
  strokeIcon: 1.8,
  /** The mark is drawn heavier than the icons: it is a logo, not a control. */
  strokeMark: 3,
} as const;
export const elevation = { flat: 0, raised: 1, overlay: 3 } as const;

export const sizes = {
  icon: { sm: 16, md: 20, lg: 24 },
  /** Source initial on a receipt. Reads as provenance, not as a tappable avatar. */
  glyph: 22,
  control: 48,
  touchTarget: 48,
  compactTouchTarget: 40,
  statusMark: 32,
  stateMinHeight: 240,
  navigationBar: 72,
  compactList: 180,
  selectionList: 300,
  noticeMaxWidth: 296,
  dialogMaxWidth: 520,
  readingWidth: 560,
  contentMaxWidth: 720,
} as const;

export const layout = {
  narrowBreakpoint: 480,
  compactGutter: spacing.lg,
  regularGutter: spacing.xl,
  sectionGap: spacing.xl,
  screenBottom: spacing.xxxl,
  overlayWidth: "92%",
} as const;

export const motion = {
  duration: { instant: 0, fast: 120, standard: 180, emphasis: 260, screen: 360 },
  entranceOffset: spacing.sm,
} as const;

export const interaction = {
  disabledOpacity: 0.44,
  pressedOpacity: 0.72,
  minimumTarget: sizes.touchTarget,
} as const;

export const fontFamilies = {
  display: "SpaceGrotesk_700Bold",
  displayMedium: "SpaceGrotesk_600SemiBold",
  body: "Inter_400Regular",
  bodyMedium: "Inter_500Medium",
  bodyStrong: "Inter_700Bold",
  /**
   * Monospace carries the values Relay read rather than the prose about them.
   *
   * A fact, a timestamp, a receipt id, and a compiled predicate are all quoted evidence: they are
   * read for their exact characters, and aligning digits keeps two amounts comparable at a glance.
   * Setting them in the body face made them read as Relay's own words instead of the source's.
   */
  mono: "JetBrainsMono_500Medium",
  monoStrong: "JetBrainsMono_600SemiBold",
} as const;

export const typography = {
  hero: {
    fontFamily: fontFamilies.display,
    fontSize: 38,
    letterSpacing: -1.25,
    lineHeight: 42,
  },
  heading: {
    fontFamily: fontFamilies.display,
    fontSize: 24,
    letterSpacing: -0.45,
    lineHeight: 30,
  },
  title: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: 18,
    letterSpacing: -0.1,
    lineHeight: 24,
  },
  body: {
    fontFamily: fontFamilies.body,
    fontSize: 15,
    letterSpacing: 0,
    lineHeight: 23,
  },
  bodyStrong: {
    fontFamily: fontFamilies.bodyStrong,
    fontSize: 15,
    letterSpacing: 0,
    lineHeight: 23,
  },
  label: {
    fontFamily: fontFamilies.bodyStrong,
    fontSize: 14,
    letterSpacing: 0.1,
    lineHeight: 20,
  },
  caption: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: 12,
    letterSpacing: 0.15,
    lineHeight: 18,
  },
  eyebrow: {
    fontFamily: fontFamilies.bodyStrong,
    fontSize: 11,
    letterSpacing: 1.25,
    lineHeight: 16,
  },
  /** The one line a receipt is named by. Smaller than `heading`, which titles a whole screen. */
  receiptTitle: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: 19,
    letterSpacing: -0.2,
    lineHeight: 24,
  },
  /** Outcome tabs. Display face, because a tab names a section rather than labelling a control. */
  tab: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: 15,
    letterSpacing: 0,
    lineHeight: 20,
  },
  /** The proposed action's one line: provider, what would be done, and when. */
  actionText: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: 13,
    letterSpacing: 0,
    lineHeight: 18,
  },
  /** A value Relay read, quoted exactly: fact chips and dry-run decisions. */
  mono: {
    fontFamily: fontFamilies.mono,
    fontSize: 12,
    letterSpacing: 0,
    lineHeight: 18,
  },
  /** Timestamps, receipt ids, and counts that sit beside prose without competing with it. */
  monoMeta: {
    fontFamily: fontFamilies.mono,
    fontSize: 11,
    letterSpacing: 0.6,
    lineHeight: 16,
  },
  /** Compiled predicates, which are read line by line like the code they are. */
  monoBody: {
    fontFamily: fontFamilies.mono,
    fontSize: 13,
    letterSpacing: 0,
    lineHeight: 20,
  },
  /** The dispatch arrow, weighted to hold its own against the title above it. */
  monoStrong: {
    fontFamily: fontFamilies.monoStrong,
    fontSize: 14,
    letterSpacing: 0,
    lineHeight: 18,
  },
  /** A single initial standing in for an application that has no icon Relay may claim to know. */
  monoGlyph: {
    fontFamily: fontFamilies.monoStrong,
    fontSize: 11,
    letterSpacing: 0,
    lineHeight: 11,
  },
} as const;

type RelayColors = {
  background: string;
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  border: string;
  borderSubtle: string;
  text: string;
  textMuted: string;
  action: string;
  onAction: string;
  actionSubtle: string;
  onActionSubtle: string;
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
  scrim: string;
};

export type RelaySemanticTokens = {
  colors: RelayColors;
  spacing: typeof spacing;
  radii: typeof radii;
  borders: typeof borders;
  elevation: typeof elevation;
  sizes: typeof sizes;
  layout: typeof layout;
  motion: typeof motion;
  interaction: typeof interaction;
  typography: typeof typography;
};

const lightColors: RelayColors = palette.light;
const darkColors: RelayColors = palette.dark;

function createTokens(colors: RelayColors): RelaySemanticTokens {
  return {
    colors,
    spacing,
    radii,
    borders,
    elevation,
    sizes,
    layout,
    motion,
    interaction,
    typography,
  };
}

export const relayTokens: Record<RelayColorScheme, RelaySemanticTokens> = {
  light: createTokens(lightColors),
  dark: createTokens(darkColors),
};

export function isThemePreference(value: string | null): value is ThemePreference {
  return themePreferences.some((preference) => preference === value);
}

export function resolveColorScheme(
  preference: ThemePreference,
  systemScheme: string | null | undefined,
): RelayColorScheme {
  if (preference !== "system") return preference;
  return systemScheme === "dark" ? "dark" : "light";
}
