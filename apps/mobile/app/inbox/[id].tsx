import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ReceiptScreen } from "@/components/ReceiptScreen";
import {
  AppButton,
  AppText,
  ContextualNotice,
  FeedbackState,
  LoadingState,
  StatusMessage,
} from "@/components/ui";
import { useProposedActions } from "@/features/actions/hooks/useProposedActions";
import { DecisionLine } from "@/features/inbox/components/DecisionLine";
import { FactChipRow } from "@/features/inbox/components/FactChipRow";
import { ProposedActionBlock } from "@/features/inbox/components/ProposedActionBlock";
import { ReceiptField, ReceiptStage } from "@/features/inbox/components/ReceiptStage";
import { useInbox } from "@/features/inbox/hooks/useInbox";
import { formatCaptureTime, type InboxItem } from "@/features/inbox/models/inboxPresentation";
import {
  eventKindLabel,
  receiptDecision,
  receiptSourceLine,
} from "@/features/inbox/models/receiptPresentation";
import { useAuth } from "@/lib/auth-context";
import { logMobileError } from "@/lib/observability";
import { useRelayTheme } from "@/theme";

const SOURCE_LABEL: Record<string, string> = {
  gmail: "Gmail",
  notification: "Android notification",
  sms: "SMS",
  unknown: "Source no longer retained",
};

/**
 * What a filing method actually did.
 *
 * Named in full here rather than abbreviated to a badge, because this is the screen a person opens
 * when they want to know whether anything left the device. "Deterministic" and "semantic" are the
 * two answers, and they differ in exactly that.
 */
const METHOD_NOTE: Record<string, string> = {
  deterministic:
    "No model was involved. Relay matched the fields a rule names and nothing left this account.",
  manual: "You filed this yourself. No rule and no model decided it.",
  semantic:
    "No deterministic rule matched, so allowlisted fields were sent to your configured model. The raw body was not among them.",
};

/**
 * One capture, as its full receipt.
 *
 * The four stages are the pipeline's own sequence: what arrived, what was read from it, how it was
 * filed, and what is proposed because of it. Everything is derived -- the encrypted raw payload is
 * never reopened -- so the screen still explains an item after the seven-day raw copy has expired,
 * and says so rather than implying the original is still there.
 */
export default function InboxItemScreen() {
  const router = useRouter();
  const theme = useRelayTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { client, session } = useAuth();
  const inbox = useInbox();
  const proposals = useProposedActions(client, session?.user.id);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | undefined>();
  const [whyOpen, setWhyOpen] = useState(false);

  const all = inbox.sections.flatMap((section) => section.items);
  const item: InboxItem | undefined = all.find((candidate) => candidate.id === id);

  const thread =
    item?.threadKey === undefined
      ? []
      : all
          .filter((candidate) => candidate.threadKey === item.threadKey && candidate.id !== item.id)
          .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));

  const open = item === undefined ? [] : proposals.forEvent(item.id);

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

  const decision =
    item === undefined ? undefined : receiptDecision(item.category, item.reviewReasons.length > 0);

  return (
    <ReceiptScreen onBack={() => router.back()} title={item?.title ?? "Receipt"}>
      {inbox.loading ? <LoadingState label="Reading this capture..." /> : null}

      {!inbox.loading && item === undefined ? (
        <FeedbackState
          detail="This capture is not in your inbox. It may have been removed."
          kind="empty"
          title="Nothing to show"
        />
      ) : null}

      {item === undefined ? null : (
        <View style={[styles.body, { gap: theme.relay.spacing.xl }]}>
          {status === undefined ? null : <StatusMessage tone="error">{status}</StatusMessage>}
          {proposals.error === undefined ? null : (
            <StatusMessage tone="error">{proposals.error}</StatusMessage>
          )}

          <AppText tone="muted" variant="monoMeta">
            {`${eventKindLabel(item.kind)} · ${receiptSourceLine(item)}`.toUpperCase()}
          </AppText>

          <ReceiptStage label="Arrived" ordinal={1}>
            <ReceiptField
              label="Source"
              value={SOURCE_LABEL[item.source.kind] ?? item.source.kind}
            />
            <ReceiptField label="Application" value={item.appLabel} />
            <ReceiptField label="Sender" value={item.source.sender} />
            <ReceiptField label="Subject" value={item.source.subject} />
            <ReceiptField label="Received" value={formatCaptureTime(item.source.occurredAt)} />
            <ReceiptField
              label="Raw copy"
              value={
                item.retention.rawExpired
                  ? "Expired and deleted"
                  : item.retention.rawExpiresAt === undefined
                    ? "Not retained"
                    : `Expires ${formatCaptureTime(item.retention.rawExpiresAt)}`
              }
            />
          </ReceiptStage>

          <ReceiptStage label="Read" ordinal={2}>
            {item.summary === undefined ? (
              <AppText tone="muted" variant="caption">
                Relay retained no readable text for this capture.
              </AppText>
            ) : (
              <AppText>{item.summary}</AppText>
            )}
            {item.evidence.length === 0 ? (
              <AppText tone="muted" variant="caption">
                No structured facts were derived, so it was filed without any.
              </AppText>
            ) : (
              <FactChipRow evidence={item.evidence} />
            )}
            {item.processing === "pending" ? (
              <ContextualNotice accessibilityLabel="Why this item is incomplete" tone="warning">
                Relay accepted this capture but has not finished processing it, so its facts may
                still be incomplete.
              </ContextualNotice>
            ) : null}
          </ReceiptStage>

          <ReceiptStage
            label="Filed"
            ordinal={3}
            trailing={
              item.category === undefined ? null : (
                <Pressable
                  accessibilityHint="Explains what this filing method did"
                  accessibilityRole="button"
                  accessibilityState={{ expanded: whyOpen }}
                  onPress={() => setWhyOpen(!whyOpen)}
                >
                  <AppText tone="accent" variant="caption">
                    {whyOpen ? "Hide" : "Why?"}
                  </AppText>
                </Pressable>
              )
            }
          >
            {decision === undefined ? (
              <AppText tone="muted" variant="caption">
                Relay has not filed this yet.
              </AppText>
            ) : (
              <DecisionLine decision={decision} />
            )}

            {item.reviewReasons.map((reason) => (
              <AppText key={reason} tone="warning" variant="caption">
                {reason}
              </AppText>
            ))}

            {whyOpen && item.category !== undefined ? (
              <AppText tone="muted" variant="caption">
                {METHOD_NOTE[item.category.method] ??
                  "Relay recorded this filing method but cannot describe it in this build."}
              </AppText>
            ) : null}

            {whyOpen && item.category?.method === "semantic" ? (
              <AppButton
                accessibilityHint="Shows every field Relay has ever sent to a model"
                label="See what was disclosed"
                onPress={() => router.push("/disclosures")}
                tone="secondary"
              />
            ) : null}
          </ReceiptStage>

          <ReceiptStage label="Proposed" ordinal={4}>
            {open.length === 0 ? (
              <AppText tone="muted" variant="caption">
                Relay proposed nothing for this. Filing it changed nothing outside Relay.
              </AppText>
            ) : (
              open.map((proposal) => (
                <View
                  key={proposal.id}
                  style={[
                    styles.proposal,
                    {
                      backgroundColor: theme.relay.colors.surface,
                      borderColor: theme.relay.colors.borderSubtle,
                      borderRadius: theme.relay.radii.md,
                      borderWidth: theme.relay.borders.hairline,
                    },
                  ]}
                >
                  <ProposedActionBlock
                    busy={proposals.deciding === proposal.id}
                    onApprove={() => void proposals.approve(proposal.id)}
                    onSkip={() => void proposals.skip(proposal.id)}
                    proposal={proposal}
                  />
                </View>
              ))
            )}
          </ReceiptStage>

          {thread.length === 0 ? null : (
            <ReceiptStage label="Same conversation" ordinal={5}>
              {thread.map((other) => (
                <AppText key={other.id} tone="muted" variant="caption">
                  {formatCaptureTime(other.source.occurredAt)} · {other.title}
                </AppText>
              ))}
            </ReceiptStage>
          )}

          {item.retention.rawExpired ? (
            <ContextualNotice accessibilityLabel="Raw copy retention" tone="info">
              The encrypted original expired and was deleted. This receipt is what Relay retains.
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
    </ReceiptScreen>
  );
}

const styles = StyleSheet.create({
  body: { width: "100%" },
  proposal: { overflow: "hidden", width: "100%" },
});
