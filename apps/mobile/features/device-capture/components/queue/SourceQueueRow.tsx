import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "react-native-paper";

import { AppText } from "@/components/ui";
import { useRelayTheme } from "@/theme";

import { formatQueueTimestamp, type SourceQueueItem } from "../../models/queuePresentation";

export function SourceQueueRow({ item, onPress }: { item: SourceQueueItem; onPress: () => void }) {
  const theme = useRelayTheme();
  return (
    <Pressable
      accessibilityHint="Opens queue item details"
      accessibilityLabel={`${item.label}. ${item.summary}. ${item.status}. ${formatQueueTimestamp(item.capturedAt)}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          borderBottomColor: theme.relay.colors.border,
          borderBottomWidth: theme.relay.borders.hairline,
          gap: theme.relay.spacing.sm,
          minHeight: theme.relay.interaction.minimumTarget,
          opacity: pressed ? theme.relay.interaction.pressedOpacity : 1,
          paddingVertical: theme.relay.spacing.md,
        },
      ]}
    >
      <AppText numberOfLines={1} style={styles.label} variant="label">
        {item.label}
      </AppText>
      <AppText numberOfLines={1} style={styles.summary} tone="muted" variant="caption">
        {item.summary}
      </AppText>
      <AppText numberOfLines={1} tone="muted" variant="caption">
        {formatQueueTimestamp(item.capturedAt)}
      </AppText>
      <AppText numberOfLines={1} tone="warning" variant="caption">
        {item.status}
      </AppText>
      <View importantForAccessibility="no-hide-descendants">
        <Icon
          color={theme.relay.colors.textMuted}
          size={theme.relay.sizes.icon.sm}
          source="chevron-right"
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: { flexShrink: 1 },
  row: { alignItems: "center", flexDirection: "row" },
  summary: { flex: 1, minWidth: 0 },
});
