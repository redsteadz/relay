import { StyleSheet, View } from "react-native";
import { Icon } from "react-native-paper";

import { AppText } from "@/components/ui";
import { useRelayTheme } from "@/theme";

import type { SourceStatus } from "../../models/capturePresentation";

export function SourceStatusLabel({ status }: { status: SourceStatus }) {
  const theme = useRelayTheme();
  const color = {
    accent: theme.relay.colors.accent,
    danger: theme.relay.colors.danger,
    muted: theme.relay.colors.textMuted,
    success: theme.relay.colors.success,
    warning: theme.relay.colors.warning,
  }[status.tone];

  return (
    <View
      accessibilityLabel={`Status: ${status.label}`}
      accessibilityLiveRegion="polite"
      style={[styles.row, { gap: theme.relay.spacing.xs }]}
    >
      <Icon color={color} size={theme.relay.sizes.icon.sm} source={status.icon} />
      <AppText numberOfLines={1} style={{ color }} variant="caption">
        {status.label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: "center", flexDirection: "row", flexShrink: 1 },
});
