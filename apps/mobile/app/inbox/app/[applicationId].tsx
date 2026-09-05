import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { AppScreen } from "@/components/AppScreen";
import { AppText, FeedbackState, LoadingState, StatusMessage, UndoBar } from "@/components/ui";
import { InboxItemCard } from "@/features/inbox/components/InboxItemCard";
import { useApplicationLabels } from "@/features/inbox/hooks/useApplicationLabels";
import { useInbox } from "@/features/inbox/hooks/useInbox";
import {
  groupByThread,
  inboxAppKey,
  inboxSections,
  type InboxGroup,
} from "@/features/inbox/models/inboxPresentation";
import { logMobileError } from "@/lib/observability";
import { useRelayTheme } from "@/theme";

const GROUP_HEADING: Record<InboxGroup, string> = {
  actionable: "Needs doing",
  filed: "Filed",
  "needs-review": "Needs your review",
  unfiled: "Not filed yet",
};

/**
 * Everything one application sent, in the same order of importance as the inbox itself.
 *
 * The groups are kept rather than flattened, so narrowing to one source never costs a reader
 * the distinction between what needs doing and what was merely recorded. Grouping applies to every
 * group here, which is what the main inbox deliberately does not do: there, a handful of items
 * needing attention stay flat so a busy application cannot bury them under its own heading.
 */
export default function InboxApplicationScreen() {
  const router = useRouter();
  const theme = useRelayTheme();
  const { applicationId } = useLocalSearchParams<{ applicationId: string }>();
  const inbox = useInbox();
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
    <AppScreen
      backLabel="Back to applications"
      detail="Only what this source sent, ordered the way your inbox is."
      eyebrow="One source"
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
      title={label}
    >
      {inbox.loading ? <LoadingState label="Reading captures..." /> : null}

      {hideError === undefined ? null : <StatusMessage tone="error">{hideError}</StatusMessage>}

      {!inbox.loading && items.length === 0 ? (
        <FeedbackState
          detail="Nothing from this source is in your inbox. It may all have been removed."
          kind="empty"
          title="Nothing here"
        />
      ) : null}

      {inboxSections(items).map((section) =>
        section.items.length === 0 ? null : (
          <View key={section.group} style={{ gap: theme.relay.spacing.sm }}>
            <AppText accessibilityRole="header" variant="eyebrow">
              {GROUP_HEADING[section.group]}
            </AppText>
            {groupByThread(section.items).map((thread) => (
              <InboxItemCard
                item={thread.latest}
                key={thread.key}
                onHide={() => void hide(thread.latest.id)}
                onOpen={() => router.push(`/inbox/${thread.latest.id}`)}
                threadCount={thread.items.length}
              />
            ))}
          </View>
        ),
      )}
    </AppScreen>
  );
}
