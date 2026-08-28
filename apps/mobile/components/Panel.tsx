import type { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";
import { Surface } from "react-native-paper";

import { useRelayTheme } from "@/theme";

import { AppText } from "./ui";

type PanelProps = PropsWithChildren<{ title: string; meta?: string }>;

export function Panel({ children, meta, title }: PanelProps) {
  const theme = useRelayTheme();
  return (
    <Surface
      elevation={theme.relay.elevation.flat}
      style={[
        styles.panel,
        {
          backgroundColor: theme.relay.colors.surface,
          borderColor: theme.relay.colors.border,
          borderRadius: theme.relay.radii.lg,
          gap: theme.relay.spacing.md,
          padding: theme.relay.spacing.lg,
        },
      ]}
    >
      <View style={[styles.heading, { gap: theme.relay.spacing.sm }]}>
        <AppText style={styles.title} variant="title">
          {title}
        </AppText>
        {meta === undefined ? null : (
          <AppText tone="muted" variant="caption">
            {meta}
          </AppText>
        )}
      </View>
      {children}
    </Surface>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderWidth: 1,
  },
  heading: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  title: { flexShrink: 1 },
});
