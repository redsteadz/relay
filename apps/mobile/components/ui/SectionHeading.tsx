import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Icon } from "react-native-paper";

import { useRelayTheme } from "@/theme";

import { AppText } from "./AppText";

type SectionHeadingProps = {
  /** A Material icon name, drawn in the accent beside the label. */
  icon?: string | undefined;
  label: string;
  /** A count, a state, or a link, set at the trailing edge in muted type. */
  trailing?: ReactNode;
};

/**
 * The line that names a band of content.
 *
 * Set in the accent rather than in body colour, and in the eyebrow face rather than a heading one,
 * because a section label is a signpost and not a thing to read: it should be findable while
 * scrolling past and invisible while reading. One per band, never nested.
 */
export function SectionHeading({ icon, label, trailing }: SectionHeadingProps) {
  const theme = useRelayTheme();
  const { colors, sizes, spacing } = theme.relay;
  return (
    <View style={[styles.row, { gap: spacing.sm, paddingTop: spacing.sm }]}>
      {icon === undefined ? null : (
        <Icon color={colors.accent} size={sizes.icon.sm} source={icon} />
      )}
      <AppText
        accessibilityRole="header"
        style={[styles.label, { color: colors.accent }]}
        variant="eyebrow"
      >
        {label.toUpperCase()}
      </AppText>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { flexShrink: 1 },
  row: { alignItems: "center", flexDirection: "row", width: "100%" },
});
