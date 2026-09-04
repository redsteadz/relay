/**
 * Activity ledger access.
 *
 * `action_runs`, `action_rules`, and `relay_events` are tenant-owned and readable under row-level
 * security, so these reads go straight to PostgREST the way the inbox and categories do. Every table
 * scopes rows to `auth.uid()`, so ownership is decided by the database and never by this layer.
 *
 * Disclosures are deliberately not read here. They already have one read path through the Relay API
 * (`getDisclosureHistory`), and that route is what bounds and shapes a disclosure record for
 * display; a second reader straight off `ai_disclosures` would be a second place for the redaction
 * contract to drift.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@relay/observability";

import { logMobileError } from "@/lib/observability";

import type {
  ActionRuleInput,
  ActionRunInput,
  ActivityEventInput,
} from "../models/activityPresentation";

const runColumns =
  "id, action_rule_id, event_id, provider, status, attempt_count, error_code, approved_at, completed_at, created_at";
const ruleColumns = "id, operation, approval_mode";
const eventColumns = "id, title";

/**
 * Bounded so one very active tenant cannot turn a first paint into an unbounded read.
 *
 * Matches the inbox page size for the same reason.
 */
const ACTIVITY_PAGE_SIZE = 200;

export class ActivityError extends AppError {
  constructor(cause: unknown, operation: string) {
    super("Activity request failed", {
      category: "database",
      cause,
      code: "ACTIVITY_READ_FAILED",
      integration: "supabase-postgrest",
      operation,
      retryable: true,
    });
    this.name = "ActivityError";
  }
}

function activityError(cause: unknown, operation: string): ActivityError {
  const normalized = new ActivityError(cause, operation);
  logMobileError("database.activity_read_failed", normalized, {
    code: normalized.code,
    integration: "supabase-postgrest",
    operation,
  });
  return normalized;
}

type RunRow = {
  action_rule_id: string;
  approved_at: string | null;
  attempt_count: number;
  completed_at: string | null;
  created_at: string;
  error_code: string | null;
  event_id: string;
  id: string;
  provider: string;
  status: string;
};

type RuleRow = { approval_mode: string; id: string; operation: string };
type EventRow = { id: string; title: string };

export type ActivityLedger = {
  events: ActivityEventInput[];
  rules: ActionRuleInput[];
  runs: ActionRunInput[];
};

/**
 * Reads the ledger and just enough of its context to describe it.
 *
 * The three tables are queried separately and joined in memory rather than through a PostgREST
 * embed. The rows are small and bounded, and separate reads keep each one's row-level security
 * policy doing its own work instead of relying on an embedded query resolving them together.
 */
export async function loadActivityLedger(client: SupabaseClient): Promise<ActivityLedger> {
  const runsResult = await client
    .from("action_runs")
    .select(runColumns)
    .order("created_at", { ascending: false })
    .limit(ACTIVITY_PAGE_SIZE);
  if (runsResult.error !== null) throw activityError(runsResult.error, "loadActivityLedger.runs");
  const runRows = (runsResult.data ?? []) as RunRow[];

  const runs: ActionRunInput[] = runRows.map((row) => ({
    actionRuleId: row.action_rule_id,
    approvedAt: row.approved_at,
    attemptCount: row.attempt_count,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    errorCode: row.error_code,
    eventId: row.event_id,
    id: row.id,
    provider: row.provider,
    status: row.status,
  }));

  // Nothing was proposed, so there is no rule or event worth naming. Skipping both reads keeps an
  // empty timeline to a single round trip.
  if (runs.length === 0) return { events: [], rules: [], runs };

  const ruleIds = [...new Set(runs.map((run) => run.actionRuleId))];
  const eventIds = [...new Set(runs.map((run) => run.eventId))];

  const [rulesResult, eventsResult] = await Promise.all([
    client.from("action_rules").select(ruleColumns).in("id", ruleIds),
    client.from("relay_events").select(eventColumns).in("id", eventIds),
  ]);
  if (rulesResult.error !== null)
    throw activityError(rulesResult.error, "loadActivityLedger.rules");
  if (eventsResult.error !== null)
    throw activityError(eventsResult.error, "loadActivityLedger.events");

  return {
    events: ((eventsResult.data ?? []) as EventRow[]).map((row) => ({
      id: row.id,
      title: row.title,
    })),
    rules: ((rulesResult.data ?? []) as RuleRow[]).map((row) => ({
      approvalMode: row.approval_mode,
      id: row.id,
      operation: row.operation,
    })),
    runs,
  };
}
