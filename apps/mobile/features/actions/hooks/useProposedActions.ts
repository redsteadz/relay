import type { ActionDecision } from "@relay/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { decideActionRun, loadProposedActions, type ProposedActionLedger } from "../api/actions";
import {
  actionDecisionErrorMessage,
  proposalsByEvent,
  proposedAction,
  type ProposedAction,
} from "../models/actionPresentation";

export const proposedActionKeys = {
  all: (userId: string | undefined) => ["proposed-actions", userId] as const,
};

export type ProposedActionState = {
  /** Clears a decision failure once the reader has seen it. */
  clearError: () => void;
  /** Fixed message for the last decision that could not be recorded. */
  error: string | undefined;
  /** Every open proposal for one event, newest first. Empty when Relay proposed nothing. */
  forEvent: (eventId: string) => readonly ProposedAction[];
  /** True only for the first load, so a refresh never blanks a receipt's proposal. */
  loading: boolean;
  /** Records approval. Resolves once the ledger has it; rejects without changing anything. */
  approve: (actionRunId: string) => Promise<void>;
  /** Records cancellation. Nothing is ever sent to the provider. */
  skip: (actionRunId: string) => Promise<void>;
  /** The run currently being decided, so its own card can show the wait. */
  deciding: string | undefined;
};

const EMPTY: readonly ProposedAction[] = [];

/**
 * The proposals open against a tenant's events.
 *
 * Read once for the whole inbox rather than per receipt: a list of twenty items would otherwise
 * issue twenty reads for rows that arrive in one bounded page, and the detail screen would disagree
 * with the list it was opened from while both were in flight.
 *
 * A decision is applied to the cache first and reversed if the write fails, matching how inbox
 * visibility works. The distinction that matters here is that the optimistic state is *removal from
 * the open set*, never a claim that the provider received anything: dispatch is a Workflow's job and
 * happens after approval, so this hook only ever reports that the decision was recorded.
 */
export function useProposedActions(
  client: SupabaseClient | undefined,
  userId: string | undefined,
): ProposedActionState {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | undefined>();
  const [deciding, setDeciding] = useState<string | undefined>();
  const key = proposedActionKeys.all(userId);

  const ledger = useQuery({
    enabled: client !== undefined && userId !== undefined,
    queryFn: () => loadProposedActions(client as SupabaseClient),
    queryKey: key,
  });

  const byEvent = useMemo(() => {
    const data = ledger.data;
    if (data === undefined) return new Map<string, readonly ProposedAction[]>();
    const rules = new Map(data.rules.map((rule) => [rule.id, rule]));
    const proposals = data.runs
      .map((run) => proposedAction(run, rules))
      .filter((proposal): proposal is ProposedAction => proposal !== undefined);
    return proposalsByEvent(proposals);
  }, [ledger.data]);

  const decision = useMutation({
    mutationFn: async ({
      actionRunId,
      decision: choice,
    }: {
      actionRunId: string;
      decision: ActionDecision;
    }) => {
      // Returning quietly would report a decision that never reached the ledger: the proposal would
      // leave the screen and nothing would have been recorded or cancelled.
      if (client === undefined) {
        throw new Error("Signed-in session required to decide a proposed action");
      }
      await decideActionRun(client, actionRunId, choice);
    },
    onMutate: async ({ actionRunId }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ProposedActionLedger>(key);
      queryClient.setQueryData<ProposedActionLedger>(key, (current) =>
        current === undefined
          ? current
          : { ...current, runs: current.runs.filter((run) => run.id !== actionRunId) },
      );
      return { previous };
    },
    onError: (_error, variables, context) => {
      // Put the proposal back exactly as it was. A decision that failed must leave something still
      // waiting, because the alternative reads as "handled" for an action that never happened.
      if (context?.previous !== undefined) queryClient.setQueryData(key, context.previous);
      setError(actionDecisionErrorMessage(variables.decision));
      void queryClient.invalidateQueries({ queryKey: key });
    },
    // Re-read only after a failure. On success the optimistic state already matches the ledger,
    // and refetching replaces every proposal with a new object, which re-renders every receipt in
    // the list for no new information.
  });

  // Stable across renders: the inbox memoizes its rows on prop identity, and a handler rebuilt
  // each render would silently defeat that.
  const mutate = decision.mutateAsync;
  const decide = useCallback(
    async (actionRunId: string, choice: ActionDecision): Promise<void> => {
      setError((current) => (current === undefined ? current : undefined));
      setDeciding(actionRunId);
      try {
        await mutate({ actionRunId, decision: choice });
      } finally {
        setDeciding(undefined);
      }
    },
    [mutate],
  );

  const approve = useCallback((actionRunId: string) => decide(actionRunId, "approve"), [decide]);
  const skip = useCallback((actionRunId: string) => decide(actionRunId, "cancel"), [decide]);
  const clearError = useCallback(() => {
    setError(undefined);
  }, []);
  const forEvent = useCallback((eventId: string) => byEvent.get(eventId) ?? EMPTY, [byEvent]);

  return {
    approve,
    clearError,
    deciding,
    error,
    forEvent,
    loading: ledger.isPending,
    skip,
  };
}
