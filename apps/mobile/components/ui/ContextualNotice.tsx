import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "react-native-paper";

import { useRelayTheme } from "@/theme";

import { AppText } from "./AppText";

export type ContextualNoticeTone = "info" | "warning";

type ContextualNoticeProps = {
  /** The one line shown when collapsed. Say what the notice is about, not that it exists. */
  accessibilityLabel?: string;
  children: string;
  tone?: ContextualNoticeTone;
};

const toneDetails: Record<ContextualNoticeTone, { icon: string; label: string }> = {
  info: { icon: "information-outline", label: "Information" },
  warning: { icon: "alert-outline", label: "Warning" },
};

/**
 * A boundary worth stating, stated in place.
 *
 * This used to be a bare circled "i" floating alone above the content, with the sentence hidden in
 * a pop-up menu behind it. On three screens it was the first thing on the page and said nothing:
 * an unlabelled control is an invitation to find out what it does, which is the opposite of what a
 * privacy notice is for -- and a person who never tapped it never learned the boundary at all.
 *
 * It is now a labelled strip. Collapsed, it names its subject on one line, which is the summary the
 * icon was standing in for. Tapped, it says the whole thing in place, without covering the content
 * it is about.
 */
export function ContextualNotice({
  accessibilityLabel,
  children,
  tone = "info",
}: ContextualNoticeProps) {
  const theme = useRelayTheme();
  const { borders, colors, interaction, radii, sizes, spacing } = theme.relay;
  const [expanded, setExpanded] = useState(false);
  const details = toneDetails[tone];
  const [backgroundColor, color, emphasis] =
    tone === "warning"
      ? [colors.warningSurface, colors.onWarningSurface, colors.warning]
      : [colors.infoSurface, colors.onInfoSurface, colors.info];
  const summary = accessibilityLabel ?? details.label;

  return (
    <Pressable
      accessibilityHint={expanded ? "Collapses this notice" : "Shows the whole notice"}
      accessibilityLabel={summary}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={() => setExpanded((open) => !open)}
      style={({ pressed }) => [
        styles.notice,
        {
          backgroundColor,
          borderLeftColor: emphasis,
          borderLeftWidth: borders.emphasis,
          borderRadius: radii.sm,
          gap: spacing.sm,
          opacity: pressed ? interaction.pressedOpacity : 1,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        },
      ]}
    >
      <View style={[styles.head, { gap: spacing.sm }]}>
        <Icon color={emphasis} size={sizes.icon.sm} source={details.icon} />
        <AppText numberOfLines={1} style={[styles.summary, { color }]} variant="caption">
          {summary}
        </AppText>
        <Icon
          color={emphasis}
          size={sizes.icon.sm}
          source={expanded ? "chevron-up" : "chevron-down"}
        />
      </View>
      {expanded ? (
        <AppText accessibilityLiveRegion="polite" style={{ color }} variant="caption">
          {children}
        </AppText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: "center", flexDirection: "row", width: "100%" },
  notice: { width: "100%" },
  summary: { flex: 1 },
});
