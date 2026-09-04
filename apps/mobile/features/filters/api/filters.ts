/**
 * Filter rule access.
 *
 * Reads and writes take different paths on purpose. Revisions are tenant-owned and readable under
 * row-level security, so listing them goes straight to PostgREST like categories do. Writing does
 * not: `insert`, `update`, and `delete` on `filter_rules` are revoked from every role, and the only
 * writer is a security-definer function reached through the Relay API, which compiles the intent in
 * the pipeline first. A client cannot store a plan of its own devising.
 */

import {
  filterCompileResponseSchema,
  filterRuleVersionSchema,
  type FilterCompileRequest,
  type FilterCompileResponse,
  type FilterRuleVersion,
} from "@relay/contracts";
import { AppError } from "@relay/observability";
import type { SupabaseClient } from "@supabase/supabase-js";

import { logMobileError } from "@/lib/observability";
import { RelayApiError, requestRelayApi } from "@/lib/relay-api";

const revisionColumns = "id, user_id, series_id, name, intent, plan, version, enabled, created_at";

type FilterRuleRow = {
  created_at: string;
  enabled: boolean;
  id: string;
  intent: string;
  name: string;
  plan: unknown;
  series_id: string;
  user_id: string;
  version: number;
};

export class FilterRuleError extends AppError {
  constructor(cause: unknown, operation: string) {
    super("Filter rule request failed", {
      category: "database",
      cause,
      code: "FILTER_RULE_QUERY_FAILED",
      integration: "supabase-postgrest",
      operation,
      retryable: true,
    });
    this.name = "FilterRuleError";
  }
}

function filterRuleError(cause: unknown, operation: string): FilterRuleError {
  const normalized = new FilterRuleError(cause, operation);
  logMobileError("database.filter_rule_query_failed", normalized, {
    code: normalized.code,
    integration: "supabase-postgrest",
    operation,
  });
  return normalized;
}

/**
 * Every revision the tenant owns, newest first.
 *
 * All revisions are fetched rather than only the newest of each series, because the editor shows
 * history: an earlier version has to stay inspectable after an edit supersedes it. The row is parsed
 * through the wire contract so a stored plan that no longer satisfies it surfaces here rather than
 * rendering as a rule that does not mean what it says.
 */
export async function listFilterRevisions(client: SupabaseClient): Promise<FilterRuleVersion[]> {
  const { data, error } = await client
    .from("filter_rules")
    .select(revisionColumns)
    .order("name", { ascending: true })
    .order("version", { ascending: false });
  if (error !== null) throw filterRuleError(error, "listFilterRevisions");

  const revisions: FilterRuleVersion[] = [];
  for (const row of data as FilterRuleRow[]) {
    const parsed = filterRuleVersionSchema.safeParse({
      createdAt: row.created_at,
      enabled: row.enabled,
      id: row.id,
      intent: row.intent,
      name: row.name,
      plan: row.plan,
      seriesId: row.series_id,
      userId: row.user_id,
      version: row.version,
    });
    if (!parsed.success) {
      throw filterRuleError(parsed.error, "listFilterRevisions.contract");
    }
    revisions.push(parsed.data);
  }
  return revisions;
}

/**
 * Compiles and stores one revision.
 *
 * The response is the server's own compilation, not an echo of the request. The editor previews
 * with the same compiler locally, but what it displays after saving is what was actually persisted,
 * so a disagreement shows up as a changed plan rather than being hidden behind an optimistic
 * client-side render.
 */
export async function saveFilterRule(
  accessToken: string,
  request: FilterCompileRequest,
): Promise<FilterCompileResponse> {
  const response = await requestRelayApi(accessToken, "/api/filters/compile", {
    body: request,
    method: "POST",
  });
  const parsed = filterCompileResponseSchema.safeParse(response);
  if (!parsed.success) {
    const error = new RelayApiError("malformed-response", {
      cause: parsed.error,
      operation: "saveFilterRule",
    });
    logMobileError("integration.response_contract_invalid", error, {
      code: error.code,
      integration: "relay-api",
      operation: "saveFilterRule",
    });
    throw error;
  }
  return parsed.data;
}
