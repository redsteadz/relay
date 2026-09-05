/**
 * Recording what this device decided.
 *
 * This is the app's only direct RPC call, and the exception is deliberate. Every other privileged
 * write goes through `apps/api` because the server has something to add: it holds a credential, or
 * it compiles the value being stored. Here it would add a hop and nothing else -- ownership comes
 * from `auth.uid()` inside the routine, and the API is explicitly not a classifier
 * (`AGENTS.md`, Architecture Boundaries). Writing straight to the routine keeps the API as storage
 * and triggering, which is what it is for.
 *
 * Direct table writes are revoked, so the routine is the only way in. It fixes `origin`, `method`
 * and `confidence` rather than trusting them, and refuses to overwrite a server-authored row. A
 * client can therefore only ever author a row that is marked as coming from a client.
 */

import { AppError } from "@relay/observability";
import type { SupabaseClient } from "@supabase/supabase-js";

import { logMobileError } from "@/lib/observability";

import type { ClassificationWrite } from "../models/deviceClassification";

export class ClassificationError extends AppError {
  constructor(cause: unknown, operation: string) {
    super("Classification request failed", {
      category: "database",
      cause,
      code: "CLASSIFICATION_WRITE_FAILED",
      integration: "supabase-postgrest",
      operation,
      retryable: true,
    });
    this.name = "ClassificationError";
  }
}

function classificationError(cause: unknown, operation: string): ClassificationError {
  const normalized = new ClassificationError(cause, operation);
  logMobileError("database.classification_write_failed", normalized, {
    code: normalized.code,
    integration: "supabase-postgrest",
    operation,
  });
  return normalized;
}

/**
 * Files as many captures as the caller decided, and reports how many landed.
 *
 * Writes are sequential rather than concurrent: the routine takes a per-capture advisory lock, and a
 * burst of parallel calls from one device would spend its connections waiting on locks it placed
 * itself. A first inbox open writes tens of rows, not thousands.
 *
 * One failed write does not abandon the rest. Filing is advisory -- a capture that stays unfiled is
 * simply filed on the next pass -- so a single rejection should not leave the remaining captures
 * unclassified for the sake of an all-or-nothing pass that has nothing to roll back.
 */
export async function recordDeviceClassifications(
  client: SupabaseClient,
  writes: readonly ClassificationWrite[],
): Promise<{ failed: number; recorded: number }> {
  let recorded = 0;
  let failed = 0;
  let firstFailure: unknown;

  for (const write of writes) {
    const { error } = await client.rpc("record_device_classification_v1", {
      p_category_id: write.categoryId ?? null,
      p_filter_rule_id: write.filterRuleId,
      p_rationale: write.rationale ?? null,
      p_source_item_id: write.sourceItemId,
    });
    if (error === null) {
      recorded += 1;
      continue;
    }
    failed += 1;
    firstFailure ??= error;
  }

  // Logged once, after the pass, so a systemic failure is one incident rather than one per capture.
  if (firstFailure !== undefined) {
    classificationError(firstFailure, "recordDeviceClassifications");
  }
  return { failed, recorded };
}
