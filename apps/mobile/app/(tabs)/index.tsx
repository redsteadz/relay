import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Platform, StyleSheet, View } from "react-native";

import { ReceiptScreen } from "@/components/ReceiptScreen";
import {
  AppButton,
  AppText,
  AppTextInput,
  EditorialSurface,
  FeedbackState,
  LoadingState,
  OutcomeTabs,
  StatusMessage,
  SwipeableRow,
  TopBarIconButton,
  UndoBar,
  type OutcomeTab,
} from "@/components/ui";
import { useProposedActions } from "@/features/actions/hooks/useProposedActions";
import { QuietSourceRow } from "@/features/inbox/components/QuietSourceRow";
import { ReceiptCard } from "@/features/inbox/components/ReceiptCard";
import { useApplicationLabels } from "@/features/inbox/hooks/useApplicationLabels";
import { useInbox } from "@/features/inbox/hooks/useInbox";
import {
  groupByThread,
  summariseByApp,
  type InboxGroup,
  type InboxItem,
} from "@/features/inbox/models/inboxPresentation";
import { useAuth } from "@/lib/auth-context";
import { demoIngress, sendDemoIngress } from "@/lib/demo";
import {
  localDevelopmentAccessEnabled,
  localDiagnosticsDisabled,
  notificationCaptureTenantId,
} from "@/lib/development-access";
import { registerInstallation } from "@/lib/device";
import { logMobileError } from "@/lib/observability";
import RelayDeviceIngress from "@/modules/relay-device-ingress";
import { useRelayTheme } from "@/theme";

/**
 * The inbox, grouped by outcome rather than by section.
 *
 * The three tabs are the three things that can have happened to a capture: Relay proposes something
 * and is waiting on you, Relay could not resolve something and is waiting on you for a different
 * reason, or Relay filed it and is waiting on nothing. Stacking those as sections put the count that
 * mattered below eighteen that did not; as tabs, every count is legible at once and a person can
 * stay inside one outcome.
 */
const TAB_FOR_GROUP: Readonly<Record<InboxGroup, string>> = {
  actionable: "Needs you",
  quiet: "Quiet",
  "needs-review": "Review",
};

const EMPTY_DETAIL: Readonly<Record<InboxGroup, string>> = {
  actionable: "Nothing is waiting on a decision from you.",
  quiet: "Nothing has been filed quietly yet.",
  "needs-review": "Relay resolved everything it read.",
};

export default function InboxScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const theme = useRelayTheme();
  const inbox = useInbox();
  const { client } = useAuth();
  const proposals = useProposedActions(client, session?.user.id);
  const [tab, setTab] = useState<InboxGroup>("actionable");
  const [searching, setSearching] = useState(false);
  const [hideError, setHideError] = useState<string | undefined>();

  const sectionFor = (group: InboxGroup) =>
    inbox.sections.find((section) => section.group === group)?.items ?? [];
  const tabs: readonly OutcomeTab<InboxGroup>[] = (
    ["actionable", "needs-review", "quiet"] as const
  ).map((group) => ({
    count: sectionFor(group).length,
    key: group,
    label: TAB_FOR_GROUP[group],
  }));

  const items = sectionFor(tab);
  const labels = useApplicationLabels(
    items.flatMap((item) =>
      item.source.applicationId === undefined ? [] : [item.source.applicationId],
    ),
  );

  // A failed hide surfaces as an error and the row returns, because `useInbox` refetches on settle
  // rather than patching the cache. Nothing here may leave an item looking removed when it is not.
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

  const quietCount = sectionFor("quiet").length;

  return (
    <ReceiptScreen
      action={
        <TopBarIconButton
          label={searching ? "Close search" : "Search the inbox"}
          name="search"
          onPress={() => {
            const next = !searching;
            setSearching(next);
            if (!next) inbox.setQuery("");
          }}
        />
      }
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
      sticky={
        <>
          {searching ? (
            <View style={[styles.search, { paddingHorizontal: theme.relay.layout.compactGutter }]}>
              <AppTextInput
                accessibilityLabel="Search the inbox"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                label="Search"
                onChangeText={inbox.setQuery}
                placeholder="Titles, senders, apps, and categories"
                value={inbox.query}
              />
            </View>
          ) : null}
          <OutcomeTabs onSelect={setTab} selected={tab} tabs={tabs} />
        </>
      }
      title="Inbox"
    >
      {hideError === undefined ? null : <StatusMessage tone="error">{hideError}</StatusMessage>}
      {proposals.error === undefined ? null : (
        <StatusMessage tone="error">{proposals.error}</StatusMessage>
      )}

      {inbox.loading ? <LoadingState label="Reading your inbox" /> : null}

      {!inbox.loading && inbox.unavailable ? (
        <FeedbackState
          action={<AppButton label="Retry" onPress={inbox.refetch} tone="secondary" />}
          detail="Relay could not reach your inbox. It will still be here when the connection returns."
          kind="offline"
          title="Inbox unavailable"
        />
      ) : null}

      {!inbox.loading && !inbox.unavailable && inbox.total === 0 ? (
        <FeedbackState
          detail="Once a connected source is captured, what matters appears here and the rest stays quietly searchable."
          kind="empty"
          title="Nothing captured yet"
        />
      ) : null}

      {!inbox.loading && !inbox.unavailable && inbox.total > 0 && items.length === 0 ? (
        <AppText tone="muted" variant="caption">
          {inbox.query === "" ? EMPTY_DETAIL[tab] : "Nothing here matches that search."}
        </AppText>
      ) : null}

      {tab === "quiet" ? (
        <QuietList items={items} labels={labels} />
      ) : (
        groupByThread(items).map((thread) => {
          const proposal = proposals.forEvent(thread.latest.id)[0];
          // The swipe is a shortcut, not the only route: the same removal sits on the receipt's own
          // screen as a labelled control, and SwipeableRow publishes it as an accessibility action.
          return (
            <SwipeableRow
              actionLabel="Remove"
              icon="inbox-remove-outline"
              key={thread.key}
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
          );
        })
      )}

      {tab === "quiet" || quietCount === 0 ? null : (
        <AppButton
          accessibilityHint="Shows everything Relay filed without asking you"
          label={`${String(quietCount)} filed quietly →`}
          onPress={() => setTab("quiet")}
          tone="secondary"
        />
      )}

      {tab === "quiet" ? <LocalSkeleton onSent={inbox.refetch} /> : null}
    </ReceiptScreen>
  );
}

/**
 * Quiet captures, one line per source.
 *
 * Folding a source away entirely was worse than the noise it removed: extraction derives little from
 * an ordinary notification, so almost everything is quiet, and hiding all of it left the inbox
 * looking unchanged no matter what arrived. Each source keeps its count and its newest arrival.
 */
function QuietList({
  items,
  labels,
}: {
  items: readonly InboxItem[];
  labels: ReadonlyMap<string, string>;
}) {
  const router = useRouter();
  return (
    <>
      {summariseByApp(items, labels).map((application) => (
        <QuietSourceRow
          application={application}
          key={application.key}
          onPress={() => router.push(`/inbox/app/${encodeURIComponent(application.key)}`)}
        />
      ))}
    </>
  );
}

/**
 * The local walking skeleton.
 *
 * Kept at the foot of the quiet tab rather than under the receipts a person came to read. It is a
 * diagnostic, and the inbox is the one screen whose whole argument is that it shows only what
 * arrived.
 */
function LocalSkeleton({ onSent }: { onSent: () => void }) {
  const { session } = useAuth();
  const [status, setStatus] = useState("Ready for local simulation");
  const [sending, setSending] = useState(false);
  const localDevelopmentAccess = localDevelopmentAccessEnabled(
    __DEV__,
    Constants.expoConfig?.extra?.relayBuildVariant,
    localDiagnosticsDisabled(),
  );
  const localCaptureTenantId = notificationCaptureTenantId(
    undefined,
    localDevelopmentAccess,
    Platform.OS,
  );

  async function simulate() {
    setSending(true);
    setStatus("Sending...");
    try {
      if (session === null) {
        if (localCaptureTenantId === undefined) throw new Error("Authentication required");
        const id = Crypto.randomUUID();
        const capturedAt = new Date().toISOString();
        await RelayDeviceIngress.enqueueCapture(localCaptureTenantId, {
          ...demoIngress,
          id,
          occurredAt: capturedAt,
          capturedAt,
          source: { ...demoIngress.source, externalId: `local-development-${id}` },
        });
        setStatus(`Stored locally ${id.slice(0, 8)}`);
        return;
      }
      const device = await registerInstallation(session.user.id, session.access_token);
      const result = await sendDemoIngress(session.access_token, device.id);
      setStatus(result.accepted ? `Queued ${result.id.slice(0, 8)}` : "Not accepted");
      onSent();
    } catch (error) {
      logMobileError("ui.demo_ingress_failed", error, {
        code: "DEMO_INGRESS_FAILED",
        integration: "relay-api",
        operation: "simulateIngress",
      });
      setStatus("Could not queue the simulated notification. Check your connection and retry.");
    } finally {
      setSending(false);
    }
  }

  return (
    <EditorialSurface icon="flask-outline" meta="Development" title="Local walking skeleton">
      <AppText tone="muted">{status}</AppText>
      <AppButton
        label="Send simulated notification"
        loading={sending}
        onPress={() => void simulate()}
      />
    </EditorialSurface>
  );
}

const styles = StyleSheet.create({
  search: { width: "100%" },
});
