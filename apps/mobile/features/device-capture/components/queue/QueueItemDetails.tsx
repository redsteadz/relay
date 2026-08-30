import { StyleSheet, View } from "react-native";

import { AppText, EditorialSurface } from "@/components/ui";
import { useRelayTheme } from "@/theme";

export type QueueItemDetail = {
  label: string;
  value: string | undefined;
};

export function QueueItemDetails({ details }: { details: QueueItemDetail[] }) {
  const theme = useRelayTheme();
  return (
    <EditorialSurface title="Allowed metadata">
      <View accessibilityRole="list" style={{ gap: theme.relay.spacing.md }}>
        {details.map((detail) => (
          <View
            accessibilityRole="summary"
            key={detail.label}
            style={[styles.row, { gap: theme.relay.spacing.xs }]}
          >
            <AppText tone="muted" variant="caption">
              {detail.label}
            </AppText>
            <AppText selectable style={styles.value} variant="bodyStrong">
              {detail.value ?? "Not available"}
            </AppText>
          </View>
        ))}
      </View>
    </EditorialSurface>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: "flex-start" },
  value: { width: "100%" },
});
