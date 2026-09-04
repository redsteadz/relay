import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { useAuth } from "@/lib/auth-context";

import { listHiddenInbox, restoreInboxEvent } from "../api/inbox";
import { inboxQueryKeys } from "./useInbox";
import type { InboxItem } from "../models/inboxPresentation";

export const hiddenInboxQueryKeys = {
  all: (userId: string | undefined) => ["inbox", "hidden", userId] as const,
};

export type HiddenInboxState = {
  items: readonly InboxItem[];
  loading: boolean;
  refetch: () => void;
  refreshing: boolean;
  /** Puts an item back in the inbox. */
  restore: (eventId: string) => Promise<void>;
  unavailable: boolean;
};

/**
 * What this reader removed from their inbox, newest removal first.
 *
 * Restoring invalidates both this list and the inbox, because one item moving between them changes
 * what each should show and neither can be patched correctly from the other's result.
 */
export function useHiddenInbox(): HiddenInboxState {
  const { client, session } = useAuth();
  const queryClient = useQueryClient();
  const userId = session?.user.id;

  const hidden = useQuery({
    enabled: client !== undefined && userId !== undefined,
    queryFn: () => listHiddenInbox(client as NonNullable<typeof client>, userId as string),
    queryKey: hiddenInboxQueryKeys.all(userId),
  });

  const restore = useMutation({
    mutationFn: async (eventId: string) => {
      if (client === undefined || userId === undefined) return;
      await restoreInboxEvent(client, userId, eventId);
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: hiddenInboxQueryKeys.all(userId) }),
        queryClient.invalidateQueries({ queryKey: inboxQueryKeys.all(userId) }),
      ]);
    },
  });

  const items = useMemo(() => hidden.data ?? [], [hidden.data]);

  return {
    items,
    loading: hidden.isPending,
    refetch: () => void hidden.refetch(),
    refreshing: hidden.isFetching && !hidden.isPending,
    restore: async (eventId: string) => {
      await restore.mutateAsync(eventId);
    },
    unavailable: hidden.isError,
  };
}
