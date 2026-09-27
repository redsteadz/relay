/**
 * Turning a synthetic capture into the rows the inbox reads.
 *
 * This is the pipeline's own derivation, run locally: `normalizeSourceFacts` and
 * `extractSourceEvents` from `@relay/domain` are the same pure functions the Workflow calls, so a
 * demo capture produces exactly the facts and the event a real one would. Nothing here decides a
 * category -- filing is left to the device classification pass the inbox already runs, which is the
 * point of generating captures at all.
 */

import { RAW_PAYLOAD_RETENTION_MS, type SourceEvent, type SourceFact } from "@relay/contracts";
import { extractSourceEvents, normalizeSourceFacts } from "@relay/domain";
import { ingressEnvelopeSchema } from "@relay/contracts";

import { DEMO_USER_ID } from "./account";
import { demoRandomUuid, demoUuid } from "./ids";
import type { DemoRow, DemoTables } from "./types";

/** The seeded rule that proposes a task for anything with a deadline. */
export const DEMO_TASK_ACTION_RULE_ID = demoUuid("action-rule:google-tasks");

export type DemoCaptureInput = {
  applicationId?: string | undefined;
  attributes?: Record<string, unknown> | undefined;
  body?: string | undefined;
  capturedAt?: string | undefined;
  externalId?: string | undefined;
  occurredAt?: string | undefined;
  /**
   * Whether this device kept its own copy of what the capture said.
   *
   * False models a capture another runtime made -- a Gmail message, whose body is encrypted to a key
   * this device does not hold. The inbox then has no readable body, and a rule that reads one
   * reports the field as unavailable rather than silently failing to match.
   */
  retainContent?: boolean | undefined;
  sender?: string | undefined;
  sourceKind: "gmail" | "notification" | "sms";
  subject?: string | undefined;
  threadId?: string | undefined;
};

export type DemoCaptureResult = {
  eventIds: readonly string[];
  factCount: number;
  proposedActions: number;
  sourceItemId: string;
};

/**
 * Canonical fact instants carry nanoseconds; a `timestamptz` column does not.
 *
 * Postgres truncates on write and PostgREST returns the truncated value, so the demo truncates at
 * the same boundary. Fact values themselves are stored exactly as the normalizer emitted them,
 * because that is what `jsonb` holds.
 */
function timestampColumn(instant: string): string {
  return `${instant.slice(0, 23)}Z`;
}

function factRow(fact: SourceFact, sourceItemId: string, createdAt: string): DemoRow {
  return {
    certainty: fact.certainty,
    created_at: createdAt,
    id: demoRandomUuid(),
    kind: fact.kind,
    source_item_id: sourceItemId,
    uncertainty_reason: "uncertaintyReason" in fact ? fact.uncertaintyReason : null,
    user_id: DEMO_USER_ID,
    value: "value" in fact ? fact.value : null,
  };
}

function eventRow(event: SourceEvent, sourceItemId: string, createdAt: string): DemoRow {
  return {
    confidence: event.confidence,
    created_at: createdAt,
    date_ambiguity: event.dateAmbiguity ?? null,
    due_at: event.dueAt === undefined ? null : timestampColumn(event.dueAt),
    id: demoRandomUuid(),
    kind: event.kind,
    requires_review: event.requiresReview,
    source_item_id: sourceItemId,
    starts_at: event.startsAt === undefined ? null : timestampColumn(event.startsAt),
    summary: event.summary,
    temporal_status: event.temporalStatus,
    title: event.title,
    user_id: DEMO_USER_ID,
  };
}

/**
 * Proposes the one action the demo's seeded rule covers.
 *
 * A proposal is only ever created for an event that carries a deadline, and it is created
 * `awaiting-approval` so nothing external is implied to have happened. Approving it is what moves
 * the run, and that decision is recorded rather than performed: the demo has no provider to call.
 */
function proposeActions(
  tables: DemoTables,
  events: readonly { event: SourceEvent; id: string }[],
  createdAt: string,
): number {
  const rules = tables.action_rules ?? [];
  if (!rules.some((rule) => rule.id === DEMO_TASK_ACTION_RULE_ID)) return 0;

  let proposed = 0;
  for (const { event, id } of events) {
    if (event.dueAt === undefined) continue;
    (tables.action_runs ??= []).unshift({
      action_rule_id: DEMO_TASK_ACTION_RULE_ID,
      approved_at: null,
      attempt_count: 0,
      completed_at: null,
      created_at: createdAt,
      error_code: null,
      event_id: id,
      id: demoRandomUuid(),
      input: { due: timestampColumn(event.dueAt), title: event.title },
      provider: "google-tasks",
      status: "awaiting-approval",
      user_id: DEMO_USER_ID,
    });
    proposed += 1;
  }
  return proposed;
}

export function applyCapture(tables: DemoTables, input: DemoCaptureInput): DemoCaptureResult {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const occurredAt = input.occurredAt ?? capturedAt;
  const sourceItemId = demoRandomUuid();

  const envelope = ingressEnvelopeSchema.parse({
    attributes: input.attributes ?? {},
    capturedAt,
    id: sourceItemId,
    occurredAt,
    schemaVersion: 1,
    source: {
      externalId: input.externalId ?? sourceItemId,
      kind: input.sourceKind,
      ...(input.applicationId === undefined ? {} : { applicationId: input.applicationId }),
    },
    ...(input.body === undefined ? {} : { body: input.body }),
    ...(input.sender === undefined ? {} : { sender: input.sender }),
    ...(input.subject === undefined ? {} : { subject: input.subject }),
  });

  const factSet = normalizeSourceFacts(envelope);
  const eventSet = extractSourceEvents(factSet);

  (tables.source_items ??= []).unshift({
    application_id: input.applicationId ?? null,
    attributes: input.threadId === undefined ? {} : { gmailThreadId: input.threadId },
    created_at: capturedAt,
    id: sourceItemId,
    occurred_at: occurredAt,
    processed_at: capturedAt,
    raw_expires_at: new Date(Date.parse(capturedAt) + RAW_PAYLOAD_RETENTION_MS).toISOString(),
    sender: input.sender ?? null,
    source: input.sourceKind,
    subject: input.subject ?? null,
    user_id: DEMO_USER_ID,
  });

  const facts = (tables.source_facts ??= []);
  for (const fact of factSet.facts) facts.unshift(factRow(fact, sourceItemId, capturedAt));

  const events = (tables.relay_events ??= []);
  const created: { event: SourceEvent; id: string }[] = [];
  for (const event of eventSet.events) {
    const row = eventRow(event, sourceItemId, capturedAt);
    events.unshift(row);
    created.push({ event, id: row.id as string });
  }

  if (input.retainContent !== false && (input.body !== undefined || input.subject !== undefined)) {
    (tables.retained_content ??= []).unshift({
      body: input.body ?? null,
      source_item_id: sourceItemId,
      subject: input.subject ?? null,
      user_id: DEMO_USER_ID,
    });
  }

  return {
    eventIds: created.map((entry) => entry.id),
    factCount: factSet.facts.length,
    proposedActions: proposeActions(tables, created, capturedAt),
    sourceItemId,
  };
}
