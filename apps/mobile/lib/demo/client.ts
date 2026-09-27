/**
 * The Supabase client the app is handed in demo mode.
 *
 * `createConfiguredClient` is the single place a client is built, so replacing it there leaves every
 * feature module, hook and screen reading exactly what it reads against the real backend. Auth is a
 * local session rather than a stub because screens branch on whether one exists, and the routines
 * are implemented rather than faked away: `record_device_classification_v1` supersedes the row it
 * replaces and fixes `origin`, `method` and `confidence` the way the migration does, because the
 * inbox distinguishes a device decision from a server one and would be wrong if this did not.
 */

import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { canDecideActionRun } from "@relay/domain";
import type { ActionDecision, ActionRunStatus } from "@relay/contracts";

import { createDemoSession, DEMO_USER_ID } from "./account";
import { demoRandomUuid } from "./ids";
import { demoTableQuery, type DemoQueryError } from "./postgrest";
import { demoDatabase } from "./store";
import type { DemoRow } from "./types";

type AuthChange = (event: string, session: Session | null) => void;

type RpcResult = { data: unknown; error: DemoQueryError | null };

function rpcError(code: string, message: string): DemoQueryError {
  return { code, details: null, hint: null, message };
}

class DemoAuth {
  private listeners = new Set<AuthChange>();
  private session: Session | null = createDemoSession();

  getSession(): Promise<{ data: { session: Session | null }; error: null }> {
    return Promise.resolve({ data: { session: this.session }, error: null });
  }

  onAuthStateChange(callback: AuthChange): {
    data: { subscription: { unsubscribe: () => void } };
  } {
    this.listeners.add(callback);
    return {
      data: {
        subscription: {
          unsubscribe: () => {
            this.listeners.delete(callback);
          },
        },
      },
    };
  }

  /**
   * A demo sign-in completes immediately.
   *
   * There is no mailbox to check, so asking for a link is the whole flow: the screen still shows its
   * confirmation, and the session it was waiting for is already there when the stack re-evaluates
   * its guard. Signing out and back in is what makes the sign-in surface demonstrable at all.
   */
  signInWithOtp(): Promise<{ data: { session: null; user: null }; error: null }> {
    this.session = createDemoSession();
    this.emit("SIGNED_IN");
    return Promise.resolve({ data: { session: null, user: null }, error: null });
  }

  exchangeCodeForSession(): Promise<{ data: { session: Session }; error: null }> {
    const session = createDemoSession();
    this.session = session;
    this.emit("SIGNED_IN");
    return Promise.resolve({ data: { session }, error: null });
  }

  signOut(): Promise<{ error: null }> {
    this.session = null;
    this.emit("SIGNED_OUT");
    return Promise.resolve({ error: null });
  }

  startAutoRefresh(): Promise<void> {
    return Promise.resolve();
  }

  stopAutoRefresh(): Promise<void> {
    return Promise.resolve();
  }

  private emit(event: string): void {
    for (const listener of [...this.listeners]) listener(event, this.session);
  }
}

function recordDeviceClassification(parameters: Record<string, unknown>): RpcResult {
  const sourceItemId = parameters.p_source_item_id;
  const filterRuleId = parameters.p_filter_rule_id;
  if (typeof sourceItemId !== "string" || typeof filterRuleId !== "string") {
    return { data: null, error: rpcError("22023", "Classification arguments are invalid") };
  }
  const rows = demoDatabase.rows("classifications");
  const current = rows.find(
    (row) => row.source_item_id === sourceItemId && (row.superseded_at ?? null) === null,
  );
  // A device refines its own earlier answer and never overrules one made where the whole payload
  // was readable. The migration enforces this; agreeing with it here keeps the two consistent.
  if (current !== undefined && current.origin !== "device") return { data: null, error: null };
  if (current !== undefined) current.superseded_at = new Date().toISOString();

  rows.unshift({
    category_id: parameters.p_category_id ?? null,
    confidence: 1,
    created_at: new Date().toISOString(),
    filter_rule_id: filterRuleId,
    id: demoRandomUuid(),
    method: "deterministic",
    origin: "device",
    rationale: parameters.p_rationale ?? null,
    source_item_id: sourceItemId,
    superseded_at: null,
    user_id: DEMO_USER_ID,
  });
  demoDatabase.touch();
  return { data: null, error: null };
}

function withdrawDeviceClassification(parameters: Record<string, unknown>): RpcResult {
  const sourceItemId = parameters.p_source_item_id;
  if (typeof sourceItemId !== "string") {
    return { data: null, error: rpcError("22023", "Withdrawal arguments are invalid") };
  }
  const current = demoDatabase
    .rows("classifications")
    .find((row) => row.source_item_id === sourceItemId && (row.superseded_at ?? null) === null);
  if (current === undefined || current.origin !== "device") return { data: null, error: null };
  current.superseded_at = new Date().toISOString();
  demoDatabase.touch();
  return { data: null, error: null };
}

/**
 * Records a decision about a proposed action.
 *
 * The legality of the transition is checked with the shared `canDecideActionRun`, the same table the
 * database routine mirrors, so a run that stopped being decidable is refused here too.
 *
 * An approved run then settles as succeeded. Demo mode has no connected provider and calls none:
 * this is the ledger recording what a Workflow would have reported, and the Demo studio says so
 * rather than implying an external effect took place.
 */
function decideActionRun(parameters: Record<string, unknown>): RpcResult {
  const runId = parameters.p_action_run_id;
  const decision = parameters.p_decision;
  if (typeof runId !== "string" || (decision !== "approve" && decision !== "cancel")) {
    return { data: null, error: rpcError("22023", "Action decision arguments are invalid") };
  }
  const run = demoDatabase.rows("action_runs").find((row) => row.id === runId);
  if (run === undefined)
    return { data: null, error: rpcError("P0002", "Action run is unavailable") };
  if (!canDecideActionRun(run.status as ActionRunStatus, decision satisfies ActionDecision)) {
    return { data: null, error: rpcError("P0001", "Action run cannot take that decision") };
  }

  const now = new Date().toISOString();
  if (decision === "cancel") {
    run.status = "cancelled";
    run.completed_at = now;
  } else {
    run.approved_at = now;
    run.attempt_count = 1;
    run.completed_at = now;
    run.status = "succeeded";
  }
  demoDatabase.touch();
  return { data: null, error: null };
}

const routines: Record<string, (parameters: Record<string, unknown>) => RpcResult> = {
  decide_action_run: decideActionRun,
  record_device_classification_v1: recordDeviceClassification,
  withdraw_device_classification_v1: withdrawDeviceClassification,
};

export function createDemoSupabaseClient(): SupabaseClient {
  const auth = new DemoAuth();
  const client = {
    auth,
    from: (table: string) => demoTableQuery(table),
    rpc: async (name: string, parameters: Record<string, unknown> = {}): Promise<RpcResult> => {
      await demoDatabase.ready();
      const routine = routines[name];
      if (routine === undefined) {
        return { data: null, error: rpcError("42883", "Routine is unavailable in demo mode") };
      }
      return routine(parameters);
    },
  };
  return client as unknown as SupabaseClient;
}

export type { DemoRow };
