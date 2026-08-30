package com.redsteadz.relaydeviceingress

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Telephony

class RelaySmsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
    SmsDebugDiagnostics.event("receiver invoked")
    val permissionsDeclared = SmsPermissions.areDeclared(context)
    val permissionsGranted = SmsPermissions.areGranted(context)
    SmsDebugDiagnostics.event(
      "permissions declared=$permissionsDeclared runtimeGranted=$permissionsGranted"
    )
    if (!permissionsDeclared || !permissionsGranted) return

    val configuration = SmsCaptureSettings(context).read()
    SmsDebugDiagnostics.event("configuration found=${configuration != null}")
    if (configuration == null) return
    SmsDebugDiagnostics.event("capture paused=${configuration.paused}")
    if (configuration.paused) return

    val scheduler = context.getSystemService(JobScheduler::class.java)
    val job = JobInfo.Builder(
      SMS_SYNC_JOB_ID,
      ComponentName(context, RelaySmsSyncJobService::class.java)
    )
      .setMinimumLatency(1_000)
      .setOverrideDeadline(15_000)
      .build()
    val result = try {
      scheduler.schedule(job)
    } catch (error: RuntimeException) {
      SmsDebugDiagnostics.failure("job scheduling threw an exception", error)
      JobScheduler.RESULT_FAILURE
    }
    SmsDebugDiagnostics.event("job scheduling result=$result")
    if (result != JobScheduler.RESULT_SUCCESS) {
      SmsDebugDiagnostics.failure("job scheduling failed result=$result")
    }
  }

  private companion object {
    const val SMS_SYNC_JOB_ID = 0x524C5901
  }
}

