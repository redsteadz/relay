import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useRelayTheme } from "@/theme";

import { AppText } from "./AppText";

export type OutcomeTab<Key extends string> = {
  count: number;
  key: Key;
  label: string;
};

type OutcomeTabsProps<Key extends string> = {
  onSelect: (key: Key) => void;
  selected: Key;
  tabs: readonly OutcomeTab<Key>[];
};

/**
 * The outcomes a capture can have, as pills on one scrolling line.
 *
 * Sections made the inbox a single scroll in which "needs you" and eighteen quiet items competed
 * for the same screen, and the count that mattered was only legible after scrolling past the ones
 * that did not. Tabs put every count where a person can see them at once.
 *
 * They scroll because they stopped fitting. Five equal-flex underlined tabs divided a phone into
 * columns too narrow for their own labels, so the last one was clipped by the edge of the screen --
 * a tab a person could neither read nor reach. A pill is sized by its own content instead, and the
 * row admits it is longer than the viewport rather than silently truncating.
 *
 * Counts render even at zero: "Needs you 0" is a different, stronger statement than a tab with no
 * number, and it is the statement this inbox exists to be able to make.
 */
export function OutcomeTabs<Key extends string>({
  onSelect,
  selected,
  tabs,
}: OutcomeTabsProps<Key>) {
  const theme = useRelayTheme();
  const { borders, colors, layout, radii, spacing } = theme.relay;
  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { gap: spacing.sm, paddingHorizontal: layout.compactGutter, paddingVertical: spacing.sm },
      ]}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.bar}
    >
      <View accessibilityRole="tablist" style={[styles.list, { gap: spacing.sm }]}>
        {tabs.map((tab) => {
          const active = tab.key === selected;
          return (
            <Pressable
              accessibilityLabel={`${tab.label}, ${String(tab.count)}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              key={tab.key}
              onPress={() => onSelect(tab.key)}
              style={[
                styles.tab,
                {
                  backgroundColor: active ? colors.accent : colors.surface,
                  borderColor: active ? colors.accent : colors.borderSubtle,
                  borderRadius: radii.pill,
                  borderWidth: borders.hairline,
                  gap: spacing.sm,
                  paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.sm,
                },
              ]}
            >
              <AppText
                style={active ? { color: colors.onAccent } : undefined}
                tone={active ? "default" : "muted"}
                variant="tab"
              >
                {tab.label}
              </AppText>
              <AppText
                style={active ? { color: colors.onAccent } : undefined}
                tone="muted"
                variant="monoMeta"
              >
                {String(tab.count)}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: { flexGrow: 0, width: "100%" },
  content: { alignItems: "center" },
  list: { alignItems: "center", flexDirection: "row" },
  tab: { alignItems: "center", flexDirection: "row", flexShrink: 0 },
});
