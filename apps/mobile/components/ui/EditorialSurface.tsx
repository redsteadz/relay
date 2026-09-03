import type { PropsWithChildren, ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon, Surface } from "react-native-paper";

import { useRelayTheme } from "@/theme";

import { AppText } from "./AppText";

export type EditorialSurfaceVariant = "plain" | "raised" | "accent";

type EditorialSurfaceProps = PropsWithChildren<{
  /** Spoken after the label to say what opening this leads to. Required with `onPress`. */
  accessibilityHint?: string | undefined;
  icon?: string | undefined;
  meta?: string | undefined;
  /** Makes the whole surface one control. Omit to leave it as static reading matter. */
  onPress?: (() => void) | undefined;
  title: string;
  titleAccessory?: ReactNode;
  variant?: EditorialSurfaceVariant;
}>;

export function EditorialSurface({
  accessibilityHint,
  children,
  icon,
  meta,
  onPress,
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

  const surface = (
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

  if (onPress === undefined) return surface;

  // The whole card is the target rather than a separate chevron, so the reachable area matches the
  // area that looks tappable and clears the 48px minimum on its own.
  return (
    <Pressable
      accessibilityRole="button"
      {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
      accessibilityLabel={meta === undefined ? title : `${title}. ${meta}`}
      onPress={onPress}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
    >
      {surface}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  heading: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  pressable: { borderRadius: 0 },
  pressed: { opacity: 0.7 },
  surface: { overflow: "hidden" },
  title: { flexShrink: 1 },
  titleRow: { alignItems: "center", flex: 1, flexDirection: "row", minWidth: 0 },
});
