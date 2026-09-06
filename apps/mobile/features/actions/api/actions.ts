/**
 * Proposed action access.
 *
 * `action_runs` and `action_rules` are tenant-owned and readable under row-level security, so these
 * reads go straight to PostgREST the way the inbox, categories, and the activity ledger do. Every
 * table scopes rows to `auth.uid()`, so ownership is decided by the database and never by this
 * layer.
 *
 * Writes do not go the same way. `action_runs` withholds insert, update, and delete from
 * `authenticated` entirely; the only path a person's decision can take is `decide_action_run`, which
 * validates the transition under a row lock and writes its own audit record. Calling the routine
 * rather than updating the row is what makes an approval a ledger entry instead of an edit.
 */

import { actionDecisionSchema, type ActionDecision } from "@relay/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@relay/observability";

import { logMobileError } from "@/lib/observability";

import type { ActionRuleInput, ActionRunInput } from "../models/actionPresentation";

/**
 * `input` is read by two keys rather than whole.
 *
 * Selecting the entire blob would silently widen what the inbox reads whenever a provider adapter
 * adds a field, and the two keys here are the only ones a proposal is named by.
 */
const runColumns =
  "id, action_rule_id, event_id, provider, status, created_at, title:input->>title, due:input->>due";
const ruleColumns = "id, operation";

/** Statuses a person can still answer. Matches `ACTION_DECISION_SOURCE_STATUSES` in the domain. */
const OPEN_STATUSES = ["proposed", "awaiting-approval", "approved"] as const;

/** Bounded so one very active tenant cannot turn a first paint into an unbounded read. */
const ACTION_PAGE_SIZE = 200;

export class ProposedActionError extends AppError {
  constructor(cause: unknown, operation: string) {
    super("Proposed action request failed", {
      category: "database",
      cause,
      code: "PROPOSED_ACTION_READ_FAILED",
      integration: "supabase-postgrest",
      operation,
      retryable: true,
    });
    this.name = "ProposedActionError";
  }
}

export class ActionDecisionError extends AppError {
  constructor(cause: unknown, decision: ActionDecision) {
    super("Action decision failed", {
      category: "database",
      cause,
      code: "ACTION_DECISION_FAILED",
      integration: "supabase-postgrest",
      operation: decision === "approve" ? "approveActionRun" : "cancelActionRun",
      retryable: false,
    });
    this.name = "ActionDecisionError";
  }
}

function readError(cause: unknown, operation: string): ProposedActionError {
  const normalized = new ProposedActionError(cause, operation);
  logMobileError("database.proposed_action_read_failed", normalized, {
    code: normalized.code,
    integration: "supabase-postgrest",
    operation,
  });
  return normalized;
}

type RunRow = {
  action_rule_id: string;
  created_at: string;
  due: string | null;
  event_id: string;
  id: string;
  provider: string;
  status: string;
  title: string | null;
};

type RuleRow = { id: string; operation: string };

export type ProposedActionLedger = {
  rules: readonly ActionRuleInput[];
  runs: readonly ActionRunInput[];
};

/**
 * Reads every run still open to a decision, and the rules that name them.
 *
 * `approved` is included alongside the undecided states because it is still cancellable until a
 * Workflow claims it. A screen that dropped it the moment it was approved would remove the only
 * place a person could change their mind while that was still possible.
 */
export async function loadProposedActions(client: SupabaseClient): Promise<ProposedActionLedger> {
  const runsResult = await client
    .from("action_runs")
    .select(runColumns)
    .in("status", OPEN_STATUSES)
    .order("created_at", { ascending: false })
    .limit(ACTION_PAGE_SIZE);
  if (runsResult.error !== null) throw readError(runsResult.error, "loadProposedActions.runs");
  const runRows = (runsResult.data ?? []) as RunRow[];

  const runs: ActionRunInput[] = runRows.map((row) => ({
    actionRuleId: row.action_rule_id,
    createdAt: row.created_at,
    due: row.due,
    eventId: row.event_id,
    id: row.id,
    provider: row.provider,
    status: row.status,
    title: row.title,
  }));

  const ruleIds = [...new Set(runs.map((run) => run.actionRuleId))];
  if (ruleIds.length === 0) return { rules: [], runs };

  const rulesResult = await client.from("action_rules").select(ruleColumns).in("id", ruleIds);
  if (rulesResult.error !== null) throw readError(rulesResult.error, "loadProposedActions.rules");
  const rules = ((rulesResult.data ?? []) as RuleRow[]).map((row) => ({
    id: row.id,
    operation: row.operation,
  }));

  return { rules, runs };
}

/**
 * Records the tenant's decision about one proposed action.
 *
 * The routine is the authority on whether the transition is legal, so nothing is checked twice here:
 * a run that stopped being decidable between the read and the tap is refused by the database rather
 * than by a stale copy of its status, and the refusal surfaces as a failed decision the caller
 * reverses.
 */
export async function decideActionRun(
  client: SupabaseClient,
  actionRunId: string,
  decision: ActionDecision,
): Promise<void> {
  const parsed = actionDecisionSchema.safeParse(decision);
  if (!parsed.success) throw new ActionDecisionError(parsed.error, decision);
  const { error } = await client.rpc("decide_action_run", {
    p_action_run_id: actionRunId,
    p_decision: parsed.data,
  });
  if (error !== null) {
    const normalized = new ActionDecisionError(error, decision);
    logMobileError("database.action_decision_failed", normalized, {
      code: normalized.code,
      integration: "supabase-postgrest",
      metadata: { decision: parsed.data },
      operation: decision === "approve" ? "approveActionRun" : "cancelActionRun",
    });
    throw normalized;
  }
}
