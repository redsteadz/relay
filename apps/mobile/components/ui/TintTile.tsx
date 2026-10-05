import { StyleSheet, Text, View } from "react-native";
import { Icon } from "react-native-paper";

import { tintNameFor, useRelayTheme, type RelayTintName } from "@/theme";

type TintTileProps = {
  /** Shrinks the tile for list density, where the row's own text already carries the name. */
  compact?: boolean;
  /** A Material icon name. Omit to fall back to the first letter of `label`. */
  icon?: string | undefined;
  /** What this tile stands for. Used for the fallback initial and, by default, for the hue. */
  label: string;
  /**
   * The value the hue is derived from, when it should outlive the label.
   *
   * A package identifier rather than an application's display name, so renaming the app -- or
   * resolving a name Relay previously could not -- does not change the colour a person has learned.
   */
  tintKey?: string | undefined;
  /** Forces a hue instead of deriving one. For a fixed vocabulary, such as source kinds. */
  tint?: RelayTintName | undefined;
};

/**
 * The coloured square that identifies a source, a category, or a condition type.
 *
 * Relay stores a package identifier and not a logo, so this never claims to know a brand: it shows
 * the initial Relay can defend, and uses colour to carry the recognition a logo would have. Hue is
 * derived from the key, which makes it stable across screens and free of per-screen decisions.
 *
 * Twelve grey squares in a list are twelve things to read. Twelve coloured ones are a shape a person
 * learns in a day.
 */
export function TintTile({ compact = false, icon, label, tint, tintKey }: TintTileProps) {
  const theme = useRelayTheme();
  const { radii, sizes, tints } = theme.relay;
  const palette = tints[tint ?? tintNameFor(tintKey ?? label)];
  const box = compact ? sizes.tileCompact : sizes.tile;
  const initial = [...label].find((character) => /\p{L}|\p{N}/u.test(character));

  return (
    <View
      // The tile repeats what the row beside it already says, so it is decoration to a screen
      // reader and must not be announced a second time.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.tile,
        {
          backgroundColor: palette.surface,
          borderRadius: compact ? radii.sm : radii.md,
          height: box,
          width: box,
        },
      ]}
    >
      {icon === undefined ? (
        <Text
          style={[
            compact ? theme.relay.typography.monoGlyph : theme.relay.typography.monoStrong,
            { color: palette.ink },
          ]}
        >
          {(initial ?? "?").toUpperCase()}
        </Text>
      ) : (
        <Icon color={palette.ink} size={compact ? sizes.icon.sm : sizes.icon.md} source={icon} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: "center", flexShrink: 0, justifyContent: "center", overflow: "hidden" },
});
