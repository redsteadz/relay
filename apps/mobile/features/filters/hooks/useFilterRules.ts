import type { FilterCompileRequest, FilterCompileResponse } from "@relay/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authorizeNamedApplications } from "@/features/device-capture/hooks/authorizeNamedApplications";
import { withdrawThenSave } from "@/features/silence/api/silenceSnapshot";
import { silenceQueryKeys } from "@/features/silence/hooks/useNotificationSilence";

import { listFilterRevisions, saveFilterRule } from "../api/filters";
import {
  applicationIdsInPlan,
  filterRevisionHistory,
  latestFilterRevisions,
} from "../models/filterPresentation";

function queryKey(userId: string | undefined) {
  return ["filter-rules", userId] as const;
}

/**
 * Saves a revision, taking the rule's quiet authorization off the device first.
 *
 * Every save appends a revision, and an authorization belongs to the revision it was granted on, so
 * pausing or editing a rule always withdraws whatever it was allowed to do to a notification. The
 * device has to let go before the save is sent: the listener acts on its own copy of the rules, and
 * until issue 251 a rule paused here kept snoozing or clearing until someone happened to open Quiet.
 */
export async function saveRuleRevision(
  client: SupabaseClient,
  userId: string,
  accessToken: string,
  request: FilterCompileRequest,
): Promise<FilterCompileResponse> {
  return withdrawThenSave(client, userId, request.seriesId, async () => {
    const response = await saveFilterRule(accessToken, request);
    // Naming an application in the saved plan authorizes its capture, as part of this same
    // action (ADR-0023) -- no separate trip to Sources required first.
    await authorizeNamedApplications(userId, applicationIdsInPlan(response.rule.plan));
    return response;
  });
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
    mutationFn: (request: FilterCompileRequest) =>
      saveRuleRevision(client as SupabaseClient, userId as string, accessToken as string, request),
    // The saved revision is refetched rather than merged in, because a save appends a version and
    // the list is derived from every revision the tenant owns. Quiet's view is marked stale too, so
    // it shows the withdrawal the next time it is open.
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKey(userId) });
      await queryClient.invalidateQueries({ queryKey: silenceQueryKeys.state(userId) });
    },
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
