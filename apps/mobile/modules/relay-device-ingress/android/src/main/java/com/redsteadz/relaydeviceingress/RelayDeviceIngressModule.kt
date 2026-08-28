package com.redsteadz.relaydeviceingress

import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class RelayDeviceIngressModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RelayDeviceIngress")

    val queue by lazy {
      CaptureQueueStore(requireNotNull(appContext.reactContext).applicationContext)
    }

    AsyncFunction("getCapabilities") {
      val context = requireNotNull(appContext.reactContext)
      val captureSettings = NotificationCaptureSettings(context.applicationContext)
      val listenerEnabled = captureSettings.listenerAccessGranted()
      val capture = captureSettings.read()
      val smsSettings = SmsCaptureSettings(context.applicationContext)
      val smsAvailable = SmsPermissions.areDeclared(context)
      val smsGranted = smsAvailable && SmsPermissions.areGranted(context)
      if (!smsGranted) smsSettings.pauseForPermissionLoss()
      val smsCapture = smsSettings.read()
      val smsQueuedCount = smsCapture?.let { queue.count(it.tenantId, "sms") } ?: 0

      mapOf(
        "notificationListener" to listenerEnabled,
        "notificationCapturePaused" to (capture?.paused ?: true),
        "notificationAllowedPackages" to (capture?.allowedPackages?.sorted() ?: emptyList<String>()),
        "smsAvailable" to smsAvailable,
        "smsPermissionGranted" to smsGranted,
        "smsCapturePaused" to (smsCapture?.paused ?: true),
        "smsAllowedSenders" to (smsCapture?.allowedSenders?.sorted() ?: emptyList<String>()),
        "smsQueuedCount" to smsQueuedCount,
        "platform" to "android"
      )
    }

    AsyncFunction("openNotificationAccessSettings") {
      val activity = requireNotNull(appContext.currentActivity)
      activity.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
    }

    AsyncFunction("configureNotificationCapture") { tenantId: String, allowedPackages: List<String>, paused: Boolean ->
      val context = requireNotNull(appContext.reactContext).applicationContext
      val normalized = allowedPackages.map { it.trim() }.filter { it.isNotBlank() }.toSet()
      require(context.packageName !in normalized) { "relay_package_not_allowed" }
      NotificationCaptureSettings(context).write(tenantId, normalized, paused)
    }

    AsyncFunction("configureSmsCapture") { tenantId: String, allowedSenders: List<String>, paused: Boolean ->
      val context = requireNotNull(appContext.reactContext).applicationContext
      require(SmsPermissions.areDeclared(context)) { "sms_not_available" }
      SmsCaptureSettings(context).write(tenantId, allowedSenders.toSet(), paused)
    }

    AsyncFunction("syncSmsInbox") { tenantId: String ->
      SmsInboxSynchronizer.sync(
        requireNotNull(appContext.reactContext).applicationContext,
        tenantId
      )
    }

    AsyncFunction("deleteQueuedSms") { tenantId: String ->
      queue.deleteBySource(tenantId, "sms")
    }

    AsyncFunction("enqueueCapture") { tenantId: String, envelopeId: String, sourceKind: String, capturedAt: Double, envelopeJson: String ->
      queue.enqueue(tenantId, envelopeId, sourceKind, capturedAt.toLong(), envelopeJson)
    }

    AsyncFunction("getReadyCaptures") { tenantId: String, now: Double ->
      val context = requireNotNull(appContext.reactContext).applicationContext
      queue.ready(tenantId, now.toLong(), SmsPermissions.areDeclared(context))
    }

    AsyncFunction("acknowledgeCapture") { tenantId: String, envelopeId: String ->
      queue.acknowledge(tenantId, envelopeId)
    }

    AsyncFunction("failCapture") { tenantId: String, envelopeId: String, terminal: Boolean ->
      queue.fail(tenantId, envelopeId, terminal)
    }

    AsyncFunction("clearCaptureQueue") { tenantId: String ->
      queue.clearTenant(tenantId)
      val context = requireNotNull(appContext.reactContext).applicationContext
      NotificationCaptureSettings(context).clear(tenantId)
      SmsCaptureSettings(context).clear(tenantId)
    }
  }
}
