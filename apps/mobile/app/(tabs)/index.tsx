import Constants from "expo-constants";
import { useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import { useState } from "react";
import { Platform, StyleSheet, View } from "react-native";

import { AppScreen } from "@/components/AppScreen";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

import {
  ActionRow,
  AppButton,
  AppText,
  AppTextInput,
  EditorialSurface,
  FeedbackState,
  LoadingState,
  StatusMessage,
  UndoBar,
} from "@/components/ui";
import { InboxItemCard } from "@/features/inbox/components/InboxItemCard";
import { useInbox } from "@/features/inbox/hooks/useInbox";
import { useApplicationLabels } from "@/features/inbox/hooks/useApplicationLabels";
import {
  groupByThread,
  inboxAppKey,
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

const GROUP_HEADING: Record<InboxGroup, string> = {
  actionable: "Needs doing",
  "needs-review": "Needs your review",
  quiet: "Filed quietly",
};

const GROUP_EMPTY: Record<InboxGroup, string> = {
  actionable: "Nothing is scheduled.",
  "needs-review": "Nothing is waiting on you.",
  quiet: "Nothing has been filed quietly yet.",
};

export default function InboxScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const theme = useRelayTheme();
  const inbox = useInbox();
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
  const actionable =
    inbox.sections.find((section) => section.group === "actionable")?.items.length ?? 0;
  const labels = useApplicationLabels(
    inbox.sections
      .flatMap((section) => section.items)
      .flatMap((item) =>
        item.source.applicationId === undefined ? [] : [item.source.applicationId],
      ),
  );

  // A failed hide surfaces as an error and the row returns, because `useInbox` refetches on settle
  // rather than patching the cache. Nothing here may leave an item looking removed when it is not.
  const [hideError, setHideError] = useState<string | undefined>();
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
      inbox.refetch();
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
    <AppScreen
      eyebrow="Signal over noise"
      title="Inbox"
      detail="Important facts remain visible. Everything else stays searchable without demanding attention."
      action={
        <View style={[styles.score, { paddingTop: theme.relay.spacing.xs }]}>
          <AppText tone="accent" variant="hero">
            {String(actionable)}
          </AppText>
          <AppText tone="muted" variant="eyebrow">
            ACTIONABLE
          </AppText>
        </View>
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
    >
      <AppTextInput
        accessibilityLabel="Search the inbox"
        autoCapitalize="none"
        autoCorrect={false}
        label="Search"
        onChangeText={inbox.setQuery}
        placeholder="Search titles, senders, apps, and categories"
        value={inbox.query}
      />

      <ActionRow compact wrap={false}>
        <AppButton
          accessibilityHint="Shows which sources sent captures, and how many"
          label="Applications"
          onPress={() => router.push("/inbox/apps")}
          tone="secondary"
        />
        <AppButton
          accessibilityHint="Shows captures you removed, so you can put one back"
          label="Removed"
          onPress={() => router.push("/inbox/hidden")}
          tone="secondary"
        />
      </ActionRow>

      {hideError === undefined ? null : <StatusMessage tone="error">{hideError}</StatusMessage>}

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

      {!inbox.loading && !inbox.unavailable && inbox.total > 0
        ? inbox.sections.map((section) => (
            <View key={section.group} style={[styles.section, { gap: theme.relay.spacing.sm }]}>
              <AppText accessibilityRole="header" variant="eyebrow">
                {GROUP_HEADING[section.group]}
              </AppText>
              {section.items.length === 0 ? (
                <AppText tone="muted" variant="caption">
                  {inbox.query === "" ? GROUP_EMPTY[section.group] : "Nothing here matches."}
                </AppText>
              ) : section.group === "quiet" ? (
                <QuietSection items={section.items} labels={labels} onHide={hide} />
              ) : (
                groupByThread(section.items).map((thread) => (
                  <InboxItemCard
                    item={thread.latest}
                    key={thread.key}
                    onHide={() => void hide(thread.latest.id)}
                    onOpen={() => router.push(`/inbox/${thread.latest.id}`)}
                    threadCount={thread.items.length}
                  />
                ))
              )}
            </View>
          ))
        : null}

      <EditorialSurface icon="flask-outline" title="Local walking skeleton" meta="Development">
        <AppText tone="muted">{status}</AppText>
        <AppButton
          label="Send simulated notification"
          loading={sending}
          onPress={() => void simulate()}
        />
      </EditorialSurface>
    </AppScreen>
  );
}

/** How many recent captures each quiet source shows before the rest are folded away. */

/**
 * Quiet items, grouped by capturing application.
 *
 * The newest few from each source stay on screen. Folding the group away entirely was worse than the
 * noise it removed: extraction derives little from an ordinary notification, so almost everything is
 * quiet, and hiding all of it left the inbox looking unchanged no matter what arrived.
 */
function QuietSection({
  items,
  labels,
  onHide,
}: {
  items: readonly InboxItem[];
  labels: ReadonlyMap<string, string>;
  onHide: (eventId: string) => Promise<void>;
}) {
  const router = useRouter();
  const theme = useRelayTheme();
  const applications = summariseByApp(items, labels);

  // One preview per source, then the whole source on its own screen. An accordion here made the
  // shortest route to "everything from this app" a toggle that grew the page a reader was already
  // scrolling; a tap that leads somewhere is both shorter and easier to come back from.
  return (
    <>
      {applications.map((application) => {
        const grouped = items.filter((item) => inboxAppKey(item.source) === application.key);
        const [newest] = groupByThread(grouped);
        return (
          <View key={application.key} style={[styles.section, { gap: theme.relay.spacing.sm }]}>
            <ActionRow compact wrap={false}>
              <MaterialCommunityIcons
                color={theme.relay.colors.textMuted}
                name={application.icon as never}
                size={theme.relay.sizes.icon.sm}
              />
              <AppText accessibilityRole="header" tone="muted" variant="caption">
                {application.label} · {String(application.captures)} captured
              </AppText>
            </ActionRow>
            {newest === undefined ? null : (
              <InboxItemCard
                item={newest.latest}
                onHide={() => void onHide(newest.latest.id)}
                onOpen={() => router.push(`/inbox/${newest.latest.id}`)}
                threadCount={newest.items.length}
              />
            )}
            {application.conversations <= 1 ? null : (
              <AppButton
                accessibilityHint={`Opens every capture from ${application.label}`}
                label={`See all ${String(application.conversations)} from ${application.label}`}
                onPress={() => router.push(`/inbox/app/${encodeURIComponent(application.key)}`)}
                tone="secondary"
              />
            )}
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  score: { alignItems: "flex-end" },
  section: { width: "100%" },
});
