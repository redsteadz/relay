import { useRouter } from "expo-router";
import { useMemo } from "react";

import { ReceiptScreen } from "@/components/ReceiptScreen";
import {
  AppButton,
  AppText,
  FeedbackState,
  LoadingState,
  MetricRow,
  SectionHeading,
  ShareBar,
  Sparkline,
  StatusMessage,
  TopBarIconButton,
  type Metric,
} from "@/components/ui";
import {
  arrivalBuckets,
  capturedToday,
  glanceCounts,
  glanceGreeting,
  glanceSummary,
  hourTicks,
} from "@/features/activity/models/glancePresentation";
import { useProposedActions } from "@/features/actions/hooks/useProposedActions";
import { ReceiptCard } from "@/features/inbox/components/ReceiptCard";
import { useApplicationLabels } from "@/features/inbox/hooks/useApplicationLabels";
import { useInbox } from "@/features/inbox/hooks/useInbox";
import { summariseByApp } from "@/features/inbox/models/inboxPresentation";
import { useAuth } from "@/lib/auth-context";
import { useRelayTheme } from "@/theme";

/** How many sources the glance names before it stops being a glance. */
const TOP_SOURCES = 4;
/** How many waiting decisions are shown inline before the reader is sent to the inbox. */
const INLINE_DECISIONS = 3;

/**
 * Today: what arrived, what Relay did with it, and what is still waiting.
 *
 * The app opened onto the inbox, which answers "what arrived" and nothing else. That made a working
 * day and a broken one look identical -- two hundred rows either way -- and left the product's
 * actual claim, that almost none of it needed the reader, as something you could only infer by
 * noticing the tabs you did not have to open.
 *
 * This screen states it instead. Three counts, the shape of the day, the decisions genuinely
 * waiting, and which applications are responsible for the volume. Everything here is derived from
 * captures the inbox has already read; no new query, no new retained field, nothing shown that is
 * not shown elsewhere.
 */
export default function TodayScreen() {
  const { client, session } = useAuth();
  const router = useRouter();
  const theme = useRelayTheme();
  const inbox = useInbox();
  const proposals = useProposedActions(client, session?.user.id);

  const items = useMemo(() => inbox.sections.flatMap((section) => section.items), [inbox.sections]);
  const actionable = useMemo(
    () => inbox.sections.find((section) => section.group === "actionable")?.items ?? [],
    [inbox.sections],
  );
  const waiting = useMemo(
    () => actionable.filter((item) => proposals.forEvent(item.id).length > 0),
    [actionable, proposals],
  );

  // Every band on this screen reads the same window. Ranking sources over the whole inbox put a
  // lifetime count beside a day's counts under a footnote promising both covered today, which is
  // the one thing a screen called Today may not do.
  const today = useMemo(() => capturedToday(items), [items]);
  const counts = useMemo(() => glanceCounts(items, waiting.length), [items, waiting.length]);
  const buckets = useMemo(() => arrivalBuckets(items), [items]);

  const applicationIds = useMemo(
    () =>
      today.flatMap((item) =>
        item.source.applicationId === undefined ? [] : [item.source.applicationId],
      ),
    [today],
  );
  const labels = useApplicationLabels(applicationIds);
  const sources = useMemo(
    () => summariseByApp(today, labels).slice(0, TOP_SOURCES),
    [labels, today],
  );
  const peak = sources[0]?.captures ?? 0;

  const metrics: readonly Metric[] = [
    { key: "captured", label: "captured", value: counts.captured },
    { key: "filed", label: "filed", value: counts.filed },
    { emphasis: counts.waiting > 0, key: "waiting", label: "need you", value: counts.waiting },
  ];

  return (
    <ReceiptScreen
      action={
        <TopBarIconButton
          label="Open the activity ledger"
          name="activity"
          onPress={() => router.push("/activity")}
        />
      }
      title="Today"
    >
      <AppText tone="muted" variant="caption">
        {`${glanceGreeting()} · ${glanceSummary(counts)}`}
      </AppText>

      {proposals.error === undefined ? null : (
        <StatusMessage tone="error">{proposals.error}</StatusMessage>
      )}

      {inbox.loading ? <LoadingState label="Reading your day" /> : null}

      {!inbox.loading && inbox.unavailable ? (
        <FeedbackState
          action={<AppButton label="Retry" onPress={inbox.refetch} tone="secondary" />}
          detail="Relay could not reach your inbox. Today will fill in when the connection returns."
          kind="offline"
          title="Nothing to show yet"
        />
      ) : null}

      {!inbox.loading && !inbox.unavailable && session === null ? (
        <FeedbackState
          action={
            <AppButton
              label="Sign in"
              onPress={() => router.push({ params: { reason: "inbox" }, pathname: "/sign-in" })}
              tone="primary"
            />
          }
          detail="Your captures are account-owned. Sign in to see what Relay read and what it filed."
          kind="permission"
          title="Sign in to see your day"
        />
      ) : null}

      {inbox.loading || inbox.unavailable || session === null ? null : (
        <>
          <MetricRow metrics={metrics} />

          <Sparkline
            buckets={buckets}
            label={`${String(counts.captured)} captures across today`}
            ticks={[...hourTicks]}
          />

          <SectionHeading
            icon="hand-back-left-outline"
            label="Needs you"
            trailing={
              waiting.length > INLINE_DECISIONS ? (
                <AppText tone="muted" variant="monoMeta">
                  {`${String(waiting.length)} total`}
                </AppText>
              ) : undefined
            }
          />
          {waiting.length === 0 ? (
            <AppText tone="muted" variant="caption">
              Nothing is waiting on a decision from you.
            </AppText>
          ) : (
            waiting.slice(0, INLINE_DECISIONS).map((item) => {
              const proposal = proposals.forEvent(item.id)[0];
              return (
                <ReceiptCard
                  busy={proposal !== undefined && proposals.deciding === proposal.id}
                  item={item}
                  key={item.id}
                  onApprove={(actionRunId) => void proposals.approve(actionRunId)}
                  onOpen={() => router.push(`/inbox/${item.id}`)}
                  onSkip={(actionRunId) => void proposals.skip(actionRunId)}
                  proposal={proposal}
                />
              );
            })
          )}
          {waiting.length > INLINE_DECISIONS ? (
            <AppButton
              label="Open the inbox"
              onPress={() => router.push("/inbox")}
              tone="secondary"
            />
          ) : null}

          <SectionHeading icon="layers-outline" label="Top sources" />
          {sources.length === 0 ? (
            <AppText tone="muted" variant="caption">
              {items.length === 0
                ? "Nothing has been captured yet. Connect a source to begin."
                : "Nothing has arrived today. Your earlier captures are in the inbox."}
            </AppText>
          ) : (
            sources.map((source) => (
              <ShareBar
                accessibilityHint="Shows everything captured from this application"
                count={source.captures}
                key={source.key}
                label={source.label}
                onPress={() => router.push(`/inbox/app/${encodeURIComponent(source.key)}`)}
                peak={peak}
                tintKey={source.key}
              />
            ))
          )}

          {items.length === 0 ? (
            <AppButton
              label="Connect a source"
              onPress={() => router.push("/connections")}
              tone="primary"
            />
          ) : null}

          <AppText style={{ paddingTop: theme.relay.spacing.sm }} tone="muted" variant="monoMeta">
            Counts cover today in your own time zone.
          </AppText>
        </>
      )}
    </ReceiptScreen>
  );
}
