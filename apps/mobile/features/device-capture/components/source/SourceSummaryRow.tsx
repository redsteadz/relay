import { Pressable, StyleSheet, View } from "react-native";

import { AppIconButton, AppText, RelayIcon } from "@/components/ui";
import { receiptGlyph } from "@/features/inbox/models/receiptPresentation";
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
          borderRadius: radii.md,
          borderWidth: borders.hairline,
          gap: spacing.md,
          opacity: pressed ? interaction.pressedOpacity : 1,
          padding: spacing.md,
        },
      ]}
    >
      <View
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.glyph,
          {
            backgroundColor: colors.surfaceRaised,
            borderRadius: radii.sm,
            height: sizes.glyph,
            width: sizes.glyph,
          },
        ]}
      >
        <AppText tone="muted" variant="monoGlyph">
          {receiptGlyph(source.name)}
        </AppText>
      </View>

      <View style={[styles.copy, { gap: spacing.xs }]}>
        <View style={[styles.heading, { gap: spacing.sm }]}>
          <AppText numberOfLines={1} style={styles.name} variant="receiptTitle">
            {source.name}
          </AppText>
          <SourceStatusLabel status={status} />
        </View>
        <AppText numberOfLines={2} tone="muted" variant="caption">
          {source.description}
        </AppText>
      </View>

      {!disclosure || onDisclosure === undefined ? (
        <View importantForAccessibility="no-hide-descendants" style={styles.chevron}>
          <RelayIcon color={colors.textMuted} name="chevron" size={sizes.icon.sm} />
        </View>
      ) : (
        <AppIconButton
          accessibilityHint={`Shows the ${source.name} privacy notice`}
          accessibilityLabel={`About ${source.name} privacy`}
          compact
          icon="information-outline"
          onPress={onDisclosure}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chevron: { alignSelf: "center" },
  copy: { flex: 1, minWidth: 0 },
  glyph: { alignItems: "center", justifyContent: "center" },
  heading: { alignItems: "center", flexDirection: "row" },
  name: { flexShrink: 1 },
  row: { alignItems: "center", flexDirection: "row" },
});
