/**
 * Delivering captures without the app being opened.
 *
 * Capture already survived a closed app: `RelayNotificationListenerService` is bound by the system,
 * so the encrypted queue fills whether or not Relay is running. Delivery did not. `syncDeviceCaptures`
 * ran on mount and on `AppState` becoming `active` and nothing else, so a capture waited in the queue
 * for an unrelated event -- the person happening to open Relay -- and the queue expires items seven
 * days after capture. A reader who did not open the app for a week lost them, having done nothing
 * wrong and been told nothing.
 *
 * This runs the existing sync from a WorkManager-backed headless task, so there is one upload path
 * and the background run is the foreground run with a different trigger. See
 * [ADR-0018](../../../docs/decisions/0018-background-capture-delivery.md).
 *
 * Two things this deliberately does not do. It does not promise immediacy: WorkManager's floor is a
 * fifteen-minute inexact interval and Doze stretches it further, so the UI says a capture arrives
 * without the app being opened rather than that it arrives now. And it does not run unless the
 * reader turned it on -- consent to notification access covers capture, and a fair reading covers
 * delivery, but a fair reading is not the standard this asks a person to rely on.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

import { demoModeEnabled } from "./demo/mode";
import { logMobileError } from "./observability";
import { createConfiguredClient } from "./auth-configuration";
import { syncDeviceCaptures } from "./device-capture-sync";

export const BACKGROUND_CAPTURE_SYNC_TASK = "relay.background-capture-sync";

const BACKGROUND_SYNC_FLAG_KEY = "relay.background-capture-sync.enabled";

/**
 * The shortest interval WorkManager honours.
 *
 * Asking for less does not produce less; it produces the same fifteen minutes with a request that
 * misrepresents what the platform agreed to.
 */
export const BACKGROUND_SYNC_MINIMUM_INTERVAL_MINUTES = 15;

/** Why a background run did nothing, for the one log line it is allowed to write. */
type BackgroundSyncOutcome = "delivered" | "no-session" | "unsupported";

/** Whether this runtime has a background executor at all. */
export function backgroundSyncSupported(): boolean {
  return Platform.OS === "android" && !demoModeEnabled();
}

export async function backgroundSyncEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(BACKGROUND_SYNC_FLAG_KEY)) === "enabled";
  } catch {
    // An unreadable preference is not consent. Nothing is scheduled and the screen shows the
    // control as off, which the reader can correct in one tap.
    return false;
  }
}

/**
 * Runs one delivery pass.
 *
 * Reads the session from storage rather than from React state, because there is no React here. A
 * signed-out phone having nothing to upload is the expected state rather than an incident, so it is
 * recorded and the run stops; it does not retry, and it does not report a failure that would put a
 * reader's attention on something that is working correctly.
 */
export async function runBackgroundCaptureSync(): Promise<BackgroundSyncOutcome> {
  if (!backgroundSyncSupported()) return "unsupported";

  // Its own client, because there is no provider tree here to take one from. Safe in this context:
  // the app is not in the foreground, so its auto-refresh controller is not also rotating the
  // refresh token, and a refresh that fails anyway leaves no session -- which this records and
  // treats as the ordinary signed-out case rather than an incident.
  const client = createConfiguredClient();
  if (client === undefined) return "unsupported";
  const { data, error } = await client.auth.getSession();
  if (error !== null) throw error;
  const session = data.session;
  if (session === null) return "no-session";

  await syncDeviceCaptures(session);
  return "delivered";
}

/**
 * Registers the task body once, at module load.
 *
 * `defineTask` has to run during the headless launch too, which is why it is at module scope rather
 * than inside a hook: the background executor imports this module and starts the task immediately,
 * with no component tree to mount first.
 *
 * Every exit is logged. A foreground failure has a person present to notice nothing happened; a
 * background one does not, which makes silence here strictly worse than silence there.
 */
TaskManager.defineTask(BACKGROUND_CAPTURE_SYNC_TASK, async () => {
  const startedAt = Date.now();
  try {
    const outcome = await runBackgroundCaptureSync();
    // A run that found no session is not a failure, but it is the explanation for an inbox that
    // stopped filling, so it is still recorded.
    if (outcome !== "delivered") {
      logMobileError(
        "background.capture_sync_skipped",
        new Error(`Background capture sync skipped: ${outcome}`),
        {
          code: "BACKGROUND_CAPTURE_SYNC_SKIPPED",
          integration: "relay-device-ingress",
          metadata: { outcome },
          operation: "runBackgroundCaptureSync",
          startedAt,
        },
      );
    }
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error: unknown) {
    logMobileError("background.capture_sync_failed", error, {
      code: "BACKGROUND_CAPTURE_SYNC_FAILED",
      integration: "relay-device-ingress",
      operation: "runBackgroundCaptureSync",
      startedAt,
    });
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/**
 * Brings the scheduled work in line with the reader's choice.
 *
 * Turning it off unregisters rather than leaving the task registered and short-circuiting, so a
 * reader who declines has no background work scheduled at all rather than work that wakes up to
 * decide it should not have.
 */
export async function syncBackgroundTaskRegistration(enabled: boolean): Promise<void> {
  if (!backgroundSyncSupported()) return;

  const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_CAPTURE_SYNC_TASK);
  if (!enabled) {
    if (registered) await BackgroundTask.unregisterTaskAsync(BACKGROUND_CAPTURE_SYNC_TASK);
    return;
  }

  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) {
    // The person has restricted background work for Relay in system settings. That is their answer,
    // and re-registering would not change it.
    throw new Error("background_task_restricted");
  }
  if (registered) return;
  await BackgroundTask.registerTaskAsync(BACKGROUND_CAPTURE_SYNC_TASK, {
    minimumInterval: BACKGROUND_SYNC_MINIMUM_INTERVAL_MINUTES,
  });
}

/** Records the choice and applies it in one step, so the two cannot disagree. */
export async function setBackgroundSyncEnabled(enabled: boolean): Promise<void> {
  await syncBackgroundTaskRegistration(enabled);
  await AsyncStorage.setItem(BACKGROUND_SYNC_FLAG_KEY, enabled ? "enabled" : "disabled");
}

/**
 * Re-applies the stored choice at startup.
 *
 * Registration is persistent, but a reinstall, a restore to a new device, or a system that dropped
 * the work leaves the flag saying one thing and the scheduler another. Reconciling on launch means
 * the control a person last used is the one in force.
 */
export async function restoreBackgroundSyncRegistration(): Promise<void> {
  if (!backgroundSyncSupported()) return;
  await syncBackgroundTaskRegistration(await backgroundSyncEnabled());
}
