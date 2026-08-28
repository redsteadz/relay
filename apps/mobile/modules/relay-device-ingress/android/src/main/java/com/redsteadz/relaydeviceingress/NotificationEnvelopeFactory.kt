package com.redsteadz.relaydeviceingress

import android.app.Notification
import android.service.notification.StatusBarNotification
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.util.UUID
import org.json.JSONObject

internal data class CapturedNotification(val envelopeId: String, val capturedAt: Long, val json: String)

internal object NotificationEnvelopeFactory {
  private const val MAX_SUBJECT_LENGTH = 4096
  // Visible title and text are the only source strings collected. Never serialize the extras bundle.
  private const val MAX_BODY_LENGTH = 4096

  fun create(notification: StatusBarNotification, capturedAt: Long): CapturedNotification {
    // Package name is part of the namespace so identical notification keys from different apps
    // cannot collide. The resulting ID is assigned once and retained by the encrypted queue.
    val sourceIdentity = "${notification.packageName}\u0000${notification.key}"
    val id = UUID.nameUUIDFromBytes(sourceIdentity.toByteArray(StandardCharsets.UTF_8)).toString()
    val extras = notification.notification.extras
    val subject = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.take(MAX_SUBJECT_LENGTH)
    val body = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.take(MAX_BODY_LENGTH)
    val source = JSONObject()
      .put("kind", "notification")
      .put("externalId", id)
      .put("applicationId", notification.packageName)
    val envelope = JSONObject()
      .put("schemaVersion", 1)
      .put("id", id)
      .put("occurredAt", Instant.ofEpochMilli(notification.postTime).toString())
      .put("capturedAt", Instant.ofEpochMilli(capturedAt).toString())
      .put("source", source)
      .put("attributes", JSONObject())
    if (!subject.isNullOrBlank()) envelope.put("subject", subject)
    if (!body.isNullOrBlank()) envelope.put("body", body)
    return CapturedNotification(id, capturedAt, envelope.toString())
  }
}
