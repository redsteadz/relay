import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { ActivityIndicator, Icon } from "react-native-paper";

import { useRelayTheme } from "@/theme";

import { AppText } from "./AppText";

export type FeedbackKind = "empty" | "error" | "offline" | "permission" | "success";

const feedbackIcons: Record<FeedbackKind, string> = {
  empty: "tray",
  error: "alert-circle-outline",
  offline: "cloud-off-outline",
  permission: "shield-lock-outline",
  success: "check-circle-outline",
};

type FeedbackStateProps = {
  action?: ReactNode;
  detail: string;
  kind?: FeedbackKind;
  title: string;
};

export function FeedbackState({ action, detail, kind = "empty", title }: FeedbackStateProps) {
  const theme = useRelayTheme();
  return (
    <View
      accessibilityLiveRegion={kind === "error" ? "assertive" : "polite"}
      accessibilityRole={kind === "error" ? "alert" : undefined}
      style={[
        styles.state,
        {
          backgroundColor: theme.relay.colors.background,
          gap: theme.relay.spacing.sm,
          minHeight: theme.relay.sizes.stateMinHeight,
          padding: theme.relay.spacing.xl,
        },
      ]}
    >
      <Icon
        color={theme.relay.colors.accent}
        size={theme.relay.sizes.icon.lg}
        source={feedbackIcons[kind]}
      />
      <AppText accessibilityRole="header" variant="title">
        {title}
      </AppText>
      <AppText style={styles.centered} tone="muted">
        {detail}
      </AppText>
      {action}
    </View>
  );
}

type LoadingStateProps = { label?: string };

export function LoadingState({ label = "Loading..." }: LoadingStateProps) {
  const theme = useRelayTheme();
  return (
    <View
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      style={[
        styles.state,
        {
          backgroundColor: theme.relay.colors.background,
          gap: theme.relay.spacing.md,
          minHeight: theme.relay.sizes.stateMinHeight,
          padding: theme.relay.spacing.xl,
        },
      ]}
    >
      <ActivityIndicator color={theme.relay.colors.accent} />
      <AppText tone="muted">{label}</AppText>
    </View>
  );
}

export function EmptyState(props: Omit<FeedbackStateProps, "kind">) {
  return <FeedbackState {...props} kind="empty" />;
}

const styles = StyleSheet.create({
  centered: { textAlign: "center" },
  state: { alignItems: "center", flex: 1, justifyContent: "center" },
});
