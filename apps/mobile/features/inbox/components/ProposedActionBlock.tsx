import { Pressable, StyleSheet, View } from "react-native";

import { AppText, DashedRule } from "@/components/ui";
import type { ProposedAction } from "@/features/actions/models/actionPresentation";
import { useRelayTheme } from "@/theme";

import { formatCaptureTime } from "../models/inboxPresentation";

/**
 * What Relay proposes to do, and the decision it is waiting on.
 *
 * This is the half of a receipt that has not happened yet, which is why it sits below a perforation
 * and why nothing here is styled as a result. Approving records a decision in the ledger; the
 * Workflow that dispatches it runs afterwards, so the confirmation says the decision was recorded
 * rather than that the provider received anything.
 *
 * There is deliberately no control to edit the rendered action. An action's input is compiled from a
 * rule and an event, and letting a person retype it here would produce a dispatch that no rule
 * accounts for and no dry run ever previewed.
 */
export function ProposedActionBlock({
  busy,
  onApprove,
  onSkip,
  proposal,
  now,
}: {
  /** True while this proposal's own decision is in flight. */
  busy: boolean;
  onApprove: () => void;
  onSkip: () => void;
  proposal: ProposedAction;
  now?: Date | undefined;
}) {
  const theme = useRelayTheme();
  const { colors, interaction, radii, sizes, spacing } = theme.relay;
  const due = proposal.due === undefined ? undefined : formatCaptureTime(proposal.due, now);
  const awaiting = proposal.canApprove;

  return (
    <>
      <DashedRule />
      <View
        style={[
          styles.block,
          {
            gap: spacing.sm,
            paddingBottom: spacing.md,
            paddingHorizontal: spacing.md,
            paddingTop: spacing.sm,
          },
        ]}
      >
        <View style={[styles.line, { gap: spacing.sm }]}>
          <AppText tone="accent" variant="monoStrong">
            →
          </AppText>
          <AppText numberOfLines={1} tone="muted" variant="actionText">
            {proposal.provider}
          </AppText>
          <AppText numberOfLines={1} style={styles.title} variant="actionText">
            {proposal.title}
          </AppText>
          {due === undefined || due === "" ? null : (
            <AppText style={styles.due} tone="muted" variant="monoMeta">
              {due}
            </AppText>
          )}
        </View>

        {awaiting ? null : (
          <AppText tone="muted" variant="caption">
            Approved. Waiting to be sent to {proposal.provider}.
          </AppText>
        )}

        <View style={[styles.controls, { gap: spacing.sm }]}>
          {awaiting ? (
            <Pressable
              accessibilityHint={`Records your approval. Relay sends it to ${proposal.provider}.`}
              accessibilityLabel={`Approve ${proposal.title}`}
              accessibilityRole="button"
              accessibilityState={{ busy, disabled: busy }}
              disabled={busy}
              onPress={onApprove}
              style={({ pressed }) => [
                styles.primary,
                {
                  backgroundColor: colors.action,
                  borderRadius: radii.sm,
                  height: sizes.compactTouchTarget,
                  opacity: busy
                    ? interaction.disabledOpacity
                    : pressed
                      ? interaction.pressedOpacity
                      : 1,
                },
              ]}
            >
              <AppText style={{ color: colors.onAction }} variant="label">
                Approve
              </AppText>
            </Pressable>
          ) : null}

          {proposal.canSkip ? (
            <Pressable
              accessibilityHint="Nothing is sent. The receipt stays in your inbox."
              accessibilityLabel={`Skip ${proposal.title}`}
              accessibilityRole="button"
              accessibilityState={{ busy, disabled: busy }}
              disabled={busy}
              onPress={onSkip}
              style={({ pressed }) => [
                styles.secondary,
                {
                  borderRadius: radii.sm,
                  height: sizes.compactTouchTarget,
                  opacity: busy
                    ? interaction.disabledOpacity
                    : pressed
                      ? interaction.pressedOpacity
                      : 1,
                  paddingHorizontal: spacing.md,
                },
              ]}
            >
              <AppText tone="muted" variant="label">
                Skip
              </AppText>
            </Pressable>
          ) : null}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  block: { width: "100%" },
  controls: { flexDirection: "row" },
  due: { marginLeft: "auto" },
  line: { alignItems: "center", flexDirection: "row" },
  primary: { alignItems: "center", flex: 1, justifyContent: "center" },
  secondary: { alignItems: "center", justifyContent: "center" },
  title: { flexShrink: 1 },
});
