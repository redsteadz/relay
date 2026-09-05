import { Pressable, StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui";
import type { ProposedAction } from "@/features/actions/models/actionPresentation";
import { useRelayTheme } from "@/theme";

import type { InboxItem } from "../models/inboxPresentation";
import {
  receiptDecision,
  receiptGlyph,
  receiptKindLine,
  receiptSourceLine,
} from "../models/receiptPresentation";
import { DecisionLine } from "./DecisionLine";
import { FactChipRow } from "./FactChipRow";
import { ProposedActionBlock } from "./ProposedActionBlock";

/**
 * One capture, as a receipt.
 *
 * The anatomy is fixed and runs everywhere Relay shows an item: where it came from, what it is
 * called, the values that were read, how it was filed, and -- below a perforation -- what is
 * proposed because of it. The order is the order things happened, so reading down the card is
 * reading the pipeline's own sequence.
 *
 * The card never states more than the pipeline did. A missing category, an uncertain fact, an
 * unfinished capture and an expired raw copy each get their own quiet line rather than being
 * smoothed into a confident summary.
 */
export function ReceiptCard({
  busy = false,
  item,
  now,
  onApprove,
  onOpen,
  onSkip,
  proposal,
  threadCount,
}: {
  busy?: boolean;
  item: InboxItem;
  now?: Date | undefined;
  onApprove?: ((actionRunId: string) => void) | undefined;
  /** Opens the full receipt. Omit to render the card as static reading matter. */
  onOpen?: (() => void) | undefined;
  onSkip?: ((actionRunId: string) => void) | undefined;
  /** The proposal this receipt is waiting on, when Relay made one. */
  proposal?: ProposedAction | undefined;
  /** How many captures share this item's conversation, when more than one does. */
  threadCount?: number | undefined;
}) {
  const theme = useRelayTheme();
  const { borders, colors, interaction, radii, sizes, spacing } = theme.relay;
  const unresolved = item.reviewReasons.length > 0;
  const decision = receiptDecision(item.category, unresolved);
  const conversation =
    threadCount === undefined || threadCount < 2 ? undefined : `+${String(threadCount - 1)} more`;

  const head = (
    <View
      style={[
        styles.head,
        {
          gap: spacing.sm,
          paddingBottom: spacing.sm,
          paddingHorizontal: spacing.md,
          paddingTop: spacing.md,
        },
      ]}
    >
      <View style={[styles.meta, { gap: spacing.sm }]}>
        <View style={[styles.source, { gap: spacing.sm }]}>
          <View
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
              {receiptGlyph(item.appLabel)}
            </AppText>
          </View>
          <AppText numberOfLines={1} style={styles.sourceText} tone="muted" variant="caption">
            {receiptSourceLine(item)}
          </AppText>
        </View>
        <AppText numberOfLines={1} tone="muted" variant="monoMeta">
          {receiptKindLine(item, now).toUpperCase()}
        </AppText>
      </View>

      <AppText variant="receiptTitle">{item.title}</AppText>

      <FactChipRow evidence={item.evidence} now={now} />

      {decision === undefined ? null : <DecisionLine decision={decision} />}

      {item.reviewReasons.map((reason) => (
        <AppText key={reason} tone="warning" variant="caption">
          {reason}
        </AppText>
      ))}

      {item.processing === "pending" ? (
        <AppText tone="muted" variant="caption">
          Relay accepted this but has not finished reading it, so its facts may be incomplete.
        </AppText>
      ) : null}

      {conversation === undefined ? null : (
        <AppText tone="muted" variant="monoMeta">
          {conversation}
        </AppText>
      )}
    </View>
  );

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.borderSubtle,
          borderRadius: radii.md,
          borderWidth: borders.hairline,
        },
      ]}
    >
      {onOpen === undefined ? (
        head
      ) : (
        <Pressable
          accessibilityHint="Opens everything Relay read from this capture"
          accessibilityLabel={item.title}
          accessibilityRole="button"
          onPress={onOpen}
          style={({ pressed }) => (pressed ? { opacity: interaction.pressedOpacity } : undefined)}
        >
          {head}
        </Pressable>
      )}

      {proposal === undefined || onApprove === undefined || onSkip === undefined ? null : (
        <ProposedActionBlock
          busy={busy}
          now={now}
          onApprove={() => onApprove(proposal.id)}
          onSkip={() => onSkip(proposal.id)}
          proposal={proposal}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { overflow: "hidden", width: "100%" },
  glyph: { alignItems: "center", justifyContent: "center" },
  head: { width: "100%" },
  meta: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  source: { alignItems: "center", flexDirection: "row", flexShrink: 1 },
  sourceText: { flexShrink: 1 },
});
