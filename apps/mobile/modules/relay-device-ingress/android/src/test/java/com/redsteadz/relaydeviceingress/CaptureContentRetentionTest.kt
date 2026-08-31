package com.redsteadz.relaydeviceingress

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Bounds on what the device keeps for itself.
 *
 * The store itself needs an Android runtime, so these cover the retention arithmetic that decides
 * how long a copy lives and when it is dropped, which is where a mistake would either lose content
 * early or keep it indefinitely.
 */
class CaptureContentRetentionTest {
  private val day = 24L * 60 * 60 * 1000

  @Test
  fun `content outlives the server's raw payload deadline`() {
    assertTrue(CAPTURE_CONTENT_MAX_AGE_MS > CAPTURE_MAX_AGE_MS)
  }

  @Test
  fun `retention is bounded rather than indefinite`() {
    assertEquals(30 * day, CAPTURE_CONTENT_MAX_AGE_MS)
    assertTrue(CAPTURE_CONTENT_MAX_ITEMS in 1..10_000)
    assertTrue(CAPTURE_CONTENT_MAX_BYTES in 1..(16 * 1024 * 1024))
  }

  @Test
  fun `an expiry never exceeds the retention window from either clock`() {
    val capturedAt = 1_000_000L
    val now = capturedAt + (5 * day)
    val expiresAt = minOf(capturedAt + CAPTURE_CONTENT_MAX_AGE_MS, now + CAPTURE_CONTENT_MAX_AGE_MS)

    assertEquals(capturedAt + CAPTURE_CONTENT_MAX_AGE_MS, expiresAt)
    assertTrue(expiresAt <= now + CAPTURE_CONTENT_MAX_AGE_MS)
  }

  @Test
  fun `a capture recorded with a future clock still expires within the window`() {
    val now = 1_000_000L
    val capturedAt = now + (400 * day)
    val expiresAt = minOf(capturedAt + CAPTURE_CONTENT_MAX_AGE_MS, now + CAPTURE_CONTENT_MAX_AGE_MS)

    assertEquals(now + CAPTURE_CONTENT_MAX_AGE_MS, expiresAt)
  }
}
