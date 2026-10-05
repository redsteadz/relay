import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useRelayTheme } from "@/theme";

import { AppText } from "./AppText";
import { RelayIcon, RelayMark } from "./RelayIcon";

type ScreenTopBarProps = {
  /** Rendered at the trailing edge of the utility row. Normally one icon button, never a toolbar. */
  action?: ReactNode;
  /** Shown instead of the mark. A screen reached from another names its way back. */
  onBack?: (() => void) | undefined;
  /** A count or a state, set beside the title in a filled pill: "Rules · 2 active". */
  pill?: string | undefined;
  title: string;
};

/**
 * The header every screen starts with: a utility row, then the screen's name set large.
 *
 * The previous version set the title at body-adjacent size on the same line as the mark and the
 * action, which made every screen open identically and left the tab bar as the only thing saying
 * where a person was. A display-sized title does that work in the first fixation, and it costs one
 * line because the row above it was already there to hold the controls.
 *
 * The mark appears only on a tab root. Below one, the same slot carries the way back, so the
 * position tells a person whether they are somewhere they can leave.
 */
export function ScreenTopBar({ action, onBack, pill, title }: ScreenTopBarProps) {
  const theme = useRelayTheme();
  const { colors, radii, sizes, spacing } = theme.relay;
  return (
    <View
      style={[
        styles.header,
        { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
      ]}
    >
      <View style={styles.utility}>
        {onBack === undefined ? (
          <RelayMark size={sizes.icon.lg + spacing.xs} />
        ) : (
          <Pressable
            accessibilityLabel="Go back"
            accessibilityRole="button"
            hitSlop={spacing.md}
            onPress={onBack}
          >
            <RelayIcon color={colors.text} name="back" />
          </Pressable>
        )}
        {action === undefined ? null : <View style={styles.action}>{action}</View>}
      </View>

      <View style={[styles.titleRow, { gap: spacing.md, paddingBottom: spacing.xs }]}>
        <AppText
          accessibilityRole="header"
          numberOfLines={1}
          style={styles.title}
          variant="display"
        >
          {title}
        </AppText>
        {pill === undefined ? null : (
          <View
            style={[
              styles.pill,
              {
                backgroundColor: colors.accentSubtle,
                borderRadius: radii.pill,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs,
              },
            ]}
          >
            <AppText style={{ color: colors.onAccentSubtle }} variant="caption">
              {pill}
            </AppText>
          </View>
        )}
      </View>
    </View>
  );
}

/** A round, label-free control sized for the header's trailing slot. */
export function TopBarIconButton({
  label,
  name,
  onPress,
}: {
  label: string;
  name: Parameters<typeof RelayIcon>[0]["name"];
  onPress: () => void;
}) {
  const theme = useRelayTheme();
  const { colors, interaction, radii, sizes } = theme.relay;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        {
          backgroundColor: colors.surface,
          borderRadius: radii.pill,
          height: sizes.compactTouchTarget,
          opacity: pressed ? interaction.pressedOpacity : 1,
          width: sizes.compactTouchTarget,
        },
      ]}
    >
      <RelayIcon color={colors.text} name={name} size={sizes.icon.md} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: { flex: 0 },
  header: { width: "100%" },
  iconButton: { alignItems: "center", justifyContent: "center" },
  pill: { flexShrink: 0 },
  title: { flexShrink: 1 },
  titleRow: { alignItems: "center", flexDirection: "row" },
  utility: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
  },
});
