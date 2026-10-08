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

/**
 * How much of its own silencing history the device keeps.
 *
 * The dry-run review in #38 is done against this, so it has to outlive the observation window with
 * room to spare. It is bounded by count and age like every other device-local store, oldest dropped
 * first, so a long-running tenant degrades by forgetting old decisions rather than by refusing to
 * record new ones.
 */
internal const val SILENCE_OUTCOME_MAX_AGE_MS = 30L * 24 * 60 * 60 * 1000
internal const val SILENCE_OUTCOME_MAX_ITEMS = 1000

/**
 * The verdict that is not final, and how many of them one pass is handed.
 *
 * The cap matches the eight clauses `resolveAwaitingModel` resolves per filing pass, because this is
 * the same bound on the same thing: requests to a model the reader is hosting themselves.
 */
internal const val PENDING_SILENCE_DECISION = "awaiting-model"
internal const val SILENCE_OUTCOME_MAX_PENDING = 8

internal class CaptureQueueStore(context: Context) :
  SQLiteOpenHelper(context, "relay-capture.db", null, 4) {
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
    createSilenceOutcomeTable(db)
  }

  /**
   * What Relay decided about notifications from applications its rules name.
   *
   * Not encrypted, and deliberately holds nothing that would need to be. A row is an application id,
   * a rule id, a capture identity, and a verdict -- no title, no text, no sender. The application
   * allowlist it is scoped to is already stored in plaintext preferences, so this adds no category of
   * data to the device that was not already there, and the ledger is never uploaded.
   *
   * Keyed by capture identity, derived by the same function that builds the capture, so a verdict
   * can be reviewed against an item a person recognises. A re-decision of one notification replaces
   * its row; an edited notification has a different identity and becomes its own observation,
   * exactly as it does in the queue.
   */
  private fun createSilenceOutcomeTable(db: SQLiteDatabase) {
    db.execSQL("""
      CREATE TABLE IF NOT EXISTS silence_outcome (
        tenant_id TEXT NOT NULL,
        envelope_id TEXT NOT NULL,
        application_id TEXT NOT NULL,
        filter_rule_id TEXT,
        decision TEXT NOT NULL,
        decided_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, envelope_id)
      )
    """.trimIndent())
    db.execSQL(
      "CREATE INDEX IF NOT EXISTS silence_outcome_recent ON silence_outcome(tenant_id, decided_at DESC)"
    )
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
    if (oldVersion < 4) createSilenceOutcomeTable(db)
  }

  /**
   * Records one decision about one notification.
   *
   * Written before the notification is acted on, never after. Once a notification is cancelled this
   * row is the only remaining evidence that anything happened to it, so a crash between the two must
   * leave a record of an act that did not happen rather than an act with no record.
   */
  fun recordSilenceOutcome(
    tenantId: String,
    envelopeId: String,
    applicationId: String,
    filterRuleId: String?,
    decision: String,
    decidedAt: Long
  ) {
    writableDatabase.beginTransaction()
    try {
      expireSilenceOutcomes(writableDatabase, decidedAt)
      trimSilenceOutcomes(writableDatabase, tenantId)
      val values = ContentValues().apply {
        put("tenant_id", tenantId); put("envelope_id", envelopeId)
        put("application_id", applicationId)
        put("filter_rule_id", filterRuleId)
        put("decision", decision)
        put("decided_at", decidedAt)
        put("expires_at", decidedAt + SILENCE_OUTCOME_MAX_AGE_MS)
      }
      writableDatabase.insertWithOnConflict(
        "silence_outcome", null, values, SQLiteDatabase.CONFLICT_REPLACE
      )
      writableDatabase.setTransactionSuccessful()
    } finally {
      writableDatabase.endTransaction()
    }
  }

  /** The decisions a person reviews, newest first. */
  fun silenceOutcomes(tenantId: String, limit: Int): List<Map<String, Any>> {
    expireSilenceOutcomes(writableDatabase, System.currentTimeMillis())
    val bounded = limit.coerceIn(1, SILENCE_OUTCOME_MAX_ITEMS)
    val result = mutableListOf<Map<String, Any>>()
    readableDatabase.query(
      "silence_outcome",
      arrayOf("envelope_id", "application_id", "filter_rule_id", "decision", "decided_at"),
      "tenant_id=?", arrayOf(tenantId), null, null, "decided_at DESC", bounded.toString()
    ).use { cursor ->
      while (cursor.moveToNext()) {
        val row = mutableMapOf<String, Any>(
          "envelopeId" to cursor.getString(0),
          "applicationId" to cursor.getString(1),
          "decision" to cursor.getString(3),
          "decidedAt" to cursor.getLong(4)
        )
        if (!cursor.isNull(2)) row["filterRuleId"] = cursor.getString(2)
        result += row
      }
    }
    return result
  }

  /**
   * The notifications whose rule still owes a model's answer, oldest first.
   *
   * Oldest first, and bounded, for the same reason the connection sweep is: a backlog is worked in
   * the order the notifications arrived, and one pass asks a model about a few of them rather than
   * all of them. Quieting a notification is only worth anything while it is still on screen, so a
   * pass that fell behind is better off making progress than making every request.
   *
   * `awaiting-model` is the only decision read back here because it is the only one that is not
   * final. Every other row is history.
   */
  fun pendingSilenceOutcomes(tenantId: String, limit: Int): List<Map<String, Any>> {
    expireSilenceOutcomes(writableDatabase, System.currentTimeMillis())
    val bounded = limit.coerceIn(1, SILENCE_OUTCOME_MAX_PENDING)
    val result = mutableListOf<Map<String, Any>>()
    readableDatabase.query(
      "silence_outcome",
      arrayOf("envelope_id", "application_id", "filter_rule_id", "decided_at"),
      "tenant_id=? AND decision=?",
      arrayOf(tenantId, PENDING_SILENCE_DECISION),
      null,
      null,
      "decided_at ASC",
      bounded.toString()
    ).use { cursor ->
      while (cursor.moveToNext()) {
        // A candidate with no rule cannot be resolved against one, and the live path never writes
        // one. Skipped rather than reported, so the pass is not handed a row it cannot finish.
        if (cursor.isNull(2)) continue
        result += mapOf(
          "envelopeId" to cursor.getString(0),
          "applicationId" to cursor.getString(1),
          "filterRuleId" to cursor.getString(2),
          "decidedAt" to cursor.getLong(3)
        )
      }
    }
    return result
  }

  /**
   * One candidate, or nothing.
   *
   * Re-read at the moment of acting rather than trusted from the listing, because the row may have
   * been resolved by another pass, expired, or cleared by a withdrawal in between. Nothing here is a
   * reason to act.
   */
  fun pendingSilenceOutcome(tenantId: String, envelopeId: String): Map<String, Any>? =
    readableDatabase.query(
      "silence_outcome",
      arrayOf("application_id", "filter_rule_id"),
      "tenant_id=? AND envelope_id=? AND decision=?",
      arrayOf(tenantId, envelopeId, PENDING_SILENCE_DECISION),
      null,
      null,
      null,
      "1"
    ).use { cursor ->
      if (!cursor.moveToNext() || cursor.isNull(1)) return null
      mapOf("applicationId" to cursor.getString(0), "filterRuleId" to cursor.getString(1))
    }

  /**
   * How much one rule was observed deciding, which is the evidence the enable transition records.
   *
   * `observed` counts every notification from an application the rule names, matched or not, because
   * a window in which a rule matched nothing is as informative as one in which it matched
   * everything. `matched` counts only the decisions the rule produced.
   */
  fun silenceOutcomeCounts(tenantId: String, filterRuleId: String, since: Long): Map<String, Any> {
    val observed = readableDatabase.rawQuery(
      "SELECT COUNT(*) FROM silence_outcome WHERE tenant_id=? AND decided_at>=?",
      arrayOf(tenantId, since.toString())
    ).use { cursor -> cursor.moveToFirst(); cursor.getInt(0) }
    val matched = readableDatabase.rawQuery(
      "SELECT COUNT(*) FROM silence_outcome WHERE tenant_id=? AND decided_at>=? AND filter_rule_id=?",
      arrayOf(tenantId, since.toString(), filterRuleId)
    ).use { cursor -> cursor.moveToFirst(); cursor.getInt(0) }
    return mapOf("observed" to observed, "matched" to matched)
  }

  private fun expireSilenceOutcomes(db: SQLiteDatabase, now: Long) {
    db.delete("silence_outcome", "expires_at<=?", arrayOf(now.toString()))
  }

  private fun trimSilenceOutcomes(db: SQLiteDatabase, tenantId: String) {
    val count = db.rawQuery(
      "SELECT COUNT(*) FROM silence_outcome WHERE tenant_id=?", arrayOf(tenantId)
    ).use { cursor -> cursor.moveToFirst(); cursor.getInt(0) }
    if (count < SILENCE_OUTCOME_MAX_ITEMS) return
    db.delete(
      "silence_outcome",
      "rowid IN (SELECT rowid FROM silence_outcome WHERE tenant_id=? ORDER BY decided_at ASC LIMIT ?)",
      arrayOf(tenantId, (count - SILENCE_OUTCOME_MAX_ITEMS + 1).toString())
    )
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

  /**
   * Whether this device has already recorded that exact capture.
   *
   * A sweep of what Android still has on screen re-offers notifications this device may have
   * captured already, and the queue alone cannot say so: a row is deleted once the server
   * acknowledges it, which makes a delivered capture look new. The retained content row outlives
   * it -- thirty days against the queue's seven -- and is keyed by the same envelope UUID, so it is
   * the durable record of what this device has seen. Both are checked, so a capture still waiting
   * to upload and one already delivered are each recognised.
   *
   * Being wrong here is bounded and safe. Content retention is capped by age and size, so an evicted
   * row makes an old capture look new; the envelope UUID is unchanged, so the pipeline recognises
   * the redelivery rather than storing a second capture.
   */
  fun hasRecord(tenantId: String, envelopeId: String): Boolean =
    readableDatabase.rawQuery(
      """
      SELECT EXISTS(SELECT 1 FROM capture_content WHERE tenant_id=? AND envelope_id=?)
          OR EXISTS(SELECT 1 FROM capture_queue WHERE tenant_id=? AND envelope_id=?)
      """.trimIndent(),
      arrayOf(tenantId, envelopeId, tenantId, envelopeId)
    ).use { cursor -> cursor.moveToFirst() && cursor.getInt(0) == 1 }

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
    writableDatabase.delete("silence_outcome", "tenant_id=?", arrayOf(tenantId))
  }
}
