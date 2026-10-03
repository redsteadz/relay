import { AppError } from "@relay/observability";

import { demoModeEnabled } from "@/lib/demo/mode";
import { localStoreSupported, openLocalStore, type LocalStore } from "@/lib/local-store";
import { logMobileError } from "@/lib/observability";

import type { InboxItem } from "../models/inboxPresentation";
import { assembleInbox, type InboxRows, type InboxVisibility } from "./inbox";

/**
 * The inbox, read from this device's own derived store.
 *
 * [ADR-0015](../../../../docs/decisions/0015-device-local-derived-store.md) put the rows the inbox
 * reads into `relay-local.db` and left rendering from them to a later change; this is that change.
 * The device derives facts and events from a capture before it uploads anything, so the phone
 * already knows what arrived. Reading the server first meant a capture was invisible until it had
 * been uploaded, processed by the pipeline and fetched back, which is a round trip a device that
 * already holds the answer should not have to wait for.
 *
 * The server stays authoritative. This answers the first paint and an offline open; the PostgREST
 * read replaces it as soon as it lands, which is what reconciles a locally derived event id with the
 * different id the server generated for the same capture.
 *
 * Column names mirror PostgREST on purpose, so both readers hand `assembleInbox` the same shapes and
 * an item cannot be explained one way here and another way there. The three adaptations below are
 * SQLite's, not Relay's: integers stand in for booleans, `attributes` is text rather than `jsonb`,
 * and a fact's value is stored as JSON text.
 */

/** Matches the server read, so switching sources cannot change how much is shown. */
const INBOX_PAGE_SIZE = 200;

type LocalEventRow = {
  confidence: number | null;
  created_at: string;
  date_ambiguity: string | null;
  due_at: string | null;
  id: string;
  kind: string;
  requires_review: number;
  source_item_id: string;
  starts_at: string | null;
  summary: string | null;
  temporal_status: string;
  title: string;
};

type LocalFactRow = {
  certainty: string;
  created_at: string;
  id: string;
  kind: string;
  source_item_id: string;
  uncertainty_reason: string | null;
  value: string | null;
};

type LocalSourceItemRow = {
  application_id: string | null;
  gmail_thread_id: string | null;
  id: string;
  occurred_at: string;
  processed_at: string | null;
  raw_expires_at: string | null;
  sender: string | null;
  source: string;
  subject: string | null;
};

type LocalClassificationRow = {
  category_id: string | null;
  confidence: number | null;
  filter_rule_id: string | null;
  method: string;
  origin: string;
  rationale: string | null;
  source_item_id: string;
};

type LocalCategoryRow = { id: string; name: string; quiet_by_default: number; slug: string };

type LocalHiddenRow = { event_id: string };

/**
 * A stored fact value, back to the shape PostgREST would have returned.
 *
 * Unparseable text resolves to undefined rather than throwing: the presentation layer already drops a
 * value it cannot use, and one malformed row must not cost a reader the whole list.
 */
function factValue(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function readRows(database: LocalStore, tenantId: string): Promise<InboxRows> {
  const [events, facts, items, classifications, categories, hidden] = await Promise.all([
    database.getAllAsync<LocalEventRow>(
      `SELECT id, kind, title, summary, starts_at, due_at, confidence, created_at, source_item_id,
              temporal_status, date_ambiguity, requires_review
         FROM relay_events
        WHERE tenant_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
      [tenantId, INBOX_PAGE_SIZE],
    ),
    database.getAllAsync<LocalFactRow>(
      `SELECT id, kind, certainty, value, uncertainty_reason, created_at, source_item_id
         FROM source_facts
        WHERE tenant_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
      [tenantId, INBOX_PAGE_SIZE],
    ),
    database.getAllAsync<LocalSourceItemRow>(
      `SELECT id, source, application_id, sender, subject, occurred_at, processed_at, raw_expires_at,
              json_extract(attributes, '$.gmailThreadId') AS gmail_thread_id
         FROM source_items
        WHERE tenant_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
      [tenantId, INBOX_PAGE_SIZE],
    ),
    // Superseded rows are history, exactly as server-side: only the current classification says
    // where a capture is now.
    database.getAllAsync<LocalClassificationRow>(
      `SELECT source_item_id, category_id, method, confidence, rationale, origin, filter_rule_id
         FROM classifications
        WHERE tenant_id = ? AND superseded_at IS NULL
        LIMIT ?`,
      [tenantId, INBOX_PAGE_SIZE],
    ),
    database.getAllAsync<LocalCategoryRow>(
      "SELECT id, name, slug, quiet_by_default FROM categories WHERE tenant_id = ?",
      [tenantId],
    ),
    database.getAllAsync<LocalHiddenRow>(
      "SELECT event_id FROM hidden_inbox_events WHERE tenant_id = ?",
      [tenantId],
    ),
  ]);

  return {
    categories: categories.map((row) => ({
      id: row.id,
      name: row.name,
      quiet_by_default: row.quiet_by_default === 1,
      slug: row.slug,
    })),
    classifications,
    // `kind` is whatever the extractor stored, so it is asserted into the union exactly as the
    // PostgREST read asserts its own rows. The presentation layer names an unrecognised kind a
    // "Record" rather than trusting it, so a stored value outside the union degrades rather than
    // throwing.
    events: events.map((row) => ({
      ...row,
      requires_review: row.requires_review === 1,
    })) as InboxRows["events"],
    facts: facts.map((row) => ({ ...row, value: factValue(row.value) })) as InboxRows["facts"],
    hidden,
    items,
  };
}

/**
 * Reads the inbox from the local store, or reports nothing when there is no local store to read.
 *
 * A failure here is never the screen's failure. The server read is authoritative and runs alongside
 * this one, so an unopenable or unreadable local database costs a fast first paint rather than the
 * inbox, and is logged once here as the terminal boundary for that attempt.
 */
export async function listLocalInbox(
  tenantId: string,
  now = new Date().toISOString(),
  visibility: InboxVisibility = "visible",
): Promise<readonly InboxItem[]> {
  // A demo build answers its inbox from the demo tables, and this store is not one of its three
  // replaced seams. It must not be read there: a demo APK carries the same application id as a real
  // one, so installing it over a real install keeps that install's data directory and this database
  // with it. Falling back to it when the demo client could not answer would show a reader their own
  // captures inside a build whose whole claim is that it holds nothing real.
  if (demoModeEnabled()) return [];
  if (!localStoreSupported()) return [];
  try {
    const database = await openLocalStore();
    const rows = await readRows(database, tenantId);
    return await assembleInbox(rows, tenantId, now, visibility);
  } catch (error: unknown) {
    logMobileError(
      "database.local_inbox_read_failed",
      new AppError("Local inbox read failed", {
        category: "database",
        cause: error,
        code: "LOCAL_INBOX_READ_FAILED",
        integration: "expo-sqlite",
        operation: "listLocalInbox",
        retryable: false,
      }),
      {
        code: "LOCAL_INBOX_READ_FAILED",
        integration: "expo-sqlite",
        operation: "listLocalInbox",
      },
    );
    return [];
  }
}
