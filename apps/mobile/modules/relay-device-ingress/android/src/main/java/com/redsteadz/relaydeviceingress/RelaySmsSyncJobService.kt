package com.redsteadz.relaydeviceingress

import android.app.job.JobParameters
import android.app.job.JobService
import java.util.concurrent.Executors

class RelaySmsSyncJobService : JobService() {
  private val executor = Executors.newSingleThreadExecutor()

  override fun onStartJob(parameters: JobParameters): Boolean {
    val configuration = SmsCaptureSettings(applicationContext).read() ?: return false
    executor.execute {
      SmsInboxSynchronizer.sync(applicationContext, configuration.tenantId)
      jobFinished(parameters, false)
    }
    return true
  }

  override fun onStopJob(parameters: JobParameters): Boolean = true

  override fun onDestroy() {
    executor.shutdownNow()
    super.onDestroy()
  }
}
