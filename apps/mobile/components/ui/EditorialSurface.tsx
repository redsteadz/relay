import type { PropsWithChildren, ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Icon, Surface } from "react-native-paper";

import { useRelayTheme } from "@/theme";

import { AppText } from "./AppText";

export type EditorialSurfaceVariant = "plain" | "raised" | "accent";

type EditorialSurfaceProps = PropsWithChildren<{
  icon?: string | undefined;
  meta?: string | undefined;
  title: string;
  titleAccessory?: ReactNode;
  variant?: EditorialSurfaceVariant;
}>;

export function EditorialSurface({
  children,
  icon,
  meta,
  title,
  titleAccessory,
  variant = "plain",
}: EditorialSurfaceProps) {
  const theme = useRelayTheme();
  const { colors } = theme.relay;
  const accent = variant === "accent";
  const raised = variant === "raised";
  const foreground = accent ? colors.onAccentSubtle : colors.text;
  const muted = accent ? colors.onAccentSubtle : colors.textMuted;

  return (
    <Surface
      elevation={raised ? theme.relay.elevation.raised : theme.relay.elevation.flat}
      style={[
        styles.surface,
        {
          backgroundColor: accent
            ? colors.accentSubtle
            : raised
              ? colors.surface
              : colors.background,
          borderColor: accent ? colors.accent : raised ? colors.borderSubtle : colors.border,
          borderRadius: raised || accent ? theme.relay.radii.lg : theme.relay.radii.xs,
          gap: theme.relay.spacing.md,
          padding: raised || accent ? theme.relay.spacing.lg : theme.relay.spacing.md,
        },
        (raised || accent) && { borderWidth: theme.relay.borders.hairline },
        !raised && !accent && { borderTopWidth: theme.relay.borders.emphasis },
      ]}
    >
      <View style={[styles.heading, { gap: theme.relay.spacing.sm }]}>
        <View style={[styles.titleRow, { gap: theme.relay.spacing.xxs }]}>
          {icon === undefined ? null : (
            <Icon
              color={accent ? colors.onAccentSubtle : colors.accent}
              size={theme.relay.sizes.icon.md}
              source={icon}
            />
          )}
          <AppText style={[styles.title, { color: foreground }]} variant="title">
            {title}
          </AppText>
          {titleAccessory === undefined ? null : (
            <View style={{ marginLeft: -theme.relay.spacing.xs }}>{titleAccessory}</View>
          )}
        </View>
        {meta === undefined ? null : (
          <AppText style={{ color: muted }} variant="caption">
            {meta}
          </AppText>
        )}
      </View>
      <View style={{ gap: theme.relay.spacing.md }}>{children}</View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  heading: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  surface: { overflow: "hidden" },
  title: { flexShrink: 1 },
  titleRow: { alignItems: "center", flex: 1, flexDirection: "row", minWidth: 0 },
});
