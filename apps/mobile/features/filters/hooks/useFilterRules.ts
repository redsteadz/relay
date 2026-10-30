import type { FilterCompileRequest } from "@relay/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authorizeNamedApplications } from "@/features/device-capture/hooks/authorizeNamedApplications";

import { listFilterRevisions, saveFilterRule } from "../api/filters";
import {
  applicationIdsInPlan,
  filterRevisionHistory,
  latestFilterRevisions,
} from "../models/filterPresentation";

function queryKey(userId: string | undefined) {
  return ["filter-rules", userId] as const;
}

export function useFilterRules(
  client: SupabaseClient | undefined,
  userId: string | undefined,
  accessToken: string | undefined,
) {
  const queryClient = useQueryClient();
  const query = useQuery({
    enabled: client !== undefined && userId !== undefined,
    queryFn: () => listFilterRevisions(client as SupabaseClient),
    queryKey: queryKey(userId),
  });
  const save = useMutation({
    mutationFn: async (request: FilterCompileRequest) => {
      const response = await saveFilterRule(accessToken as string, request);
      // Naming an application in the saved plan authorizes its capture, as part of this same
      // action (ADR-0023) -- no separate trip to Sources required first.
      await authorizeNamedApplications(userId, applicationIdsInPlan(response.rule.plan));
      return response;
    },
    // The saved revision is refetched rather than merged in, because a save appends a version and
    // the list is derived from every revision the tenant owns.
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: queryKey(userId) }),
  });

  const revisions = query.data ?? [];
  return {
    clearSaveError: save.reset,
    historyFor: (seriesId: string) => filterRevisionHistory(revisions, seriesId),
    isLoading: query.isFetching && query.data === undefined,
    loadError: query.error,
    refresh: query.refetch,
    rules: latestFilterRevisions(revisions),
    save: save.mutateAsync,
    saveError: save.error,
    saving: save.isPending,
  };
}
