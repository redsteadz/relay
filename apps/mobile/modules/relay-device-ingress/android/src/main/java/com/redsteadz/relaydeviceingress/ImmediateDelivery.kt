package com.redsteadz.relaydeviceingress

import android.content.Context
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.ListenableWorker
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager

/**
 * Asks for a delivery pass now, rather than when the periodic one comes round.
 *
 * Capture was always immediate; delivery waited. With the app open an event tells the running
 * runtime to sync, and with the app closed there was nothing to tell -- so a capture sat in the
 * queue for up to fifteen minutes with the listener that took it still running beside it.
 *
 * This runs the **same worker** `expo-background-task` already registers, with no delay and
 * expedited priority. That matters: it is not a second headless path to keep in step with the first,
 * it is the existing one asked to run sooner. `BackgroundTaskWork` reads `appScopeKey` and hands off
 * to the task registry, which is where `runBackgroundCaptureSync` already lives.
 *
 * **A foreground service was considered and is not this.** A service keeps a process alive; it does
 * not start a JavaScript runtime, and delivery needs one. The permanent notification would have
 * bought nothing that this does not, and on Android 15 a `dataSync` service is capped at six hours
 * in twenty-four besides.
 *
 * What this does not beat is deep Doze. Expedited work is not exempt from it, so a phone that has
 * been stationary and dark for hours still batches to a maintenance window. Screen on or recently
 * used -- which is when a reader could notice -- it runs in seconds.
 */
internal object ImmediateDelivery {
  /**
   * Its own unique name, kept away from `EXPO_BACKGROUND_WORKER`.
   *
   * Enqueuing under that name would either cancel the periodic chain or append behind its delay,
   * and both would make this slower than doing nothing.
   */
  private const val WORK_NAME = "relay-immediate-capture-delivery"

  /**
   * `expo-background-task`'s worker, resolved by name.
   *
   * It has no Gradle project of its own -- autolinking folds it into `:expo`, and depending on that
   * from here risks a cycle, since the app links this module into the same graph. So the class is
   * looked up rather than imported.
   *
   * That turns a coupling that would have been a build failure into one that degrades: if a future
   * version renames or moves the worker, this resolves to null, nothing is enqueued, and delivery
   * falls back to the periodic task that is scheduled anyway. Fifteen minutes instead of seconds,
   * rather than a crash or a build that will not produce an APK.
   */
  private val worker: Class<out ListenableWorker>? by lazy {
    try {
      @Suppress("UNCHECKED_CAST")
      Class.forName("expo.modules.backgroundtask.BackgroundTaskWork") as Class<out ListenableWorker>
    } catch (_: ClassNotFoundException) {
      null
    } catch (_: ClassCastException) {
      null
    }
  }

  /**
   * Requests a pass, coalescing by construction.
   *
   * `KEEP` is what turns a burst of notifications into one delivery: a request made while another
   * is queued or running is dropped, because that one has not read the queue yet and will take
   * everything in it.
   *
   * Never throws. The periodic task is still scheduled underneath, so a failure here costs the
   * immediacy and not the delivery -- which is also what happens if a future `expo-background-task`
   * moves the worker this reaches for.
   */
  fun request(context: Context) {
    val workerClass = worker
    if (workerClass == null) {
      NotificationDebugDiagnostics.event("immediate delivery unavailable: worker not found")
      return
    }
    try {
      val request = OneTimeWorkRequest.Builder(workerClass)
        .setInputData(Data.Builder().putString("appScopeKey", context.packageName).build())
        .setConstraints(
          Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        )
        // Falls back to ordinary work rather than failing when the expedited quota is spent, which
        // is the difference between a late delivery and none.
        .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
        .build()
      WorkManager.getInstance(context)
        .enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.KEEP, request)
    } catch (error: RuntimeException) {
      NotificationDebugDiagnostics.failure("immediate delivery request failed", error)
    }
  }
}
