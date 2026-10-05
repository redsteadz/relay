import { Children, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "react-native-paper";

import { useRelayTheme } from "@/theme";

import { AppText } from "./AppText";
import { RelayIcon } from "./RelayIcon";
import { StatusPill, type StatusPillTone } from "./StatusPill";

/**
 * Several rows that belong together, inside one card.
 *
 * Settings used to set each of its controls as its own titled block with a paragraph under it,
 * which made a screen of nine switches read like a document and pushed the ninth three scrolls
 * down. A group states the relationship with a shared surface and a hairline, so the paragraph is
 * only written where a control genuinely needs defending.
 */
export function CardGroup({ children }: { children: ReactNode }) {
  const theme = useRelayTheme();
  const { borders, colors, radii } = theme.relay;
  const rows = Children.toArray(children);
  return (
    <View
      style={[
        styles.group,
        {
          backgroundColor: colors.surface,
          borderColor: colors.borderSubtle,
          borderRadius: radii.lg,
          borderWidth: borders.hairline,
        },
      ]}
    >
      {rows.map((row, index) => (
        <View
          key={index}
          style={
            index === 0
              ? undefined
              : { borderTopColor: colors.borderSubtle, borderTopWidth: borders.hairline }
          }
        >
          {row}
        </View>
      ))}
    </View>
  );
}

type CardRowProps = {
  accessibilityHint?: string | undefined;
  /** A control that owns the trailing edge: a switch, a segmented picker, a value. */
  control?: ReactNode;
  detail?: string | undefined;
  /** A Material icon name, drawn in a tinted tile at the leading edge. */
  icon?: string | undefined;
  label: string;
  /** Makes the row a control and draws a chevron. Omit when `control` owns the interaction. */
  onPress?: (() => void) | undefined;
  /** State worth scanning for, such as a connection's. */
  status?: { label: string; tone: StatusPillTone } | undefined;
};

/** One line inside a {@link CardGroup}: what it is, optionally why, and the one thing it does. */
export function CardRow({
  accessibilityHint,
  control,
  detail,
  icon,
  label,
  onPress,
  status,
}: CardRowProps) {
  const theme = useRelayTheme();
  const { colors, interaction, sizes, spacing } = theme.relay;

  const body = (
    <View
      style={[
        styles.row,
        {
          gap: spacing.md,
          minHeight: sizes.touchTarget,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
        },
      ]}
    >
      {icon === undefined ? null : (
        <Icon color={colors.textMuted} size={sizes.icon.md} source={icon} />
      )}
      <View style={[styles.copy, { gap: spacing.xxs }]}>
        <View style={[styles.labelRow, { gap: spacing.sm }]}>
          <AppText style={styles.label} variant="label">
            {label}
          </AppText>
          {status === undefined ? null : <StatusPill label={status.label} tone={status.tone} />}
        </View>
        {detail === undefined ? null : (
          <AppText tone="muted" variant="caption">
            {detail}
          </AppText>
        )}
      </View>
      {control}
      {onPress === undefined ? null : (
        <RelayIcon color={colors.textMuted} name="chevron" size={sizes.icon.md} />
      )}
    </View>
  );

  if (onPress === undefined) return body;
  return (
    <Pressable
      {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
      accessibilityLabel={detail === undefined ? label : `${label}. ${detail}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => (pressed ? { opacity: interaction.pressedOpacity } : undefined)}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  copy: { flex: 1 },
  group: { overflow: "hidden", width: "100%" },
  label: { flexShrink: 1 },
  labelRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap" },
  row: { alignItems: "center", flexDirection: "row", width: "100%" },
});
