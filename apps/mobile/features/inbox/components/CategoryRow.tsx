import { Pressable, StyleSheet, View } from "react-native";

import { AppText, RelayIcon, StatusPill } from "@/components/ui";
import { useRelayTheme } from "@/theme";

import { formatCaptureTime, type InboxCategorySummary } from "../models/inboxPresentation";

/**
 * One category, as a row.
 *
 * Shows what is filed here and what within it still wants a decision, because a category is only
 * useful as an answer to "where did that go" and "is anything in there waiting on me". A category
 * with nothing in it still appears, with a zero: proving a category exists is the point of listing
 * every one the tenant owns rather than only the ones that have matched something.
 */
export function CategoryRow({
  category,
  now,
  onPress,
}: {
  category: InboxCategorySummary;
  now?: Date | undefined;
  onPress: () => void;
}) {
  const theme = useRelayTheme();
  const { borders, colors, interaction, radii, sizes, spacing } = theme.relay;
  const waiting = category.actionable + category.needsReview;
  const newest = formatCaptureTime(category.latestOccurredAt, now);
  const captures = category.captures === 1 ? "1 receipt" : `${String(category.captures)} receipts`;

  return (
    <Pressable
      accessibilityHint={`Opens everything filed under ${category.name}`}
      accessibilityLabel={`${category.name}, ${captures}${waiting === 0 ? "" : `, ${String(waiting)} waiting on you`}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: colors.surface,
          borderColor: colors.borderSubtle,
          borderRadius: radii.md,
          borderWidth: borders.hairline,
          gap: spacing.md,
          opacity: pressed ? interaction.pressedOpacity : 1,
          padding: spacing.md,
        },
      ]}
    >
      <View style={styles.body}>
        <View style={[styles.heading, { gap: spacing.sm }]}>
          <AppText numberOfLines={1} style={styles.name} variant="bodyStrong">
            {category.name}
          </AppText>
          {category.system ? <StatusPill label="System" tone="muted" /> : null}
        </View>
        <AppText numberOfLines={1} tone="muted" variant="caption">
          {category.captures === 0
            ? "Nothing filed here yet"
            : newest === ""
              ? captures
              : `${captures} · newest ${newest}`}
        </AppText>
      </View>

      {waiting === 0 ? null : <StatusPill label={`${String(waiting)} waiting`} tone="accent" />}
      <AppText tone="muted" variant="monoMeta">
        {String(category.captures)}
      </AppText>
      <RelayIcon color={colors.textMuted} name="chevron" size={sizes.icon.sm} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { flexGrow: 1, flexShrink: 1 },
  heading: { alignItems: "center", flexDirection: "row" },
  name: { flexShrink: 1 },
  row: { alignItems: "center", flexDirection: "row", width: "100%" },
});
