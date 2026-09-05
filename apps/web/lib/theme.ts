export type ColorScheme = "light" | "dark";
export type ThemePreference = ColorScheme | "system";

export const themePreferences = ["system", "light", "dark"] as const;

/** Same key as the mobile app so the preference model reads identically across surfaces. */
export const themeStorageKey = "relay.theme-preference";
export const themeAttribute = "data-theme";

export function isThemePreference(value: unknown): value is ThemePreference {
  return themePreferences.some((preference) => preference === value);
}

export function resolveColorScheme(
  preference: ThemePreference,
  systemScheme: string | null | undefined,
): ColorScheme {
  if (preference !== "system") return preference;
  return systemScheme === "dark" ? "dark" : "light";
}

/**
 * Inline script for the document head. It runs before first paint so an explicit preference never
 * flashes the system scheme; with no stored preference the attribute stays absent and CSS follows
 * `prefers-color-scheme`.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  themeStorageKey,
)});if(t==="light"||t==="dark"){document.documentElement.setAttribute(${JSON.stringify(
  themeAttribute,
)},t)}}catch(e){}})()`;
