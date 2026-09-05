import { describe, expect, it } from "vitest";

import { isThemePreference, resolveColorScheme, themeInitScript, themeStorageKey } from "./theme";

describe("theme preference", () => {
  it("follows the system scheme only when no explicit preference exists", () => {
    expect(resolveColorScheme("system", "dark")).toBe("dark");
    expect(resolveColorScheme("system", "light")).toBe("light");
    expect(resolveColorScheme("system", null)).toBe("light");
    expect(resolveColorScheme("light", "dark")).toBe("light");
    expect(resolveColorScheme("dark", "light")).toBe("dark");
  });

  it("rejects corrupt persisted values", () => {
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("sepia")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });

  it("initializes the document from the same storage key the toggle writes", () => {
    expect(themeInitScript).toContain(JSON.stringify(themeStorageKey));
    expect(themeInitScript).not.toContain("\n");
  });
});
