import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import { listFilterRevisions } from "@/features/filters/api/filters";
import { useAuth } from "@/lib/auth-context";
import { localStoreSupported, openLocalStore, setLocalHidden } from "@/lib/local-store";
import { runInBackground } from "@/lib/observability";

import { recordDeviceClassifications } from "../api/classifications";
import { hideInboxEvent, listInbox, restoreInboxEvent } from "../api/inbox";
import { listLocalInbox } from "../api/localInbox";
import { resolveAwaitingModelForTenant } from "../api/semanticFiling";
import { classifiableRules, classificationPass } from "../models/deviceClassification";
import {
  filterInbox,
  inboxSections,
  type InboxItem,
  type InboxSection,
} from "../models/inboxPresentation";

export const inboxQueryKeys = {
  all: (userId: string | undefined) => ["inbox", userId] as const,
};

/** Kept separate from the server read so one can refetch, fail, or be invalidated without the other. */
export const localInboxQueryKeys = {
  all: (userId: string | undefined) => ["inbox-local", userId] as const,
};

export type InboxState = {
  /** Clears the pending undo offer without restoring anything. */
  clearLastHidden: () => void;
  /** Removes an item from this reader's inbox. The device notification is never touched. */
  hide: (eventId: string) => Promise<void>;
  /** The item just removed, while the offer to put it back still stands. */
  lastHidden: InboxItem | undefined;
  /**
   * True only for the first load, so a refresh never replaces the list with a spinner.
   *
   * False when there is no session to read for: a disabled query stays `pending` indefinitely in
   * react-query, and reporting that as loading left a signed-out reader watching a spinner that
   * could never resolve.
   */
  loading: boolean;
  query: string;
  refetch: () => void;
  refreshing: boolean;
  /** Puts a hidden item back. Hiding is reversible, so this is always available after it. */
  restore: (eventId: string) => Promise<void>;
  sections: readonly InboxSection[];
  setQuery: (value: string) => void;
  /** Distinguishes "nothing captured yet" from "nothing matches this search". */
  total: number;
  unavailable: boolean;
};

export function useInbox(): InboxState {
  const { client, session } = useAuth();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [lastHidden, setLastHidden] = useState<InboxItem | undefined>();
  const userId = session?.user.id;

  const inbox = useQuery({
    enabled: client !== undefined && userId !== undefined,
    queryFn: () => listInbox(client as NonNullable<typeof client>, userId as string),
    queryKey: inboxQueryKeys.all(userId),
  });

  /**
   * The same inbox, from this device's own derived store.
   *
   * Read alongside the server rather than after it, because the device derived these rows before it
   * uploaded anything: waiting for PostgREST meant a capture the phone had already understood stayed
   * invisible until a round trip completed. This answers the first paint and an offline open; the
   * server read replaces it the moment it lands.
   *
   * It needs no client, only a tenant, so it still answers when the network does not.
   */
  const local = useQuery({
    enabled: userId !== undefined,
    queryFn: () => listLocalInbox(userId as string),
    queryKey: localInboxQueryKeys.all(userId),
  });

  // Captures arrive while the app is backgrounded and sync on resume, so a list fetched once goes
  // stale the moment a notification lands. Refetching on resume is what makes an arrival visible
  // without asking a person to know they should reopen the screen.
  // Both readers, because resume is also when the sync pass derives what arrived while the app was
  // away: the local store is written during that pass, so refetching only the server would leave the
  // faster source holding rows nothing had asked it for.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void inbox.refetch();
      void local.refetch();
    });
    return () => subscription.remove();
  }, [inbox, local]);

  const inboxKey = inboxQueryKeys.all(userId);

  /**
   * Visibility changes are applied to the cache first and reversed if the write fails.
   *
   * Waiting for a round trip and a full re-read before the row moved put a visible delay between
   * the gesture and its result, and the re-read then replaced the whole list, which moved the rows
   * a person was still reading. The list a person sees is still the server's answer -- the write is
   * awaited and a failure restores exactly what was there before -- it is simply no longer the only
   * thing that decides what is drawn.
   */
  const visibility = useMutation({
    mutationFn: async ({
      action,
      eventId,
    }: {
      action: "hide" | "restore";
      eventId: string;
      item?: InboxItem | undefined;
    }) => {
      // Returning quietly here would report success without writing anything: the row would appear
      // to go, the undo offer would stand, and nothing would have changed on the server.
      if (client === undefined || userId === undefined) {
        throw new Error("Signed-in session required to change inbox visibility");
      }
      const write = action === "hide" ? hideInboxEvent : restoreInboxEvent;
      await write(client, userId, eventId);
      // Mirrored locally so the device's own read agrees. Not awaited into the mutation's result: the
      // server write is what makes the change real, and a local store that could not record it would
      // otherwise turn a successful removal into a failed one. The next server read corrects it.
      if (localStoreSupported()) {
        runInBackground(
          openLocalStore().then((database) =>
            setLocalHidden(database, userId, eventId, action === "hide"),
          ),
          "inbox.local_hidden_write_failed",
          {
            code: "LOCAL_HIDDEN_WRITE_FAILED",
            integration: "expo-sqlite",
            operation: "setLocalHidden",
          },
        );
      }
    },
    onMutate: async ({ action, eventId, item }) => {
      await queryClient.cancelQueries({ queryKey: inboxKey });
      const previous = queryClient.getQueryData<readonly InboxItem[]>(inboxKey);
      queryClient.setQueryData<readonly InboxItem[]>(inboxKey, (current) => {
        const rows = current ?? [];
        if (action === "hide") return rows.filter((row) => row.id !== eventId);
        // Undo returns the item to the list it was taken from, in its original order.
        if (item === undefined || rows.some((row) => row.id === item.id)) return rows;
        return [...rows, item];
      });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      // Put back precisely what was there. An item whose removal failed must reappear rather than
      // stay gone because the screen already drew it that way.
      if (context?.previous !== undefined) queryClient.setQueryData(inboxKey, context.previous);
      void queryClient.invalidateQueries({ queryKey: inboxKey });
    },
  });

  // Rules are read here rather than in the filter feature's own hook because filing needs the newest
  // enabled revision of each series, which is what that reader already returns.
  const revisions = useQuery({
    enabled: client !== undefined && userId !== undefined,
    queryFn: () => listFilterRevisions(client as NonNullable<typeof client>),
    queryKey: ["filter-rules", userId],
  });

  /**
   * The server's answer when there is one, this device's until then.
   *
   * Not merged. The two stores disagree about event ids -- a locally derived event carries a locally
   * generated id and the server generates its own for the same capture (ADR-0015) -- so merging would
   * show one capture twice. Preferring the server once it answers keeps a single identity per item
   * and makes reconciliation a replacement rather than a diff.
   */
  const items = useMemo(() => inbox.data ?? local.data ?? [], [inbox.data, local.data]);
  const rules = useMemo(() => classifiableRules(revisions.data ?? []), [revisions.data]);

  /**
   * Files what this device can decide, once per load.
   *
   * The pass converges rather than looping: a write invalidates the inbox, the refetched items carry
   * the classification that was just written, and the next pass finds nothing left to change. The
   * ref guards the window before that refetch lands, where the same decision would otherwise be
   * written twice.
   *
   * Filing is deliberately not awaited by the screen. It is advisory -- a capture that stays unfiled
   * is filed on the next open -- so it must never delay drawing the inbox or turn a write failure
   * into a failed read.
   *
   * A clause this device can resolve gets a second phase. Phase one is deterministic and free and
   * reports what it could not decide; phase two asks the reader's configured endpoint and re-runs the
   * pass with the answers (ADR-0019). A reader with no endpoint configured never reaches phase two,
   * and the behaviour is exactly what it was.
   */
  const filing = useRef(false);
  useEffect(() => {
    if (client === undefined || filing.current) return;
    if (inbox.isPending || revisions.isPending) return;

    const first = classificationPass(items, rules);
    const resolvable = userId !== undefined && first.pending.length > 0;
    if (first.writes.length === 0 && first.withdrawals.length === 0 && !resolvable) return;

    filing.current = true;
    runInBackground(
      (async () => {
        let { withdrawals, writes } = first;

        if (resolvable) {
          // Asking a model is the slow part, so the deterministic writes are not held behind it:
          // they are recorded first and the resolved ones follow. A reader watching the inbox sees
          // what the device knew immediately, then what the model added.
          if (writes.length > 0 || withdrawals.length > 0) {
            const immediate = await recordDeviceClassifications(client, writes, withdrawals);
            if (immediate.changed > 0) {
              await queryClient.invalidateQueries({ queryKey: inboxKey });
            }
          }
          const resolved = await resolveAwaitingModelForTenant(userId, first.pending, rules);
          if (resolved === undefined) return;
          ({ withdrawals, writes } = classificationPass(items, rules, resolved));
        }

        if (writes.length === 0 && withdrawals.length === 0) return;
        const result = await recordDeviceClassifications(client, writes, withdrawals);
        if (result.changed > 0) await queryClient.invalidateQueries({ queryKey: inboxKey });
      })().finally(() => {
        filing.current = false;
      }),
      "inbox.device_classification_failed",
      {
        code: "DEVICE_CLASSIFICATION_FAILED",
        integration: "supabase-postgrest",
        operation: "recordDeviceClassifications",
      },
    );
  }, [client, inbox.isPending, inboxKey, items, queryClient, revisions.isPending, rules, userId]);
  const sections = useMemo(() => inboxSections(filterInbox(items, query)), [items, query]);

  // Every callback below is stable across renders. The inbox list memoizes its rows on prop
  // identity, and a handler rebuilt each render would silently defeat that.
  const mutate = visibility.mutateAsync;
  const clearLastHidden = useCallback(() => {
    setLastHidden(undefined);
  }, []);

  const hide = useCallback(
    async (eventId: string) => {
      const removed = items.find((item) => item.id === eventId);
      await mutate({ action: "hide", eventId });
      // Offered only after the write settles. Offering to undo something that never persisted
      // would be a second false statement on top of the row appearing to vanish.
      setLastHidden(removed);
    },
    [items, mutate],
  );

  const restore = useCallback(
    async (eventId: string) => {
      const item = lastHidden?.id === eventId ? lastHidden : undefined;
      await mutate({ action: "restore", eventId, item });
      setLastHidden((current) => (current?.id === eventId ? undefined : current));
    },
    [lastHidden, mutate],
  );

  const refetchInbox = inbox.refetch;
  const refetchLocal = local.refetch;
  const refetch = useCallback(() => {
    void refetchInbox();
    void refetchLocal();
  }, [refetchInbox, refetchLocal]);

  return {
    clearLastHidden,
    hide,
    lastHidden,
    // A spinner only while there is genuinely nothing to show. Local rows arriving first are what
    // they are -- the inbox -- so replacing them with a loading state while the server catches up
    // would reintroduce the wait this read exists to remove.
    loading: inbox.isPending && inbox.fetchStatus !== "idle" && items.length === 0,
    query,
    refetch,
    refreshing: inbox.isFetching && !inbox.isPending,
    restore,
    sections,
    setQuery,
    total: items.length,
    // A failed server read is not an unavailable inbox when the device can still answer from its own
    // store. It is reported only when there is nothing to show, so an offline open reads as the inbox
    // it is rather than as an error.
    unavailable: inbox.isError && items.length === 0,
  };
}
