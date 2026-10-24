package com.redsteadz.relaydeviceingress

import android.content.Context
import android.os.Build
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.ListenableWorker
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/** Runs the installed Expo delivery worker, subject to consent checks in its task body.
 * Android constraints, quotas and OEM restrictions still determine when execution is possible.
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

  /** Append a pass so an arrival after an active worker's queue snapshot is not dropped.
   * A failed or cancelled predecessor can be replaced. The periodic Expo chain remains independent.
   */
  fun request(context: Context, delayMillis: Long = 0) {
    val workerClass = worker
    if (workerClass == null) {
      NotificationDebugDiagnostics.event("immediate delivery unavailable: worker not found")
      return
    }
    try {
      val builder = OneTimeWorkRequest.Builder(workerClass)
        .setInputData(Data.Builder().putString("appScopeKey", context.packageName).build())
        .setConstraints(
          Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        )
      // Expo's worker has no foreground-info implementation for pre-Android 12 expedited work.
      if (delayMillis > 0) builder.setInitialDelay(delayMillis, TimeUnit.MILLISECONDS)
      if (delayMillis == 0L && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        builder.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
      }
      val request = builder.build()
      WorkManager.getInstance(context)
        .enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    } catch (error: RuntimeException) {
      NotificationDebugDiagnostics.failure("immediate delivery request failed", error)
    }
  }
}
