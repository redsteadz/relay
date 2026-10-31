package com.redsteadz.relaydeviceingress

import android.app.Notification
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * What Relay will and will not capture.
 *
 * A notification reaches Relay by two routes: posted live while the listener is bound, or found on
 * the shade when it connects. These cover the decision both routes make, which is the whole reason
 * it is one function rather than two copies.
 */
class NotificationCapturePolicyTest {
  private val relay = "com.redsteadz.relay"
  private val gmail = "com.google.android.gm"
  private val allowed = setOf(gmail, "com.whatsapp")

  @Test
  fun `an allowlisted application is captured`() {
    assertEquals(
      NotificationCaptureDecision.CAPTURE,
      NotificationCapturePolicy.decide(gmail, relay, 0, allowed)
    )
  }

  @Test
  fun `an application the tenant did not allow is refused`() {
    assertEquals(
      NotificationCaptureDecision.PACKAGE_NOT_ALLOWED,
      NotificationCapturePolicy.decide("com.linkedin.android", relay, 0, allowed)
    )
  }

  @Test
  fun `an empty allowlist captures nothing`() {
    assertEquals(
      NotificationCaptureDecision.PACKAGE_NOT_ALLOWED,
      NotificationCapturePolicy.decide(gmail, relay, 0, emptySet())
    )
  }

  // Capturing Relay's own notification would make the adapter observe itself, and every capture it
  // reported would post a notification to observe next.
  @Test
  fun `relay never captures itself`() {
    assertEquals(
      NotificationCaptureDecision.OWN_NOTIFICATION,
      NotificationCapturePolicy.decide(relay, relay, 0, allowed + relay)
    )
  }

  // The summary only aggregates content its children already carry and is rewritten whenever a
  // child arrives, so capturing it duplicates observations without adding signal.
  @Test
  fun `a group summary is refused even from an allowlisted application`() {
    assertEquals(
      NotificationCaptureDecision.GROUP_SUMMARY,
      NotificationCapturePolicy.decide(gmail, relay, Notification.FLAG_GROUP_SUMMARY, allowed)
    )
  }

  @Test
  fun `a summary flag set alongside other flags is still a summary`() {
    val flags = Notification.FLAG_GROUP_SUMMARY or Notification.FLAG_AUTO_CANCEL
    assertEquals(
      NotificationCaptureDecision.GROUP_SUMMARY,
      NotificationCapturePolicy.decide(gmail, relay, flags, allowed)
    )
  }

  @Test
  fun `an ordinary child of a group is captured`() {
    assertEquals(
      NotificationCaptureDecision.CAPTURE,
      NotificationCapturePolicy.decide(gmail, relay, Notification.FLAG_AUTO_CANCEL, allowed)
    )
  }

  /**
   * The sweep on connect re-reads notifications that are still on screen, so it decides about the
   * same notification more than once over a device's lifetime. Nothing in the decision may depend on
   * when it is asked, or a notification's fate would turn on which route happened to reach it.
   */
  @Test
  fun `the same notification decides the same way every time it is offered`() {
    val first = NotificationCapturePolicy.decide(gmail, relay, Notification.FLAG_AUTO_CANCEL, allowed)
    val again = NotificationCapturePolicy.decide(gmail, relay, Notification.FLAG_AUTO_CANCEL, allowed)

    assertEquals(first, again)
    assertEquals(NotificationCaptureDecision.CAPTURE, again)
  }

  // The capture list is also the per-application control for quieting, re-read when a model's
  // answer arrives. It must agree with the live decision about every application.
  @Test
  fun `a configuration captures only an allowlisted application while capture is on`() {
    val tenant = "638ce145-a77d-4c32-b798-cb398e881fc9"
    val capturing = NotificationCaptureConfiguration(tenant, allowed, paused = false)

    assertEquals(true, capturing.captures(tenant, gmail))
    assertEquals(false, capturing.captures(tenant, "com.linkedin.android"))
    assertEquals(false, capturing.copy(paused = true).captures(tenant, gmail))
    assertEquals(false, capturing.captures("5e106d7a-85aa-4a08-9a1f-cb13b42df1f8", gmail))
  }
}
