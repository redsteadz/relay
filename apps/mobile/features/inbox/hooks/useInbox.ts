import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { useAuth } from "@/lib/auth-context";

import { listInbox } from "../api/inbox";
import { filterInbox, inboxSections, type InboxSection } from "../models/inboxPresentation";

export const inboxQueryKeys = {
  all: (userId: string | undefined) => ["inbox", userId] as const,
};

export type InboxState = {
  /** True only for the first load, so a refresh never replaces the list with a spinner. */
  loading: boolean;
  query: string;
  refetch: () => void;
  refreshing: boolean;
  sections: readonly InboxSection[];
  setQuery: (value: string) => void;
  /** Distinguishes "nothing captured yet" from "nothing matches this search". */
  total: number;
  unavailable: boolean;
};

export function useInbox(): InboxState {
  const { client, session } = useAuth();
  const [query, setQuery] = useState("");
  const userId = session?.user.id;

  const inbox = useQuery({
    enabled: client !== undefined && userId !== undefined,
    queryFn: () => listInbox(client as NonNullable<typeof client>),
    queryKey: inboxQueryKeys.all(userId),
  });

  const items = useMemo(() => inbox.data ?? [], [inbox.data]);
  const sections = useMemo(() => inboxSections(filterInbox(items, query)), [items, query]);

  return {
    loading: inbox.isPending,
    query,
    refetch: () => void inbox.refetch(),
    refreshing: inbox.isFetching && !inbox.isPending,
    sections,
    setQuery,
    total: items.length,
    unavailable: inbox.isError,
  };
}
