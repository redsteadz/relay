import type { SupabaseClient } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";

import { getDisclosureHistory } from "@/features/privacy/api/privacy";

import { loadActivityLedger } from "../api/activity";
import { activityTimeline, pendingDecisionCount } from "../models/activityPresentation";

function ledgerKey(userId: string | undefined) {
  return ["activity-ledger", userId] as const;
}

function disclosureKey(userId: string | undefined) {
  return ["activity-disclosures", userId] as const;
}

/**
 * The timeline, assembled from two records that fail independently.
 *
 * They are separate queries rather than one, because the ledger is read from PostgREST and
 * disclosures from the Relay API. Either can fail while the other succeeds, and when that happens
 * the screen shows what it has and says the rest is missing — an activity view that blanks itself
 * because one of two sources is unreachable is less honest than a partial one that admits the gap.
 */
export function useActivityTimeline(
  client: SupabaseClient | undefined,
  userId: string | undefined,
  accessToken: string | undefined,
) {
  const ledger = useQuery({
    enabled: client !== undefined && userId !== undefined,
    queryFn: () => loadActivityLedger(client as SupabaseClient),
    queryKey: ledgerKey(userId),
  });
  const disclosures = useQuery({
    enabled: accessToken !== undefined,
    queryFn: () => getDisclosureHistory(accessToken as string),
    queryKey: disclosureKey(userId),
  });

  const entries = activityTimeline({
    disclosures: disclosures.data ?? [],
    events: ledger.data?.events ?? [],
    rules: ledger.data?.rules ?? [],
    runs: ledger.data?.runs ?? [],
  });

  return {
    disclosuresUnavailable: disclosures.error !== null,
    entries,
    isLoading:
      (ledger.isFetching && ledger.data === undefined) ||
      (disclosures.isFetching && disclosures.data === undefined),
    ledgerUnavailable: ledger.error !== null,
    pendingCount: pendingDecisionCount(entries),
    refresh: async () => {
      await Promise.all([ledger.refetch(), disclosures.refetch()]);
    },
    refreshing: ledger.isRefetching || disclosures.isRefetching,
  };
}
