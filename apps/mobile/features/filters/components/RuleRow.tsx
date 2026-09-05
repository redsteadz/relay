import type { FilterRuleVersion } from "@relay/contracts";
import { Pressable, StyleSheet, View } from "react-native";

import { AppSwitch, AppText, RelayIcon } from "@/components/ui";
import { useRelayTheme } from "@/theme";

import { filterPlanSummary } from "../models/filterPresentation";

/**
 * One rule, as a row.
 *
 * The version is stated on the face of the row rather than inside the editor, because a rule is a
 * series and not a setting: what is running now is one revision of it, and the number is how a
 * person tells which. The summary beneath is compiled from the stored plan, so the row describes
 * what the rule does rather than what its author meant to write.
 *
 * The switch is the only control that acts in place. Everything else opens the rule, because
 * changing a rule means adding a version and that deserves a screen.
 */
export function RuleRow({
  busy,
  history,
  onOpen,
  onToggleEnabled,
  revision,
}: {
  busy: boolean;
  history: readonly FilterRuleVersion[];
  onOpen: () => void;
  onToggleEnabled: () => void;
  revision: FilterRuleVersion;
}) {
  const theme = useRelayTheme();
  const { borders, colors, interaction, radii, sizes, spacing } = theme.relay;
  const prior = history.filter((entry) => entry.version !== revision.version);

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: colors.surface,
          borderColor: colors.borderSubtle,
          borderRadius: radii.md,
          borderWidth: borders.hairline,
          opacity: revision.enabled ? 1 : interaction.pressedOpacity,
        },
      ]}
    >
      <Pressable
        accessibilityHint="Opens the rule, its compiled plan, and a dry run"
        accessibilityLabel={`${revision.name}, version ${String(revision.version)}`}
        accessibilityRole="button"
        onPress={onOpen}
        style={({ pressed }) => [
          styles.head,
          {
            gap: spacing.sm,
            opacity: pressed ? interaction.pressedOpacity : 1,
            padding: spacing.md,
          },
        ]}
      >
        <View style={[styles.title, { gap: spacing.sm }]}>
          <AppText numberOfLines={1} style={styles.name} variant="receiptTitle">
            {revision.name}
          </AppText>
          <AppText tone="muted" variant="monoMeta">
            {`v${String(revision.version)}`}
          </AppText>
          <RelayIcon color={colors.textMuted} name="chevron" size={sizes.icon.sm} />
        </View>

        <AppText numberOfLines={2} tone="muted" variant="caption">
          {revision.intent}
        </AppText>

        <AppText tone="muted" variant="mono">
          {filterPlanSummary(revision.plan)}
        </AppText>

        {prior.length === 0 ? null : (
          <AppText tone="muted" variant="monoMeta">
            {`${String(prior.length)} earlier ${prior.length === 1 ? "version" : "versions"} kept`}
          </AppText>
        )}
      </Pressable>

      <View
        style={[
          styles.control,
          {
            borderTopColor: colors.borderSubtle,
            borderTopWidth: borders.hairline,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
          },
        ]}
      >
        <AppSwitch
          detail={
            revision.enabled
              ? "Deciding. Applies to the next capture."
              : "Paused. Its versions and past decisions are kept."
          }
          disabled={busy}
          label={revision.enabled ? "Enabled" : "Paused"}
          onValueChange={onToggleEnabled}
          value={revision.enabled}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  control: { width: "100%" },
  head: { width: "100%" },
  name: { flexShrink: 1, flexGrow: 1 },
  row: { overflow: "hidden", width: "100%" },
  title: { alignItems: "center", flexDirection: "row", width: "100%" },
});
