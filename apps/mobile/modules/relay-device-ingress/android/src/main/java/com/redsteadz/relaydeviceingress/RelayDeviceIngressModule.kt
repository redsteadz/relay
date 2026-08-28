package com.redsteadz.relaydeviceingress

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import androidx.core.content.ContextCompat
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
      val smsGranted = ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.READ_SMS
      ) == PackageManager.PERMISSION_GRANTED
      val capture = captureSettings.read()

      mapOf(
        "notificationListener" to listenerEnabled,
        "notificationCapturePaused" to (capture?.paused ?: true),
        "notificationAllowedPackages" to (capture?.allowedPackages?.sorted() ?: emptyList<String>()),
        "smsRead" to smsGranted,
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

    AsyncFunction("enqueueCapture") { tenantId: String, envelopeId: String, capturedAt: Double, envelopeJson: String ->
      queue.enqueue(tenantId, envelopeId, capturedAt.toLong(), envelopeJson)
    }

    AsyncFunction("getReadyCaptures") { tenantId: String, now: Double ->
      queue.ready(tenantId, now.toLong())
    }

    AsyncFunction("acknowledgeCapture") { tenantId: String, envelopeId: String ->
      queue.acknowledge(tenantId, envelopeId)
    }

    AsyncFunction("failCapture") { tenantId: String, envelopeId: String, terminal: Boolean ->
      queue.fail(tenantId, envelopeId, terminal)
    }

    AsyncFunction("clearCaptureQueue") { tenantId: String ->
      queue.clearTenant(tenantId)
      NotificationCaptureSettings(requireNotNull(appContext.reactContext).applicationContext).clear(tenantId)
    }
  }
}
