package com.redsteadz.relaydeviceingress

import android.app.job.JobParameters
import android.app.job.JobService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

class RelaySmsSyncJobService : JobService() {
  private val executor = Executors.newSingleThreadExecutor()

  override fun onStartJob(parameters: JobParameters): Boolean {
    val configuration = SmsCaptureSettings(applicationContext).read()
    if (configuration == null) {
      SmsDebugDiagnostics.event("sync job skipped configuration found=false")
      return false
    }
    return try {
      executor.execute {
        var wantsReschedule = false
        try {
          SmsInboxSynchronizer.sync(applicationContext, configuration.tenantId)
        } catch (error: Exception) {
          wantsReschedule = true
          SmsDebugDiagnostics.failure("sync job failed", error)
        } finally {
          jobFinished(parameters, wantsReschedule)
        }
      }
      true
    } catch (error: RejectedExecutionException) {
      SmsDebugDiagnostics.failure("sync job executor rejected work", error)
      false
    }
  }

  override fun onStopJob(parameters: JobParameters): Boolean = true

  override fun onDestroy() {
    executor.shutdownNow()
    super.onDestroy()
  }
}
