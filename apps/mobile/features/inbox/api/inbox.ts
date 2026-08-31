import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@relay/observability";

import { logMobileError } from "@/lib/observability";

import {
  inboxItemForEvent,
  inboxRetention,
  type InboxCategory,
  type InboxContext,
  type InboxEventInput,
  type InboxFactInput,
  type InboxItem,
} from "../models/inboxPresentation";

// Facts, events, source items, classifications, and categories are tenant-owned and readable under
// row-level security, so this module talks to PostgREST rather than the Relay API, matching how
// categories are read. Every table scopes rows to `auth.uid()`, so ownership is decided by the
// database and never by this layer. The encrypted raw payload is deliberately not read: the inbox
// explains an item from derived fields, and the raw copy expires after seven days.
const eventColumns =
  "id, kind, title, summary, starts_at, due_at, confidence, created_at, source_item_id, temporal_status, date_ambiguity, requires_review";
const factColumns = "id, kind, certainty, value, uncertainty_reason, created_at, source_item_id";
const sourceItemColumns =
  "id, source, application_id, sender, subject, occurred_at, processed_at, raw_expires_at";
const classificationColumns = "source_item_id, category_id, method, confidence, rationale";
const categoryColumns = "id, name";

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

type SourceItemRow = {
  application_id: string | null;
  id: string;
  occurred_at: string;
  processed_at: string | null;
  raw_expires_at: string | null;
  sender: string | null;
  source: string;
  subject: string | null;
};

type ClassificationRow = {
  category_id: string | null;
  confidence: number | null;
  method: string;
  rationale: string | null;
  source_item_id: string;
};

type CategoryRow = { id: string; name: string };

/**
 * Context for an item whose source row is missing.
 *
 * A derived item can outlive the source row that produced it, and dropping the item would hide work
 * rather than explain it. The unknown source is stated instead of guessed.
 */
function unknownContext(occurredAt: string): InboxContext {
  return {
    category: undefined,
    processing: "pending",
    retention: { rawExpired: false, rawExpiresAt: undefined },
    source: {
      applicationId: undefined,
      kind: "unknown",
      occurredAt,
      sender: undefined,
      subject: undefined,
    },
  };
}

function buildContext(
  sourceItemId: string,
  fallbackOccurredAt: string,
  sourceItems: Map<string, SourceItemRow>,
  classifications: Map<string, ClassificationRow>,
  categoryNames: Map<string, string>,
  now: string,
): InboxContext {
  const item = sourceItems.get(sourceItemId);
  if (item === undefined) return unknownContext(fallbackOccurredAt);

  const classification = classifications.get(sourceItemId);
  const category: InboxCategory | undefined =
    classification === undefined
      ? undefined
      : {
          confidence: classification.confidence ?? undefined,
          method: classification.method,
          name:
            classification.category_id === null
              ? undefined
              : categoryNames.get(classification.category_id),
          rationale: classification.rationale ?? undefined,
        };

  return {
    category,
    processing: item.processed_at === null ? "pending" : "processed",
    retention: inboxRetention(item.raw_expires_at, now),
    source: {
      applicationId: item.application_id ?? undefined,
      kind: item.source,
      occurredAt: item.occurred_at,
      sender: item.sender ?? undefined,
      subject: item.subject ?? undefined,
    },
  };
}

/**
 * Reads one tenant's inbox.
 *
 * Events and facts are fetched independently because they are separate observations rather than one
 * joined record: an event cites the source item it came from, and a fact describes that same item
 * without belonging to any event. Reading them together would either drop facts that no event cites
 * or duplicate facts across the events that do. Source items, classifications, and category names
 * are read alongside so each item can explain where it came from and which decision placed it.
 */
export async function listInbox(client: SupabaseClient, now = new Date().toISOString()) {
  const [events, facts, items, classifications, categories] = await Promise.all([
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
    client
      .from("source_items")
      .select(sourceItemColumns)
      .order("created_at", { ascending: false })
      .limit(INBOX_PAGE_SIZE),
    client.from("classifications").select(classificationColumns).limit(INBOX_PAGE_SIZE),
    client.from("categories").select(categoryColumns),
  ]);

  if (events.error !== null) throw inboxError(events.error, "listRelayEvents");
  if (facts.error !== null) throw inboxError(facts.error, "listSourceFacts");
  if (items.error !== null) throw inboxError(items.error, "listSourceItems");
  if (classifications.error !== null)
    throw inboxError(classifications.error, "listClassifications");
  if (categories.error !== null) throw inboxError(categories.error, "listCategories");

  const itemsById = new Map(
    ((items.data ?? []) as SourceItemRow[]).map((row) => [row.id, row] as const),
  );
  const classificationsByItem = new Map(
    ((classifications.data ?? []) as ClassificationRow[]).map(
      (row) => [row.source_item_id, row] as const,
    ),
  );
  const categoryNames = new Map(
    ((categories.data ?? []) as CategoryRow[]).map((row) => [row.id, row.name] as const),
  );

  const context = (sourceItemId: string, fallbackOccurredAt: string): InboxContext =>
    buildContext(
      sourceItemId,
      fallbackOccurredAt,
      itemsById,
      classificationsByItem,
      categoryNames,
      now,
    );

  // Facts support the event extracted from the same source item. They are grouped here rather than
  // listed, because a raw fact is evidence for an observation rather than an observation itself.
  const factsByItem = new Map<string, InboxFactInput[]>();
  for (const row of (facts.data ?? []) as FactRow[]) {
    const fact: InboxFactInput = {
      certainty: row.certainty,
      createdAt: row.created_at,
      id: row.id,
      kind: row.kind,
      sourceItemId: row.source_item_id,
      uncertaintyReason: row.uncertainty_reason,
      value: row.value,
    };
    const existing = factsByItem.get(row.source_item_id);
    if (existing === undefined) factsByItem.set(row.source_item_id, [fact]);
    else existing.push(fact);
  }

  const inbox: InboxItem[] = [
    ...((events.data ?? []) as EventRow[]).map((row) =>
      inboxItemForEvent(
        {
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
        },
        context(row.source_item_id, row.created_at),
        factsByItem.get(row.source_item_id) ?? [],
      ),
    ),
  ];

  return inbox;
}
