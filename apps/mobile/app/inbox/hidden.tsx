import { useRouter } from "expo-router";
import { useState } from "react";
import { AccessibilityInfo, View } from "react-native";

import { AppScreen } from "@/components/AppScreen";
import {
  AppButton,
  AppText,
  ContextualNotice,
  EditorialSurface,
  FeedbackState,
  LoadingState,
  StatusMessage,
} from "@/components/ui";
import { useHiddenInbox } from "@/features/inbox/hooks/useHiddenInbox";
import { appIconFor, formatCaptureTime } from "@/features/inbox/models/inboxPresentation";
import { logMobileError } from "@/lib/observability";
import { useRelayTheme } from "@/theme";

/**
 * Captures this reader took out of their inbox.
 *
 * Hiding is reversible in the schema by design -- restoring deletes the record rather than clearing
 * a flag -- so a mistake has to stay recoverable after the undo offer expires. This is where it
 * goes. Nothing here was deleted: the source item, its facts, and its event all remain, and the
 * notification on the device was never touched.
 */
export default function HiddenInboxScreen() {
  const router = useRouter();
  const theme = useRelayTheme();
  const hidden = useHiddenInbox();
  const [pending, setPending] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();

  async function restore(eventId: string, title: string): Promise<void> {
    setPending(eventId);
    setStatus(undefined);
    try {
      await hidden.restore(eventId);
      AccessibilityInfo.announceForAccessibility(`${title} is back in your inbox`);
    } catch (error: unknown) {
      logMobileError("ui.inbox_restore_failed", error, {
        code: "INBOX_RESTORE_FAILED",
        integration: "supabase-postgrest",
        operation: "restoreInboxEvent",
      });
      setStatus("Could not put this back in your inbox.");
    } finally {
      setPending(undefined);
    }
  }

  return (
    <AppScreen
      backLabel="Back to inbox"
      detail="Removed from your inbox only. Nothing was deleted and no device notification was cleared."
      eyebrow="Reversible"
      onBack={() => router.back()}
      title="Removed"
    >
      {hidden.loading ? <LoadingState label="Reading removed captures..." /> : null}

      {hidden.unavailable ? (
        <FeedbackState
          detail="Relay could not read your removed captures. Pull to try again."
          kind="error"
          title="Unavailable"
        />
      ) : null}

      {!hidden.loading && !hidden.unavailable && hidden.items.length === 0 ? (
        <FeedbackState
          detail="Anything you remove from your inbox will wait here so you can put it back."
          kind="empty"
          title="Nothing removed"
        />
      ) : null}

      {status === undefined ? null : <StatusMessage tone="error">{status}</StatusMessage>}

      {hidden.items.length === 0 ? null : (
        <View style={{ gap: theme.relay.spacing.md }}>
          <ContextualNotice accessibilityLabel="What removed means" tone="info">
            These were taken out of your inbox view. Their captures, facts, and events are all still
            recorded, and no notification was cleared from your device.
          </ContextualNotice>

          {hidden.items.map((item) => (
            <EditorialSurface
              icon={appIconFor(item.source)}
              key={item.id}
              meta={formatCaptureTime(item.source.occurredAt)}
              title={item.title}
              variant="raised"
            >
              {item.summary === undefined ? null : <AppText tone="muted">{item.summary}</AppText>}
              <AppButton
                accessibilityHint="Puts this capture back in your inbox"
                label="Put back"
                loading={pending === item.id}
                onPress={() => void restore(item.id, item.title)}
                tone="secondary"
              />
            </EditorialSurface>
          ))}
        </View>
      )}
    </AppScreen>
  );
}
