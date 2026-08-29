import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { ActivityIndicator } from "react-native-paper";

import { useRelayTheme } from "@/theme";

import { AppText } from "./AppText";

type LoadingStateProps = {
  label?: string;
};

export function LoadingState({ label = "Loading..." }: LoadingStateProps) {
  const theme = useRelayTheme();
  return (
    <View
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      style={[styles.state, { backgroundColor: theme.relay.colors.background }]}
    >
      <ActivityIndicator color={theme.relay.colors.accent} />
      <AppText tone="muted">{label}</AppText>
    </View>
  );
}

type EmptyStateProps = {
  action?: ReactNode;
  detail: string;
  title: string;
};

export function EmptyState({ action, detail, title }: EmptyStateProps) {
  const theme = useRelayTheme();
  return (
    <View style={[styles.state, { gap: theme.relay.spacing.sm }]}>
      <AppText variant="title">{title}</AppText>
      <AppText style={styles.centered} tone="muted">
        {detail}
      </AppText>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { textAlign: "center" },
  state: { alignItems: "center", flex: 1, justifyContent: "center", padding: 24 },
});
