/**
 * Deciding which category a capture belongs to.
 *
 * The evaluator already answers `match` / `no-match` / `undecided` for one plan against one capture.
 * What it cannot answer is which rule should get the chance, what to do when a rule needs a field
 * this runtime cannot read, and where a match should be filed. That is this module.
 *
 * It exists to be run on the device as well as the server, so it stays pure: no I/O, no clock, no
 * crypto. Where a caller cannot supply a field -- a phone holds no readable body for a Gmail capture,
 * because the raw payload is encrypted to a key it does not have -- it says so rather than letting
 * the evaluator read the absence as a `no-match`.
 */

import type { FilterExpression, FilterField, FilterPlan } from "@relay/contracts";

import { evaluateFilterPlan, type MatchedPredicate } from "./filter-evaluator.js";

/** The rule shape classification needs, independent of how any runtime stores a rule. */
export type ClassifiableRule = {
  /** Where a match is filed. A rule may match without naming a category. */
  categoryId: string | undefined;
  id: string;
  plan: FilterPlan;
};

export type CaptureClassification =
  | {
      categoryId: string | undefined;
      filterRuleId: string;
      kind: "filed";
      matchedPredicates: readonly MatchedPredicate[];
    }
  /** A rule that could have matched carries a semantic clause this runtime cannot resolve. */
  | { filterRuleId: string; kind: "awaiting-model" }
  /** A rule that could have matched reads a field this runtime cannot supply. */
  | { fields: readonly FilterField[]; filterRuleId: string; kind: "field-unavailable" }
  /** Every rule was evaluated and none matched. */
  | { kind: "unfiled" };

// Mirrors the evaluator's own budget so a malformed in-memory plan cannot make this walk unbounded.
const MAX_NODES = 64;

function collectFields(
  node: FilterExpression,
  fields: Set<FilterField>,
  budget: { nodes: number },
): void {
  budget.nodes += 1;
  if (budget.nodes > MAX_NODES) return;

  if ("all" in node) {
    for (const child of node.all) collectFields(child, fields, budget);
    return;
  }
  if ("any" in node) {
    for (const child of node.any) collectFields(child, fields, budget);
    return;
  }
  if ("not" in node) {
    collectFields(node.not, fields, budget);
    return;
  }
  if ("never" in node) return;
  fields.add(node.field);
}

/**
 * Every field a plan reads, deterministic and semantic parts alike.
 *
 * The semantic clause's `allowedFields` count: a clause this runtime cannot resolve is reported as
 * awaiting a model, but a caller that can resolve one still needs to know what it would have to read.
 */
export function referencedFilterFields(plan: FilterPlan): Set<FilterField> {
  const fields = new Set<FilterField>();
  if (plan.deterministic !== undefined) {
    collectFields(plan.deterministic, fields, { nodes: 0 });
  }
  for (const field of plan.semantic?.allowedFields ?? []) fields.add(field);
  return fields;
}

function unavailableFields(plan: FilterPlan, available: ReadonlySet<FilterField>): FilterField[] {
  const missing: FilterField[] = [];
  for (const field of referencedFilterFields(plan)) {
    if (!available.has(field)) missing.push(field);
  }
  return missing;
}

/**
 * Files a capture under the first rule that claims it.
 *
 * Rules are tried in the order given, and the caller owns that order so it can be shown to a person
 * and stays the same between runs. First match wins.
 *
 * A rule that cannot be decided stops the walk rather than being skipped. Skipping it would file the
 * capture under a later rule while an earlier one might have claimed it, which would make the result
 * depend on what this particular runtime happened to be able to read. Reporting the obstacle instead
 * keeps the answer honest and lets a runtime that *can* read the field decide it later.
 */
export function classifyCapture(
  rules: readonly ClassifiableRule[],
  item: Record<string, unknown>,
  availableFields: ReadonlySet<FilterField>,
): CaptureClassification {
  for (const rule of rules) {
    const missing = unavailableFields(rule.plan, availableFields);
    if (missing.length > 0) {
      return { fields: missing, filterRuleId: rule.id, kind: "field-unavailable" };
    }

    const evaluation = evaluateFilterPlan(rule.plan, item);
    if (evaluation.decision === "match") {
      return {
        categoryId: rule.categoryId,
        filterRuleId: rule.id,
        kind: "filed",
        matchedPredicates: evaluation.matchedPredicates,
      };
    }
    if (evaluation.decision === "undecided") {
      return { filterRuleId: rule.id, kind: "awaiting-model" };
    }
  }

  return { kind: "unfiled" };
}

/**
 * A short, value-free explanation of why a capture was filed.
 *
 * Names the fields and operators that decided it and never the values they matched, so a rationale
 * stored beside the classification cannot become a second copy of source content.
 */
export function classificationRationale(
  matched: readonly MatchedPredicate[],
  limit = 500,
): string | undefined {
  if (matched.length === 0) return undefined;
  const parts = matched.map((predicate) => `${predicate.field} ${predicate.operator}`);
  const text = `Matched ${parts.join(", ")}`;
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}\u2026`;
}
