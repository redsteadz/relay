import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import { ReceiptScreen } from "@/components/ReceiptScreen";
import {
  ActionRow,
  AppButton,
  AppText,
  AppTextInput,
  EditorialSurface,
  FeedbackState,
  LoadingState,
  OutcomeTabs,
  StatusMessage,
  TopBarIconButton,
  UndoBar,
  type OutcomeTab,
} from "@/components/ui";
import { useProposedActions } from "@/features/actions/hooks/useProposedActions";
import { useCategoryManagement } from "@/features/categories/hooks/useCategoryManagement";
import { CategoryRow } from "@/features/inbox/components/CategoryRow";
import { InboxReceiptRow } from "@/features/inbox/components/InboxReceiptRow";
import { QuietSourceRow } from "@/features/inbox/components/QuietSourceRow";
import { useApplicationLabels } from "@/features/inbox/hooks/useApplicationLabels";
import { useInbox } from "@/features/inbox/hooks/useInbox";
import {
  groupByThread,
  inboxEverything,
  summariseByApp,
  summariseByCategory,
  type InboxGroup,
  type InboxItem,
} from "@/features/inbox/models/inboxPresentation";
import { useAuth } from "@/lib/auth-context";
import { demoModeEnabled } from "@/lib/demo/mode";
import { logMobileError } from "@/lib/observability";
import { useRelayTheme } from "@/theme";

/**
 * The inbox: what arrived, then what Relay wants from you about it.
 *
 * "All" leads because it is the only tab whose contents a reader can predict. The others are
 * outcomes -- Relay proposes something and is waiting on you, Relay could not resolve something, or
 * Relay filed it and is waiting on nothing -- and an ordinary notification derives no time, so it is
 * never actionable. Opening onto an outcome therefore showed an empty screen to a person whose
 * messages had all arrived correctly and been filed two tabs away. Outcomes remain, as filters over
 * a list that is visible first.
 */
/**
 * The tabs, and what each one answers.
 *
 * "All" is what arrived. The next three are outcomes -- what happened to a capture. "Categories" is
 * a different axis: it is the taxonomy the reader themselves defined, and it belongs here because
 * the question "where did that go" is asked of the inbox rather than of Settings, which is where
 * categories are edited.
 */
type InboxTab = "actionable" | "all" | "categories" | "needs-review" | "quiet";

const TAB_LABEL: Readonly<Record<InboxTab, string>> = {
  actionable: "Needs you",
  all: "All",
  categories: "Categories",
  quiet: "Quiet",
  "needs-review": "Review",
};

const EMPTY_DETAIL: Readonly<Record<InboxTab, string>> = {
  actionable: "Nothing is waiting on a decision from you.",
  all: "Nothing has been captured yet.",
  categories: "You have no categories yet. Create one from Settings.",
  quiet: "Nothing has been filed quietly yet.",
  "needs-review": "Relay resolved everything it read.",
};

/** Stable empty list, so a tab with nothing in it does not hand the memo a new array. */
const EMPTY_ITEMS: readonly InboxItem[] = [];

export default function InboxScreen() {
  const { client, session } = useAuth();
  const router = useRouter();
  const theme = useRelayTheme();
  const inbox = useInbox();
  const proposals = useProposedActions(client, session?.user.id);
  const categories = useCategoryManagement(client, session?.user.id);
  const [tab, setTab] = useState<InboxTab>("all");
  const [searching, setSearching] = useState(false);
  const [hideError, setHideError] = useState<string | undefined>();

  // Every derivation below runs over the whole inbox. Removing one item puts this component
  // through several renders -- the optimistic write, the undo offer, the mutation settling -- and
  // recomputing all of it on each was the JS-thread work that made removal feel late.
  const sections = inbox.sections;
  const itemsByTab = useMemo(() => {
    const byGroup = new Map<InboxGroup, readonly InboxItem[]>();
    for (const section of sections) byGroup.set(section.group, section.items);
    const group = (key: InboxGroup): readonly InboxItem[] => byGroup.get(key) ?? EMPTY_ITEMS;
    return new Map<InboxTab, readonly InboxItem[]>([
      // Every group, in arrival order. Built from the same sections so an item cannot appear here
      // and be missing from the outcome it belongs to.
      ["all", inboxEverything(sections.flatMap((section) => section.items))],
      ["actionable", group("actionable")],
      ["needs-review", group("needs-review")],
      // One tab over two groups. An item a rule filed and one nothing has ever looked at are
      // different states -- the Categories tab and each receipt's own decision line say which --
      // but neither is waiting on the reader, so both sit behind the same tab.
      ["quiet", [...group("filed"), ...group("unfiled")]],
    ]);
  }, [sections]);

  const known = useMemo(
    () => categories.activeCustom.concat(categories.systemCategories),
    [categories.activeCustom, categories.systemCategories],
  );
  const summaries = useMemo(
    () =>
      summariseByCategory(
        sections.flatMap((section) => section.items),
        known,
      ),
    [known, sections],
  );

  const items = useMemo(
    () => (tab === "categories" ? EMPTY_ITEMS : (itemsByTab.get(tab) ?? EMPTY_ITEMS)),
    [itemsByTab, tab],
  );
  const threads = useMemo(() => groupByThread(items), [items]);
  const quietCount = itemsByTab.get("quiet")?.length ?? 0;

  const tabs: readonly OutcomeTab<InboxTab>[] = useMemo(
    () =>
      (["all", "actionable", "needs-review", "quiet", "categories"] as const).map((key) => ({
        count: key === "categories" ? summaries.length : (itemsByTab.get(key)?.length ?? 0),
        key,
        label: TAB_LABEL[key],
      })),
    [itemsByTab, summaries.length],
  );

  const applicationIds = useMemo(
    () =>
      items.flatMap((item) =>
        item.source.applicationId === undefined ? [] : [item.source.applicationId],
      ),
    [items],
  );
  const labels = useApplicationLabels(applicationIds);

  // Stable across renders so the memoized rows are not invalidated by a new closure each time.
  const hideEvent = inbox.hide;
  const approveRun = proposals.approve;
  const skipRun = proposals.skip;
  const hide = useCallback(
    (eventId: string) => {
      // Cleared only when something is actually showing: an unconditional reset is a state write,
      // and a state write is a render the list does not need while a row is leaving.
      setHideError((current) => (current === undefined ? current : undefined));
      void hideEvent(eventId).catch((error: unknown) => {
        logMobileError("ui.inbox_hide_failed", error, {
          code: "INBOX_HIDE_FAILED",
          integration: "supabase-postgrest",
          operation: "hideInboxEvent",
        });
        setHideError("Could not remove that from your inbox. It is still here.");
      });
    },
    [hideEvent],
  );

  const openReceipt = useCallback((eventId: string) => router.push(`/inbox/${eventId}`), [router]);
  const approve = useCallback((actionRunId: string) => void approveRun(actionRunId), [approveRun]);
  const skip = useCallback((actionRunId: string) => void skipRun(actionRunId), [skipRun]);

  return (
    <ReceiptScreen
      action={
        // A demo build puts its one extra control here rather than in the list. The inbox is the
        // thing being demonstrated, and a banner across the top of it displaces the receipts a
        // person is meant to be reading.
        <ActionRow compact wrap={false}>
          {demoModeEnabled() ? (
            <TopBarIconButton
              label="Demo studio"
              name="experiment"
              onPress={() => router.push("/demo")}
            />
          ) : null}
          <TopBarIconButton
            label={searching ? "Close search" : "Search the inbox"}
            name="search"
            onPress={() => {
              const next = !searching;
              setSearching(next);
              if (!next) inbox.setQuery("");
            }}
          />
        </ActionRow>
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

      {/*
       * A signed-out reader is told so, rather than told nothing has been captured. The inbox is
       * account-owned, so "nothing captured yet" would be a claim Relay cannot make without a
       * session to read -- and a development build lets a person reach this screen without one.
       */}
      {!inbox.loading && !inbox.unavailable && inbox.total === 0 && session === null ? (
        <EditorialSurface icon="inbox-outline" meta="Sign-in required" title="Inbox">
          <AppText tone="muted">
            Your inbox is account-owned. Sign in to see what Relay captured, what it filed, and what
            it is waiting on you to decide.
          </AppText>
          <AppButton
            label="Sign in to see your inbox"
            onPress={() => router.push({ params: { reason: "inbox" }, pathname: "/sign-in" })}
            tone="secondary"
          />
        </EditorialSurface>
      ) : null}

      {!inbox.loading && !inbox.unavailable && inbox.total === 0 && session !== null ? (
        <FeedbackState
          detail="Once a connected source is captured, what matters appears here and the rest stays quietly searchable."
          kind="empty"
          title="Nothing captured yet"
        />
      ) : null}

      {tab === "categories" && !inbox.loading && summaries.length === 0 ? (
        <AppText tone="muted" variant="caption">
          {EMPTY_DETAIL.categories}
        </AppText>
      ) : null}

      {tab !== "categories" &&
      !inbox.loading &&
      !inbox.unavailable &&
      inbox.total > 0 &&
      items.length === 0 ? (
        <AppText tone="muted" variant="caption">
          {inbox.query === "" ? EMPTY_DETAIL[tab] : "Nothing here matches that search."}
        </AppText>
      ) : null}

      {tab === "categories"
        ? summaries.map((category) => (
            <CategoryRow
              category={category}
              key={category.key}
              onPress={() => router.push(`/inbox/category/${encodeURIComponent(category.key)}`)}
            />
          ))
        : null}

      {tab === "quiet" ? (
        <QuietList items={items} labels={labels} />
      ) : tab === "categories" ? null : (
        threads.map((thread) => {
          const proposal = proposals.forEvent(thread.latest.id)[0];
          return (
            <InboxReceiptRow
              busy={proposal !== undefined && proposals.deciding === proposal.id}
              key={thread.key}
              onApprove={approve}
              onHide={hide}
              onOpen={openReceipt}
              onSkip={skip}
              proposal={proposal}
              thread={thread}
            />
          );
        })
      )}

      {/* Not on "All": the quiet captures are already in that list, so the shortcut would offer to
          show what is on screen. */}
      {tab === "all" || tab === "quiet" || tab === "categories" || quietCount === 0 ? null : (
        <AppButton
          accessibilityHint="Shows everything Relay filed without asking you"
          label={`${String(quietCount)} filed quietly →`}
          onPress={() => setTab("quiet")}
          tone="secondary"
        />
      )}
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

const styles = StyleSheet.create({
  search: { width: "100%" },
});
