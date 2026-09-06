import { Pressable, StyleSheet, View } from "react-native";

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
 * The three outcomes a capture can have, as tabs rather than stacked sections.
 *
 * Sections made the inbox a single scroll in which "needs you" and eighteen quiet items competed for
 * the same screen, and the count that mattered was only legible after scrolling past the ones that
 * did not. Tabs put every count on one line and let a person stay in one outcome.
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
  const { borders, colors, spacing } = theme.relay;
  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.bar,
        { borderBottomColor: colors.borderSubtle, borderBottomWidth: borders.hairline },
      ]}
    >
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
                borderBottomColor: active ? colors.accent : "transparent",
                borderBottomWidth: borders.emphasis,
                gap: spacing.xs,
                marginBottom: -borders.hairline,
                paddingVertical: spacing.sm,
              },
            ]}
          >
            <AppText tone={active ? "default" : "muted"} variant="tab">
              {tab.label}
            </AppText>
            <AppText tone="muted" variant="monoMeta">
              {String(tab.count)}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", width: "100%" },
  tab: { alignItems: "baseline", flex: 1, flexDirection: "row", justifyContent: "center" },
});
