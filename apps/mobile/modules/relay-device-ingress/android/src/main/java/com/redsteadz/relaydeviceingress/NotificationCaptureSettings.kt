package com.redsteadz.relaydeviceingress

import android.content.Context
import android.content.ComponentName
import android.provider.Settings

internal data class NotificationCaptureConfiguration(
  val tenantId: String,
  val allowedPackages: Set<String>,
  val paused: Boolean
)

internal class NotificationCaptureSettings(context: Context) {
  private val applicationContext = context.applicationContext
  private val preferences = applicationContext.getSharedPreferences("relay-notification-capture", Context.MODE_PRIVATE)

  fun listenerAccessGranted(): Boolean = Settings.Secure.getString(
    applicationContext.contentResolver,
    "enabled_notification_listeners"
  ).orEmpty().split(":").mapNotNull(ComponentName::unflattenFromString)
    .any { it.packageName == applicationContext.packageName }

  fun read(): NotificationCaptureConfiguration? {
    val tenantId = preferences.getString("tenant_id", null) ?: return null
    return NotificationCaptureConfiguration(
      tenantId,
      preferences.getStringSet("allowed_packages", emptySet()).orEmpty(),
      preferences.getBoolean("paused", true)
    )
  }

  fun write(tenantId: String, allowedPackages: Set<String>, paused: Boolean) {
    require(tenantId.isNotBlank()) { "tenant_required" }
    preferences.edit()
      .putString("tenant_id", tenantId)
      .putStringSet("allowed_packages", allowedPackages)
      .putBoolean("paused", paused)
      .commit()
  }

  fun clear(tenantId: String) {
    if (preferences.getString("tenant_id", null) == tenantId) preferences.edit().clear().commit()
  }
}
