import type { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";

import { useRelayTheme } from "@/theme";

type ActionRowProps = PropsWithChildren<{
  compact?: boolean;
  wrap?: boolean;
}>;

export function ActionRow({ children, compact = false, wrap = true }: ActionRowProps) {
  const theme = useRelayTheme();
  return (
    <View
      style={[
        styles.row,
        {
          flexWrap: wrap ? "wrap" : "nowrap",
          gap: compact ? theme.relay.spacing.xxs : theme.relay.spacing.sm,
        },
        !wrap && styles.fixed,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fixed: { flexShrink: 0 },
  row: { alignItems: "center", flexDirection: "row" },
});
