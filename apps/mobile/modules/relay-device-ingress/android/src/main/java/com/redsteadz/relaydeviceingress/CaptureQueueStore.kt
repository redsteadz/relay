package com.redsteadz.relaydeviceingress

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

internal const val CAPTURE_MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000
internal const val CAPTURE_MAX_BYTES = 2 * 1024 * 1024
internal const val CAPTURE_MAX_ITEMS = 500

internal class CaptureQueueStore(context: Context) :
  SQLiteOpenHelper(context, "relay-capture.db", null, 1) {
  private val crypto = CaptureQueueCrypto()

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL("""
      CREATE TABLE capture_queue (
        tenant_id TEXT NOT NULL,
        envelope_id TEXT NOT NULL,
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
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

  fun enqueue(tenantId: String, envelopeId: String, capturedAt: Long, envelopeJson: String) {
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
        put("captured_at", capturedAt); put("expires_at", expiresAt)
        put("byte_count", plaintext.size); put("attempts", 0); put("state", "pending")
        put("nonce", encrypted.nonce); put("ciphertext", encrypted.ciphertext)
      }
      // IGNORE makes repeated OS delivery preserve the original stable item and retry history.
      writableDatabase.insertWithOnConflict("capture_queue", null, values, SQLiteDatabase.CONFLICT_IGNORE)
      writableDatabase.setTransactionSuccessful()
    } finally { writableDatabase.endTransaction() }
  }

  fun ready(tenantId: String, now: Long): List<Map<String, Any>> {
    expire(writableDatabase, now)
    val result = mutableListOf<Map<String, Any>>()
    writableDatabase.query(
      "capture_queue", arrayOf("envelope_id", "attempts", "nonce", "ciphertext"),
      "tenant_id=? AND state='pending' AND expires_at>?", arrayOf(tenantId, now.toString()),
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

  fun clearTenant(tenantId: String) {
    // Delete key first: a crash between operations leaves ciphertext permanently undecryptable.
    crypto.deleteKey(tenantId)
    writableDatabase.delete("capture_queue", "tenant_id=?", arrayOf(tenantId))
  }
}
