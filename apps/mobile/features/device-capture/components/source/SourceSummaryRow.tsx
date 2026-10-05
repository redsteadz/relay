import { Pressable, StyleSheet, View } from "react-native";

import { AppIconButton, AppText, RelayIcon, TintTile } from "@/components/ui";
import { useRelayTheme } from "@/theme";

import type { SourceStatus } from "../../models/capturePresentation";
import type { SourceDefinition } from "../../models/sourceCatalog";
import { SourceStatusLabel } from "./SourceStatusLabel";

type SourceSummaryRowProps = {
  disclosure?: boolean;
  onDisclosure?: (() => void) | undefined;
  onPress: () => void;
  source: SourceDefinition;
  status: SourceStatus;
};

/**
 * One connected source, as a card.
 *
 * Carries the same anatomy as a receipt -- a glyph for where it comes from, a name, a line of what
 * it reads, and a state -- so the screen that lists what Relay may capture reads like the screen
 * that lists what it captured. The privacy notice keeps its own control rather than being folded
 * into the row's tap, because opening a boundary and changing it are different intents.
 */
export function SourceSummaryRow({
  disclosure = false,
  onDisclosure,
  onPress,
  source,
  status,
}: SourceSummaryRowProps) {
  const theme = useRelayTheme();
  const { borders, colors, interaction, radii, sizes, spacing } = theme.relay;

  return (
    <Pressable
      accessibilityHint="Opens source configuration"
      accessibilityLabel={`${source.name}. ${status.label}. ${source.description}`}
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
          padding: spacing.lg,
        },
      ]}
    >
      <TintTile icon={source.icon} label={source.name} tintKey={source.id} />

      <View style={[styles.copy, { gap: spacing.xs }]}>
        {/* Wrapping, because "Android notifications" beside an ACTIVE pill does not fit a phone
            on one line and was being truncated to "Android notific...". */}
        <View style={[styles.heading, { gap: spacing.sm }]}>
          <AppText numberOfLines={2} style={styles.name} variant="title">
            {source.name}
          </AppText>
          <SourceStatusLabel status={status} />
        </View>
        <AppText numberOfLines={2} tone="muted" variant="caption">
          {source.description}
        </AppText>
      </View>

      {/*
       * Both controls, not one or the other. The row used to drop its chevron whenever a source
       * carried a privacy notice, which left the lone information circle looking like the only
       * thing the row did -- and it was the one thing that did not open the source.
       */}
      {!disclosure || onDisclosure === undefined ? null : (
        <AppIconButton
          accessibilityHint={`Shows the ${source.name} privacy notice`}
          accessibilityLabel={`About ${source.name} privacy`}
          compact
          icon="information-outline"
          onPress={onDisclosure}
        />
      )}
      <View importantForAccessibility="no-hide-descendants" style={styles.chevron}>
        <RelayIcon color={colors.textMuted} name="chevron" size={sizes.icon.sm} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chevron: { alignSelf: "center" },
  copy: { flex: 1, minWidth: 0 },
  heading: { alignItems: "center", flexDirection: "row", flexWrap: "wrap" },
  name: { flexShrink: 1 },
  row: { alignItems: "center", flexDirection: "row" },
});
