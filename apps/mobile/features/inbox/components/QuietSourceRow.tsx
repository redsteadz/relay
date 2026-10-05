import { Pressable, StyleSheet, View } from "react-native";

import { AppText, RelayIcon, TintTile } from "@/components/ui";
import { useRelayTheme } from "@/theme";

import { formatCaptureTime, type InboxAppSummary } from "../models/inboxPresentation";

/**
 * One quiet source, as a single line.
 *
 * Quiet items are numerous by design, and a receipt each would be the noise this inbox exists to
 * remove. A source keeps its count and its newest arrival on screen -- so nothing becomes invisible
 * -- and the captures themselves stay one tap away rather than expanded in place.
 */
export function QuietSourceRow({
  application,
  now,
  onPress,
}: {
  application: InboxAppSummary;
  now?: Date | undefined;
  onPress: () => void;
}) {
  const theme = useRelayTheme();
  const { borders, colors, interaction, radii, sizes, spacing } = theme.relay;
  const newest = formatCaptureTime(application.latestOccurredAt, now);
  const captures =
    application.captures === 1 ? "1 capture" : `${String(application.captures)} captures`;

  return (
    <Pressable
      accessibilityHint={`Opens every capture from ${application.label}`}
      accessibilityLabel={`${application.label}, ${captures}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: colors.surface,
          borderColor: colors.borderSubtle,
          borderRadius: radii.lg,
          borderWidth: borders.hairline,
          gap: spacing.md,
          opacity: pressed ? interaction.pressedOpacity : 1,
          padding: spacing.md,
        },
      ]}
    >
      <TintTile compact label={application.label} tintKey={application.key} />

      <View style={styles.body}>
        <AppText numberOfLines={1} variant="bodyStrong">
          {application.label}
        </AppText>
        <AppText numberOfLines={1} tone="muted" variant="caption">
          {newest === "" ? captures : `${captures} · newest ${newest}`}
        </AppText>
      </View>

      <AppText tone="muted" variant="monoMeta">
        {String(application.captures)}
      </AppText>
      <RelayIcon color={colors.textMuted} name="chevron" size={sizes.icon.sm} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { flexShrink: 1, flexGrow: 1 },
  row: { alignItems: "center", flexDirection: "row", width: "100%" },
});
