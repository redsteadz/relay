import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";

import { ReceiptScreen } from "@/components/ReceiptScreen";
import {
  AnimatedListItem,
  FeedbackState,
  LoadingState,
  StatusMessage,
  SwipeableRow,
  UndoBar,
} from "@/components/ui";
import { useProposedActions } from "@/features/actions/hooks/useProposedActions";
import { useCategoryManagement } from "@/features/categories/hooks/useCategoryManagement";
import { ReceiptCard } from "@/features/inbox/components/ReceiptCard";
import { useInbox } from "@/features/inbox/hooks/useInbox";
import {
  filterByCategory,
  groupByThread,
  UNFILED_CATEGORY_KEY,
} from "@/features/inbox/models/inboxPresentation";
import { useAuth } from "@/lib/auth-context";
import { logMobileError } from "@/lib/observability";

/**
 * Everything filed into one category.
 *
 * Flat rather than split by outcome: the reader already narrowed to one category, and a second
 * axis of grouping over what is usually a short list asks for a choice where scrolling is cheaper.
 */
export default function InboxCategoryScreen() {
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { client, session } = useAuth();
  const inbox = useInbox();
  const proposals = useProposedActions(client, session?.user.id);
  const categories = useCategoryManagement(client, session?.user.id);
  const [hideError, setHideError] = useState<string | undefined>();

  const known = categories.activeCustom.concat(categories.systemCategories);
  const key = decodeURIComponent(slug ?? "");
  const items = filterByCategory(
    inbox.sections.flatMap((section) => section.items),
    key,
    known,
  );
  const title =
    key === UNFILED_CATEGORY_KEY
      ? "Unfiled"
      : (known.find((category) => category.slug === key)?.name ?? "Category");

  async function hide(eventId: string): Promise<void> {
    setHideError(undefined);
    try {
      await inbox.hide(eventId);
    } catch (error: unknown) {
      logMobileError("ui.inbox_hide_failed", error, {
        code: "INBOX_HIDE_FAILED",
        integration: "supabase-postgrest",
        operation: "hideInboxEvent",
      });
      setHideError("Could not remove that from your inbox. It is still here.");
    }
  }

  return (
    <ReceiptScreen
      onBack={() => router.back()}
      overlay={
        inbox.lastHidden === undefined ? undefined : (
          <UndoBar
            message={`Removed ${inbox.lastHidden.title} from your inbox`}
            onExpire={inbox.clearLastHidden}
            onUndo={() => {
              const removed = inbox.lastHidden;
              if (removed !== undefined) void inbox.restore(removed.id);
            }}
          />
        )
      }
      title={title}
    >
      {inbox.loading ? <LoadingState label="Reading this category..." /> : null}

      {hideError === undefined ? null : <StatusMessage tone="error">{hideError}</StatusMessage>}
      {proposals.error === undefined ? null : (
        <StatusMessage tone="error">{proposals.error}</StatusMessage>
      )}

      {!inbox.loading && items.length === 0 ? (
        <FeedbackState
          detail={
            key === UNFILED_CATEGORY_KEY
              ? "Everything Relay read matched one of your categories."
              : "Nothing has been filed here yet. It will appear once a rule files something into it."
          }
          kind="empty"
          title="Nothing here"
        />
      ) : null}

      {groupByThread(items).map((thread) => {
        const proposal = proposals.forEvent(thread.latest.id)[0];
        return (
          <AnimatedListItem key={thread.key}>
            <SwipeableRow
              actionLabel="Remove"
              icon="inbox-remove-outline"
              onAction={() => void hide(thread.latest.id)}
            >
              <ReceiptCard
                busy={proposal !== undefined && proposals.deciding === proposal.id}
                item={thread.latest}
                onApprove={(runId) => void proposals.approve(runId)}
                onOpen={() => router.push(`/inbox/${thread.latest.id}`)}
                onSkip={(runId) => void proposals.skip(runId)}
                proposal={proposal}
                threadCount={thread.items.length}
              />
            </SwipeableRow>
          </AnimatedListItem>
        );
      })}
    </ReceiptScreen>
  );
}
