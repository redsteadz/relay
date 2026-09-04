import { View } from "react-native";

import {
  AppIconButton,
  AppText,
  ContextualNotice,
  EditorialSurface,
  StatusMessage,
  SwipeableRow,
} from "@/components/ui";
import { useRelayTheme } from "@/theme";

import {
  appIconFor,
  formatCaptureTime,
  type InboxEvidence,
  type InboxItem,
} from "../models/inboxPresentation";

/**
 * Evidence worth reading beside an item.
 *
 * A capture records when it was captured and when it occurred, which the item already states as its
 * time. Repeating those as evidence says nothing, so only facts describing what the capture carried
 * appear here.
 */
function readableEvidence(evidence: readonly InboxEvidence[]): readonly InboxEvidence[] {
  return evidence.filter((fact) => fact.kind !== "date");
}

/**
 * One inbox item and the evidence behind it.
 *
 * Detail is assembled from derived fields only. The encrypted raw payload is never read here, so an
 * item still explains itself after its raw copy expires.
 */
export function InboxItemCard({
  item,
  onHide,
  onOpen,
  threadCount,
}: {
  item: InboxItem;
  /**
   * Removes the item from this reader's inbox. Omit where removal does not apply, such as a list of
   * already-removed items. Never clears the device notification.
   */
  onHide?: (() => void) | undefined;
  /** Opens this item's detail. Omit to render the card as static reading matter. */
  onOpen?: (() => void) | undefined;
  /** How many captures share this item's conversation, when more than one does. */
  threadCount?: number | undefined;
}) {
  const theme = useRelayTheme();
  const evidence = readableEvidence(item.evidence);
  const occurred = formatCaptureTime(item.source.occurredAt);
  const scheduled =
    item.scheduledAt === undefined ? undefined : formatCaptureTime(item.scheduledAt);

  const conversation =
    threadCount === undefined || threadCount < 2
      ? undefined
      : `${threadCount.toString()} in this conversation`;

  const card = (
    <EditorialSurface
      accessibilityHint={
        onOpen === undefined ? undefined : "Opens what Relay read from this capture"
      }
      icon={appIconFor(item.source)}
      meta={[occurred, conversation, item.category?.name].filter(Boolean).join(" · ")}
      onPress={onOpen}
      title={item.title}
      titleAccessory={
        onHide === undefined ? undefined : (
          <AppIconButton
            accessibilityLabel={`Remove ${item.title} from inbox`}
            accessibilityHint="The notification on your device is not touched"
            icon="inbox-remove-outline"
            onPress={onHide}
          />
        )
      }
      variant={item.group === "actionable" ? "accent" : "raised"}
    >
      {item.summary === undefined ? null : <AppText>{item.summary}</AppText>}

      {item.reviewReasons.map((reason) => (
        <StatusMessage key={reason} tone="warning">
          {reason}
        </StatusMessage>
      ))}

      <View style={{ gap: theme.relay.spacing.xxs }}>
        {scheduled === undefined ? null : (
          <AppText tone="muted" variant="caption">
            Due {scheduled}
          </AppText>
        )}
        {evidence.length === 0 ? null : (
          <AppText tone="muted" variant="caption">
            {evidence.map((entry) => `${entry.kind}: ${entry.label}`).join(" · ")}
          </AppText>
        )}
        {item.category === undefined ? null : (
          <AppText tone="muted" variant="caption">
            Filed by {item.category.method} rule
            {item.category.rationale === undefined ? "" : ` · ${item.category.rationale}`}
          </AppText>
        )}
      </View>

      {item.processing === "pending" ? (
        <ContextualNotice accessibilityLabel="Why this item is incomplete" tone="warning">
          Relay accepted this capture but has not finished processing it, so its facts may still be
          incomplete.
        </ContextualNotice>
      ) : null}

      {item.retention.rawExpired ? (
        <ContextualNotice accessibilityLabel="Raw copy retention" tone="info">
          The encrypted original expired and was deleted. This summary is what Relay retains.
        </ContextualNotice>
      ) : null}
    </EditorialSurface>
  );

  if (onHide === undefined) return card;

  // The swipe is the shortcut, not the only route: the same action sits on the card as a labelled
  // control, and SwipeableRow publishes it as an accessibility action besides.
  return (
    <SwipeableRow actionLabel="Remove" icon="inbox-remove-outline" onAction={onHide}>
      {card}
    </SwipeableRow>
  );
}
