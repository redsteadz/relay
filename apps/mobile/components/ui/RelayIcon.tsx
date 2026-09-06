import Svg, { Circle, Path } from "react-native-svg";

import { useRelayTheme } from "@/theme";

/**
 * Relay's own line icons.
 *
 * Drawn here rather than taken from an icon font because the set is small, deliberately uniform, and
 * two of its members have no stock equivalent: the mark, and the tray that names the inbox. Mixing
 * one hand-drawn glyph into a borrowed family reads as a mistake, so the whole set is drawn.
 *
 * Every glyph shares a 24-unit box, a round cap, and one stroke weight, and inherits its color from
 * the caller so a nav item can state selection with color alone.
 */
export type RelayIconName =
  "activity" | "back" | "chevron" | "inbox" | "rules" | "search" | "settings" | "sources";

type RelayIconProps = {
  color: string;
  name: RelayIconName;
  size?: number;
};

/** Path data only. Anything positional stays in the component so the box is uniform. */
const glyphs: Record<RelayIconName, { circles?: readonly [number, number, number][]; d: string }> =
  {
    activity: { d: "M3 12a9 9 0 1 0 3-6.7 M3 4v5h5 M12 7v5l3 2" },
    back: { d: "M15 18l-6-6 6-6" },
    chevron: { d: "M9 6l6 6-6 6" },
    inbox: { d: "M5 5h14l2 8v6H3v-6z M3 13h5l2 3h4l2-3h5" },
    rules: {
      circles: [[15, 7, 2] as const, [9, 17, 2] as const],
      d: "M4 7h9M17 7h3M4 17h3M11 17h9",
    },
    search: { circles: [[11, 11, 7] as const], d: "M20 20l-4-4" },
    settings: {
      circles: [[12, 12, 3] as const],
      d: "M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1",
    },
    sources: { d: "M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0z M12 17v4" },
  };

export function RelayIcon({ color, name, size }: RelayIconProps) {
  const theme = useRelayTheme();
  const box = size ?? theme.relay.sizes.icon.lg;
  const glyph = glyphs[name];
  return (
    <Svg fill="none" height={box} viewBox="0 0 24 24" width={box}>
      <Path
        d={glyph.d}
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={theme.relay.borders.strokeIcon}
      />
      {(glyph.circles ?? []).map(([cx, cy, r]) => (
        <Circle
          cx={cx}
          cy={cy}
          key={`${String(cx)}-${String(cy)}`}
          r={r}
          stroke={color}
          strokeWidth={theme.relay.borders.strokeIcon}
        />
      ))}
    </Svg>
  );
}

/**
 * The Relay mark: several signals arriving, one leaving.
 *
 * The outgoing stroke is the accent and the incoming ones are not, because the whole product claim
 * is that what leaves is fewer and chosen. Rendering it in a single color loses that.
 */
export function RelayMark({ size }: { size?: number }) {
  const theme = useRelayTheme();
  const box = size ?? theme.relay.sizes.icon.lg;
  return (
    <Svg fill="none" height={box} viewBox="0 0 32 32" width={box}>
      <Path
        d="M4 8C10 8 12 16 16 16M4 16H16M4 24C10 24 12 16 16 16"
        stroke={theme.relay.colors.text}
        strokeLinecap="round"
        strokeWidth={theme.relay.borders.strokeMark}
      />
      <Path
        d="M16 16H28"
        stroke={theme.relay.colors.accent}
        strokeLinecap="round"
        strokeWidth={theme.relay.borders.strokeMark}
      />
    </Svg>
  );
}
