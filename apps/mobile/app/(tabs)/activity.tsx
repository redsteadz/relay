import { router } from "expo-router";

import { AppScreen } from "@/components/AppScreen";
import {
  AppButton,
  AppText,
  ContextualNotice,
  EditorialSurface,
  EmptyState,
  LoadingState,
  StatusMessage,
} from "@/components/ui";
import { ActivityEntryCard } from "@/features/activity/components/ActivityEntryCard";
import { useActivityTimeline } from "@/features/activity/hooks/useActivityTimeline";
import { activityErrorMessage } from "@/features/activity/models/activityPresentation";
import { useAuth } from "@/lib/auth-context";
import { reportUnexpectedUiError } from "@/lib/observability";

function reportActivityUiFailure(error: unknown): void {
  reportUnexpectedUiError(error, "ui.activity_refresh_failed", {
    code: "ACTIVITY_UI_REFRESH_FAILED",
    integration: "supabase-postgrest",
    operation: "refreshActivity",
  });
}

export default function ActivityScreen() {
  const { client, session } = useAuth();
  const activity = useActivityTimeline(client, session?.user.id, session?.access_token);

  if (session === null) {
    return (
      <AppScreen
        detail="Provenance, approvals, retries, and disclosures share one immutable timeline."
        eyebrow="Explain every decision"
        title="Activity"
      >
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
      </AppScreen>
    );
  }

  const failedEntirely = activity.ledgerUnavailable && activity.disclosuresUnavailable;
  const showEmpty =
    !activity.isLoading && activity.entries.length === 0 && !activity.ledgerUnavailable;

  return (
    <AppScreen
      action={
        <AppButton
          disabled={activity.refreshing}
          label="Refresh"
          onPress={() => {
            activity.refresh().catch(reportActivityUiFailure);
          }}
          tone="secondary"
        />
      }
      detail="Provenance, approvals, retries, and disclosures share one immutable timeline."
      eyebrow="Explain every decision"
      title="Activity"
      titleAccessory={
        <ContextualNotice accessibilityLabel="What this timeline records">
          Every entry is a record of something that already happened. Relay never shows an example
          here, so an empty timeline means nothing has run yet.
        </ContextualNotice>
      }
    >
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
          Approvals and retries could not be loaded, so this timeline is incomplete. Disclosures
          below are complete.
        </StatusMessage>
      ) : null}

      {activity.disclosuresUnavailable && !failedEntirely ? (
        <StatusMessage tone="warning">
          Disclosure history could not be loaded, so this timeline is incomplete. It does not mean
          nothing was disclosed.
        </StatusMessage>
      ) : null}

      {activity.isLoading ? <LoadingState label="Loading activity" /> : null}

      {activity.pendingCount === 0 ? null : (
        <StatusMessage tone="info">
          {activity.pendingCount === 1
            ? "1 action is waiting for your decision."
            : `${activity.pendingCount.toString()} actions are waiting for your decision.`}
        </StatusMessage>
      )}

      {showEmpty ? (
        <EmptyState
          detail="When Relay proposes an action or sends allowlisted fields to a model, the record appears here."
          title="Nothing has happened yet"
        />
      ) : null}

      {activity.entries.map((entry) => (
        <ActivityEntryCard entry={entry} key={`${entry.kind}-${entry.id}`} />
      ))}
    </AppScreen>
  );
}
