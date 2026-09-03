import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

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
import { useInbox } from "@/features/inbox/hooks/useInbox";
import { formatCaptureTime, type InboxItem } from "@/features/inbox/models/inboxPresentation";
import { logMobileError } from "@/lib/observability";
import { useRelayTheme } from "@/theme";

const SOURCE_LABEL: Record<string, string> = {
  gmail: "Gmail",
  notification: "Android notification",
  sms: "SMS",
  unknown: "Source no longer retained",
};

/** One labelled line. Absent values are omitted rather than rendered as an empty row. */
function Detail({ label, value }: { label: string; value: string | undefined }) {
  const theme = useRelayTheme();
  if (value === undefined || value.length === 0) return null;
  return (
    <View style={{ gap: theme.relay.spacing.xxs }}>
      <AppText tone="muted" variant="caption">
        {label}
      </AppText>
      <AppText>{value}</AppText>
    </View>
  );
}

/**
 * What Relay read from one capture.
 *
 * Everything here is derived: facts, the event they support, and the retained metadata of the source
 * row. The encrypted raw payload is never reopened, so this screen still explains an item after the
 * seven-day raw copy has expired -- and says so rather than implying the original is still there.
 */
export default function InboxItemScreen() {
  const router = useRouter();
  const theme = useRelayTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const inbox = useInbox();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | undefined>();

  const item: InboxItem | undefined = inbox.sections
    .flatMap((section) => section.items)
    .find((candidate) => candidate.id === id);

  const thread =
    item?.threadKey === undefined
      ? []
      : inbox.sections
          .flatMap((section) => section.items)
          .filter((candidate) => candidate.threadKey === item.threadKey && candidate.id !== item.id)
          .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));

  async function hide(): Promise<void> {
    if (item === undefined) return;
    setPending(true);
    setStatus(undefined);
    try {
      await inbox.hide(item.id);
      router.back();
    } catch (error: unknown) {
      logMobileError("ui.inbox_hide_failed", error, {
        code: "INBOX_HIDE_FAILED",
        integration: "supabase-postgrest",
        operation: "hideInboxEvent",
      });
      setStatus("Could not remove this from your inbox.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AppScreen
      backLabel="Back to inbox"
      detail="Everything here is what Relay derived. The encrypted original is never reopened."
      eyebrow="Capture detail"
      onBack={() => router.back()}
      title={item?.title ?? "Capture"}
    >
      {inbox.loading ? <LoadingState label="Reading this capture..." /> : null}

      {!inbox.loading && item === undefined ? (
        <FeedbackState
          detail="This capture is not in your inbox. It may have been removed."
          kind="empty"
          title="Nothing to show"
        />
      ) : null}

      {item === undefined ? null : (
        <View style={{ gap: theme.relay.spacing.lg }}>
          {status === undefined ? null : <StatusMessage tone="error">{status}</StatusMessage>}

          {item.reviewReasons.map((reason) => (
            <StatusMessage key={reason} tone="warning">
              {reason}
            </StatusMessage>
          ))}

          <EditorialSurface title="What it said" variant="raised">
            {item.summary === undefined ? (
              <AppText tone="muted">
                Relay retained no readable text for this capture. Its facts are below.
              </AppText>
            ) : (
              <AppText>{item.summary}</AppText>
            )}
          </EditorialSurface>

          <EditorialSurface title="Where it came from" variant="raised">
            <Detail label="Source" value={SOURCE_LABEL[item.source.kind] ?? item.source.kind} />
            <Detail label="Application" value={item.appLabel} />
            <Detail label="Sender" value={item.source.sender} />
            <Detail label="Subject" value={item.source.subject} />
            <Detail label="Captured" value={formatCaptureTime(item.source.occurredAt)} />
            <Detail
              label="Scheduled"
              value={
                item.scheduledAt === undefined ? undefined : formatCaptureTime(item.scheduledAt)
              }
            />
          </EditorialSurface>

          <EditorialSurface title="What Relay read" variant="raised">
            {item.evidence.length === 0 ? (
              <AppText tone="muted">
                No structured facts were derived from this capture, so it was filed without one.
              </AppText>
            ) : (
              item.evidence.map((fact) => (
                <View key={`${fact.kind}:${fact.label}`} style={{ gap: theme.relay.spacing.xxs }}>
                  <AppText tone="muted" variant="caption">
                    {fact.kind}
                    {fact.certain ? "" : " · read as uncertain"}
                  </AppText>
                  <AppText>{fact.label}</AppText>
                </View>
              ))
            )}
            <Detail label="Event kind" value={item.kind} />
            {item.category === undefined ? null : (
              <Detail
                label="Filed by"
                value={`${item.category.method} rule${
                  item.category.name === undefined ? "" : ` · ${item.category.name}`
                }`}
              />
            )}
          </EditorialSurface>

          {thread.length === 0 ? null : (
            <EditorialSurface
              meta={`${thread.length.toString()} earlier`}
              title="Same conversation"
              variant="raised"
            >
              {thread.map((other) => (
                <AppText key={other.id} tone="muted" variant="caption">
                  {formatCaptureTime(other.source.occurredAt)} · {other.title}
                </AppText>
              ))}
            </EditorialSurface>
          )}

          {item.processing === "pending" ? (
            <ContextualNotice accessibilityLabel="Why this item is incomplete" tone="warning">
              Relay accepted this capture but has not finished processing it, so its facts may still
              be incomplete.
            </ContextualNotice>
          ) : null}

          {item.retention.rawExpired ? (
            <ContextualNotice accessibilityLabel="Raw copy retention" tone="info">
              The encrypted original expired and was deleted. This summary is what Relay retains.
            </ContextualNotice>
          ) : null}

          <ContextualNotice accessibilityLabel="What removing does" tone="info">
            Removing takes this out of your Relay inbox only. The notification on your device is not
            touched, and nothing is deleted from the source.
          </ContextualNotice>

          <AppButton
            accessibilityHint="Takes this capture out of your Relay inbox"
            label="Remove from inbox"
            loading={pending}
            onPress={() => void hide()}
            tone="destructive"
          />
        </View>
      )}
    </AppScreen>
  );
}
