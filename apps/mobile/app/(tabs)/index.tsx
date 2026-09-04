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
import {
  appIconFor,
  groupByApp,
  groupByThread,
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
  const [quietExpanded, setQuietExpanded] = useState<string | undefined>();
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
          accessibilityHint="Shows captures you removed, so you can put one back"
          label="Removed"
          onPress={() => router.push("/inbox/hidden")}
          tone="secondary"
        />
      </ActionRow>

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

      {hideError === undefined ? null : <StatusMessage tone="error">{hideError}</StatusMessage>}

      {inbox.lastHidden === undefined ? null : (
        <UndoBar
          message={`Removed ${inbox.lastHidden.title} from your inbox`}
          onExpire={inbox.clearLastHidden}
          onUndo={() => {
            const removed = inbox.lastHidden;
            if (removed !== undefined) void inbox.restore(removed.id);
          }}
        />
      )}

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
                <QuietSection
                  expanded={quietExpanded}
                  items={section.items}
                  onHide={hide}
                  onToggle={setQuietExpanded}
                />
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
const QUIET_PREVIEW_COUNT = 3;

/**
 * Quiet items, grouped by capturing application.
 *
 * The newest few from each source stay on screen. Folding the group away entirely was worse than the
 * noise it removed: extraction derives little from an ordinary notification, so almost everything is
 * quiet, and hiding all of it left the inbox looking unchanged no matter what arrived.
 */
function QuietSection({
  expanded,
  items,
  onHide,
  onToggle,
}: {
  expanded: string | undefined;
  items: readonly InboxItem[];
  onHide: (eventId: string) => Promise<void>;
  onToggle: (value: string | undefined) => void;
}) {
  const router = useRouter();
  const theme = useRelayTheme();
  return (
    <>
      {groupByApp(items).map((group) => {
        const showingAll = expanded === group.appLabel;
        // Paging counts conversations rather than captures, so a preview of five is five things to
        // read instead of five messages that might all belong to one thread.
        const threads = groupByThread(group.items);
        const visible = showingAll ? threads : threads.slice(0, QUIET_PREVIEW_COUNT);
        const remaining = threads.length - visible.length;
        const first = group.items[0];
        return (
          <View key={group.appLabel} style={[styles.section, { gap: theme.relay.spacing.sm }]}>
            <ActionRow compact wrap={false}>
              {first === undefined ? null : (
                <MaterialCommunityIcons
                  color={theme.relay.colors.textMuted}
                  name={appIconFor(first.source) as never}
                  size={theme.relay.sizes.icon.sm}
                />
              )}
              <AppText accessibilityRole="header" tone="muted" variant="caption">
                {group.appLabel} · {String(group.items.length)} captured
              </AppText>
            </ActionRow>
            {visible.map((thread) => (
              <InboxItemCard
                item={thread.latest}
                key={thread.key}
                onHide={() => void onHide(thread.latest.id)}
                onOpen={() => router.push(`/inbox/${thread.latest.id}`)}
                threadCount={thread.items.length}
              />
            ))}
            {remaining > 0 || showingAll ? (
              <AppButton
                accessibilityHint={`Shows every capture filed quietly from ${group.appLabel}`}
                label={showingAll ? "Show fewer" : `Show all ${String(group.items.length)}`}
                onPress={() => onToggle(showingAll ? undefined : group.appLabel)}
                tone="secondary"
              />
            ) : null}
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
