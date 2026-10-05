import type { FilterRuleVersion } from "@relay/contracts";
import { Pressable, StyleSheet, View } from "react-native";
import { Switch } from "react-native-paper";

import { AppText, RelayIcon } from "@/components/ui";
import { useRelayTheme } from "@/theme";

import { filterRuleSentence } from "../models/filterPresentation";

/**
 * One rule, as a sentence you can switch off.
 *
 * The card used to describe a rule by its construction -- a name, the author's intent, then "2
 * deterministic checks · semantic fallback at 80% confidence" -- and put the pause switch in a
 * separate band beneath, with a paragraph of its own explaining what pausing means. Three of those
 * filled a phone, and none of them said what the rule did.
 *
 * It now states the rule as the conditional it is, in Relay's own compiled words rather than the
 * author's, so what is read is what will run. The switch sits on the title line because on and off
 * is the only state worth scanning a list of rules for, and the explanation it used to carry now
 * appears in the confirmation that actually changes something.
 *
 * Everything else still opens the rule, because changing one means adding a version and that
 * deserves a screen.
 */
export function RuleRow({
  busy,
  categoryName,
  history,
  onOpen,
  onToggleEnabled,
  revision,
}: {
  busy: boolean;
  /** Where a matching capture is filed, when the screen could resolve the name. */
  categoryName?: string | undefined;
  history: readonly FilterRuleVersion[];
  onOpen: () => void;
  onToggleEnabled: () => void;
  revision: FilterRuleVersion;
}) {
  const theme = useRelayTheme();
  const { borders, colors, interaction, radii, sizes, spacing } = theme.relay;
  const prior = history.filter((entry) => entry.version !== revision.version);
  const sentence = filterRuleSentence(revision.plan);
  const outcome = categoryName === undefined ? "file it" : `file it as ${categoryName}`;

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: colors.surface,
          borderColor: colors.borderSubtle,
          borderRadius: radii.lg,
          borderWidth: borders.hairline,
          opacity: revision.enabled ? 1 : interaction.pressedOpacity,
        },
      ]}
    >
      <Pressable
        accessibilityHint="Opens the rule, its compiled plan, and a dry run"
        accessibilityLabel={`${revision.name}, version ${String(revision.version)}, ${
          revision.enabled ? "enabled" : "paused"
        }`}
        accessibilityRole="button"
        onPress={onOpen}
        style={({ pressed }) => [
          styles.head,
          {
            gap: spacing.sm,
            opacity: pressed ? interaction.pressedOpacity : 1,
            padding: spacing.lg,
          },
        ]}
      >
        <View style={[styles.title, { gap: spacing.sm }]}>
          <AppText numberOfLines={1} style={styles.name} variant="title">
            {revision.name}
          </AppText>
          <AppText tone="muted" variant="monoMeta">
            {`v${String(revision.version)}`}
          </AppText>
          <View
            // The switch owns its own gesture inside a pressable card, so the card's label must not
            // swallow it: it is announced separately and toggles without opening the rule.
            style={[styles.switch, { minHeight: sizes.compactTouchTarget }]}
          >
            <Switch
              accessibilityLabel={revision.enabled ? "Enabled" : "Paused"}
              color={colors.accent}
              disabled={busy}
              onValueChange={onToggleEnabled}
              value={revision.enabled}
            />
          </View>
        </View>

        {/*
         * The rule, as a conditional. Set in body type rather than mono: this is Relay describing a
         * rule in words, not quoting a value it read, and the mono face is reserved for the latter.
         */}
        <AppText numberOfLines={4} variant="body">
          <AppText tone="muted" variant="body">
            If{" "}
          </AppText>
          {sentence.condition}
          <AppText tone="muted" variant="body">
            , then{" "}
          </AppText>
          {outcome}.
        </AppText>

        {sentence.semantic === undefined ? null : (
          <AppText numberOfLines={2} tone="muted" variant="caption">
            {sentence.semantic}
          </AppText>
        )}

        <View style={[styles.footer, { gap: spacing.sm }]}>
          {prior.length === 0 ? (
            <View />
          ) : (
            <AppText tone="muted" variant="monoMeta">
              {`${String(prior.length)} earlier ${prior.length === 1 ? "version" : "versions"} kept`}
            </AppText>
          )}
          <RelayIcon color={colors.textMuted} name="chevron" size={sizes.icon.sm} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
  },
  head: { width: "100%" },
  name: { flexShrink: 1, flexGrow: 1 },
  row: { overflow: "hidden", width: "100%" },
  switch: { justifyContent: "center" },
  title: { alignItems: "center", flexDirection: "row", width: "100%" },
});
