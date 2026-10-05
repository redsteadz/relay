package com.redsteadz.relaydeviceingress

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.ContactsContract
import android.provider.Settings
import android.view.WindowManager
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale
import org.json.JSONException
import org.json.JSONObject

private fun JSONObject.stringValue(name: String): String? = opt(name) as? String

private fun notificationCapturePreview(row: Map<String, Any>): Map<String, Any>? {
  val envelopeJson = row["envelopeJson"] as? String ?: return null
  val envelopeId = row["envelopeId"] as? String ?: return null
  val attempts = row["attempts"] as? Int ?: return null

  return try {
    val envelope = JSONObject(envelopeJson)
    val source = envelope.optJSONObject("source") ?: return null
    if (source.stringValue("kind") != "notification") return null
    val capturedAt = envelope.stringValue("capturedAt") ?: return null
    val preview = mutableMapOf<String, Any>(
      "attempts" to attempts,
      "capturedAt" to capturedAt,
      "envelopeId" to envelopeId,
    )

    envelope.stringValue("sender")?.let { preview["sender"] = it }
    envelope.stringValue("subject")?.let { preview["subject"] = it }
    envelope.stringValue("body")?.let { preview["body"] = it }
    source.stringValue("applicationId")?.let { preview["applicationId"] = it }
    preview
  } catch (_: JSONException) {
    null
  }
}

private fun smsCapturePreview(row: Map<String, Any>): Map<String, Any>? {
  val envelopeJson = row["envelopeJson"] as? String ?: return null
  val envelopeId = row["envelopeId"] as? String ?: return null
  val attempts = row["attempts"] as? Int ?: return null

  return try {
    val envelope = JSONObject(envelopeJson)
    val source = envelope.optJSONObject("source") ?: return null
    if (source.stringValue("kind") != "sms") return null
    val capturedAt = envelope.stringValue("capturedAt") ?: return null
    val preview = mutableMapOf<String, Any>(
      "attempts" to attempts,
      "capturedAt" to capturedAt,
      "envelopeId" to envelopeId,
    )

    envelope.stringValue("sender")?.let { preview["sender"] = it }
    envelope.stringValue("body")?.let { preview["body"] = it }
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
  private lateinit var phoneNumberPicker: AppContextActivityResultLauncher<String, String?>

  private fun setCapturePreviewSecure(enabled: Boolean) {
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

    RegisterActivityContracts {
      phoneNumberPicker = registerForActivityResult(PickPhoneNumberContract())
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
      val silenceSettings = NotificationSilenceSettings(context.applicationContext)
      val silence = capture?.let { silenceSettings.read(it.tenantId) } ?: SilenceSnapshot.OFF

      mapOf(
        "notificationListener" to listenerEnabled,
        "notificationCapturePaused" to (capture?.paused ?: true),
        "notificationAllowedPackages" to (capture?.allowedPackages?.sorted() ?: emptyList<String>()),
        "notificationSilenceMode" to silence.mode,
        "notificationSilenceKillSwitch" to silence.killSwitchEngaged,
        "notificationSilenceRevision" to silenceSettings.revision().toDouble(),
        "notificationSilenceRuleCount" to silence.rules.size,
        "smsAvailable" to smsAvailable,
        "smsPermissionGranted" to smsGranted,
        "smsCapturePaused" to (smsCapture?.paused ?: true),
        "smsAllowedSenders" to (smsCapture?.allowedSenders?.sorted() ?: emptyList<String>()),
        "smsQueuedCount" to smsQueuedCount,
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

    /**
     * Opens Android's own notification settings for one application.
     *
     * This is the only thing on the device that can stop that application ringing, and Relay is not
     * it: a listener is told about a notification after the system has already alerted, and the
     * pre-posting hook (`NotificationAssistantService`) is `@SystemApi`, absent from the public SDK.
     * So where Relay cannot act, it hands the person the exact switch that can -- the app's own
     * channels, in Android's UI, changed by them.
     *
     * `ACTION_APP_NOTIFICATION_SETTINGS` has existed since API 26, below which this is a no-op
     * rather than a crash.
     */
    AsyncFunction("openApplicationNotificationSettings") { packageName: String ->
      require(packageName.isNotBlank()) { "package_required" }
      val activity = requireNotNull(appContext.currentActivity)
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@AsyncFunction
      val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
        .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
      require(
        activity.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY) != null
      ) { "notification_settings_unavailable" }
      activity.startActivity(intent)
    }

    /**
     * Caches the authorization the database granted.
     *
     * The snapshot is validated against `notificationSilenceSnapshotSchema` before it gets here and
     * re-validated by `NotificationSilencePolicy.parse` when it is read, because the services that
     * read it run with the app dead and have no other way to refuse a snapshot that does not mean
     * what it says.
     */
    AsyncFunction("configureNotificationSilence") {
      tenantId: String, snapshotJson: String, revision: Double, generation: Double ->
      require(revision.isFinite() && revision >= 0) { "silence_revision_invalid" }
      val context = requireNotNull(appContext.reactContext).applicationContext
      synchronized(NotificationCaptureStateLock) {
        requirePreparedCaptureTenant(tenantId, generation)
        NotificationSilenceSettings(context).write(tenantId, snapshotJson, revision.toLong())
      }
    }

    /**
     * The stop.
     *
     * Deliberately one boolean and one preference write. Engaging it must not wait on recompiling
     * rules, on the network, or on anything that can fail, so it does not touch the snapshot: reads
     * combine the two by `or`, and neither source can release a stop the other engaged.
     */
    AsyncFunction("setNotificationSilenceKillSwitch") {
      tenantId: String, engaged: Boolean, generation: Double ->
      val context = requireNotNull(appContext.reactContext).applicationContext
      synchronized(NotificationCaptureStateLock) {
        requirePreparedCaptureTenant(tenantId, generation)
        NotificationSilenceSettings(context).setKillSwitch(engaged)
      }
    }

    /** What the device decided, newest first, for the dry-run review. Content-free by construction. */
    AsyncFunction("getNotificationSilenceOutcomes") {
      tenantId: String, limit: Int, generation: Double ->
      synchronized(NotificationCaptureStateLock) {
        requirePreparedCaptureTenant(tenantId, generation)
        queue.silenceOutcomes(tenantId, limit)
      }
    }

    /** The observation counts the enable transition records as evidence. */
    AsyncFunction("getNotificationSilenceCounts") {
      tenantId: String, filterRuleId: String, since: Double, generation: Double ->
      require(since.isFinite() && since >= 0) { "silence_window_invalid" }
      synchronized(NotificationCaptureStateLock) {
        requirePreparedCaptureTenant(tenantId, generation)
        queue.silenceOutcomeCounts(tenantId, filterRuleId, since.toLong())
      }
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
        val context = requireNotNull(appContext.reactContext).applicationContext
        val notificationSettings = NotificationCaptureSettings(context)
        val smsSettings = SmsCaptureSettings(context)
        val silenceSettings = NotificationSilenceSettings(context)
        val staleTenantIds = linkedSetOf<String>()
        cleanupTenantId?.let(staleTenantIds::add)
        notificationSettings.read()?.tenantId?.takeIf { it != tenantId }?.let(staleTenantIds::add)
        smsSettings.read()?.tenantId?.takeIf { it != tenantId }?.let(staleTenantIds::add)

        staleTenantIds.forEach { staleTenantId ->
          queue.clearTenant(staleTenantId)
          notificationSettings.clear(staleTenantId)
          smsSettings.clear(staleTenantId)
          silenceSettings.clear(staleTenantId)
        }
        NotificationCaptureStateLock.preparedTenantId = tenantId
      }
    }

    AsyncFunction("configureSmsCapture") {
      tenantId: String, allowedSenders: List<String>, paused: Boolean, generation: Double ->
      val context = requireNotNull(appContext.reactContext).applicationContext
      require(SmsPermissions.areDeclared(context)) { "sms_not_available" }
      synchronized(NotificationCaptureStateLock) {
        requirePreparedCaptureTenant(tenantId, generation)
        SmsCaptureSettings(context).write(tenantId, allowedSenders.toSet(), paused)
      }
    }

    AsyncFunction("syncSmsInbox") { tenantId: String, generation: Double ->
      synchronized(NotificationCaptureStateLock) {
        requirePreparedCaptureTenant(tenantId, generation)
        SmsInboxSynchronizer.sync(
          requireNotNull(appContext.reactContext).applicationContext,
          tenantId
        )
      }
    }

    AsyncFunction("deleteQueuedSms") { tenantId: String, generation: Double ->
      synchronized(NotificationCaptureStateLock) {
        requirePreparedCaptureTenant(tenantId, generation)
        queue.deleteBySource(tenantId, "sms")
      }
    }

    AsyncFunction("enqueueCapture") {
      tenantId: String, envelopeId: String, sourceKind: String, capturedAt: Double,
        envelopeJson: String, generation: Double ->
      synchronized(NotificationCaptureStateLock) {
        requirePreparedCaptureTenant(tenantId, generation)
        queue.enqueue(tenantId, envelopeId, sourceKind, capturedAt.toLong(), envelopeJson)
      }
    }

    AsyncFunction("getReadyCaptures") { tenantId: String, now: Double, generation: Double ->
      synchronized(NotificationCaptureStateLock) {
        requirePreparedCaptureTenant(tenantId, generation)
        val context = requireNotNull(appContext.reactContext).applicationContext
        queue.ready(tenantId, now.toLong(), SmsPermissions.areDeclared(context))
      }
    }

    /**
     * Reads what the device kept of its own captures.
     *
     * The tenant is prepared and the rows are decrypted with that tenant's Keystore key, so this
     * returns content only to the runtime that captured it. Nothing here reaches the network: the
     * server holds derived facts, and this holds what those facts were derived from.
     */
    AsyncFunction("getRetainedCaptureContent") {
      tenantId: String, envelopeIds: List<String>, generation: Double ->
      synchronized(NotificationCaptureStateLock) {
        requirePreparedCaptureTenant(tenantId, generation)
        queue.readContent(tenantId, envelopeIds)
      }
    }

    AsyncFunction("getNotificationCapturePreviews") {
      tenantId: String, now: Double, generation: Double ->
      synchronized(NotificationCaptureStateLock) {
        requirePreparedCaptureTenant(tenantId, generation)
        queue.readyBySource(tenantId, now.toLong(), "notification")
          .mapNotNull(::notificationCapturePreview)
      }
    }

    AsyncFunction("pickSmsSender") Coroutine { ->
      val selectedUri = phoneNumberPicker.launch("sms-sender") ?: return@Coroutine null
      val context = requireNotNull(appContext.reactContext).applicationContext
      context.contentResolver.query(
        Uri.parse(selectedUri),
        arrayOf(
          ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY,
          ContactsContract.CommonDataKinds.Phone.NUMBER,
          ContactsContract.CommonDataKinds.Phone.NORMALIZED_NUMBER
        ),
        null,
        null,
        null
      )?.use { cursor ->
        if (!cursor.moveToFirst()) return@Coroutine null
        val numberColumn = cursor.getColumnIndexOrThrow(
          ContactsContract.CommonDataKinds.Phone.NUMBER
        )
        val labelColumn = cursor.getColumnIndex(
          ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY
        )
        val normalizedNumberColumn = cursor.getColumnIndex(
          ContactsContract.CommonDataKinds.Phone.NORMALIZED_NUMBER
        )
        val normalizedNumber = if (normalizedNumberColumn >= 0) {
          cursor.getString(normalizedNumberColumn).orEmpty()
        } else {
          ""
        }
        val selectedNumber = normalizedNumber.ifBlank {
          cursor.getString(numberColumn).orEmpty()
        }
        val sender = SmsSender.normalize(selectedNumber, SmsCountryIso.resolve(context))
        if (sender.isBlank()) null else mapOf(
          "label" to if (labelColumn >= 0) cursor.getString(labelColumn).orEmpty().ifBlank { sender }
            else sender,
          "sender" to sender
        )
      }
    }

    AsyncFunction("getSmsCapturePreviews") {
      tenantId: String, now: Double, generation: Double ->
      synchronized(NotificationCaptureStateLock) {
        requirePreparedCaptureTenant(tenantId, generation)
        queue.readyBySource(tenantId, now.toLong(), "sms").mapNotNull(::smsCapturePreview)
      }
    }

    AsyncFunction("setCapturePreviewSecure") { enabled: Boolean ->
      setCapturePreviewSecure(enabled)
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
        val context = requireNotNull(appContext.reactContext).applicationContext
        NotificationCaptureSettings(context).clear(tenantId)
        SmsCaptureSettings(context).clear(tenantId)
        NotificationSilenceSettings(context).clear(tenantId)
        if (NotificationCaptureStateLock.preparedTenantId == tenantId) {
          NotificationCaptureStateLock.preparedTenantId = null
        }
      }
    }

    OnDestroy {
      appContext.currentActivity?.runOnUiThread {
        setCapturePreviewSecure(false)
      }
    }
  }
}
