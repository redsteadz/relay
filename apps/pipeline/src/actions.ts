import {
  actionProposalRequestSchema,
  actionRunCompletionSchema,
  actionRunFailureSchema,
  actionRunSchema,
  actionWorkflowClaimSchema,
  type ActionProposalRequest,
  type ActionRun,
  type ActionRunCompletion,
  type ActionRunFailure,
  type ActionWorkflowClaim,
} from "@relay/contracts";

import { supabaseBackendHeaders, type PersistenceConfiguration } from "./configuration";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export class ActionLedgerError extends Error {
  constructor(
    readonly reason:
      | "action_ledger_conflict"
      | "action_ledger_rejected"
      | "action_ledger_response_invalid"
      | "action_ledger_unavailable"
      | "action_rule_unavailable",
  ) {
    super("Action ledger operation failed");
  }
}

/**
 * Maps a PostgREST failure to a fixed reason.
 *
 * `P0002` is the routines' "unavailable or not eligible" code: a rule that is disabled, an event or
 * run that does not belong to this tenant, or a status that does not permit the transition. They are
 * deliberately one reason, because distinguishing them to a caller would report whether another
 * tenant's row exists. `55006` is a run already claimed by a different workflow.
 */
function ledgerFailure(status: number, body: unknown): ActionLedgerError {
  const code = (body as { code?: unknown } | null)?.code;
  if (code === "P0002") return new ActionLedgerError("action_rule_unavailable");
  if (code === "55006") return new ActionLedgerError("action_ledger_conflict");
  if (status >= 400 && status < 500) return new ActionLedgerError("action_ledger_rejected");
  return new ActionLedgerError("action_ledger_unavailable");
}

/**
 * Shapes one `action_runs` row into the wire contract.
 *
 * PostgREST returns a `returns public.action_runs` routine as a single object. Anything else -- a
 * set, a null, a scalar -- means the routine is not the one this build expects, so it is rejected
 * rather than coerced.
 */
function readActionRun(value: unknown): ActionRun {
  const row: unknown = Array.isArray(value) ? value[0] : value;
  if (typeof row !== "object" || row === null) {
    throw new ActionLedgerError("action_ledger_response_invalid");
  }
  const record = row as Record<string, unknown>;
  const parsed = actionRunSchema.safeParse({
    id: record.id,
    userId: record.user_id,
    actionRuleId: record.action_rule_id,
    eventId: record.event_id,
    provider: record.provider,
    status: record.status,
    approvalMode: record.approval_mode,
    input: record.input,
    attemptCount: record.attempt_count,
    providerReference: record.provider_reference ?? null,
    workflowInstanceId: record.workflow_instance_id ?? null,
    approvedAt: record.approved_at ?? null,
    completedAt: record.completed_at ?? null,
    createdAt: record.created_at,
  });
  if (!parsed.success) throw new ActionLedgerError("action_ledger_response_invalid");
  return parsed.data;
}

async function callLedgerRoutine(
  configuration: PersistenceConfiguration,
  routine: string,
  body: Record<string, unknown>,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<ActionRun> {
  if (configuration.supabase === undefined) {
    throw new ActionLedgerError("action_ledger_unavailable");
  }

  let response: Response;
  try {
    response = await fetcher(`${configuration.supabase.url}/rest/v1/rpc/${routine}`, {
      method: "POST",
      headers: supabaseBackendHeaders(configuration.supabase.serviceRoleKey),
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch {
    throw new ActionLedgerError("action_ledger_unavailable");
  }

  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw ledgerFailure(response.status, payload);
  return readActionRun(payload);
}

/**
 * Proposes one action run for a rule and event.
 *
 * Identity is derived by the database from the rule/event pair, and the unique pair constraint makes
 * the routine idempotent: a redelivered message converges on the run it already created rather than
 * proposing a second action, and writes no second audit record.
 *
 * The request carries no provider, operation, connection, status, or approval mode. Those are read
 * from the persisted rule inside the routine, so nothing derived from source content or a model can
 * choose them.
 */
export async function proposeActionRun(
  configuration: PersistenceConfiguration,
  request: ActionProposalRequest,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<ActionRun> {
  const proposal = actionProposalRequestSchema.safeParse(request);
  if (!proposal.success) throw new ActionLedgerError("action_ledger_rejected");

  return callLedgerRoutine(
    configuration,
    "propose_action_run_v1",
    {
      p_user_id: proposal.data.userId,
      p_action_rule_id: proposal.data.actionRuleId,
      p_event_id: proposal.data.eventId,
      p_input: proposal.data.input,
    },
    fetcher,
    signal,
  );
}

/**
 * Claims an approved run for a Workflow attempt.
 *
 * This is the only path from ledger state to an external effect. It moves `approved` to `running`
 * under a row lock and re-checks that the owning rule is still enabled, so an approval that predates
 * a rule being disabled cannot start anything. A repeated claim from the same workflow instance
 * returns the running row without starting a second attempt; a different instance is a conflict.
 */
export async function claimActionRunForWorkflow(
  configuration: PersistenceConfiguration,
  claim: ActionWorkflowClaim,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<ActionRun> {
  const parsed = actionWorkflowClaimSchema.safeParse(claim);
  if (!parsed.success) throw new ActionLedgerError("action_ledger_rejected");

  return callLedgerRoutine(
    configuration,
    "claim_action_run_for_workflow_v1",
    {
      p_user_id: parsed.data.userId,
      p_action_run_id: parsed.data.actionRunId,
      p_workflow_instance_id: parsed.data.workflowInstanceId,
    },
    fetcher,
    signal,
  );
}

/**
 * Records the effect a claimed run produced.
 *
 * Called after the provider call has committed, so the reference is the provider's own identifier
 * for a thing that now exists. A redelivered step reporting the same reference converges on the row
 * it already wrote; a different reference for an already-settled run is refused, because two effects
 * for one approval is the failure this ledger exists to prevent.
 */
export async function completeActionRun(
  configuration: PersistenceConfiguration,
  completion: ActionRunCompletion,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<ActionRun> {
  const parsed = actionRunCompletionSchema.safeParse(completion);
  if (!parsed.success) throw new ActionLedgerError("action_ledger_rejected");

  return callLedgerRoutine(
    configuration,
    "complete_action_run_v1",
    {
      p_user_id: parsed.data.userId,
      p_action_run_id: parsed.data.actionRunId,
      p_workflow_instance_id: parsed.data.workflowInstanceId,
      p_provider_reference: parsed.data.providerReference,
    },
    fetcher,
    signal,
  );
}

/**
 * Records that an attempt produced no effect.
 *
 * `retryable` is decided by the provider layer, which is the only place that knows whether a status
 * was a transient refusal or a permanent rejection. The routine turns that into state: a retryable
 * failure returns the run to `approved` for a later attempt, a permanent one ends it. A failure
 * reported against a run that already succeeded is ignored rather than applied, since the response
 * proving success can be lost while the effect exists.
 */
export async function failActionRun(
  configuration: PersistenceConfiguration,
  failure: ActionRunFailure,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<ActionRun> {
  const parsed = actionRunFailureSchema.safeParse(failure);
  if (!parsed.success) throw new ActionLedgerError("action_ledger_rejected");

  return callLedgerRoutine(
    configuration,
    "fail_action_run_v1",
    {
      p_user_id: parsed.data.userId,
      p_action_run_id: parsed.data.actionRunId,
      p_workflow_instance_id: parsed.data.workflowInstanceId,
      p_error_code: parsed.data.errorCode,
      p_retryable: parsed.data.retryable,
    },
    fetcher,
    signal,
  );
}
