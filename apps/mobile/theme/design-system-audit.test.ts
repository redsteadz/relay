import { describe, expect, it } from "vitest";

type Glob = (
  patterns: string[],
  options: { eager: true; import: "default"; query: "?raw" },
) => Record<string, string>;

declare global {
  interface ImportMeta {
    glob: Glob;
  }
}

const sources = import.meta.glob(
  [
    "../app/**/*.{ts,tsx}",
    "../components/**/*.{ts,tsx}",
    "../features/**/*.{ts,tsx}",
    "../hooks/**/*.{ts,tsx}",
    "../app.config.ts",
  ],
  { eager: true, import: "default", query: "?raw" },
);
const files = Object.entries(sources).filter(([path]) => !path.includes(".test."));
const visualLiteral =
  /\b(?:gap|padding(?:Top|Bottom|Horizontal|Vertical)?|margin(?:Top|Bottom|Horizontal|Vertical)?|maxWidth|maxHeight|minHeight|minWidth|height|width|borderRadius|borderWidth|borderTopWidth|borderLeftWidth|fontSize|lineHeight|letterSpacing|elevation):\s*[1-9][0-9]*/;
const colorLiteral = /#[0-9a-f]{3,8}|rgba?\(/i;

describe("design-system boundaries", () => {
  it.each(files)("keeps color literals in the theme: %s", (_path, source) => {
    expect(source).not.toMatch(colorLiteral);
  });

  it.each(files)("keeps visual measurements in shared tokens: %s", (_path, source) => {
    expect(source).not.toMatch(visualLiteral);
  });
});
