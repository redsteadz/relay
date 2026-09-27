/**
 * Writing a derived capture into the local store, and reading back what it holds.
 *
 * Writes are idempotent by the schema's own identity rather than by checking first. Facts are keyed by
 * `(tenant, capture, normalizer version, ordinal)` and events by their extraction tuple, so deriving
 * the same capture twice inserts nothing the second time and a pass can run as often as it likes. That
 * matters because derivation runs on every sync and a capture stays in the queue until it uploads.
 *
 * Row ids for facts and events are generated here rather than derived from the capture. The server
 * generates its own for the same capture, so the two will not agree; reconciling that is the sync
 * change's problem, and the identity that matters locally is the tuple, not the id.
 */

import type { SourceEvent, SourceFact, IngressEnvelope } from "@relay/contracts";
import { randomUUID } from "expo-crypto";

import type { DerivedCapture } from "../capture-derivation";

import type { LocalStore, SqlParameter } from "./database";

/** What the store holds for one capture, in the column vocabulary the inbox reads. */
export type StoredCaptureCounts = { events: number; facts: number };

/**
 * One fact's bindings.
 *
 * An uncertain fact has no `value` -- `uncertainFactSchema` does not carry one, because the normalizer
 * records why it could not resolve a value rather than guessing one. The two shapes are split here so
 * the row matches the paired check constraint the schema and the database both apply.
 */
function factValues(tenantId: string, fact: SourceFact, now: string): SqlParameter[] {
  return [
    tenantId,
    randomUUID(),
    fact.sourceItemId,
    fact.normalizerVersion,
    fact.ordinal,
    fact.kind,
    fact.certainty,
    fact.certainty === "certain" ? JSON.stringify(fact.value) : null,
    fact.certainty === "uncertain" ? fact.uncertaintyReason : null,
    JSON.stringify(fact.provenance),
    now,
  ];
}

function eventValues(tenantId: string, event: SourceEvent, now: string): SqlParameter[] {
  return [
    tenantId,
    randomUUID(),
    event.sourceItemId,
    event.normalizerVersion,
    event.extractorVersion,
    event.ordinal,
    event.kind,
    event.title,
    event.summary,
    event.startsAt ?? null,
    event.endsAt ?? null,
    event.dueAt ?? null,
    event.temporalStatus,
    event.dateAmbiguity ?? null,
    event.timeZone,
    event.confidence,
    event.requiresReview ? 1 : 0,
    JSON.stringify(event.provenance),
    now,
  ];
}

/**
 * Persists a capture and everything derived from it in one transaction.
 *
 * The capture row is upserted rather than ignored, because a re-derivation under a newer normalizer
 * should refresh what the inbox shows about the capture itself. Its facts and events are inserted or
 * ignored, because they are versioned and a version's output is append-only -- the same rule the
 * server applies, where changed output under one version is an integrity failure rather than an
 * update.
 */
export async function persistDerivedCapture(
  database: LocalStore,
  tenantId: string,
  envelope: IngressEnvelope,
  derived: DerivedCapture,
  now = new Date().toISOString(),
): Promise<StoredCaptureCounts> {
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      `INSERT INTO source_items
         (tenant_id, id, source, application_id, sender, subject, occurred_at, captured_at,
          attributes, content_fingerprint, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT (tenant_id, id) DO UPDATE SET
         source = excluded.source,
         application_id = excluded.application_id,
         sender = excluded.sender,
         subject = excluded.subject,
         occurred_at = excluded.occurred_at,
         captured_at = excluded.captured_at,
         attributes = excluded.attributes`,
      [
        tenantId,
        envelope.id,
        envelope.source.kind,
        envelope.source.applicationId ?? null,
        envelope.sender ?? null,
        envelope.subject ?? null,
        envelope.occurredAt,
        envelope.capturedAt,
        JSON.stringify(envelope.attributes),
        now,
      ],
    );

    for (const fact of derived.factSet.facts) {
      await transaction.runAsync(
        `INSERT OR IGNORE INTO source_facts
           (tenant_id, id, source_item_id, normalizer_version, ordinal, kind, certainty, value,
            uncertainty_reason, provenance, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        factValues(tenantId, fact, now),
      );
    }

    for (const event of derived.eventSet.events) {
      await transaction.runAsync(
        `INSERT OR IGNORE INTO relay_events
           (tenant_id, id, source_item_id, normalizer_version, extractor_version, ordinal, kind,
            title, summary, starts_at, ends_at, due_at, temporal_status, date_ambiguity, time_zone,
            confidence, requires_review, provenance, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        eventValues(tenantId, event, now),
      );
    }
  });

  return { events: derived.eventSet.events.length, facts: derived.factSet.facts.length };
}

/**
 * Captures already derived at these versions.
 *
 * Keyed on the versions rather than on the capture, so a pass skips work it has already done while a
 * normalizer or extractor bump re-derives everything it now reads differently. Skipping by capture
 * alone would silently freeze a tenant's history at whichever version first saw it.
 */
export async function derivedCaptureIds(
  database: LocalStore,
  tenantId: string,
  normalizerVersion: number,
  extractorVersion: number,
): Promise<Set<string>> {
  const rows = await database.getAllAsync<{ source_item_id: string }>(
    `SELECT DISTINCT source_item_id FROM relay_events
     WHERE tenant_id = ? AND normalizer_version = ? AND extractor_version = ?`,
    [tenantId, normalizerVersion, extractorVersion],
  );
  return new Set(rows.map((row) => row.source_item_id));
}

/** How many derived rows a capture has, so a caller can assert a derivation actually landed. */
export async function storedCaptureCounts(
  database: LocalStore,
  tenantId: string,
  sourceItemId: string,
): Promise<StoredCaptureCounts> {
  const row = await database.getFirstAsync<{ events: number; facts: number }>(
    `SELECT
       (SELECT COUNT(*) FROM source_facts WHERE tenant_id = ? AND source_item_id = ?) AS facts,
       (SELECT COUNT(*) FROM relay_events WHERE tenant_id = ? AND source_item_id = ?) AS events`,
    [tenantId, sourceItemId, tenantId, sourceItemId],
  );
  return { events: row?.events ?? 0, facts: row?.facts ?? 0 };
}
