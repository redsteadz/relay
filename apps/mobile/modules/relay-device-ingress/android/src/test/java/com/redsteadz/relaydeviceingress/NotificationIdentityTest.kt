package com.redsteadz.relaydeviceingress

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class NotificationIdentityTest {
  private val gmail = "com.google.android.gm"
  private val key = "0|com.google.android.gm|0|gig:2060346079|10214"

  @Test
  fun `redelivering one unchanged notification keeps its identity`() {
    assertEquals(
      NotificationEnvelopeFactory.envelopeId(gmail, key, "Inbox", "One new message"),
      NotificationEnvelopeFactory.envelopeId(gmail, key, "Inbox", "One new message")
    )
  }

  @Test
  fun `rewriting a notification in place becomes its own observation`() {
    val first = NotificationEnvelopeFactory.envelopeId(gmail, key, "Inbox", "One new message")
    val edited = NotificationEnvelopeFactory.envelopeId(gmail, key, "Inbox", "Two new messages")

    assertNotEquals(first, edited)
  }

  @Test
  fun `a reported sender changes the identity it is reported under`() {
    // Everything the adapter reports has to be part of the identity. When the sender was not, one
    // envelope ID carried two different fact sets across a redelivery, which deduplication refuses.
    assertNotEquals(
      NotificationEnvelopeFactory.envelopeId(gmail, key, "Inbox", "One new message", null),
      NotificationEnvelopeFactory.envelopeId(gmail, key, "Inbox", "One new message", "Alex"),
    )
  }

  @Test
  fun `the same reported sender keeps one identity`() {
    assertEquals(
      NotificationEnvelopeFactory.envelopeId(gmail, key, "Inbox", "One new message", "Alex"),
      NotificationEnvelopeFactory.envelopeId(gmail, key, "Inbox", "One new message", "Alex"),
    )
  }

  @Test
  fun `equal notification keys from different apps stay distinct`() {
    assertNotEquals(
      NotificationEnvelopeFactory.envelopeId(gmail, key, "Inbox", "One new message"),
      NotificationEnvelopeFactory.envelopeId("com.whatsapp", key, "Inbox", "One new message")
    )
  }

  @Test
  fun `subject and body are not interchangeable within the identity`() {
    assertNotEquals(
      NotificationEnvelopeFactory.envelopeId(gmail, key, "alpha", "beta"),
      NotificationEnvelopeFactory.envelopeId(gmail, key, "alphabeta", null)
    )
  }

  @Test
  fun `absent and empty content agree`() {
    assertEquals(
      NotificationEnvelopeFactory.envelopeId(gmail, key, null, null),
      NotificationEnvelopeFactory.envelopeId(gmail, key, "", "")
    )
  }
}
