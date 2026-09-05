import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { ReceiptScreen } from "@/components/ReceiptScreen";
import {
  AppButton,
  AppText,
  ContextualNotice,
  EditorialSurface,
  EmptyState,
  FilterChips,
  LoadingState,
  StatusMessage,
} from "@/components/ui";
import { ActivityEntryRow } from "@/features/activity/components/ActivityEntryRow";
import { useActivityTimeline } from "@/features/activity/hooks/useActivityTimeline";
import {
  activityErrorMessage,
  activityFilters,
  filterActivity,
  groupActivityByDay,
  type ActivityFilter,
} from "@/features/activity/models/activityPresentation";
import { useAuth } from "@/lib/auth-context";
import { reportUnexpectedUiError } from "@/lib/observability";
import { useRelayTheme } from "@/theme";

function reportActivityUiFailure(error: unknown): void {
  reportUnexpectedUiError(error, "ui.activity_refresh_failed", {
    code: "ACTIVITY_UI_REFRESH_FAILED",
    integration: "supabase-postgrest",
    operation: "refreshActivity",
  });
}

/**
 * Everything that has already happened, in one append-only column.
 *
 * Five kinds share the timeline -- actions decided, fields disclosed to a model, rules saved,
 * retention sweeps, and sources connected or removed -- because the question a person brings here
 * is "what did Relay do", and answering it from five separate screens would make the answer
 * depend on knowing which one to open.
 *
 * Nothing here is an example. An empty timeline means nothing has run yet, and the screen says so
 * rather than showing a sample of what a record would look like.
 */
export default function ActivityScreen() {
  const theme = useRelayTheme();
  const { client, session } = useAuth();
  const activity = useActivityTimeline(client, session?.user.id, session?.access_token);
  const [filter, setFilter] = useState<ActivityFilter>("all");

  if (session === null) {
    return (
      <ReceiptScreen title="Activity">
        <EditorialSurface icon="shield-check-outline" meta="Sign-in required" title="Activity">
          <AppText tone="muted">
            The timeline is account-owned. Sign in to see what Relay proposed, what you decided, and
            what was ever sent to a model.
          </AppText>
          <AppButton
            label="Sign in to see activity"
            onPress={() => router.push({ params: { reason: "activity" }, pathname: "/sign-in" })}
            tone="secondary"
          />
        </EditorialSurface>
      </ReceiptScreen>
    );
  }

  const failedEntirely =
    activity.ledgerUnavailable && activity.disclosuresUnavailable && activity.auditUnavailable;
  const visible = filterActivity(activity.entries, filter);
  const days = groupActivityByDay(visible);
  const showEmpty =
    !activity.isLoading && activity.entries.length === 0 && !activity.ledgerUnavailable;

  return (
    <ReceiptScreen
      action={
        <AppButton
          accessibilityLabel="Refresh activity"
          disabled={activity.refreshing}
          label="Refresh"
          onPress={() => {
            activity.refresh().catch(reportActivityUiFailure);
          }}
          tone="secondary"
        />
      }
      sticky={<FilterChips chips={activityFilters} onSelect={setFilter} selected={filter} />}
      title="Activity"
    >
      <ContextualNotice accessibilityLabel="What this timeline records">
        Every entry is a record of something that already happened. Relay never shows an example
        here, so an empty timeline means nothing has run yet.
      </ContextualNotice>

      {failedEntirely ? (
        <>
          <StatusMessage tone="error">{activityErrorMessage()}</StatusMessage>
          <AppButton
            label="Retry"
            onPress={() => {
              activity.refresh().catch(reportActivityUiFailure);
            }}
            tone="secondary"
          />
        </>
      ) : null}

      {activity.ledgerUnavailable && !failedEntirely ? (
        <StatusMessage tone="warning">
          Approvals and retries could not be loaded, so this timeline is incomplete.
        </StatusMessage>
      ) : null}

      {activity.disclosuresUnavailable && !failedEntirely ? (
        <StatusMessage tone="warning">
          Disclosure history could not be loaded, so this timeline is incomplete. It does not mean
          nothing was disclosed.
        </StatusMessage>
      ) : null}

      {activity.auditUnavailable && !failedEntirely ? (
        <StatusMessage tone="warning">
          Rule, retention, and source records could not be loaded, so this timeline is incomplete.
        </StatusMessage>
      ) : null}

      {activity.isLoading ? <LoadingState label="Loading activity" /> : null}

      {activity.pendingCount === 0 ? null : (
        <StatusMessage tone="info">
          {activity.pendingCount === 1
            ? "1 action is waiting for your decision in the inbox."
            : `${activity.pendingCount.toString()} actions are waiting for your decision in the inbox.`}
        </StatusMessage>
      )}

      {showEmpty ? (
        <EmptyState
          detail="When Relay proposes an action or sends allowlisted fields to a model, the record appears here."
          title="Nothing has happened yet"
        />
      ) : null}

      {!activity.isLoading && activity.entries.length > 0 && visible.length === 0 ? (
        <AppText tone="muted" variant="caption">
          Nothing of that kind has been recorded.
        </AppText>
      ) : null}

      {days.map((group) => (
        <View key={group.day} style={{ gap: theme.relay.spacing.md }}>
          <AppText accessibilityRole="header" variant="eyebrow">
            {group.day}
          </AppText>
          {group.entries.map((entry) => (
            <ActivityEntryRow entry={entry} key={`${entry.kind}-${entry.id}`} />
          ))}
        </View>
      ))}
    </ReceiptScreen>
  );
}
