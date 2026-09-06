import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useRelayTheme } from "@/theme";

import { AppText } from "./AppText";
import { RelayIcon, RelayMark } from "./RelayIcon";

type ScreenTopBarProps = {
  /** Rendered at the trailing edge. A single icon button, never a row of them. */
  action?: ReactNode;
  /** Shown instead of the mark. A screen reached from another names its way back. */
  onBack?: (() => void) | undefined;
  title: string;
};

/**
 * The one-line header every screen in the redesign starts with.
 *
 * It replaces the eyebrow/title/detail block, which spent the top third of every screen restating
 * what the tab bar already said. A receipt list has to begin near the top of the screen for the
 * first receipt to be readable without scrolling, and the explanatory sentence that used to sit
 * here now lives where it is actually needed -- next to the control it explains.
 *
 * The mark appears only on a tab root. Below one, the same slot carries the way back, so the
 * position tells a person whether they are somewhere they can leave.
 */
export function ScreenTopBar({ action, onBack, title }: ScreenTopBarProps) {
  const theme = useRelayTheme();
  const { colors, sizes, spacing } = theme.relay;
  return (
    <View
      style={[
        styles.bar,
        {
          gap: spacing.sm,
          paddingLeft: spacing.lg,
          paddingRight: spacing.md,
          paddingTop: spacing.md,
        },
      ]}
    >
      <View style={[styles.lead, { gap: spacing.sm }]}>
        {onBack === undefined ? (
          <RelayMark size={sizes.icon.lg + spacing.xs} />
        ) : (
          <Pressable
            accessibilityLabel="Go back"
            accessibilityRole="button"
            hitSlop={spacing.sm}
            onPress={onBack}
          >
            <RelayIcon color={colors.text} name="back" />
          </Pressable>
        )}
        <AppText accessibilityRole="header" numberOfLines={1} variant="heading">
          {title}
        </AppText>
      </View>
      {action === undefined ? null : <View style={styles.action}>{action}</View>}
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
  bar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
  },
  iconButton: { alignItems: "center", justifyContent: "center" },
  lead: { alignItems: "center", flexDirection: "row", flexShrink: 1 },
});
