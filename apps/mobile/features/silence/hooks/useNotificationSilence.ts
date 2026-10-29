/**
 * The quiet controls, as one hook.
 *
 * Every change here has to land in two places that cannot be updated atomically: the database, which
 * is the authority on what a rule may do, and the device snapshot, which is what the notification
 * assistant reads while the app is dead. The order is always database first, then device, so a failed
 * write leaves the device holding *less* authorization than the database granted rather than more.
 *
 * The one exception is the kill switch, which goes to the device first. A person reaching for a stop
 * is stopping the behaviour now, and making that wait on the network would be the wrong trade in the
 * one case where it matters most.
 */

import type { NotificationSilenceAction } from "@relay/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import RelayDeviceIngress, { SILENCE_OUTCOME_LIMIT } from "@/modules/relay-device-ingress";
import { compileSilencePlan, reviewableRules, type SilencePlan } from "@/lib/notification-silence";
import { reportUnexpectedUiError } from "@/lib/observability";
import type { QuietChoice } from "../models/silencePresentation";
import {
  completeDryRun,
  listSilenceAuthorizations,
  readDismissalSettings,
  setKillSwitch,
  setRuleDismissal,
  startDryRun,
  SILENCE_DRY_RUN_MINIMUM_HOURS,
} from "../api/silence";

export const silenceQueryKeys = {
  outcomes: (userId: string | undefined) => ["notification-silence", userId, "outcomes"] as const,
  state: (userId: string | undefined) => ["notification-silence", userId, "state"] as const,
};

type SilenceState = {
  killSwitchEngaged: boolean;
  plan: SilencePlan;
};

/**
 * Reads the authorization and leaves a matching snapshot on the device.
 *
 * Publishing on read rather than only on write is deliberate. Authorization can change on another
 * device, and a rule the tenant withdrew there must stop acting here without waiting for someone to
 * open the screen that changed it.
 *
 * `revision` is the moment this snapshot was compiled. It has to be monotonic, and it cannot be
 * derived from the rules: withdrawing the last authorized rule would lower it, and the native store
 * would then refuse the very write that was meant to clear the authorization. The snapshot is
 * device-local, so the race being guarded is two publishes on this device -- a refetch landing after
 * a newer one -- and publish time orders those correctly.
 */
async function loadSilenceState(client: SupabaseClient, tenantId: string): Promise<SilenceState> {
  const [rules, killSwitchEngaged] = await Promise.all([
    listSilenceAuthorizations(client),
    readDismissalSettings(client),
  ]);

  const plan = compileSilencePlan(rules, { killSwitchEngaged, revision: Date.now() });
  await RelayDeviceIngress.configureNotificationSilence(tenantId, plan.snapshot);
  return { killSwitchEngaged, plan };
}

export function useNotificationSilence(
  client: SupabaseClient | undefined,
  tenantId: string | undefined,
) {
  const queryClient = useQueryClient();
  const enabled = client !== undefined && tenantId !== undefined;

  const state = useQuery({
    enabled,
    queryFn: () => loadSilenceState(client as SupabaseClient, tenantId as string),
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
   */
  const authorize = useMutation({
    mutationFn: ({
      action,
      enabled: on,
      filterRuleId,
    }: {
      action?: NotificationSilenceAction;
      enabled: boolean;
      filterRuleId: string;
    }) => setRuleDismissal(client as SupabaseClient, filterRuleId, on, action),
    onSuccess: refreshAll,
  });

  /**
   * Sets what one revision does to a matching notification, from the choice the editor offers.
   *
   * One mutation rather than three, because the editor has one control. `observe` opens a window;
   * `snooze` and `dismiss` authorize directly with that action (ADR-0021); `none` withdraws. A window
   * that was open when the reader chose to act is closed first so its counts land in the audit
   * record -- the evidence is a record, not a gate, so a window too young for the server to close
   * is reported and does not stop the enable.
   */
  const applyChoice = useMutation({
    mutationFn: async ({
      choice,
      filterRuleId,
      observingSince,
    }: {
      choice: QuietChoice;
      filterRuleId: string;
      /** When the revision's observation window opened, if one is open. */
      observingSince?: string | undefined;
    }) => {
      const database = client as SupabaseClient;
      if (choice === "observe") {
        await startDryRun(database, filterRuleId, "snooze");
        return;
      }
      if (choice === "none") {
        await setRuleDismissal(database, filterRuleId, false);
        return;
      }
      if (observingSince !== undefined) {
        try {
          const counts = await RelayDeviceIngress.getNotificationSilenceCounts(
            tenantId as string,
            filterRuleId,
            Date.parse(observingSince),
          );
          await completeDryRun(database, filterRuleId, counts);
        } catch (cause: unknown) {
          reportUnexpectedUiError(cause, "ui.silence_observation_not_recorded", {
            code: "SILENCE_OBSERVATION_NOT_RECORDED",
            integration: "supabase-postgrest",
            operation: "completeDryRun",
          });
        }
      }
      await setRuleDismissal(database, filterRuleId, true, choice);
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
    applyChoice: applyChoice.mutateAsync,
    applying: applyChoice.isPending,
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
    /** Where the newest revision of one series stands, which is the only revision that can act. */
    statusForSeries: (seriesId: string) =>
      statuses.find((status) => status.rule.seriesId === seriesId),
    statuses,
    stopError: stop.error,
    stopping: stop.isPending,
    writeError: observe.error ?? completeObservation.error ?? authorize.error ?? applyChoice.error,
  };
}
