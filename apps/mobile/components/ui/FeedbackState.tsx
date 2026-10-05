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

/**
 * A screen with nothing on it, said properly.
 *
 * An empty inbox is the product working, not a failure, so it gets a drawn state rather than one
 * grey sentence floating under a tab bar: a tinted disc carrying the kind's icon, a titled
 * statement of what is true, and the one control that would change it. The disc is what makes the
 * band read as deliberate at a glance instead of as a screen that failed to load.
 */
export function FeedbackState({ action, detail, kind = "empty", title }: FeedbackStateProps) {
  const theme = useRelayTheme();
  const { colors, radii, sizes, spacing } = theme.relay;
  return (
    <View
      accessibilityLiveRegion={kind === "error" ? "assertive" : "polite"}
      accessibilityRole={kind === "error" ? "alert" : undefined}
      style={[
        styles.state,
        {
          backgroundColor: colors.background,
          gap: spacing.md,
          minHeight: sizes.stateMinHeight,
          padding: spacing.xl,
        },
      ]}
    >
      <View
        style={[
          styles.disc,
          {
            backgroundColor: kind === "error" ? colors.dangerSurface : colors.accentSubtle,
            borderRadius: radii.pill,
            height: sizes.control,
            width: sizes.control,
          },
        ]}
      >
        <Icon
          color={kind === "error" ? colors.onDangerSurface : colors.onAccentSubtle}
          size={sizes.icon.lg}
          source={feedbackIcons[kind]}
        />
      </View>
      <AppText accessibilityRole="header" style={styles.centered} variant="title">
        {title}
      </AppText>
      <AppText style={[styles.centered, styles.measure]} tone="muted" variant="caption">
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
  disc: { alignItems: "center", justifyContent: "center" },
  measure: { maxWidth: "90%" },
  state: { alignItems: "center", flex: 1, justifyContent: "center" },
});
