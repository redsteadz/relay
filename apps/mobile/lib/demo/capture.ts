/**
 * Generating a capture from the Demo studio.
 *
 * One entry point for the screen, so the order the store is touched in -- derive, file, persist --
 * lives here rather than in a component. What comes back is what a person watching would want said
 * out loud: how much was derived, which rule claimed it, and where it went.
 */

import { classifyDemoCapture } from "./classify";
import { applyCapture, type DemoCaptureInput } from "./ingest";
import { demoDatabase } from "./store";

export type DemoCaptureOutcome = {
  /** Where it was filed, when a rule claimed it. */
  categoryName: string | undefined;
  eventIds: readonly string[];
  factCount: number;
  proposedActions: number;
  /** Plain-language result, phrased the way the receipt phrases it. */
  outcome: string;
  ruleName: string | undefined;
  sourceItemId: string;
};

function nameOf(table: string, id: string | undefined): string | undefined {
  if (id === undefined) return undefined;
  const row = demoDatabase.rows(table).find((candidate) => candidate.id === id);
  return typeof row?.name === "string" ? row.name : undefined;
}

export async function generateDemoCapture(input: DemoCaptureInput): Promise<DemoCaptureOutcome> {
  await demoDatabase.ready();
  const tables = demoDatabase.document();
  const capture = applyCapture(tables, input);
  const filed = classifyDemoCapture(
    tables,
    input,
    capture.sourceItemId,
    input.capturedAt ?? new Date().toISOString(),
  );
  if (filed.row !== undefined) (tables.classifications ??= []).unshift(filed.row);
  demoDatabase.touch();

  const ruleName =
    filed.outcome.kind === "unfiled"
      ? undefined
      : nameOf("filter_rules", filed.outcome.filterRuleId);
  const categoryName =
    filed.outcome.kind === "filed" ? nameOf("categories", filed.outcome.categoryId) : undefined;

  return {
    categoryName,
    eventIds: capture.eventIds,
    factCount: capture.factCount,
    outcome:
      filed.outcome.kind === "filed"
        ? `Filed under ${categoryName ?? "no category"} by "${ruleName ?? "a rule"}".`
        : filed.outcome.kind === "awaiting-model"
          ? `"${ruleName ?? "A rule"}" needs a model to decide this one, so it stays unfiled.`
          : filed.outcome.kind === "field-unavailable"
            ? `"${ruleName ?? "A rule"}" reads something this device cannot read for this capture, so nothing below it was tried.`
            : "No rule claimed it. It is searchable and unfiled.",
    proposedActions: capture.proposedActions,
    ruleName,
    sourceItemId: capture.sourceItemId,
  };
}

export async function resetDemoData(): Promise<void> {
  await demoDatabase.reset();
}
