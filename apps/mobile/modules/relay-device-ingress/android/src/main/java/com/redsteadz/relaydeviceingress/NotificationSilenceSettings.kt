package com.redsteadz.relaydeviceingress

import android.content.Context

/**
 * The authorization the listener acts on, as the app last wrote it.
 *
 * `RelayNotificationListenerService` runs with the app dead and no session, so it cannot ask the
 * database whether a rule may clear a notification. The app asks on its behalf -- after
 * `set_notification_dismissal_v1` has validated the plan shape, the explicit application predicate,
 * and the completed dry run -- and leaves the answer here. This is a cache of a decision, never the
 * decision itself.
 *
 * The kill switch is stored apart from the snapshot rather than inside it. A person reaching for it
 * is stopping the behaviour now, and that must not wait on recompiling rules or on the network, so
 * it is one boolean the module can flip in a single call. Reads combine the two by `or`, so neither
 * source can release a stop the other engaged.
 */
internal class NotificationSilenceSettings(context: Context) {
  private val applicationContext = context.applicationContext
  private val preferences =
    applicationContext.getSharedPreferences("relay-notification-silence", Context.MODE_PRIVATE)

  /**
   * Replaces the authorization snapshot.
   *
   * `revision` is monotonic and a lower one is dropped. Two overlapping writes -- a sync completing
   * after the tenant withdrew a rule, say -- would otherwise be able to reinstate authorization that
   * has since been revoked.
   */
  fun write(tenantId: String, snapshotJson: String, revision: Long) {
    require(tenantId.isNotBlank()) { "tenant_required" }
    val storedTenant = preferences.getString("tenant_id", null)
    if (storedTenant == tenantId && revision < preferences.getLong("revision", 0)) return
    check(
      preferences.edit()
        .putString("tenant_id", tenantId)
        .putString("snapshot_json", snapshotJson)
        .putLong("revision", revision)
        .commit()
    ) { "silence_snapshot_write_failed" }
  }

  /** The snapshot for this tenant, or no authorization at all. */
  fun read(tenantId: String): SilenceSnapshot {
    if (preferences.getString("tenant_id", null) != tenantId) return SilenceSnapshot.OFF
    val parsed = NotificationSilencePolicy.parse(preferences.getString("snapshot_json", null))
    val engaged = parsed.killSwitchEngaged || preferences.getBoolean("kill_switch", false)
    return parsed.copy(killSwitchEngaged = engaged)
  }

  /** The tenant this snapshot belongs to, for a service that has no caller to tell it. */
  fun tenantId(): String? = preferences.getString("tenant_id", null)

  fun killSwitchEngaged(): Boolean = preferences.getBoolean("kill_switch", false)

  fun setKillSwitch(engaged: Boolean) {
    check(preferences.edit().putBoolean("kill_switch", engaged).commit()) {
      "silence_kill_switch_write_failed"
    }
  }

  fun revision(): Long = preferences.getLong("revision", 0)

  /** Forgets this tenant's authorization. Nothing that could authorize an act survives. */
  fun clear(tenantId: String) {
    if (preferences.getString("tenant_id", null) != tenantId) return
    check(
      preferences.edit()
        .remove("tenant_id")
        .remove("snapshot_json")
        .remove("revision")
        .remove("kill_switch")
        .commit()
    ) { "silence_settings_clear_failed" }
  }
}
