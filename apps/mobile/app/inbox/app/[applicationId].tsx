import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { ReceiptScreen } from "@/components/ReceiptScreen";
import {
  AppButton,
  AnimatedListItem,
  AppText,
  FeedbackState,
  LoadingState,
  StatusMessage,
  SwipeableRow,
  UndoBar,
} from "@/components/ui";
import { useConfirmedApproval } from "@/features/actions/hooks/useConfirmedApproval";
import { useProposedActions } from "@/features/actions/hooks/useProposedActions";
import { ReceiptCard } from "@/features/inbox/components/ReceiptCard";
import { useApplicationLabels } from "@/features/inbox/hooks/useApplicationLabels";
import { useInbox } from "@/features/inbox/hooks/useInbox";
import { undoRemoval } from "@/features/inbox/undoRemoval";
import {
  groupByThread,
  inboxAppKey,
  inboxSections,
  type InboxGroup,
} from "@/features/inbox/models/inboxPresentation";
import { useAuth } from "@/lib/auth-context";
import { logMobileError } from "@/lib/observability";
import { useRelayTheme } from "@/theme";

const GROUP_HEADING: Record<InboxGroup, string> = {
  actionable: "Needs you",
  filed: "Filed",
  "needs-review": "Review",
  unfiled: "Not filed yet",
};

/**
 * Everything one application sent, in the same order of importance as the inbox itself.
 *
 * The outcomes are kept as headings rather than tabs here: this list is already narrowed to one
 * source, so it is short enough to read in one pass, and a tab strip over a handful of rows would
 * ask for a choice where scrolling is cheaper.
 */
export default function InboxApplicationScreen() {
  const router = useRouter();
  const theme = useRelayTheme();
  const { applicationId } = useLocalSearchParams<{ applicationId: string }>();
  const { client, session } = useAuth();
  const inbox = useInbox();
  const proposals = useProposedActions(client, session?.user.id);
  const approval = useConfirmedApproval(proposals.approve);
  const [hideError, setHideError] = useState<string | undefined>();

  const key = decodeURIComponent(applicationId ?? "");
  const items = inbox.sections
    .flatMap((section) => section.items)
    .filter((item) => inboxAppKey(item.source) === key);

  const labels = useApplicationLabels(
    items.flatMap((item) =>
      item.source.applicationId === undefined ? [] : [item.source.applicationId],
    ),
  );
  const first = items[0];
  const label =
    first === undefined
      ? "Source"
      : first.source.applicationId === undefined
        ? first.appLabel
        : (labels.get(first.source.applicationId) ?? first.appLabel);

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
              if (removed !== undefined) undoRemoval(inbox.restore, removed.id, setHideError);
            }}
          />
        )
      }
      title={label}
    >
      <AppText tone="muted" variant="caption">
        Everything Relay captured from this app, newest first. Swipe one to remove it.
      </AppText>

      {inbox.loading ? <LoadingState label="Reading captures..." /> : null}

      {hideError === undefined ? null : <StatusMessage tone="error">{hideError}</StatusMessage>}
      {proposals.error === undefined ? null : (
        <StatusMessage tone="error">{proposals.error}</StatusMessage>
      )}

      {!inbox.loading && inbox.unavailable ? (
        <FeedbackState
          action={<AppButton label="Retry" onPress={inbox.refetch} tone="secondary" />}
          detail="Relay could not reach your inbox. Nothing was lost; try again when the connection returns."
          kind="offline"
          title="Inbox unavailable"
        />
      ) : null}

      {!inbox.loading && !inbox.unavailable && items.length === 0 ? (
        <FeedbackState
          detail="Nothing from this source is in your inbox. It may all have been removed."
          kind="empty"
          title="Nothing here"
        />
      ) : null}

      {inboxSections(items).map((section) =>
        section.items.length === 0 ? null : (
          <View key={section.group} style={{ gap: theme.relay.spacing.md }}>
            <AppText accessibilityRole="header" variant="eyebrow">
              {GROUP_HEADING[section.group]}
            </AppText>
            {groupByThread(section.items).map((thread) => {
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
                      onApprove={approval.request}
                      onOpen={() => router.push(`/inbox/${thread.latest.id}`)}
                      onSkip={(runId) => void proposals.skip(runId)}
                      proposal={proposal}
                      threadCount={thread.items.length}
                    />
                  </SwipeableRow>
                </AnimatedListItem>
              );
            })}
          </View>
        ),
      )}
      {approval.dialog}
    </ReceiptScreen>
  );
}
