package com.redsteadz.relaydeviceingress

import android.content.Context
import android.provider.BaseColumns
import android.provider.Telephony

internal object SmsInboxSynchronizer {
  private val projection = arrayOf(
    BaseColumns._ID,
    Telephony.Sms.ADDRESS,
    Telephony.Sms.BODY,
    Telephony.Sms.DATE
  )

  fun sync(context: Context, tenantId: String): Int {
    val applicationContext = context.applicationContext
    val settings = SmsCaptureSettings(applicationContext)
    if (!SmsPermissions.areDeclared(applicationContext) || !SmsPermissions.areGranted(applicationContext)) {
      settings.pauseForPermissionLoss()
      return 0
    }
    val configuration = settings.read() ?: return 0
    if (configuration.tenantId != tenantId || configuration.paused) return 0

    val initialSync = configuration.lastProviderId == 0L
    val selection = if (initialSync) null else "${BaseColumns._ID}>?"
    val selectionArgs = if (initialSync) null else arrayOf(configuration.lastProviderId.toString())
    val sortOrder = "${BaseColumns._ID} ${if (initialSync) "DESC" else "ASC"}"
    var captured = 0
    var lastProcessed = configuration.lastProviderId

    try {
      applicationContext.contentResolver.query(
        Telephony.Sms.Inbox.CONTENT_URI,
        projection,
        selection,
        selectionArgs,
        sortOrder
      )?.use { cursor ->
        val idColumn = cursor.getColumnIndexOrThrow(BaseColumns._ID)
        val senderColumn = cursor.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
        val bodyColumn = cursor.getColumnIndexOrThrow(Telephony.Sms.BODY)
        val dateColumn = cursor.getColumnIndexOrThrow(Telephony.Sms.DATE)
        CaptureQueueStore(applicationContext).use { queue ->
          while (true) {
            if (!SmsPermissions.areGranted(applicationContext)) {
              settings.pauseForPermissionLoss()
              break
            }
            val current = settings.read()
            if (current == null || current.tenantId != tenantId || current.paused) break
            if (!cursor.moveToNext()) break
            val providerId = cursor.getLong(idColumn)
            val sender = cursor.getString(senderColumn).orEmpty()
            if (SmsSender.normalize(sender) in current.allowedSenders) {
              val message = SmsProviderMessage(
                providerId = providerId,
                sender = sender,
                body = cursor.getString(bodyColumn).orEmpty(),
                occurredAt = cursor.getLong(dateColumn)
              )
              val capture = SmsEnvelopeFactory.create(
                message,
                current.sourceAccountId,
                System.currentTimeMillis()
              )
              try {
                queue.enqueue(
                  tenantId,
                  capture.envelopeId,
                  "sms",
                  capture.capturedAt,
                  capture.json
                )
                captured += 1
              } catch (error: IllegalArgumentException) {
                if (error.message == "capture_queue_limit") break else throw error
              }
            }
            lastProcessed = maxOf(lastProcessed, providerId)
          }
        }
      }
    } catch (_: SecurityException) {
      settings.pauseForPermissionLoss()
    }

    settings.updateLastProviderId(tenantId, lastProcessed)
    return captured
  }
}
