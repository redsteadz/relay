/**
 * Presentation logic for the filter rule editor.
 *
 * Pure, so it can be tested without rendering, matching how `categoryPresentation.ts` backs the
 * category editor and `openAiPresentation.ts` backs the credential panel.
 *
 * The compiler and evaluator come from `@relay/domain` rather than being restated here. That is the
 * point of the editor: what it shows before saving is produced by the same code the pipeline runs,
 * so the preview cannot drift into describing behaviour Relay would not actually have. The server
 * still recompiles on save and remains authoritative; this is a faithful preview, not a second
 * implementation.
 */

import {
  filterIntentSchema,
  type FilterCompilation,
  type FilterCompileRequest,
  type FilterExpression,
  type FilterField,
  type FilterPlan,
  type FilterPredicate,
  type FilterRuleVersion,
  type FilterUnsupportedClause,
  type SemanticDisclosure,
} from "@relay/contracts";
import {
  compileFilterPlan,
  evaluateFilterPlan,
  minimizeSemanticDisclosure,
  type FilterCategoryDescriptor,
  type FilterDecision,
} from "@relay/domain";

import { RelayApiError } from "@/lib/relay-api";

const FIELD_LABELS: Readonly<Record<FilterField, string>> = {
  "attributes.amount": "Amount",
  "attributes.currency": "Currency",
  "attributes.merchant": "Merchant",
  body: "Body",
  category: "Category",
  sender: "Sender",
  "source.applicationId": "App",
  "source.kind": "Source",
  subject: "Subject",
};

export function filterFieldLabel(field: FilterField): string {
  return FIELD_LABELS[field];
}

const OPERATOR_LABELS: Readonly<Record<string, string>> = {
  contains: "contains",
  equals: "is",
  exists: "is present",
  in: "is any of",
  "starts-with": "starts with",
};

/** One line of the compiled plan, flattened with a depth so the screen can indent it. */
export type PlanLine = {
  depth: number;
  /** `group` lines introduce the connective that governs the lines beneath them. */
  kind: "group" | "predicate";
  text: string;
};

function describePredicate(predicate: FilterPredicate): string {
  const field = filterFieldLabel(predicate.field);
  const operator = OPERATOR_LABELS[predicate.operator] ?? predicate.operator;
  if (predicate.operator === "exists") return `${field} ${operator}`;
  const value = Array.isArray(predicate.value) ? predicate.value.join(", ") : predicate.value;
  return `${field} ${operator} ${value}`;
}

function isPredicate(expression: FilterExpression): expression is FilterPredicate {
  return "field" in expression;
}

/**
 * Flattens a compiled expression into readable lines.
 *
 * `never` is shown rather than hidden. The compiler emits it when an intent produced no usable
 * predicate or carried a value it could not accept, and a rule that silently matches nothing is
 * exactly the surprise this editor exists to prevent.
 */
export function describeFilterExpression(
  expression: FilterExpression | undefined,
  depth = 0,
): PlanLine[] {
  if (expression === undefined) return [];
  if (isPredicate(expression)) {
    return [{ depth, kind: "predicate", text: describePredicate(expression) }];
  }
  if ("never" in expression) {
    return [{ depth, kind: "predicate", text: "Never matches" }];
  }
  if ("not" in expression) {
    return [
      { depth, kind: "group", text: "Not" },
      ...describeFilterExpression(expression.not, depth + 1),
    ];
  }
  const children = "all" in expression ? expression.all : expression.any;
  return [
    { depth, kind: "group", text: "all" in expression ? "All of" : "Any of" },
    ...children.flatMap((child) => describeFilterExpression(child, depth + 1)),
  ];
}

export type UnsupportedExplanation = { detail: string; text: string };

const UNSUPPORTED_DETAIL: Readonly<Record<FilterUnsupportedClause["reason"], string>> = {
  "action-intent-not-allowed":
    "A filter decides what matches. It cannot choose an action — that stays an explicit, separate rule.",
  "invalid-value": "Relay could not read a usable value here, so this rule will match nothing.",
  "semantic-required":
    "No deterministic predicate covers this, so it becomes a question for a model — and only if you have a key configured.",
};

export function explainUnsupportedClauses(
  clauses: readonly FilterUnsupportedClause[],
): UnsupportedExplanation[] {
  return clauses.map((clause) => ({
    detail: UNSUPPORTED_DETAIL[clause.reason],
    text: clause.text,
  }));
}

export type FilterPreviewCompilation =
  | { compilation: FilterCompilation; status: "compiled" }
  | { message: string; status: "incomplete" };

/**
 * Compiles an intent locally so the editor can show the plan before anything is written.
 *
 * `compileFilterPlan` parses the intent first and throws on one that cannot be a rule, which for a
 * field someone is still typing is an ordinary state rather than a failure.
 */
export function previewFilterCompilation(
  intent: string,
  categories: readonly FilterCategoryDescriptor[] = [],
): FilterPreviewCompilation {
  if (!filterIntentSchema.safeParse(intent).success) {
    return {
      message: "Describe the rule in plain language to see how Relay would compile it.",
      status: "incomplete",
    };
  }
  try {
    return { compilation: compileFilterPlan(intent, categories), status: "compiled" };
  } catch {
    return {
      message: "Relay could not compile that intent. Try describing one condition per sentence.",
      status: "incomplete",
    };
  }
}

export type PreviewItem = {
  id: string;
  item: Record<string, unknown>;
  label: string;
  synthetic: boolean;
};

export type PreviewOutcome = {
  decision: FilterDecision;
  /**
   * The exact minimized payload a semantic clause would disclose, built with the same function the
   * pipeline uses. Present only for an `undecided` item, because nothing is disclosed otherwise.
   */
  disclosure: SemanticDisclosure | undefined;
  id: string;
  label: string;
  matchedFields: FilterField[];
};

/**
 * Runs a compiled plan against items without contacting anything.
 *
 * `evaluateFilterPlan` is pure and returns `undecided` for a semantic clause rather than resolving
 * it, so a preview cannot reach a provider even when a key is configured, and cannot create an
 * action because it produces a decision and nothing else.
 */
export function previewFilterOutcomes(
  plan: FilterPlan,
  items: readonly PreviewItem[],
): PreviewOutcome[] {
  return items.map((entry) => {
    const evaluation = evaluateFilterPlan(plan, entry.item);
    return {
      decision: evaluation.decision,
      disclosure:
        evaluation.decision === "undecided" && plan.semantic !== undefined
          ? minimizeSemanticDisclosure(plan.semantic, entry.item)
          : undefined,
      id: entry.id,
      label: entry.label,
      matchedFields: evaluation.matchedPredicates.map((predicate) => predicate.field),
    };
  });
}

const DECISION_LABELS: Readonly<Record<FilterDecision, string>> = {
  match: "Matches",
  "no-match": "No match",
  undecided: "Needs a model",
};

export function decisionLabel(decision: FilterDecision): string {
  return DECISION_LABELS[decision];
}

export function decisionTone(decision: FilterDecision): "info" | "success" | "warning" {
  if (decision === "match") return "success";
  return decision === "undecided" ? "warning" : "info";
}

/**
 * A fixed corpus for previewing a rule before any real item is chosen.
 *
 * Entirely invented: `example.test` addresses and an obviously fake card number, so a preview is
 * useful on a new account with nothing retained and never depends on someone's own data. The
 * receipt carries values the redactor should remove, which is what makes the disclosure preview
 * meaningful rather than decorative.
 */
export const syntheticPreviewItems: readonly PreviewItem[] = [
  {
    id: "synthetic-receipt",
    item: {
      attributes: { amount: "42.50", currency: "USD", merchant: "Corner Market" },
      body: "Card ending 4111 1111 1111 1111 charged. Questions? billing@example.test",
      category: "finance",
      sender: "receipts@example.test",
      source: { applicationId: "com.example.bank", kind: "sms" },
      subject: "Receipt for order 8891",
    },
    label: "Receipt · SMS",
    synthetic: true,
  },
  {
    id: "synthetic-delivery",
    item: {
      attributes: {},
      body: "Your parcel arrives tomorrow between 09:00 and 12:00.",
      category: "logistics",
      sender: "no-reply@example.test",
      source: { applicationId: "com.example.mail", kind: "gmail" },
      subject: "Delivery update",
    },
    label: "Delivery · Gmail",
    synthetic: true,
  },
  {
    id: "synthetic-promotion",
    item: {
      attributes: {},
      body: "Half price this weekend only. Unsubscribe at https://promo.example.test/stop",
      category: "promotions",
      sender: "offers@example.test",
      source: { applicationId: "com.example.shop", kind: "notification" },
      subject: "Weekend sale",
    },
    label: "Promotion · Notification",
    synthetic: true,
  },
];

/** The newest revision of each series, which is what the rule list shows. */
export function latestFilterRevisions(
  revisions: readonly FilterRuleVersion[],
): FilterRuleVersion[] {
  const newest = new Map<string, FilterRuleVersion>();
  for (const revision of revisions) {
    const current = newest.get(revision.seriesId);
    if (current === undefined || revision.version > current.version) {
      newest.set(revision.seriesId, revision);
    }
  }
  return [...newest.values()].sort((left, right) => left.name.localeCompare(right.name));
}

/** Every revision of one series, newest first, so prior versions stay inspectable after an edit. */
export function filterRevisionHistory(
  revisions: readonly FilterRuleVersion[],
  seriesId: string,
): FilterRuleVersion[] {
  return revisions
    .filter((revision) => revision.seriesId === seriesId)
    .sort((left, right) => right.version - left.version);
}

export type FilterDraft = {
  /** Category a matching capture is filed into. Undefined files it without naming one. */
  categoryId: string | undefined;
  enabled: boolean;
  intent: string;
  name: string;
  /** Present when editing, so the save extends the existing series instead of starting one. */
  series: { expectedVersion: number; seriesId: string } | undefined;
};

export function filterDraftFor(revision: FilterRuleVersion | undefined): FilterDraft {
  if (revision === undefined) {
    return { categoryId: undefined, enabled: true, intent: "", name: "", series: undefined };
  }
  return {
    categoryId: revision.categoryId,
    enabled: revision.enabled,
    intent: revision.intent,
    name: revision.name,
    series: { expectedVersion: revision.version, seriesId: revision.seriesId },
  };
}

/**
 * The save body.
 *
 * `seriesId` and `expectedVersion` travel together — the contract refuses one without the other —
 * and carry the optimistic concurrency that makes a lost update a `409` rather than a silent
 * overwrite of someone else's edit.
 */
export function filterSaveRequest(draft: FilterDraft): FilterCompileRequest {
  return {
    // Sent explicitly as null when cleared, because an absent field reads as "unchanged" and would
    // leave a rule pointed at a category the editor no longer shows as selected.
    categoryId: draft.categoryId ?? null,
    enabled: draft.enabled,
    intent: draft.intent.trim(),
    name: draft.name.trim(),
    ...(draft.series === undefined
      ? {}
      : { expectedVersion: draft.series.expectedVersion, seriesId: draft.series.seriesId }),
  };
}

export function filterNameError(value: string): string | undefined {
  const candidate = value.trim();
  if (candidate.length === 0) return "Give the rule a name you will recognise later.";
  if (candidate.length > 80) return "Keep the name to 80 characters or fewer.";
  return undefined;
}

export function filterIntentError(value: string): string | undefined {
  const candidate = value.trim();
  if (candidate.length === 0) return "Describe what this rule should match.";
  if (candidate.length > 4000) return "Keep the description to 4000 characters or fewer.";
  return undefined;
}

export function filterDraftError(draft: FilterDraft): string | undefined {
  return filterNameError(draft.name) ?? filterIntentError(draft.intent);
}

const SAVE_MESSAGES: Readonly<Record<string, string>> = {
  filter_compilation_unavailable:
    "Relay could not compile the rule just now. Your draft is unchanged — try again shortly.",
  filter_revision_conflict:
    "This rule changed somewhere else while you were editing. Reopen it to see the current version, then reapply your change.",
  invalid_filter_intent:
    "Relay could not read that rule. Try describing one condition per sentence.",
};

export function filterSaveErrorMessage(error: unknown): string {
  if (error instanceof RelayApiError) {
    const message = error.apiCode === undefined ? undefined : SAVE_MESSAGES[error.apiCode];
    if (message !== undefined) return message;
    if (error.reason === "unauthorized") return "Your session expired. Sign in again to continue.";
    if (error.reason === "rate-limit") return "Too many saves. Wait a moment before trying again.";
    if (error.reason === "network" || error.reason === "timeout") {
      return "Relay is temporarily unreachable. Check your connection and try again.";
    }
  }
  return "The rule could not be saved right now. Try again shortly.";
}

/** Short summary for a rule card: what decides it, and whether a model is ever involved. */
export function filterPlanSummary(plan: FilterPlan): string {
  const parts: string[] = [];
  if (plan.deterministic !== undefined) {
    const predicates = describeFilterExpression(plan.deterministic).filter(
      (line) => line.kind === "predicate",
    );
    parts.push(
      predicates.length === 1 && predicates[0]?.text === "Never matches"
        ? "Matches nothing"
        : `${predicates.length.toString()} deterministic ${predicates.length === 1 ? "check" : "checks"}`,
    );
  }
  if (plan.semantic !== undefined) {
    parts.push(
      `semantic fallback at ${Math.round(plan.semantic.minimumConfidence * 100).toString()}% confidence`,
    );
  }
  return parts.join(" · ");
}
