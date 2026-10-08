/**
 * The account the demo opens on.
 *
 * Everything here is synthetic and deterministic: the same categories, the same rules, the same
 * captures, in the same order, on every install. Rules are compiled by the shipped
 * `compileFilterPlan`, captures go through the shipped normalizer and extractor, and the seeded
 * classifications are produced by the shipped `classifyCapture` rather than written by hand -- so an
 * inbox that is already filed on first paint was filed by the same reasoning that files the next
 * capture someone generates.
 */

import type { FilterPlan } from "@relay/contracts";
import { compileFilterPlan } from "@relay/domain";

import { DEMO_USER_ID } from "./account";
import { classifyDemoCapture } from "./classify";
import { demoUuid } from "./ids";
import { applyCapture, DEMO_TASK_ACTION_RULE_ID } from "./ingest";
import { demoScenario } from "./scenarios";
import { emptyTables, type DemoRow, type DemoTables } from "./types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

type CategorySeed = {
  description: string;
  name: string;
  quiet: boolean;
  slug: string;
  system: boolean;
};

const CATEGORIES: readonly CategorySeed[] = [
  {
    description: "Money leaving or arriving, with the amount Relay read.",
    name: "Transactions",
    quiet: true,
    slug: "transaction",
    system: true,
  },
  { description: "Something to do.", name: "Tasks", quiet: false, slug: "task", system: true },
  {
    description: "Something happening at a time.",
    name: "Events",
    quiet: false,
    slug: "event",
    system: true,
  },
  {
    description: "Something with a deadline.",
    name: "Reminders",
    quiet: false,
    slug: "reminder",
    system: true,
  },
  {
    description: "Parcels and their promised arrival.",
    name: "Deliveries",
    quiet: false,
    slug: "delivery",
    system: true,
  },
  {
    description: "Journeys and bookings.",
    name: "Travel",
    quiet: false,
    slug: "travel",
    system: true,
  },
  {
    description: "Codes and account warnings. Never dismissed automatically.",
    name: "Security",
    quiet: false,
    slug: "security",
    system: true,
  },
  {
    description: "People talking to you.",
    name: "Communication",
    quiet: true,
    slug: "communication",
    system: true,
  },
  {
    description: "Marketing. Kept searchable, never surfaced.",
    name: "Promotions",
    quiet: true,
    slug: "promotion",
    system: true,
  },
  {
    description: "Everything Relay filed without a better home.",
    name: "Other",
    quiet: true,
    slug: "other",
    system: true,
  },
  {
    description: "A category you created. Rename, archive or delete it.",
    name: "Household",
    quiet: false,
    slug: "household",
    system: false,
  },
  {
    description: "Recurring charges worth watching.",
    name: "Subscriptions",
    quiet: true,
    slug: "subscriptions",
    system: false,
  },
];

type RuleSeed = {
  categorySlug: string;
  enabled: boolean;
  intent: string;
  name: string;
  /** Earlier wording kept as history, so the rule reads as a series rather than a setting. */
  supersededIntent?: string;
};

const RULES: readonly RuleSeed[] = [
  {
    categorySlug: "delivery",
    enabled: true,
    intent: "app is com.amazon.mShop.android.shopping",
    name: "Deliveries",
  },
  { categorySlug: "transaction", enabled: true, intent: "amount exists", name: "Money" },
  {
    categorySlug: "promotion",
    enabled: true,
    intent: "app is com.ubercab.eats",
    supersededIntent: "subject contains offer",
    name: "Offers",
  },
  {
    categorySlug: "security",
    enabled: true,
    intent: "body contains verification code",
    name: "Security codes",
  },
  { categorySlug: "communication", enabled: true, intent: "app is com.Slack", name: "Work chat" },
  {
    categorySlug: "travel",
    enabled: false,
    intent: "subject contains boarding pass",
    name: "Zz paused example",
  },
];

function categoryId(slug: string): string {
  return demoUuid(`category:${slug}`);
}

function categoryRows(now: number): DemoRow[] {
  return CATEGORIES.map((category, index) => ({
    archived_at: null,
    created_at: new Date(now - 30 * DAY).toISOString(),
    description: category.description,
    id: categoryId(category.slug),
    is_system: category.system,
    name: category.name,
    quiet_by_default: category.quiet,
    slug: category.slug,
    sort_order: index,
    user_id: DEMO_USER_ID,
  }));
}

function planFor(intent: string): FilterPlan {
  return compileFilterPlan(
    intent,
    CATEGORIES.map((category) => ({ name: category.name, slug: category.slug })),
  ).plan;
}

function ruleRows(now: number): DemoRow[] {
  const rows: DemoRow[] = [];
  for (const [index, rule] of RULES.entries()) {
    const seriesId = demoUuid(`rule-series:${rule.name}`);
    const createdAt = now - (RULES.length - index) * DAY;
    if (rule.supersededIntent !== undefined) {
      rows.push({
        category_id: categoryId(rule.categorySlug),
        created_at: new Date(createdAt - DAY).toISOString(),
        enabled: rule.enabled,
        id: demoUuid(`rule:${rule.name}:1`),
        intent: rule.supersededIntent,
        name: rule.name,
        plan: planFor(rule.supersededIntent),
        series_id: seriesId,
        user_id: DEMO_USER_ID,
        version: 1,
      });
    }
    rows.push({
      category_id: categoryId(rule.categorySlug),
      created_at: new Date(createdAt).toISOString(),
      enabled: rule.enabled,
      id: demoUuid(`rule:${rule.name}:${rule.supersededIntent === undefined ? "1" : "2"}`),
      intent: rule.intent,
      name: rule.name,
      plan: planFor(rule.intent),
      series_id: seriesId,
      user_id: DEMO_USER_ID,
      version: rule.supersededIntent === undefined ? 1 : 2,
    });
  }
  return rows;
}

/** Captures the account already holds, oldest first, so the inbox opens with history in it. */
const HISTORY: readonly { minutesAgo: number; scenarioId: string; sequence: number }[] = [
  { minutesAgo: 372, scenarioId: "card-payment", sequence: 0 },
  { minutesAgo: 331, scenarioId: "work-message", sequence: 0 },
  { minutesAgo: 274, scenarioId: "promotion", sequence: 0 },
  { minutesAgo: 226, scenarioId: "gmail-receipt", sequence: 0 },
  { minutesAgo: 188, scenarioId: "card-payment", sequence: 1 },
  { minutesAgo: 143, scenarioId: "verification-code", sequence: 0 },
  { minutesAgo: 96, scenarioId: "boarding-pass", sequence: 0 },
  { minutesAgo: 61, scenarioId: "work-message", sequence: 1 },
  { minutesAgo: 44, scenarioId: "parcel-delivery", sequence: 0 },
  { minutesAgo: 23, scenarioId: "conflicting-dates", sequence: 0 },
  { minutesAgo: 8, scenarioId: "calendar-invite", sequence: 0 },
];

function auditRows(now: number, rules: readonly DemoRow[]): DemoRow[] {
  const rows: DemoRow[] = rules.map((rule, index) => ({
    action: "filter.revision_compiled",
    created_at: rule.created_at,
    id: index + 1,
    metadata: { version: String(rule.version) },
    user_id: DEMO_USER_ID,
  }));
  rows.push(
    {
      action: "privacy.raw_payloads_purged",
      created_at: new Date(now - 2 * DAY).toISOString(),
      id: rows.length + 1,
      metadata: { purgedCount: "18" },
      user_id: DEMO_USER_ID,
    },
    {
      action: "connector.disconnected",
      created_at: new Date(now - 9 * DAY).toISOString(),
      id: rows.length + 2,
      metadata: { provider: "gmail" },
      user_id: DEMO_USER_ID,
    },
  );
  return rows.sort((left, right) =>
    (right.created_at as string).localeCompare(left.created_at as string),
  );
}

function disclosureRows(now: number): DemoRow[] {
  return [
    {
      created_at: new Date(now - 3 * HOUR).toISOString(),
      disclosed_fields: ["subject", "body"],
      id: demoUuid("disclosure:1"),
      model: "gpt-4.1-mini",
      provider: "openai",
      purpose: "filter-semantic-clause",
      user_id: DEMO_USER_ID,
    },
    {
      created_at: new Date(now - 2 * DAY).toISOString(),
      disclosed_fields: ["subject"],
      id: demoUuid("disclosure:2"),
      model: "gpt-4.1-mini",
      provider: "openai",
      purpose: "filter-semantic-clause",
      user_id: DEMO_USER_ID,
    },
  ];
}

/** Runs that already finished, so the timeline has decisions on it rather than only proposals. */
function historicalRuns(now: number, eventIds: readonly string[]): DemoRow[] {
  const webhookRuleId = demoUuid("action-rule:webhook");
  const [first, second, third] = eventIds;
  if (first === undefined || second === undefined || third === undefined) return [];
  return [
    {
      action_rule_id: DEMO_TASK_ACTION_RULE_ID,
      approved_at: new Date(now - 20 * HOUR).toISOString(),
      attempt_count: 1,
      completed_at: new Date(now - 20 * HOUR + MINUTE).toISOString(),
      created_at: new Date(now - 20 * HOUR - MINUTE).toISOString(),
      error_code: null,
      event_id: first,
      id: demoUuid("run:succeeded"),
      input: { title: "Collect parcel" },
      provider: "google-tasks",
      status: "succeeded",
      user_id: DEMO_USER_ID,
    },
    {
      action_rule_id: webhookRuleId,
      approved_at: null,
      attempt_count: 0,
      completed_at: new Date(now - 2 * DAY).toISOString(),
      created_at: new Date(now - 2 * DAY - MINUTE).toISOString(),
      error_code: null,
      event_id: second,
      id: demoUuid("run:cancelled"),
      input: { title: "Post to household webhook" },
      provider: "webhook",
      status: "cancelled",
      user_id: DEMO_USER_ID,
    },
    {
      action_rule_id: webhookRuleId,
      approved_at: new Date(now - 4 * DAY).toISOString(),
      attempt_count: 3,
      completed_at: new Date(now - 4 * DAY + 5 * MINUTE).toISOString(),
      created_at: new Date(now - 4 * DAY - MINUTE).toISOString(),
      error_code: "UPSTREAM_UNAVAILABLE",
      event_id: third,
      id: demoUuid("run:failed"),
      input: { title: "Post to household webhook" },
      provider: "webhook",
      status: "failed",
      user_id: DEMO_USER_ID,
    },
  ];
}

export function seedTables(now: number = Date.now()): DemoTables {
  const tables = emptyTables();
  tables.categories = categoryRows(now);
  tables.filter_rules = ruleRows(now);
  tables.action_rules = [
    {
      approval_mode: "required",
      connection_id: null,
      id: DEMO_TASK_ACTION_RULE_ID,
      operation: "tasks.insert",
      provider: "google-tasks",
      user_id: DEMO_USER_ID,
    },
    {
      approval_mode: "required",
      connection_id: null,
      id: demoUuid("action-rule:webhook"),
      operation: "webhook.post",
      provider: "webhook",
      user_id: DEMO_USER_ID,
    },
  ];
  tables.openai_credentials = [
    {
      configured: true,
      last_validated_at: new Date(now - 6 * DAY).toISOString(),
      // On, so the demo shows the panel in its subscribed state rather than its default one.
      server_evaluation: true,
      user_id: DEMO_USER_ID,
      validated: true,
    },
  ];
  tables.disclosures = disclosureRows(now);

  const classifications: DemoRow[] = [];
  const eventIds: string[] = [];

  for (const entry of HISTORY) {
    const scenario = demoScenario(entry.scenarioId);
    if (scenario === undefined) continue;
    const capturedAt = now - entry.minutesAgo * MINUTE;
    const input = scenario.build(capturedAt, entry.sequence);
    const result = applyCapture(tables, input);
    eventIds.push(...result.eventIds);
    const filed = classifyDemoCapture(
      tables,
      input,
      result.sourceItemId,
      new Date(capturedAt).toISOString(),
    );
    if (filed.row !== undefined) classifications.push(filed.row);
  }

  tables.classifications = classifications;
  tables.audit_log = auditRows(now, tables.filter_rules);
  tables.action_runs = [...(tables.action_runs ?? []), ...historicalRuns(now, eventIds)].sort(
    (left, right) => (right.created_at as string).localeCompare(left.created_at as string),
  );
  return tables;
}
