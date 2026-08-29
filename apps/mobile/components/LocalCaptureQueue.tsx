import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Surface } from "react-native-paper";

import { useRelayTheme } from "@/theme";

import { AppButton, AppText, StatusMessage } from "./ui";

export type CapturePreviewField = {
  label: string;
  value: string | undefined;
};

type Props<T> = {
  captures: T[];
  description: ReactNode;
  emptyMessage: string;
  error: string | undefined;
  fields: (capture: T) => CapturePreviewField[];
  keyFor: (capture: T, index: number) => string;
  onRefresh: () => void;
  refreshLabel: string;
  refreshing: boolean;
  title: string;
};

export function LocalCaptureQueue<T>({
  captures,
  description,
  emptyMessage,
  error,
  fields,
  keyFor,
  onRefresh,
  refreshLabel,
  refreshing,
  title,
}: Props<T>) {
  const theme = useRelayTheme();

  return (
    <Surface
      elevation={theme.relay.elevation.flat}
      style={[
        styles.queue,
        {
          backgroundColor: theme.relay.colors.surfaceRaised,
          borderColor: theme.relay.colors.border,
          borderRadius: theme.relay.radii.md,
          gap: theme.relay.spacing.sm,
          padding: theme.relay.spacing.md,
        },
      ]}
    >
      <View style={[styles.heading, { gap: theme.relay.spacing.sm }]}>
        <AppText variant="label">{title}</AppText>
        <AppText tone="accent" variant="eyebrow">
          {captures.length} PENDING
        </AppText>
      </View>
      <AppText tone="muted">{description}</AppText>
      <AppButton
        disabled={refreshing}
        label={refreshing ? "Refreshing..." : refreshLabel}
        onPress={onRefresh}
        tone="secondary"
      />
      {error === undefined ? null : <StatusMessage tone="error">{error}</StatusMessage>}
      {!refreshing && captures.length === 0 ? <AppText tone="muted">{emptyMessage}</AppText> : null}
      {captures.map((capture, index) => (
        <Surface
          elevation={theme.relay.elevation.flat}
          key={keyFor(capture, index)}
          style={[
            styles.capture,
            {
              backgroundColor: theme.relay.colors.background,
              borderColor: theme.relay.colors.border,
              borderRadius: theme.relay.radii.md,
              gap: theme.relay.spacing.xs,
              padding: theme.relay.spacing.sm,
            },
          ]}
        >
          {fields(capture).map((field) => (
            <AppText key={field.label} variant="caption">
              {field.label}: {field.value ?? "Not available"}
            </AppText>
          ))}
        </Surface>
      ))}
    </Surface>
  );
}

const styles = StyleSheet.create({
  capture: { borderWidth: 1 },
  heading: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  queue: { borderWidth: 1 },
});
