/**
 * The audit trail behind the activity ledger.
 *
 * `audit_log` is tenant-readable under row-level security -- select only, with no insert, update, or
 * delete policy -- so this reads it straight from PostgREST the way the ledger and the inbox do. The
 * rows are append-only records of things Relay already did.
 *
 * Only three families are read here. Action rows are left to `action_runs`, which carries richer
 * state than an audit line, and semantic evaluations are left to the disclosure API, which is the
 * one route that bounds and shapes a disclosure for display. Reading either from here as well would
 * put the same event on the timeline twice and give the redaction contract a second place to drift.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@relay/observability";

import { logMobileError } from "@/lib/observability";

import type { AuditEntryInput } from "../models/activityPresentation";

/**
 * The actions this timeline can describe.
 *
 * A closed list rather than a prefix match: an action Relay adds later would otherwise appear as an
 * unnamed row, and a ledger that shows something it cannot explain is worse than one that waits for
 * the build that can.
 */
const AUDIT_ACTIONS = [
  "connector.disconnected",
  "connector.revoked",
  "filter.revision_compiled",
  "privacy.account_deletion_finalized",
  "privacy.account_deletion_requested",
  "privacy.raw_payloads_purged",
] as const;

/**
 * `metadata` is read by named keys rather than whole.
 *
 * Every key here is Relay's own bounded vocabulary -- a version, a count, a provider slug -- and
 * selecting the blob would put whatever a future routine records straight onto the screen.
 */
const auditColumns =
  "id, action, created_at, provider:metadata->>provider, purged_count:metadata->>purgedCount, version:metadata->>version";

/** Bounded so one very active tenant cannot turn a first paint into an unbounded read. */
const AUDIT_PAGE_SIZE = 200;

export class AuditTrailError extends AppError {
  constructor(cause: unknown) {
    super("Audit trail request failed", {
      category: "database",
      cause,
      code: "AUDIT_TRAIL_READ_FAILED",
      integration: "supabase-postgrest",
      operation: "loadAuditTrail",
      retryable: true,
    });
    this.name = "AuditTrailError";
  }
}

type AuditRow = {
  action: string;
  created_at: string;
  id: number;
  provider: string | null;
  purged_count: string | null;
  version: string | null;
};

export async function loadAuditTrail(client: SupabaseClient): Promise<readonly AuditEntryInput[]> {
  const result = await client
    .from("audit_log")
    .select(auditColumns)
    .in("action", AUDIT_ACTIONS)
    .order("created_at", { ascending: false })
    .limit(AUDIT_PAGE_SIZE);
  if (result.error !== null) {
    const normalized = new AuditTrailError(result.error);
    logMobileError("database.audit_trail_read_failed", normalized, {
      code: normalized.code,
      integration: "supabase-postgrest",
      operation: "loadAuditTrail",
    });
    throw normalized;
  }

  return ((result.data ?? []) as AuditRow[]).map((row) => ({
    action: row.action,
    createdAt: row.created_at,
    id: String(row.id),
    provider: row.provider,
    purgedCount: row.purged_count,
    version: row.version,
  }));
}
