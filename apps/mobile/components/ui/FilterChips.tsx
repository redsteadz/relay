import { Pressable, ScrollView, StyleSheet } from "react-native";

import { useRelayTheme } from "@/theme";

import { AppText } from "./AppText";

export type FilterChip<Key extends string> = { key: Key; label: string };

/**
 * A single-select row of narrowing options.
 *
 * Scrolls horizontally rather than wrapping: this row sits directly under a screen's title, and a
 * wrapped second line would push the content it narrows off the first screenful. The selected chip
 * inverts rather than merely tinting, so which one is active survives a glance in either theme.
 */
export function FilterChips<Key extends string>({
  chips,
  onSelect,
  selected,
}: {
  chips: readonly FilterChip<Key>[];
  onSelect: (key: Key) => void;
  selected: Key;
}) {
  const theme = useRelayTheme();
  const { borders, colors, interaction, radii, spacing } = theme.relay;

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { gap: spacing.sm, paddingHorizontal: theme.relay.layout.compactGutter },
      ]}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
    >
      {chips.map((chip) => {
        const active = chip.key === selected;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            key={chip.key}
            onPress={() => onSelect(chip.key)}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: active ? colors.action : "transparent",
                borderColor: active ? colors.action : colors.borderSubtle,
                borderRadius: radii.sm,
                borderWidth: borders.hairline,
                opacity: pressed ? interaction.pressedOpacity : 1,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
              },
            ]}
          >
            <AppText style={{ color: active ? colors.onAction : colors.text }} variant="caption">
              {chip.label}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chip: { flexShrink: 0 },
  content: { alignItems: "center", flexDirection: "row" },
  scroll: { flexGrow: 0, width: "100%" },
});
