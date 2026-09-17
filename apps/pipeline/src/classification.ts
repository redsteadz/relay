import { filterPlanSchema, type IngressEnvelope } from "@relay/contracts";
import { filterItem } from "@relay/domain";
import { createLogger } from "@relay/observability";

import { supabaseBackendHeaders, type PersistenceConfiguration } from "./configuration";
import { evaluateFilterWithSemantics, type SemanticEvaluationOptions } from "./semantic";

/**
 * How many rule series one capture may be evaluated against.
 *
 * Evaluation is per capture and per rule, so an unbounded ruleset would let one tenant decide how
 * much work every message costs. The cap counts series rather than rows, because `version` is per
 * series and a row cap spends the whole budget on one rule's edit history: a tenant with one rule
 * edited fifty times and nine rules never edited had those nine dropped from every capture, still
 * enabled in the Rules tab and silently filing nothing. The cap is generous enough that reaching it
 * means a ruleset needs review rather than that Relay is losing rules quietly -- reaching it is
 * logged.
 */
const MAX_RULE_SERIES_PER_CAPTURE = 50;

/**
 * Rows per rule read.
 *
 * A series contributes one revision to the answer and as many rows as it has ever been edited, so
 * the page is larger than the series cap. A tenant whose whole revision history fits in one page --
 * the normal case -- is read in a single round trip.
 */
const RULE_PAGE_SIZE = 200;

export type ClassificationOutcome =
  | { reason: "no-rules" | "not-configured"; status: "skipped" }
  | {
      status: "stored";
      categoryId: string | undefined;
      method: "deterministic" | "semantic";
      ruleId: string;
    }
  | { status: "unmatched" };

export type ClassificationOptions = Omit<SemanticEvaluationOptions, "configuration" | "userId"> & {
  /** Namespaced DEBUG specification, normally `env.DEBUG`. Only ever widens what a log serializes. */
  debugSpecification?: string | undefined;
};

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

/**
 * One page of a tenant's enabled rule revisions, from `after` exclusive.
 *
 * Ordered by series and then by version descending, which is exactly
 * `filter_rules_active_series_idx` (`user_id, series_id, version desc` where `enabled`), so the
 * newest revision of a series is the first row of its group.
 */
async function readRulePage(
  supabase: NonNullable<PersistenceConfiguration["supabase"]>,
  userId: string,
  after: string | undefined,
): Promise<readonly FilterRuleRow[]> {
  const url = new URL("/rest/v1/filter_rules", supabase.url);
  url.searchParams.set("select", "id,series_id,version,plan,category_id");
  url.searchParams.set("user_id", `eq.${userId}`);
  url.searchParams.set("enabled", "is.true");
  url.searchParams.set("order", "series_id.asc,version.desc");
  url.searchParams.set("limit", String(RULE_PAGE_SIZE));
  if (after !== undefined) url.searchParams.set("series_id", `gt.${after}`);

  const response = await fetch(url, {
    headers: supabaseBackendHeaders(supabase.serviceRoleKey),
  });
  if (!response.ok) throw new Error(`Filter rule read failed with status ${response.status}`);
  const rows: FilterRuleRow[] = await response.json();
  return rows;
}

/**
 * The newest enabled revision of each of a tenant's rule series, up to the cap.
 *
 * Paged by series rather than by row. A row cap over a global `version.desc` sort ranked one
 * series' edit history above every other rule the tenant owns, so the rules that were never edited
 * never reached the evaluator -- the defect this pager exists to remove.
 *
 * The cursor is the last row's `series_id`. Advancing past it can skip revisions that were not read,
 * which is safe precisely because the ordering puts a series' newest revision first in its group:
 * anything skipped is an older revision of a series already answered. It also means every page
 * advances by at least one whole series, so the number of reads is bounded by the cap and not by how
 * often a tenant has edited one rule.
 *
 * Note that the device reduces the same way but from an unpaged read -- `classifiableRules`
 * (`apps/mobile/features/inbox/models/deviceClassification.ts`) keeps the newest revision per
 * `seriesId` from every revision `listFilterRevisions` returned. Both runtimes must reach the same
 * set of rules or they disagree about which rules exist, which is the class of divergence #180 was.
 */
async function loadActiveRules(
  configuration: PersistenceConfiguration,
  userId: string,
  debugSpecification: string | undefined,
): Promise<readonly FilterRuleRow[]> {
  const supabase = configuration.supabase;
  if (supabase === undefined) return [];

  const newest = new Map<string, FilterRuleRow>();
  let after: string | undefined;
  let exhausted = false;
  let truncated = false;

  while (!exhausted && !truncated) {
    const rows = await readRulePage(supabase, userId, after);
    if (rows.length === 0) break;

    for (const row of rows) {
      if (newest.has(row.series_id)) continue;
      // A series beyond the cap is one this capture will not be evaluated against, which is the
      // only condition worth telling the tenant about.
      if (newest.size === MAX_RULE_SERIES_PER_CAPTURE) {
        truncated = true;
        break;
      }
      newest.set(row.series_id, row);
    }

    // A short page is the last page.
    if (rows.length < RULE_PAGE_SIZE) exhausted = true;
    else after = rows[rows.length - 1]?.series_id;
  }

  if (truncated) {
    // A count only. Which rules were dropped would name rule ids and intents, and a log never
    // carries either -- the ruleset itself is where a tenant sees which rules they own.
    createLogger({ debugSpecification, namespace: "relay:pipeline" }).warn(
      "ingress.rule_cap_reached",
      { ruleSeriesEvaluated: newest.size },
    );
  }

  return activeRules([...newest.values()]);
}

/**
 * Records this classification as the capture's current one.
 *
 * Through `record_server_classification_v1` rather than a direct insert, because a capture has
 * exactly one current classification -- `classifications_current_per_item_idx` is unique on
 * `(user_id, source_item_id) where superseded_at is null`. A blind insert therefore succeeded only
 * for a capture that had never been classified, and a second pass over the same capture raised a
 * unique violation that reached the queue as an ordinary failed write. The routine supersedes the
 * current row instead, which is what lets the pipeline re-file a capture at all.
 *
 * `filterRuleId` is the rule revision that matched. Revisions are immutable, so it is permanent
 * provenance; the rationale names the same rule in prose, which is not the same thing and is not
 * what `202609070001` reads when deciding whether a category may gate a provider effect.
 */
async function storeClassification(
  configuration: PersistenceConfiguration,
  userId: string,
  sourceItemId: string,
  entry: {
    categoryId: string | undefined;
    confidence: number;
    filterRuleId: string;
    method: "deterministic" | "semantic";
    model: string | undefined;
    rationale: string;
  },
): Promise<void> {
  if (configuration.supabase === undefined) return;
  const response = await fetch(
    `${configuration.supabase.url}/rest/v1/rpc/record_server_classification_v1`,
    {
      method: "POST",
      headers: supabaseBackendHeaders(configuration.supabase.serviceRoleKey),
      body: JSON.stringify({
        p_category_id: entry.categoryId ?? null,
        p_confidence: entry.confidence,
        p_filter_rule_id: entry.filterRuleId,
        p_method: entry.method,
        p_model: entry.model ?? null,
        p_rationale: entry.rationale,
        p_source_item_id: sourceItemId,
        p_user_id: userId,
      }),
    },
  );
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
  options: ClassificationOptions,
): Promise<ClassificationOutcome> {
  if (configuration.supabase === undefined) return { reason: "not-configured", status: "skipped" };

  const rules = await loadActiveRules(configuration, userId, options.debugSpecification);
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
      filterRuleId: rule.id,
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
