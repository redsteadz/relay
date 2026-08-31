import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { useState } from "react";
import { Platform, StyleSheet, View } from "react-native";

import { AppScreen } from "@/components/AppScreen";
import {
  AppButton,
  AppText,
  AppTextInput,
  EditorialSurface,
  FeedbackState,
  LoadingState,
} from "@/components/ui";
import { InboxItemCard } from "@/features/inbox/components/InboxItemCard";
import { useInbox } from "@/features/inbox/hooks/useInbox";
import {
  groupByApp,
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
                <QuietSection
                  expanded={quietExpanded}
                  items={section.items}
                  onToggle={setQuietExpanded}
                />
              ) : (
                section.items.map((item) => <InboxItemCard item={item} key={item.id} />)
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
  onToggle,
}: {
  expanded: string | undefined;
  items: readonly InboxItem[];
  onToggle: (value: string | undefined) => void;
}) {
  const theme = useRelayTheme();
  return (
    <>
      {groupByApp(items).map((group) => {
        const showingAll = expanded === group.appLabel;
        const visible = showingAll ? group.items : group.items.slice(0, QUIET_PREVIEW_COUNT);
        const remaining = group.items.length - visible.length;
        return (
          <View key={group.appLabel} style={[styles.section, { gap: theme.relay.spacing.sm }]}>
            <AppText accessibilityRole="header" tone="muted" variant="caption">
              {group.appLabel} · {String(group.items.length)} captured
            </AppText>
            {visible.map((item) => (
              <InboxItemCard item={item} key={item.id} />
            ))}
            {remaining > 0 || showingAll ? (
              <AppButton
                accessibilityHint={`Shows every capture filed quietly from ${group.appLabel}`}
                label={showingAll ? "Show fewer" : `Show ${String(remaining)} more`}
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
