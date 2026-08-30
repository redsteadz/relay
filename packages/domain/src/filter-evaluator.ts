import type { FilterExpression, FilterPlan, FilterPredicate } from "@relay/contracts";

export type FilterDecision = "match" | "no-match" | "undecided";

export type MatchedPredicate = {
  field: FilterPredicate["field"];
  operator: FilterPredicate["operator"];
  path: string;
};

export type FilterEvaluation = {
  compilerVersion: number;
  decision: FilterDecision;
  matchedPredicates: MatchedPredicate[];
  schemaVersion: number;
};

/**
 * Raised when a plan exceeds the structural limits the contract already enforces at parse time.
 *
 * Reaching this means a plan was constructed in memory without going through `filterPlanSchema`, so
 * it is a programming error rather than untrusted input. It carries no field values, only the limit
 * that was exceeded.
 */
export class FilterEvaluationLimitError extends Error {
  constructor(readonly limit: "depth" | "nodes") {
    super("Filter plan exceeds evaluation limits");
  }
}

// Mirrors `boundedFilterExpressionSchema` in @relay/contracts. Evaluation re-checks them so the
// bound holds even for a plan that never passed the schema.
const MAX_DEPTH = 8;
const MAX_NODES = 64;

function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function readField(item: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (typeof current !== "object" || current === null || !(segment in current)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, item);
}

/**
 * Reads and normalizes a field at most once per evaluation.
 *
 * Without this, a plan holding the contract maximum of 64 predicates over `body` would normalize the
 * same string 64 times, and an envelope body may be up to a megabyte. Field values are read from the
 * item and never written back, so this cache cannot leak between evaluations.
 */
function fieldReader(item: Record<string, unknown>) {
  const raw = new Map<string, unknown>();
  const normalized = new Map<string, string | undefined>();

  return {
    normalized(field: string): string | undefined {
      if (normalized.has(field)) return normalized.get(field);
      const value = this.raw(field);
      const result = typeof value === "string" ? normalizeText(value) : undefined;
      normalized.set(field, result);
      return result;
    },
    raw(field: string): unknown {
      if (raw.has(field)) return raw.get(field);
      const value = readField(item, field);
      raw.set(field, value);
      return value;
    },
  };
}

function assertNeverOperator(predicate: never): never {
  throw new TypeError(`Unhandled filter predicate: ${JSON.stringify(predicate)}`);
}

function evaluatePredicate(predicate: FilterPredicate, fields: ReturnType<typeof fieldReader>) {
  if (predicate.operator === "exists") {
    const value = fields.raw(predicate.field);
    return value !== undefined && value !== null && value !== "";
  }

  // A field that is absent, null, or not a string cannot satisfy a comparison. It is reported as a
  // failed predicate rather than an unknown, so an absent field is `no-match` and never widens what
  // is sent to a provider. `exists` is the supported way to test presence.
  const actual = fields.normalized(predicate.field);
  if (actual === undefined) return false;

  if (predicate.operator === "in") {
    return predicate.value.some((candidate) => normalizeText(candidate) === actual);
  }

  const expected = normalizeText(predicate.value);
  switch (predicate.operator) {
    case "equals":
      return actual === expected;
    case "contains":
      return actual.includes(expected);
    case "starts-with":
      return actual.startsWith(expected);
    default:
      // Exhaustive: adding an operator to the contract without handling it here is a compile
      // error rather than a silent fall-through to the last branch.
      return assertNeverOperator(predicate);
  }
}

function evaluateExpression(
  expression: FilterExpression,
  fields: ReturnType<typeof fieldReader>,
  matched: MatchedPredicate[],
  path: string,
  depth: number,
  budget: { nodes: number },
): boolean {
  if (depth > MAX_DEPTH) throw new FilterEvaluationLimitError("depth");
  budget.nodes += 1;
  if (budget.nodes > MAX_NODES) throw new FilterEvaluationLimitError("nodes");

  if ("never" in expression) return false;

  if ("all" in expression) {
    // Deliberately evaluates every child rather than short-circuiting, so `matchedPredicates`
    // explains the whole expression. The node budget keeps that bounded.
    const results = expression.all.map((child, index) =>
      evaluateExpression(
        child,
        fields,
        matched,
        `${path}all[${index.toString()}]`,
        depth + 1,
        budget,
      ),
    );
    return results.every(Boolean);
  }

  if ("any" in expression) {
    const results = expression.any.map((child, index) =>
      evaluateExpression(
        child,
        fields,
        matched,
        `${path}any[${index.toString()}]`,
        depth + 1,
        budget,
      ),
    );
    return results.some(Boolean);
  }

  if ("not" in expression) {
    return !evaluateExpression(expression.not, fields, matched, `${path}not.`, depth + 1, budget);
  }

  const result = evaluatePredicate(expression, fields);
  if (result) {
    matched.push({ field: expression.field, operator: expression.operator, path: path || "." });
  }
  return result;
}

/**
 * Evaluates a compiled plan against one item, purely.
 *
 * Never calls a provider, never mutates the item, and never returns a field value. A deterministic
 * expression that fails yields `no-match` without consulting the semantic clause, so a deterministic
 * rejection cannot reach OpenAI.
 *
 * `matchedPredicates` lists every predicate that evaluated true, with its position in the
 * expression. A predicate under `not` can therefore appear while the overall decision is `no-match`;
 * the list explains the evaluation rather than justifying the decision on its own.
 */
export function evaluateFilterPlan(
  plan: FilterPlan,
  item: Record<string, unknown>,
): FilterEvaluation {
  const fields = fieldReader(item);
  const matchedPredicates: MatchedPredicate[] = [];
  const version = { compilerVersion: plan.compilerVersion, schemaVersion: plan.schemaVersion };

  if (plan.deterministic !== undefined) {
    const passed = evaluateExpression(plan.deterministic, fields, matchedPredicates, "", 1, {
      nodes: 0,
    });
    if (!passed) return { ...version, decision: "no-match", matchedPredicates };
  }

  return {
    ...version,
    decision: plan.semantic === undefined ? "match" : "undecided",
    matchedPredicates,
  };
}

/** Decision-only convenience over {@link evaluateFilterPlan}. */
export function evaluateFilter(plan: FilterPlan, item: Record<string, unknown>): FilterDecision {
  return evaluateFilterPlan(plan, item).decision;
}
