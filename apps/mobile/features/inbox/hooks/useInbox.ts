import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import { useAuth } from "@/lib/auth-context";

import { hideInboxEvent, listInbox, restoreInboxEvent } from "../api/inbox";
import { filterInbox, inboxSections, type InboxSection } from "../models/inboxPresentation";

export const inboxQueryKeys = {
  all: (userId: string | undefined) => ["inbox", userId] as const,
};

export type InboxState = {
  /** Removes an item from this reader's inbox. The device notification is never touched. */
  hide: (eventId: string) => Promise<void>;
  /** True only for the first load, so a refresh never replaces the list with a spinner. */
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

  // Both writes refetch rather than patch the cache: the list a person sees is the server's answer,
  // and a hidden item that failed to persist must reappear rather than look removed.
  const visibility = useMutation({
    mutationFn: async ({ action, eventId }: { action: "hide" | "restore"; eventId: string }) => {
      if (client === undefined || userId === undefined) return;
      const write = action === "hide" ? hideInboxEvent : restoreInboxEvent;
      await write(client, userId, eventId);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: inboxQueryKeys.all(userId) }),
  });

  const items = useMemo(() => inbox.data ?? [], [inbox.data]);
  const sections = useMemo(() => inboxSections(filterInbox(items, query)), [items, query]);

  return {
    hide: async (eventId: string) => {
      await visibility.mutateAsync({ action: "hide", eventId });
    },
    loading: inbox.isPending,
    query,
    refetch: () => void inbox.refetch(),
    refreshing: inbox.isFetching && !inbox.isPending,
    restore: async (eventId: string) => {
      await visibility.mutateAsync({ action: "restore", eventId });
    },
    sections,
    setQuery,
    total: items.length,
    unavailable: inbox.isError,
  };
}
