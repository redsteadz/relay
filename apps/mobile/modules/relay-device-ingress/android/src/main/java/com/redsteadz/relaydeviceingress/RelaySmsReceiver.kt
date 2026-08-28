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
    if (!SmsPermissions.areDeclared(context) || !SmsPermissions.areGranted(context)) return
    val configuration = SmsCaptureSettings(context).read() ?: return
    if (configuration.paused) return

    val scheduler = context.getSystemService(JobScheduler::class.java)
    val job = JobInfo.Builder(
      SMS_SYNC_JOB_ID,
      ComponentName(context, RelaySmsSyncJobService::class.java)
    )
      .setMinimumLatency(1_000)
      .setOverrideDeadline(15_000)
      .build()
    scheduler.schedule(job)
  }

  private companion object {
    const val SMS_SYNC_JOB_ID = 0x524C5901
  }
}

