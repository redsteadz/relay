package com.redsteadz.relaydeviceingress

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

internal const val CAPTURE_MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000

/**
 * How long the device keeps its own copy of what a capture said.
 *
 * The server retains derived facts until the tenant deletes them but destroys the encrypted original
 * after seven days, so an item that still exists server-side would otherwise become unreadable. This
 * copy never leaves the device and stays under the same per-tenant Keystore key as the queue, so it
 * is bounded by storage rather than by the server's retention deadline.
 */
internal const val CAPTURE_CONTENT_MAX_AGE_MS = 30L * 24 * 60 * 60 * 1000
internal const val CAPTURE_CONTENT_MAX_ITEMS = 2000
internal const val CAPTURE_CONTENT_MAX_BYTES = 4 * 1024 * 1024
internal const val CAPTURE_MAX_BYTES = 2 * 1024 * 1024
internal const val CAPTURE_MAX_ITEMS = 500

internal class CaptureQueueStore(context: Context) :
  SQLiteOpenHelper(context, "relay-capture.db", null, 3) {
  private val crypto = CaptureQueueCrypto()

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL("""
      CREATE TABLE capture_queue (
        tenant_id TEXT NOT NULL,
        envelope_id TEXT NOT NULL,
        source_kind TEXT NOT NULL CHECK(source_kind IN ('notification','sms')),
        captured_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        byte_count INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL CHECK(state IN ('pending','failed')),
        nonce BLOB NOT NULL,
        ciphertext BLOB NOT NULL,
        PRIMARY KEY (tenant_id, envelope_id)
      )
    """.trimIndent())
    db.execSQL("CREATE INDEX capture_ready ON capture_queue(tenant_id, state, captured_at)")
    createContentTable(db)
  }

  private fun createContentTable(db: SQLiteDatabase) {
    db.execSQL("""
      CREATE TABLE IF NOT EXISTS capture_content (
        tenant_id TEXT NOT NULL,
        envelope_id TEXT NOT NULL,
        captured_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        byte_count INTEGER NOT NULL,
        nonce BLOB NOT NULL,
        ciphertext BLOB NOT NULL,
        PRIMARY KEY (tenant_id, envelope_id)
      )
    """.trimIndent())
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    if (oldVersion < 2) {
      // Every v1 row was produced by the notification adapter.
      db.execSQL("ALTER TABLE capture_queue ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'notification'")
    }
    if (oldVersion < 3) createContentTable(db)
  }

  /**
   * Keeps what a capture said, encrypted under the same per-tenant Keystore key as the queue.
   *
   * Stored separately from the queue so uploading and forgetting stay independent: acknowledging a
   * capture removes it from the outbox without removing the tenant's ability to read it. Content is
   * bounded before storage and oldest rows are dropped first once the cap is reached, so retention
   * degrades by age rather than by refusing to record anything further.
   */
  fun retainContent(tenantId: String, envelopeId: String, capturedAt: Long, contentJson: String) {
    val plaintext = contentJson.toByteArray(Charsets.UTF_8)
    if (plaintext.size > CAPTURE_CONTENT_MAX_BYTES) return
    val encrypted = crypto.encrypt(tenantId, envelopeId, plaintext)
    val now = System.currentTimeMillis()
    writableDatabase.beginTransaction()
    try {
      expireContent(writableDatabase, now)
      trimContent(writableDatabase, tenantId, plaintext.size)
      val values = ContentValues().apply {
        put("tenant_id", tenantId); put("envelope_id", envelopeId)
        put("captured_at", capturedAt)
        put("expires_at", minOf(capturedAt + CAPTURE_CONTENT_MAX_AGE_MS, now + CAPTURE_CONTENT_MAX_AGE_MS))
        put("byte_count", plaintext.size)
        put("nonce", encrypted.nonce); put("ciphertext", encrypted.ciphertext)
      }
      writableDatabase.insertWithOnConflict(
        "capture_content", null, values, SQLiteDatabase.CONFLICT_REPLACE
      )
      writableDatabase.setTransactionSuccessful()
    } finally {
      writableDatabase.endTransaction()
    }
  }

  /** Reads retained content for the given envelopes. Unreadable rows are dropped, never guessed. */
  fun readContent(tenantId: String, envelopeIds: List<String>): Map<String, String> {
    if (envelopeIds.isEmpty()) return emptyMap()
    expireContent(writableDatabase, System.currentTimeMillis())
    val bounded = envelopeIds.take(CAPTURE_CONTENT_MAX_ITEMS)
    val placeholders = bounded.joinToString(",") { "?" }
    val result = mutableMapOf<String, String>()
    writableDatabase.query(
      "capture_content", arrayOf("envelope_id", "nonce", "ciphertext"),
      "tenant_id=? AND envelope_id IN ($placeholders)",
      (listOf(tenantId) + bounded).toTypedArray(),
      null, null, null
    ).use { cursor ->
      while (cursor.moveToNext()) {
        val id = cursor.getString(0)
        try {
          val plaintext = crypto.decrypt(
            tenantId, id, EncryptedCapture(cursor.getBlob(2), cursor.getBlob(1))
          )
          result[id] = plaintext.toString(Charsets.UTF_8)
        } catch (_: Exception) {
          writableDatabase.delete(
            "capture_content", "tenant_id=? AND envelope_id=?", arrayOf(tenantId, id)
          )
        }
      }
    }
    return result
  }

  private fun expireContent(db: SQLiteDatabase, now: Long) {
    db.delete("capture_content", "expires_at<=?", arrayOf(now.toString()))
  }

  private fun trimContent(db: SQLiteDatabase, tenantId: String, incoming: Int) {
    val counts = db.rawQuery(
      "SELECT COUNT(*), COALESCE(SUM(byte_count),0) FROM capture_content WHERE tenant_id=?",
      arrayOf(tenantId)
    ).use { cursor -> cursor.moveToFirst(); cursor.getInt(0) to cursor.getInt(1) }
    var items = counts.first
    var bytes = counts.second
    while (items >= CAPTURE_CONTENT_MAX_ITEMS || bytes + incoming > CAPTURE_CONTENT_MAX_BYTES) {
      val removed = db.delete(
        "capture_content",
        "rowid IN (SELECT rowid FROM capture_content WHERE tenant_id=? ORDER BY captured_at ASC LIMIT 32)",
        arrayOf(tenantId)
      )
      if (removed == 0) return
      val next = db.rawQuery(
        "SELECT COUNT(*), COALESCE(SUM(byte_count),0) FROM capture_content WHERE tenant_id=?",
        arrayOf(tenantId)
      ).use { cursor -> cursor.moveToFirst(); cursor.getInt(0) to cursor.getInt(1) }
      items = next.first
      bytes = next.second
    }
  }

  fun enqueue(
    tenantId: String,
    envelopeId: String,
    sourceKind: String,
    capturedAt: Long,
    envelopeJson: String
  ) {
    require(sourceKind == "notification" || sourceKind == "sms") { "capture_source_invalid" }
    val plaintext = envelopeJson.toByteArray(Charsets.UTF_8)
    require(plaintext.size <= CAPTURE_MAX_BYTES) { "capture_too_large" }
    val encrypted = crypto.encrypt(tenantId, envelopeId, plaintext)
    val now = System.currentTimeMillis()
    val expiresAt = minOf(capturedAt + CAPTURE_MAX_AGE_MS, now + CAPTURE_MAX_AGE_MS)
    writableDatabase.beginTransaction()
    try {
      expire(writableDatabase, now)
      val count = writableDatabase.rawQuery(
        "SELECT COUNT(*), COALESCE(SUM(byte_count),0) FROM capture_queue WHERE tenant_id=?",
        arrayOf(tenantId)
      ).use { cursor -> cursor.moveToFirst(); cursor.getInt(0) to cursor.getInt(1) }
      require(count.first < CAPTURE_MAX_ITEMS && count.second + plaintext.size <= CAPTURE_MAX_BYTES) {
        "capture_queue_limit"
      }
      val values = ContentValues().apply {
        put("tenant_id", tenantId); put("envelope_id", envelopeId)
        put("source_kind", sourceKind)
        put("captured_at", capturedAt); put("expires_at", expiresAt)
        put("byte_count", plaintext.size); put("attempts", 0); put("state", "pending")
        put("nonce", encrypted.nonce); put("ciphertext", encrypted.ciphertext)
      }
      // IGNORE makes repeated OS delivery preserve the original stable item and retry history.
      writableDatabase.insertWithOnConflict("capture_queue", null, values, SQLiteDatabase.CONFLICT_IGNORE)
      writableDatabase.setTransactionSuccessful()
    } finally { writableDatabase.endTransaction() }
  }

  fun ready(tenantId: String, now: Long, includeSms: Boolean): List<Map<String, Any>> {
    expire(writableDatabase, now)
    val selection = if (includeSms) {
      "tenant_id=? AND state='pending' AND expires_at>?"
    } else {
      "tenant_id=? AND state='pending' AND expires_at>? AND source_kind!='sms'"
    }
    return readyRows(tenantId, selection, arrayOf(tenantId, now.toString()))
  }

  fun readyBySource(
    tenantId: String,
    now: Long,
    sourceKind: String
  ): List<Map<String, Any>> {
    require(sourceKind == "notification" || sourceKind == "sms") { "capture_source_invalid" }
    expire(writableDatabase, now)
    return readyRows(
      tenantId,
      "tenant_id=? AND state='pending' AND expires_at>? AND source_kind=?",
      arrayOf(tenantId, now.toString(), sourceKind)
    )
  }

  private fun readyRows(
    tenantId: String,
    selection: String,
    selectionArgs: Array<String>
  ): List<Map<String, Any>> {
    val result = mutableListOf<Map<String, Any>>()
    writableDatabase.query(
      "capture_queue", arrayOf("envelope_id", "attempts", "nonce", "ciphertext"),
      selection, selectionArgs,
      null, null, "captured_at ASC", "50"
    ).use { cursor ->
      while (cursor.moveToNext()) {
        val id = cursor.getString(0)
        try {
          val plaintext = crypto.decrypt(
            tenantId, id, EncryptedCapture(cursor.getBlob(3), cursor.getBlob(2))
          )
          result += mapOf(
            "envelopeId" to id,
            "attempts" to cursor.getInt(1),
            "envelopeJson" to plaintext.toString(Charsets.UTF_8)
          )
        } catch (_: Exception) {
          markFailed(tenantId, id)
        }
      }
    }
    return result
  }

  fun acknowledge(tenantId: String, envelopeId: String) {
    writableDatabase.delete("capture_queue", "tenant_id=? AND envelope_id=?", arrayOf(tenantId, envelopeId))
  }

  fun fail(tenantId: String, envelopeId: String, terminal: Boolean) {
    val state = if (terminal) "failed" else "pending"
    writableDatabase.execSQL(
      "UPDATE capture_queue SET attempts=attempts+1, state=? WHERE tenant_id=? AND envelope_id=?",
      arrayOf(state, tenantId, envelopeId)
    )
  }

  private fun markFailed(tenantId: String, envelopeId: String) = fail(tenantId, envelopeId, true)

  private fun expire(db: SQLiteDatabase, now: Long) {
    db.delete("capture_queue", "expires_at<=?", arrayOf(now.toString()))
  }

  fun count(tenantId: String, sourceKind: String, now: Long = System.currentTimeMillis()): Int {
    expire(writableDatabase, now)
    return readableDatabase.rawQuery(
      "SELECT COUNT(*) FROM capture_queue WHERE tenant_id=? AND source_kind=?",
      arrayOf(tenantId, sourceKind)
    ).use { cursor -> cursor.moveToFirst(); cursor.getInt(0) }
  }

  fun deleteBySource(tenantId: String, sourceKind: String) {
    writableDatabase.delete(
      "capture_queue",
      "tenant_id=? AND source_kind=?",
      arrayOf(tenantId, sourceKind)
    )
  }

  fun clearTenant(tenantId: String) {
    // Delete key first: a crash between operations leaves ciphertext permanently undecryptable.
    crypto.deleteKey(tenantId)
    writableDatabase.delete("capture_queue", "tenant_id=?", arrayOf(tenantId))
    writableDatabase.delete("capture_content", "tenant_id=?", arrayOf(tenantId))
  }
}
