/**
 * The one way the device's quiet rules change.
 *
 * The notification listener acts on a snapshot cached on the device, not on the database, because
 * it runs with the app dead. Every path that changes what a rule may do -- pausing or editing it in
 * Rules, switching it off or on in Quiet, a change made on another device -- has to land here, or
 * the phone keeps acting on a rule the person has already stopped. Pausing in Rules once skipped it,
 * and a paused "clear" rule went on deleting notifications until someone opened Quiet (issue 251).
 *
 * The order depends on the direction. Granting goes database first, then device, so a failed write
 * leaves the phone holding less authorization than the database rather than more. Withdrawing goes
 * device first, for the same reason, and the kill switch has always done the same.
 *
 * Publishes run one at a time. A publish reads the database and then writes the device, and one that
 * read before a withdrawal was saved must not land after the withdrawal and put the rule back. So a
 * withdrawal holds the queue from its device write until the database has its change, and every
 * other publish waits for it.
 *
 * Issue 196 moves authorization onto the phone; it should only need to change where `publish`
 * reads from.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { AppState } from "react-native";

import { compileSilencePlan, type SilencePlan } from "@/lib/notification-silence";
import { runInBackground } from "@/lib/observability";
import RelayDeviceIngress from "@/modules/relay-device-ingress";

import { listSilenceAuthorizations, readDismissalSettings } from "./silence";

export type SilenceState = {
  killSwitchEngaged: boolean;
  plan: SilencePlan;
};

let queue: Promise<unknown> = Promise.resolve();

/**
 * Runs `work` after every earlier publish has settled.
 *
 * The queue waits for each one to settle rather than succeed: a failed publish still rejects to its
 * own caller, and must not stall the ones behind it. `work` must not itself call back into this
 * module, or it would wait on itself.
 */
function exclusively<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work);
  queue = Promise.allSettled([run]);
  return run;
}

/**
 * Reads what the database authorized and leaves the matching snapshot on the device.
 *
 * `withdrawing` leaves a series out whatever the database says, for the moment between the device
 * letting go of a rule and the database recording it.
 *
 * `revision` is the moment this snapshot was compiled. It has to be monotonic, and it cannot be
 * derived from the rules: withdrawing the last authorized rule would lower it, and the native store
 * would then refuse the very write that was meant to clear the authorization. Publishes are
 * serialized, so publish time orders them.
 */
async function publish(
  client: SupabaseClient,
  tenantId: string,
  withdrawing?: string,
): Promise<SilenceState> {
  const [rules, killSwitchEngaged] = await Promise.all([
    listSilenceAuthorizations(client),
    readDismissalSettings(client),
  ]);
  const kept =
    withdrawing === undefined ? rules : rules.filter((rule) => rule.seriesId !== withdrawing);

  const plan = compileSilencePlan(kept, { killSwitchEngaged, revision: Date.now() });
  await RelayDeviceIngress.configureNotificationSilence(tenantId, plan.snapshot);
  return { killSwitchEngaged, plan };
}

/** Brings the device in line with the database, and returns what it published. */
export function publishSilenceSnapshot(
  client: SupabaseClient,
  tenantId: string,
): Promise<SilenceState> {
  return exclusively(() => publish(client, tenantId));
}

/**
 * Takes a rule off the device, then makes the change that withdraws it in the database.
 *
 * For any change that can only reduce what a rule may do: pausing it, editing it (a new revision
 * carries no authorization), or switching its quiet action off. `seriesId` is undefined for a rule
 * that does not exist yet, which has nothing on the device to withdraw.
 *
 * If `save` fails, the device is left without the rule while the database still authorizes it. That
 * is the safe direction, and the next publish restores it.
 */
export function withdrawThenSave<T>(
  client: SupabaseClient,
  tenantId: string,
  seriesId: string | undefined,
  save: () => Promise<T>,
): Promise<T> {
  return exclusively(async () => {
    if (seriesId !== undefined) await publish(client, tenantId, seriesId);
    return save();
  });
}

/**
 * Publishes now and each time the app comes to the foreground, until the returned function is
 * called.
 *
 * A rule paused on another device stops acting here the next time this phone opens Relay, without
 * anyone opening Quiet. It does not reach a phone that never opens the app; the listener keeps the
 * last snapshot it was given.
 */
export function publishSilenceOnForeground(client: SupabaseClient, tenantId: string): () => void {
  const sync = () =>
    runInBackground(publishSilenceSnapshot(client, tenantId), "silence.publish_failed", {
      code: "SILENCE_PUBLISH_FAILED",
      integration: "relay-device-ingress",
      operation: "publishSilenceSnapshot",
    });
  sync();
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active") sync();
  });
  return () => subscription.remove();
}
