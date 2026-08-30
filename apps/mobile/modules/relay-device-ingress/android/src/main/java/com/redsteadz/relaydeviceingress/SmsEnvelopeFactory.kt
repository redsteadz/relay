package com.redsteadz.relaydeviceingress

import java.nio.charset.StandardCharsets
import java.time.Instant
import java.util.UUID
import org.json.JSONObject

internal data class SmsProviderMessage(
  val providerId: Long,
  val sender: String,
  val body: String,
  val occurredAt: Long
)

internal object SmsEnvelopeFactory {
  private const val MAX_BODY_LENGTH = 32_768

  fun create(
    message: SmsProviderMessage,
    sourceAccountId: String,
    capturedAt: Long
  ): CapturedNotification {
    // The provider row ID is stable on this device. Installation scope prevents two devices with
    // the same row number from producing the same Relay envelope ID.
    val sourceIdentity = "sms\u0000$sourceAccountId\u0000${message.providerId}"
    val id = UUID.nameUUIDFromBytes(sourceIdentity.toByteArray(StandardCharsets.UTF_8)).toString()
    val source = JSONObject()
      .put("kind", "sms")
      .put("externalId", message.providerId.toString())
      .put("accountId", sourceAccountId)
    val envelope = JSONObject()
      .put("schemaVersion", 1)
      .put("id", id)
      .put("occurredAt", Instant.ofEpochMilli(message.occurredAt.coerceAtLeast(0)).toString())
      .put("capturedAt", Instant.ofEpochMilli(capturedAt).toString())
      .put("source", source)
      .put("attributes", JSONObject())
    if (message.sender.isNotBlank()) envelope.put("sender", message.sender.take(1024))
    if (message.body.isNotBlank()) envelope.put("body", message.body.take(MAX_BODY_LENGTH))
    return CapturedNotification(id, capturedAt, envelope.toString())
  }
}

