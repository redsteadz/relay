import { filterPlanSchema, type IngressEnvelope } from "@relay/contracts";
import { filterItem } from "@relay/domain";

import { supabaseBackendHeaders, type PersistenceConfiguration } from "./configuration";
import { evaluateFilterWithSemantics, type SemanticEvaluationOptions } from "./semantic";

/**
 * How many rules one capture may be evaluated against.
 *
 * Evaluation is per capture and per rule, so an unbounded ruleset would let one tenant decide how
 * much work every message costs. The cap is generous enough that reaching it means a ruleset needs
 * review rather than that Relay is losing rules quietly -- reaching it is logged.
 */
const MAX_RULES_PER_CAPTURE = 50;

export type ClassificationOutcome =
  | { reason: "no-rules" | "not-configured"; status: "skipped" }
  | {
      status: "stored";
      categoryId: string | undefined;
      method: "deterministic" | "semantic";
      ruleId: string;
    }
  | { status: "unmatched" };

type FilterRuleRow = {
  category_id: string | null;
  id: string;
  plan: unknown;
  series_id: string;
  version: number;
};

/**
 * The fields a rule may test.
 *
 * Built from the envelope rather than the stored row, so a rule sees what actually arrived. The
 * shape itself belongs to `@relay/domain`: this module previously built its own, using flat keys
 * that contained dots, which `readFilterField` read as a path into objects that were not there. Every
 * `source.*` and `attributes.*` predicate failed here while the identical rule matched on the
 * device, and it failed silently, because an absent field is a failed predicate rather than an error.
 */
export function classificationItem(envelope: IngressEnvelope): Record<string, unknown> {
  return filterItem({
    attributes: envelope.attributes,
    ...(envelope.body === undefined ? {} : { body: envelope.body }),
    ...(envelope.sender === undefined ? {} : { sender: envelope.sender }),
    source: {
      ...(envelope.source.applicationId === undefined
        ? {}
        : { applicationId: envelope.source.applicationId }),
      kind: envelope.source.kind,
    },
    ...(envelope.subject === undefined ? {} : { subject: envelope.subject }),
  });
}

/**
 * The newest enabled version of each rule series.
 *
 * A series is one rule through its edits, so evaluating every enabled row would apply a rule once
 * per version it has ever had. Ordering by version descending and keeping the first per series
 * leaves exactly the version a person last enabled.
 */
export function activeRules(rows: readonly FilterRuleRow[]): readonly FilterRuleRow[] {
  const newest = new Map<string, FilterRuleRow>();
  for (const row of [...rows].sort((left, right) => right.version - left.version)) {
    if (!newest.has(row.series_id)) newest.set(row.series_id, row);
  }
  // Stable order so two captures with identical facts always meet the same rule first.
  return [...newest.values()].sort(
    (left, right) => left.series_id.localeCompare(right.series_id) || left.version - right.version,
  );
}

async function loadActiveRules(
  configuration: PersistenceConfiguration,
  userId: string,
): Promise<readonly FilterRuleRow[]> {
  if (configuration.supabase === undefined) return [];
  const url = new URL("/rest/v1/filter_rules", configuration.supabase.url);
  url.searchParams.set("select", "id,series_id,version,plan,category_id");
  url.searchParams.set("user_id", `eq.${userId}`);
  url.searchParams.set("enabled", "is.true");
  url.searchParams.set("order", "version.desc");
  url.searchParams.set("limit", String(MAX_RULES_PER_CAPTURE));

  const response = await fetch(url, {
    headers: supabaseBackendHeaders(configuration.supabase.serviceRoleKey),
  });
  if (!response.ok) throw new Error(`Filter rule read failed with status ${response.status}`);
  const rows: FilterRuleRow[] = await response.json();
  return activeRules(rows);
}

async function storeClassification(
  configuration: PersistenceConfiguration,
  userId: string,
  sourceItemId: string,
  entry: {
    categoryId: string | undefined;
    confidence: number;
    method: "deterministic" | "semantic";
    model: string | undefined;
    rationale: string;
  },
): Promise<void> {
  if (configuration.supabase === undefined) return;
  const response = await fetch(`${configuration.supabase.url}/rest/v1/classifications`, {
    method: "POST",
    headers: supabaseBackendHeaders(configuration.supabase.serviceRoleKey),
    body: JSON.stringify({
      category_id: entry.categoryId ?? null,
      confidence: entry.confidence,
      method: entry.method,
      model: entry.model ?? null,
      rationale: entry.rationale,
      source_item_id: sourceItemId,
      user_id: userId,
    }),
  });
  if (!response.ok) throw new Error(`Classification write failed with status ${response.status}`);
}

/**
 * Decides which of a tenant's rules a capture belongs to, and records the answer.
 *
 * Rules are tried in a stable order and the first match wins, so a capture receives one category
 * rather than an arbitrary one of several. Evaluation runs deterministic predicates before any
 * semantic clause, which is what keeps a capture the user already excluded from being disclosed in
 * order to discover that it was excluded.
 *
 * `undecided` is not a match. A semantic clause that could not be resolved -- no credential, an
 * unreachable endpoint, an answer below the clause's confidence -- leaves the capture unclassified
 * rather than filed on a guess, and the next rule still gets its turn.
 *
 * The rationale names the rule and how it decided, never the content that decided it.
 */
export async function classifyCapture(
  configuration: PersistenceConfiguration,
  envelope: IngressEnvelope,
  userId: string,
  options: Omit<SemanticEvaluationOptions, "configuration" | "userId">,
): Promise<ClassificationOutcome> {
  if (configuration.supabase === undefined) return { reason: "not-configured", status: "skipped" };

  const rules = await loadActiveRules(configuration, userId);
  if (rules.length === 0) return { reason: "no-rules", status: "skipped" };

  const item = classificationItem(envelope);

  for (const rule of rules) {
    const plan = filterPlanSchema.safeParse(rule.plan);
    // A stored plan that no longer satisfies the contract is skipped rather than failing the
    // capture: one malformed rule must not stop every other rule from being applied.
    if (!plan.success) continue;

    const evaluation = await evaluateFilterWithSemantics(plan.data, item, {
      ...options,
      configuration,
      userId,
    });
    if (evaluation.decision !== "match") continue;

    const semantic = "semantic" in evaluation ? evaluation.semantic : undefined;
    const method = semantic === undefined ? "deterministic" : "semantic";
    await storeClassification(configuration, userId, envelope.id, {
      categoryId: rule.category_id ?? undefined,
      confidence: semantic?.confidence ?? 1,
      method,
      model: semantic?.model,
      rationale: `Matched rule ${rule.id} version ${rule.version.toString()} by ${method} evaluation`,
    });
    return {
      categoryId: rule.category_id ?? undefined,
      method,
      ruleId: rule.id,
      status: "stored",
    };
  }

  return { status: "unmatched" };
}
