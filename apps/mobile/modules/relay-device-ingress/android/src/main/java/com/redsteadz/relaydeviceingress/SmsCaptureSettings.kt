package com.redsteadz.relaydeviceingress

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import java.util.UUID

internal data class SmsCaptureConfiguration(
  val tenantId: String,
  val allowedSenders: Set<String>,
  val paused: Boolean,
  val lastProviderId: Long,
  val sourceAccountId: String
)

internal object SmsPermissions {
  private val required = arrayOf(Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS)

  fun areDeclared(context: Context): Boolean {
    @Suppress("DEPRECATION")
    val requested = context.packageManager.getPackageInfo(
      context.packageName,
      PackageManager.GET_PERMISSIONS
    ).requestedPermissions.orEmpty().toSet()
    return required.all(requested::contains)
  }

  fun areGranted(context: Context): Boolean = required.all {
    ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
  }
}

internal class SmsCaptureSettings(context: Context) {
  private val applicationContext = context.applicationContext
  private val preferences = applicationContext.getSharedPreferences(
    "relay-sms-capture",
    Context.MODE_PRIVATE
  )
  private val identityPreferences = applicationContext.getSharedPreferences(
    "relay-sms-identity",
    Context.MODE_PRIVATE
  )

  fun read(): SmsCaptureConfiguration? {
    val tenantId = preferences.getString("tenant_id", null) ?: return null
    return SmsCaptureConfiguration(
      tenantId = tenantId,
      allowedSenders = preferences.getStringSet("allowed_senders", emptySet()).orEmpty(),
      paused = preferences.getBoolean("paused", true),
      lastProviderId = preferences.getLong("last_provider_id", 0),
      sourceAccountId = sourceAccountId()
    )
  }

  fun write(tenantId: String, allowedSenders: Set<String>, paused: Boolean) {
    require(tenantId.isNotBlank()) { "tenant_required" }
    require(allowedSenders.isNotEmpty()) { "sms_sender_required" }
    val normalized = allowedSenders.map(SmsSender::normalize).filter(String::isNotBlank).toSet()
    require(normalized.isNotEmpty()) { "sms_sender_required" }
    val currentTenant = preferences.getString("tenant_id", null)
    val lastProviderId = if (currentTenant == tenantId) {
      preferences.getLong("last_provider_id", 0)
    } else {
      0
    }
    preferences.edit()
      .putString("tenant_id", tenantId)
      .putStringSet("allowed_senders", normalized)
      .putBoolean("paused", paused)
      .putLong("last_provider_id", lastProviderId)
      .commit()
  }

  fun pauseForPermissionLoss() {
    if (preferences.contains("tenant_id")) preferences.edit().putBoolean("paused", true).commit()
  }

  fun updateLastProviderId(tenantId: String, providerId: Long) {
    if (preferences.getString("tenant_id", null) != tenantId) return
    val current = preferences.getLong("last_provider_id", 0)
    if (providerId > current) preferences.edit().putLong("last_provider_id", providerId).commit()
  }

  fun clear(tenantId: String) {
    if (preferences.getString("tenant_id", null) == tenantId) preferences.edit().clear().commit()
  }

  private fun sourceAccountId(): String {
    val stored = identityPreferences.getString("source_account_id", null)
    if (stored != null) return stored
    val created = UUID.randomUUID().toString()
    identityPreferences.edit().putString("source_account_id", created).commit()
    return created
  }
}

