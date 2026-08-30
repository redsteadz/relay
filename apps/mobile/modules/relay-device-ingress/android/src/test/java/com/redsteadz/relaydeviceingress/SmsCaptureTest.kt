package com.redsteadz.relaydeviceingress

import android.Manifest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SmsCaptureTest {
  @Test
  fun `Pakistani mobile representations share one exact canonical value`() {
    val expected = "+923001234567"
    val allowlist = setOf(SmsSender.normalize("0300-1234567", "PK"))

    assertEquals(expected, SmsSender.normalize("+92 300 1234567", "PK"))
    assertEquals(expected, SmsSender.normalize("0300-1234567", "pk"))
    assertEquals(expected, SmsSender.normalize("923001234567", "PK"))
    assertEquals(expected, SmsSender.normalize("00923001234567", "PK"))
    assertTrue(SmsSender.normalize("+92 300 1234567", "PK") in allowlist)
    assertFalse(SmsSender.normalize("+92 301 1234567", "PK") in allowlist)
  }

  @Test
  fun `country rewrite does not become fuzzy matching`() {
    assertEquals("03001234567", SmsSender.normalize("0300 1234567", "GB"))
    assertEquals("923001234567", SmsSender.normalize("923001234567", null))
    assertEquals("examplebank", SmsSender.normalize("ExampleBank", "PK"))
    assertFalse(
      SmsSender.normalize("03001234567", "GB") ==
        SmsSender.normalize("+923001234567", "GB")
    )
  }

  @Test
  fun `permission declaration requires both SMS permissions`() {
    assertTrue(
      SmsPermissions.areAllDeclared(
        setOf(Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS)
      )
    )
    assertFalse(SmsPermissions.areAllDeclared(setOf(Manifest.permission.READ_SMS)))
    assertFalse(SmsPermissions.areAllDeclared(emptySet()))
  }

  @Test
  fun `cursor starts oldest first and later resumes above the last processed ID`() {
    val initial = SmsInboxCursor.query(0)
    assertNull(initial.selection)
    assertNull(initial.selectionArgs)
    assertEquals("_id ASC", initial.sortOrder)

    val resumed = SmsInboxCursor.query(41)
    assertEquals("_id>?", resumed.selection)
    assertTrue(resumed.selectionArgs!!.contentEquals(arrayOf("41")))
    assertEquals("_id ASC", resumed.sortOrder)
  }

  @Test
  fun `cursor advances for every processed row but not an unprocessed queue-full row`() {
    var cursor = 10L
    cursor = SmsInboxCursor.afterRow(cursor, 11, completed = true)
    assertEquals(11L, cursor)
    assertEquals(11L, SmsInboxCursor.afterRow(cursor, 12, completed = false))
  }

  @Test
  fun `cursor is preserved for the same allowlist and reset when it changes`() {
    val allowed = setOf("+923001234567")

    assertEquals(
      41L,
      SmsInboxCursor.afterAllowlistUpdate("tenant-a", allowed, "tenant-a", allowed, 41)
    )
    assertEquals(
      0L,
      SmsInboxCursor.afterAllowlistUpdate(
        "tenant-a",
        allowed,
        "tenant-a",
        setOf("+923011234567"),
        41
      )
    )
  }
}
