import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import { useAuth } from "@/lib/auth-context";

import { hideInboxEvent, listInbox, restoreInboxEvent } from "../api/inbox";
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
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: inboxKey }),
  });

  const items = useMemo(() => inbox.data ?? [], [inbox.data]);
  const sections = useMemo(() => inboxSections(filterInbox(items, query)), [items, query]);

  return {
    clearLastHidden: () => {
      setLastHidden(undefined);
    },
    hide: async (eventId: string) => {
      const removed = items.find((item) => item.id === eventId);
      await visibility.mutateAsync({ action: "hide", eventId });
      // Offered only after the write settles. Offering to undo something that never persisted
      // would be a second false statement on top of the row appearing to vanish.
      setLastHidden(removed);
    },
    lastHidden,
    loading: inbox.isPending && inbox.fetchStatus !== "idle",
    query,
    refetch: () => void inbox.refetch(),
    refreshing: inbox.isFetching && !inbox.isPending,
    restore: async (eventId: string) => {
      const item = lastHidden?.id === eventId ? lastHidden : undefined;
      await visibility.mutateAsync({ action: "restore", eventId, item });
      setLastHidden((current) => (current?.id === eventId ? undefined : current));
    },
    sections,
    setQuery,
    total: items.length,
    unavailable: inbox.isError,
  };
}
