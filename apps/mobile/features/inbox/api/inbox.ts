import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@relay/observability";

import { logMobileError } from "@/lib/observability";

import {
  inboxItemForEvent,
  inboxItemForFact,
  type InboxEventInput,
  type InboxFactInput,
  type InboxItem,
} from "../models/inboxPresentation";

// Facts and events are tenant-owned and readable under row-level security, so this module talks to
// PostgREST rather than the Relay API, matching how categories are read. Both tables grant `select`
// to `authenticated` and scope every row to `auth.uid()`, so ownership is decided by the database
// and never by this layer.
const eventColumns =
  "id, kind, title, summary, starts_at, due_at, confidence, created_at, source_item_id, temporal_status, date_ambiguity, requires_review";
const factColumns = "id, kind, certainty, value, uncertainty_reason, created_at, source_item_id";

/** Bounded so one very active tenant cannot turn a first paint into an unbounded read. */
const INBOX_PAGE_SIZE = 200;

export class InboxError extends AppError {
  constructor(cause: unknown, operation: string) {
    super("Inbox request failed", {
      category: "database",
      cause,
      code: "INBOX_READ_FAILED",
      integration: "supabase-postgrest",
      operation,
      retryable: true,
    });
    this.name = "InboxError";
  }
}

function inboxError(cause: unknown, operation: string): InboxError {
  const normalized = new InboxError(cause, operation);
  logMobileError("database.inbox_read_failed", normalized, {
    code: normalized.code,
    integration: "supabase-postgrest",
    operation,
  });
  return normalized;
}

type EventRow = {
  confidence: number | null;
  created_at: string;
  date_ambiguity: string | null;
  due_at: string | null;
  id: string;
  kind: InboxEventInput["kind"];
  requires_review: boolean;
  source_item_id: string;
  starts_at: string | null;
  summary: string | null;
  temporal_status: string;
  title: string;
};

type FactRow = {
  certainty: string;
  created_at: string;
  id: string;
  kind: InboxFactInput["kind"];
  source_item_id: string;
  uncertainty_reason: string | null;
  value: unknown;
};

function eventInput(row: EventRow): InboxEventInput {
  return {
    confidence: row.confidence,
    createdAt: row.created_at,
    dateAmbiguity: row.date_ambiguity,
    dueAt: row.due_at,
    id: row.id,
    kind: row.kind,
    requiresReview: row.requires_review,
    sourceItemId: row.source_item_id,
    startsAt: row.starts_at,
    summary: row.summary,
    temporalStatus: row.temporal_status,
    title: row.title,
  };
}

function factInput(row: FactRow): InboxFactInput {
  return {
    certainty: row.certainty,
    createdAt: row.created_at,
    id: row.id,
    kind: row.kind,
    sourceItemId: row.source_item_id,
    uncertaintyReason: row.uncertainty_reason,
    value: row.value,
  };
}

/**
 * Reads one tenant's inbox.
 *
 * Events and facts are fetched independently because they are separate observations rather than one
 * joined record: an event cites the source item it came from, and a fact describes that same item
 * without belonging to any event. Reading them together would either drop facts that no event cites
 * or duplicate facts across the events that do.
 */
export async function listInbox(client: SupabaseClient): Promise<InboxItem[]> {
  const [events, facts] = await Promise.all([
    client
      .from("relay_events")
      .select(eventColumns)
      .order("created_at", { ascending: false })
      .limit(INBOX_PAGE_SIZE),
    client
      .from("source_facts")
      .select(factColumns)
      .order("created_at", { ascending: false })
      .limit(INBOX_PAGE_SIZE),
  ]);

  if (events.error !== null) throw inboxError(events.error, "listRelayEvents");
  if (facts.error !== null) throw inboxError(facts.error, "listSourceFacts");

  return [
    ...((events.data ?? []) as EventRow[]).map((row) => inboxItemForEvent(eventInput(row))),
    ...((facts.data ?? []) as FactRow[]).map((row) => inboxItemForFact(factInput(row))),
  ];
}
