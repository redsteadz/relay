import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

type Scheme = "light" | "dark";

const css = readFileSync(join(import.meta.dirname, "..", "app", "globals.css"), "utf8");

function token(name: string, scheme: Scheme): string {
  const pattern = new RegExp(
    `--${name}:\\s*light-dark\\((#[0-9a-f]{6}),\\s*(#[0-9a-f]{6})\\)`,
    "i",
  );
  const match = css.match(pattern);
  if (match === null) throw new Error(`Missing light-dark token --${name}`);
  const value = scheme === "light" ? match[1] : match[2];
  if (value === undefined) throw new Error(`Malformed light-dark token --${name}`);
  return value;
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  if (channels === undefined) throw new Error(`Invalid color: ${hex}`);
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(first: string, second: string): number {
  const light = Math.max(relativeLuminance(first), relativeLuminance(second));
  const dark = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (light + 0.05) / (dark + 0.05);
}

const pairs: Array<[foreground: string, background: string]> = [
  ["text", "bg"],
  ["text-muted", "bg"],
  ["text", "surface"],
  ["text-muted", "surface"],
  ["text", "surface-raised"],
  ["accent", "bg"],
  ["on-action", "action"],
  ["on-success-surface", "success-surface"],
  ["on-warning-surface", "warning-surface"],
  ["on-danger-surface", "danger-surface"],
  ["on-info-surface", "info-surface"],
];

describe.each<Scheme>(["light", "dark"])("%s scheme contrast", (scheme) => {
  it.each(pairs)("keeps --%s readable on --%s", (foreground, background) => {
    expect(contrast(token(foreground, scheme), token(background, scheme))).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});
