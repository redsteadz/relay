import { describe, expect, it } from "vitest";

import { isThemePreference, relayTokens, resolveColorScheme } from "./tokens";

function relativeLuminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  if (channels === undefined) throw new Error(`Invalid color: ${hex}`);
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(first: string, second: string) {
  const light = Math.max(relativeLuminance(first), relativeLuminance(second));
  const dark = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (light + 0.05) / (dark + 0.05);
}

describe("theme selection", () => {
  it("follows a dark system preference", () => {
    expect(resolveColorScheme("system", "dark")).toBe("dark");
  });

  it("defaults an unavailable system preference to light", () => {
    expect(resolveColorScheme("system", null)).toBe("light");
    expect(resolveColorScheme("system", "unspecified")).toBe("light");
  });

  it("honors an explicit preference", () => {
    expect(resolveColorScheme("light", "dark")).toBe("light");
    expect(resolveColorScheme("dark", "light")).toBe("dark");
  });

  it("rejects corrupt persisted preferences", () => {
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("sepia")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });
});

describe.each(["light", "dark"] as const)("%s theme contrast", (scheme) => {
  const colors = relayTokens[scheme].colors;

  it("keeps body and secondary text readable", () => {
    expect(contrastRatio(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.textMuted, colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.text, colors.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps control and feedback labels readable", () => {
    expect(contrastRatio(colors.onAction, colors.action)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.onAccent, colors.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.onAccentSubtle, colors.accentSubtle)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.onDangerSurface, colors.dangerSurface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.onWarningSurface, colors.warningSurface)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrastRatio(colors.onSuccessSurface, colors.successSurface)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrastRatio(colors.onInfoSurface, colors.infoSurface)).toBeGreaterThanOrEqual(4.5);
  });
});
