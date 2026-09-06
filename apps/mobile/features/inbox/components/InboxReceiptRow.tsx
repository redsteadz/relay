import { memo } from "react";

import { AnimatedListItem, SwipeableRow } from "@/components/ui";
import type { ProposedAction } from "@/features/actions/models/actionPresentation";

import type { InboxThread } from "../models/inboxPresentation";
import { ReceiptCard } from "./ReceiptCard";

type InboxReceiptRowProps = {
  busy: boolean;
  onApprove: (actionRunId: string) => void;
  onHide: (eventId: string) => void;
  onOpen: (eventId: string) => void;
  onSkip: (actionRunId: string) => void;
  proposal: ProposedAction | undefined;
  thread: InboxThread;
};

/**
 * One receipt in a list, memoized.
 *
 * A single removal puts the inbox through several renders -- the optimistic cache write, the undo
 * offer, and the mutation settling -- and without this every card in the list re-rendered on each
 * of them. That work lands on the JS thread at exactly the moment the row is animating away, and
 * stalling the commit is what made a gesture running on the UI thread still feel late.
 *
 * The callbacks are taken as stable references and given the id they act on, rather than closing
 * over it here. A closure created inline in the parent would change identity on every render and
 * make this memo do nothing.
 */
export const InboxReceiptRow = memo(function InboxReceiptRow({
  busy,
  onApprove,
  onHide,
  onOpen,
  onSkip,
  proposal,
  thread,
}: InboxReceiptRowProps) {
  const item = thread.latest;
  return (
    <AnimatedListItem>
      {/*
       * The swipe is a shortcut, not the only route: the same removal sits on the receipt's own
       * screen as a labelled control, and SwipeableRow publishes it as an accessibility action.
       */}
      <SwipeableRow
        actionLabel="Remove"
        icon="inbox-remove-outline"
        onAction={() => onHide(item.id)}
      >
        <ReceiptCard
          busy={busy}
          item={item}
          onApprove={onApprove}
          onOpen={() => onOpen(item.id)}
          onSkip={onSkip}
          proposal={proposal}
          threadCount={thread.items.length}
        />
      </SwipeableRow>
    </AnimatedListItem>
  );
});
