package com.redsteadz.relaydeviceingress

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import android.view.WindowManager
import androidx.core.content.ContextCompat
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale
import org.json.JSONException
import org.json.JSONObject

private fun JSONObject.stringValue(name: String): String? = opt(name) as? String

private fun notificationCapturePreview(row: Map<String, Any>): Map<String, Any>? {
  val envelopeJson = row["envelopeJson"] as? String ?: return null

  return try {
    val envelope = JSONObject(envelopeJson)
    val source = envelope.optJSONObject("source") ?: return null
    if (source.stringValue("kind") != "notification") return null
    val capturedAt = envelope.stringValue("capturedAt") ?: return null
    val preview = mutableMapOf<String, Any>("capturedAt" to capturedAt)

    envelope.stringValue("sender")?.let { preview["sender"] = it }
    envelope.stringValue("subject")?.let { preview["subject"] = it }
    envelope.stringValue("body")?.let { preview["body"] = it }
    source.stringValue("applicationId")?.let { preview["applicationId"] = it }
    preview
  } catch (_: JSONException) {
    null
  }
}

private fun requirePreparedCaptureTenant(tenantId: String, generation: Double) {
  check(
    NotificationCaptureStateLock.preparedTenantId == tenantId &&
      NotificationCaptureStateLock.latestPreparationGeneration == generation.toLong()
  ) { "capture_tenant_not_prepared" }
}

class RelayDeviceIngressModule : Module() {
  private fun setNotificationCapturePreviewSecure(enabled: Boolean) {
    val activity = appContext.currentActivity
    require(activity != null || !enabled) { "activity_unavailable" }
    val window = activity?.window ?: return
    if (enabled) {
      window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    } else {
      window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }
  }

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

    AsyncFunction("getSelectableNotificationApps") {
      val context = requireNotNull(appContext.reactContext).applicationContext
      val packageManager = context.packageManager
      val launcherIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
      val appsByPackage = mutableMapOf<String, String>()

      packageManager.queryIntentActivities(launcherIntent, 0).forEach { resolvedActivity ->
        val applicationInfo = resolvedActivity.activityInfo?.applicationInfo ?: return@forEach
        val packageName = applicationInfo.packageName
        if (packageName == context.packageName || appsByPackage.containsKey(packageName)) {
          return@forEach
        }
        val label = packageManager.getApplicationLabel(applicationInfo).toString().trim()
        appsByPackage[packageName] = label.ifBlank { packageName }
      }

      appsByPackage.map { (packageName, label) ->
        mapOf("label" to label, "packageName" to packageName)
      }.sortedWith(
        compareBy<Map<String, String>>(
          { it.getValue("label").lowercase(Locale.ROOT) },
          { it.getValue("packageName").lowercase(Locale.ROOT) },
          { it.getValue("packageName") }
        )
      )
    }

    AsyncFunction("openNotificationAccessSettings") {
      val activity = requireNotNull(appContext.currentActivity)
      activity.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
    }

    AsyncFunction("configureNotificationCapture") {
      tenantId: String, allowedPackages: List<String>, paused: Boolean, generation: Double ->
      val context = requireNotNull(appContext.reactContext).applicationContext
      val normalized = allowedPackages.map { it.trim() }.filter { it.isNotBlank() }.toSet()
      require(context.packageName !in normalized) { "relay_package_not_allowed" }
      synchronized(NotificationCaptureStateLock) {
        requirePreparedCaptureTenant(tenantId, generation)
        NotificationCaptureSettings(context).write(tenantId, normalized, paused)
      }
    }

    AsyncFunction("prepareNotificationCaptureState") {
      tenantId: String?, cleanupTenantId: String?, generation: Double ->
      require(tenantId == null || tenantId.isNotBlank()) { "tenant_required" }
      require(cleanupTenantId == null || cleanupTenantId.isNotBlank()) { "cleanup_tenant_required" }
      require(generation.isFinite() && generation >= 0) { "generation_invalid" }
      synchronized(NotificationCaptureStateLock) {
        val preparationGeneration = generation.toLong()
        if (preparationGeneration < NotificationCaptureStateLock.latestPreparationGeneration) {
          return@synchronized
        }
        NotificationCaptureStateLock.latestPreparationGeneration = preparationGeneration
        val settings = NotificationCaptureSettings(
          requireNotNull(appContext.reactContext).applicationContext
        )

        if (cleanupTenantId != null) {
          queue.clearTenant(cleanupTenantId)
          settings.clear(cleanupTenantId)
        }
        val currentTenantId = settings.read()?.tenantId
        if (currentTenantId != null && currentTenantId != tenantId) {
          queue.clearTenant(currentTenantId)
          settings.clear(currentTenantId)
        }
        NotificationCaptureStateLock.preparedTenantId = tenantId
      }
    }

    AsyncFunction("enqueueCapture") {
      tenantId: String, envelopeId: String, capturedAt: Double, envelopeJson: String, generation: Double ->
      synchronized(NotificationCaptureStateLock) {
        requirePreparedCaptureTenant(tenantId, generation)
        queue.enqueue(tenantId, envelopeId, capturedAt.toLong(), envelopeJson)
      }
    }

    AsyncFunction("getReadyCaptures") { tenantId: String, now: Double, generation: Double ->
      synchronized(NotificationCaptureStateLock) {
        requirePreparedCaptureTenant(tenantId, generation)
        queue.ready(tenantId, now.toLong())
      }
    }

    AsyncFunction("getNotificationCapturePreviews") {
      tenantId: String, now: Double, generation: Double ->
      synchronized(NotificationCaptureStateLock) {
        requirePreparedCaptureTenant(tenantId, generation)
        queue.ready(tenantId, now.toLong()).mapNotNull(::notificationCapturePreview)
      }
    }

    AsyncFunction("setNotificationCapturePreviewSecure") { enabled: Boolean ->
      setNotificationCapturePreviewSecure(enabled)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("acknowledgeCapture") {
      tenantId: String, envelopeId: String, generation: Double ->
      synchronized(NotificationCaptureStateLock) {
        requirePreparedCaptureTenant(tenantId, generation)
        queue.acknowledge(tenantId, envelopeId)
      }
    }

    AsyncFunction("failCapture") {
      tenantId: String, envelopeId: String, terminal: Boolean, generation: Double ->
      synchronized(NotificationCaptureStateLock) {
        requirePreparedCaptureTenant(tenantId, generation)
        queue.fail(tenantId, envelopeId, terminal)
      }
    }

    AsyncFunction("clearCaptureQueue") { tenantId: String, generation: Double ->
      synchronized(NotificationCaptureStateLock) {
        requirePreparedCaptureTenant(tenantId, generation)
        queue.clearTenant(tenantId)
        NotificationCaptureSettings(requireNotNull(appContext.reactContext).applicationContext).clear(tenantId)
        if (NotificationCaptureStateLock.preparedTenantId == tenantId) {
          NotificationCaptureStateLock.preparedTenantId = null
        }
      }
    }

    OnDestroy {
      appContext.currentActivity?.runOnUiThread {
        setNotificationCapturePreviewSecure(false)
      }
    }
  }
}
