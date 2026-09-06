import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import { listFilterRevisions } from "@/features/filters/api/filters";
import { useAuth } from "@/lib/auth-context";
import { runInBackground } from "@/lib/observability";

import { recordDeviceClassifications } from "../api/classifications";
import { hideInboxEvent, listInbox, restoreInboxEvent } from "../api/inbox";
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

  // Captures arrive while the app is backgrounded and sync on resume, so a list fetched once goes
  // stale the moment a notification lands. Refetching on resume is what makes an arrival visible
  // without asking a person to know they should reopen the screen.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void inbox.refetch();
    });
    return () => subscription.remove();
  }, [inbox]);

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

  const items = useMemo(() => inbox.data ?? [], [inbox.data]);
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
   */
  const filing = useRef(false);
  useEffect(() => {
    if (client === undefined || filing.current) return;
    if (inbox.isPending || revisions.isPending) return;

    const { withdrawals, writes } = classificationPass(items, rules);
    if (writes.length === 0 && withdrawals.length === 0) return;

    filing.current = true;
    runInBackground(
      recordDeviceClassifications(client, writes, withdrawals)
        .then(async (result) => {
          if (result.changed > 0) await queryClient.invalidateQueries({ queryKey: inboxKey });
        })
        .finally(() => {
          filing.current = false;
        }),
      "inbox.device_classification_failed",
      {
        code: "DEVICE_CLASSIFICATION_FAILED",
        integration: "supabase-postgrest",
        operation: "recordDeviceClassifications",
      },
    );
  }, [client, inbox.isPending, inboxKey, items, queryClient, revisions.isPending, rules]);
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
  const refetch = useCallback(() => void refetchInbox(), [refetchInbox]);

  return {
    clearLastHidden,
    hide,
    lastHidden,
    loading: inbox.isPending && inbox.fetchStatus !== "idle",
    query,
    refetch,
    refreshing: inbox.isFetching && !inbox.isPending,
    restore,
    sections,
    setQuery,
    total: items.length,
    unavailable: inbox.isError,
  };
}
