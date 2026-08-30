import { Pressable, StyleSheet, View } from "react-native";
import { Checkbox } from "react-native-paper";

import { AppText } from "@/components/ui";
import { useRelayTheme } from "@/theme";

export type SelectionItem = {
  detail?: string | undefined;
  id: string;
  label: string;
  searchText: string;
  selected: boolean;
  unavailable?: boolean;
};

export function SelectionRow({ item, onToggle }: { item: SelectionItem; onToggle: () => void }) {
  const theme = useRelayTheme();
  return (
    <Pressable
      accessibilityLabel={item.detail === undefined ? item.label : `${item.label}, ${item.detail}`}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: item.selected }}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: item.selected
            ? theme.relay.colors.accentSubtle
            : theme.relay.colors.background,
          borderBottomColor: theme.relay.colors.border,
          borderBottomWidth: theme.relay.borders.hairline,
          gap: theme.relay.spacing.sm,
          minHeight: theme.relay.interaction.minimumTarget,
          opacity: pressed ? theme.relay.interaction.pressedOpacity : 1,
          paddingVertical: theme.relay.spacing.md,
        },
      ]}
    >
      <View importantForAccessibility="no-hide-descendants" pointerEvents="none">
        <Checkbox status={item.selected ? "checked" : "unchecked"} />
      </View>
      <View style={[styles.copy, { gap: theme.relay.spacing.xxs }]}>
        <AppText numberOfLines={1} variant="label">
          {item.label}
        </AppText>
        {item.detail === undefined ? null : (
          <AppText numberOfLines={1} tone="muted" variant="caption">
            {item.detail}
          </AppText>
        )}
        {!item.unavailable ? null : (
          <AppText tone="warning" variant="caption">
            Saved selection, not currently launchable
          </AppText>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  copy: { flex: 1, minWidth: 0 },
  row: { alignItems: "flex-start", flexDirection: "row" },
});
