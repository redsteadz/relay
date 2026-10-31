/**
 * The quiet controls, as one hook.
 *
 * Every change here has to land in two places that cannot be updated atomically: the database, which
 * is the authority on what a rule may do, and the device snapshot, which is what the notification
 * listener reads while the app is dead. `silenceSnapshot.ts` owns the device side and the order:
 * granting goes database first, withdrawing goes device first, so a failed write always leaves the
 * device holding *less* authorization than the database rather than more.
 *
 * The kill switch is its own native flag and goes to the device first, in both directions. A person
 * reaching for a stop is stopping the behaviour now, and making that wait on the network would be
 * the wrong trade in the one case where it matters most.
 */

import type { NotificationSilenceAction } from "@relay/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authorizeNamedApplications } from "@/features/device-capture/hooks/authorizeNamedApplications";
import RelayDeviceIngress, { SILENCE_OUTCOME_LIMIT } from "@/modules/relay-device-ingress";
import { reviewableRules } from "@/lib/notification-silence";
import { namedApplications } from "../models/silencePresentation";
import {
  completeDryRun,
  setKillSwitch,
  setRuleDismissal,
  startDryRun,
  SILENCE_DRY_RUN_MINIMUM_HOURS,
} from "../api/silence";
import { publishSilenceSnapshot, withdrawThenSave } from "../api/silenceSnapshot";

export const silenceQueryKeys = {
  outcomes: (userId: string | undefined) => ["notification-silence", userId, "outcomes"] as const,
  state: (userId: string | undefined) => ["notification-silence", userId, "state"] as const,
};

export function useNotificationSilence(
  client: SupabaseClient | undefined,
  tenantId: string | undefined,
) {
  const queryClient = useQueryClient();
  const enabled = client !== undefined && tenantId !== undefined;

  // Reading the state publishes it, so opening this screen also brings the device up to date.
  const state = useQuery({
    enabled,
    queryFn: () => publishSilenceSnapshot(client as SupabaseClient, tenantId as string),
    queryKey: silenceQueryKeys.state(tenantId),
  });

  /**
   * The verdicts, each carrying the title of the notification it was about.
   *
   * The ledger is content-free on purpose and stays that way: it holds an application id, a rule id,
   * a capture identity and a verdict. The title is read separately, from the device's own retained
   * copy of the capture, and joined here for display only.
   *
   * That join is what the ledger was keyed by capture identity *for*, and it was never built -- so
   * the review a person is asked to authorize an irreversible capability on read
   * `com.courier.app · Would have been put away` and nothing else. Which notification that was is
   * the entire question a reviewer has.
   *
   * A title that is missing is not an error. Retention is thirty days and bounded by size, so an old
   * verdict outlives its content; the row then says what it always said.
   */
  const outcomes = useQuery({
    enabled,
    queryFn: async () => {
      const recorded = await RelayDeviceIngress.getNotificationSilenceOutcomes(
        tenantId as string,
        SILENCE_OUTCOME_LIMIT,
      );
      if (recorded.length === 0) return recorded;
      const content = await RelayDeviceIngress.getRetainedCaptureContent(
        tenantId as string,
        recorded.map((outcome) => outcome.envelopeId),
      );
      return recorded.map((outcome) => {
        const subject = content[outcome.envelopeId]?.subject;
        return subject === undefined ? outcome : { ...outcome, subject };
      });
    },
    queryKey: silenceQueryKeys.outcomes(tenantId),
  });

  async function refreshAll(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: silenceQueryKeys.state(tenantId) });
    await queryClient.invalidateQueries({ queryKey: silenceQueryKeys.outcomes(tenantId) });
  }

  const observe = useMutation({
    mutationFn: ({
      action,
      filterRuleId,
    }: {
      action: NotificationSilenceAction;
      filterRuleId: string;
    }) => startDryRun(client as SupabaseClient, filterRuleId, action),
    onSuccess: refreshAll,
  });

  /**
   * Closes the window with what the device actually observed.
   *
   * The counts are read from the device's own ledger rather than passed in by the screen, so the
   * evidence written to `audit_log` is the evidence that exists rather than a number a component
   * happened to be rendering.
   */
  const completeObservation = useMutation({
    mutationFn: async ({ filterRuleId, since }: { filterRuleId: string; since: number }) => {
      const counts = await RelayDeviceIngress.getNotificationSilenceCounts(
        tenantId as string,
        filterRuleId,
        since,
      );
      await completeDryRun(client as SupabaseClient, filterRuleId, counts);
    },
    onSuccess: refreshAll,
  });

  /**
   * Enables or withdraws a rule, optionally setting what it does in the same call.
   *
   * No dry run is required and the action can change in place (ADR-0021). Omitting `action` keeps
   * whatever is stored, so turning a rule off and on again cannot quietly turn a snooze into a
   * cancellation.
   *
   * Withdrawing takes the rule off the device before the database write. Enabling reaches the
   * device only through the refetch that follows a successful write.
   */
  const authorize = useMutation({
    mutationFn: async ({
      action,
      enabled: on,
      filterRuleId,
    }: {
      action?: NotificationSilenceAction;
      enabled: boolean;
      filterRuleId: string;
    }) => {
      if (!on) {
        const seriesId = statuses.find((status) => status.rule.id === filterRuleId)?.rule.seriesId;
        await withdrawThenSave(client as SupabaseClient, tenantId as string, seriesId, () =>
          setRuleDismissal(client as SupabaseClient, filterRuleId, false, action),
        );
        return;
      }
      await setRuleDismissal(client as SupabaseClient, filterRuleId, true, action);
      // Authorizing a rule that names an application grants that application's capture as part of
      // this same action, for a rule saved before ADR-0023 (a save already grants it going
      // forward). The device write follows the database write, per this file's own ordering rule
      // above.
      const named = namedApplications(statuses.filter((status) => status.rule.id === filterRuleId));
      await authorizeNamedApplications(tenantId, named);
    },
    onSuccess: refreshAll,
  });

  /**
   * The stop, device first.
   *
   * Engaging it reaches the native store before the network, so a person who loses signal
   * mid-action has still stopped the behaviour on the phone it affects. Releasing it goes in the same
   * order for symmetry; the native read combines both sources with `or`, so a failed database write
   * leaves the switch released locally and still engaged durably, which is the safe direction.
   */
  const stop = useMutation({
    mutationFn: async (engaged: boolean) => {
      await RelayDeviceIngress.setNotificationSilenceKillSwitch(tenantId as string, engaged);
      await setKillSwitch(client as SupabaseClient, engaged);
    },
    onSuccess: refreshAll,
  });

  const statuses = state.data?.plan.statuses ?? [];
  return {
    authorize: authorize.mutateAsync,
    authorizing: authorize.isPending,
    completeObservation: completeObservation.mutateAsync,
    completing: completeObservation.isPending,
    engageStop: stop.mutateAsync,
    isLoading: state.isFetching && state.data === undefined,
    killSwitchEngaged: state.data?.killSwitchEngaged ?? false,
    loadError: state.error ?? outcomes.error,
    minimumWindowHours: SILENCE_DRY_RUN_MINIMUM_HOURS,
    mode: state.data?.plan.snapshot.mode ?? "off",
    observe: observe.mutateAsync,
    observing: observe.isPending,
    outcomes: outcomes.data ?? [],
    refresh: refreshAll,
    reviewable: reviewableRules(statuses),
    statuses,
    stopError: stop.error,
    stopping: stop.isPending,
    writeError: observe.error ?? completeObservation.error ?? authorize.error,
  };
}
