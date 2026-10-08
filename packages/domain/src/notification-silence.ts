/**
 * Compiling a filter rule into something the notification listener can safely evaluate.
 *
 * `RelayNotificationListenerService` runs in a system-bound process with the app dead. It holds a
 * `StatusBarNotification` and nothing else: no session, no derived facts, no classification, no
 * Gmail body, and no way to ask anything. It cannot run `evaluateFilterPlan`, and approximating it
 * there would be the worst possible place to guess -- the decision cancels or snoozes a
 * notification, and cancelling cannot be undone.
 *
 * So a rule is compiled here, in the runtime that *can* see the whole plan, into a flat disjunction
 * of literal tests over the three fields that are reliably available at decision time. Anything that
 * does not compile is refused with a reason the UI states, rather than being partially honoured. The
 * Kotlin side is then a loop over tests rather than a second expression interpreter that could drift
 * from this one.
 *
 * See [ADR-0017](../../../docs/decisions/0017-notification-dismissal-after-posting.md).
 */

import {
  notificationSilenceClauseSchema,
  notificationSilenceRuleSchema,
  type FilterExpression,
  type FilterPlan,
  type FilterPredicate,
  type NotificationSilenceAction,
  type NotificationSilenceClause,
  type NotificationSilenceField,
  type NotificationSilenceRule,
  type NotificationSilenceTest,
} from "@relay/contracts";

import { readFilterField } from "./field-access.js";

/** Clauses a compiled rule may hold, and tests one clause may hold. Mirrors the contract bounds. */
export const SILENCE_MAX_CLAUSES = 16;
export const SILENCE_MAX_TESTS = 16;

/** The only fields available at decision time. Everything else is refused, not approximated. */
const SILENCE_READABLE_FIELDS = new Set<string>(["source.applicationId", "source.kind", "subject"]);

/**
 * Why a rule cannot act on a notification, in the vocabulary the UI reports.
 *
 * Each reason is a property of the rule a person can act on by editing it, except `too-complex`,
 * which is a property of how far the expression expands when flattened.
 */
export type SilenceRefusal =
  | "matches-nothing"
  | "negation-unsupported"
  | "no-deterministic-clause"
  | "too-complex"
  | "unbounded-application"
  | "unreadable-field"
  /**
   * The stored plan is not a plan this build can read.
   *
   * Separate from every other reason here because it is not a property of how the rule was written
   * -- nothing the reader phrased differently would avoid it -- and the advice is different:
   * rebuild the rule rather than reword it.
   */
  | "unreadable-plan";

export type SilenceCompilation =
  | { refusal: SilenceRefusal; status: "refused"; unreadableFields?: NotificationSilenceField[] }
  | { rule: NotificationSilenceRule; status: "compiled" };

/**
 * Canonical text comparison, identical to `evaluateFilterPlan`'s.
 *
 * Exported because three implementations have to agree: this one, the Kotlin one the listener runs,
 * and the evaluator a rule was written against. A rule that files a capture on `subject contains
 * "out for delivery"` and clears a notification on a different notion of what that string equals
 * would clear the wrong one, so both suites assert the same vectors.
 */
export function normalizeSilenceText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function testFor(predicate: FilterPredicate): NotificationSilenceTest {
  return {
    field: predicate.field as NotificationSilenceField,
    operator: predicate.operator,
    values:
      predicate.operator === "exists"
        ? []
        : Array.isArray(predicate.value)
          ? [...predicate.value]
          : [predicate.value],
  };
}

/** A clause names an application only when a test binds the value, rather than describing it. */
function namesApplication(tests: readonly NotificationSilenceTest[]): boolean {
  return tests.some(
    (test) =>
      test.field === "source.applicationId" &&
      (test.operator === "equals" || test.operator === "in"),
  );
}

/** Identity of a test, so flattening an `all` cannot emit the same comparison twice. */
function testKey(test: NotificationSilenceTest): string {
  return `${test.field}\u001f${test.operator}\u001f${test.values.join("\u001f")}`;
}

type Flattening =
  | { clauses: NotificationSilenceTest[][]; status: "ok" }
  | { refusal: SilenceRefusal; status: "refused"; unreadableFields?: NotificationSilenceField[] };

/**
 * Flattens an expression into a disjunction of conjunctions.
 *
 * `all` is a cartesian product and `any` a concatenation, which is where the size bound earns its
 * keep: a plan the contract happily accepts can expand past what is reasonable to carry in a
 * SharedPreferences snapshot and loop over on every posted notification. Exceeding the bound refuses
 * the rule rather than truncating it, because a truncated disjunction matches strictly more than the
 * rule asked for.
 */
function flatten(expression: FilterExpression): Flattening {
  if ("never" in expression) {
    // Vacuously safe but pointless: a rule that matches nothing would sit in the list looking
    // authorized and never do anything.
    return { refusal: "matches-nothing", status: "refused" };
  }

  if ("not" in expression) {
    // A negated predicate over a field Android may simply not have supplied is true by absence, so
    // it would clear a notification the rule never described. Device classification guards the same
    // hazard by declaring field availability up front; the listener has no way to do that.
    return { refusal: "negation-unsupported", status: "refused" };
  }

  if ("all" in expression) {
    let clauses: NotificationSilenceTest[][] = [[]];
    for (const child of expression.all) {
      const flattened = flatten(child);
      if (flattened.status === "refused") return flattened;
      const combined: NotificationSilenceTest[][] = [];
      for (const left of clauses) {
        for (const right of flattened.clauses) {
          const seen = new Set(left.map(testKey));
          const merged = [...left];
          for (const test of right) {
            if (seen.has(testKey(test))) continue;
            seen.add(testKey(test));
            merged.push(test);
          }
          if (merged.length > SILENCE_MAX_TESTS) {
            return { refusal: "too-complex", status: "refused" };
          }
          combined.push(merged);
        }
      }
      if (combined.length > SILENCE_MAX_CLAUSES) {
        return { refusal: "too-complex", status: "refused" };
      }
      clauses = combined;
    }
    return { clauses, status: "ok" };
  }

  if ("any" in expression) {
    const clauses: NotificationSilenceTest[][] = [];
    for (const child of expression.any) {
      const flattened = flatten(child);
      if (flattened.status === "refused") return flattened;
      clauses.push(...flattened.clauses);
      if (clauses.length > SILENCE_MAX_CLAUSES) {
        return { refusal: "too-complex", status: "refused" };
      }
    }
    return { clauses, status: "ok" };
  }

  if (!SILENCE_READABLE_FIELDS.has(expression.field)) {
    return {
      refusal: "unreadable-field",
      status: "refused",
      unreadableFields: [expression.field as NotificationSilenceField],
    };
  }
  return { clauses: [[testFor(expression)]], status: "ok" };
}

/**
 * Compiles one authorized rule, or says why it cannot be.
 *
 * The caller is expected to have established that the database authorized this rule; this decides
 * only whether the device can evaluate it faithfully. The two are separate questions and both have
 * to answer yes, so a rule can be authorized server-side and still be refused here -- which is
 * reported rather than hidden, because a rule that appears to work and quietly does nothing is worse
 * than one that says it cannot.
 */
export function compileNotificationSilenceRule(
  plan: FilterPlan,
  options: { action: NotificationSilenceAction; filterRuleId: string; observing: boolean },
): SilenceCompilation {
  // A semantic clause no longer disqualifies a rule. The device can resolve one against an endpoint
  // the reader configured (ADR-0019), so the clause becomes a second step rather than a refusal:
  // the literal tests below decide that a notification is a candidate, and a model decides whether
  // it matches. What has not changed is that the deterministic part must still exist and must still
  // compile -- a rule that is *only* a semantic clause names no application and could never act.
  if (plan.deterministic === undefined) {
    return { refusal: "no-deterministic-clause", status: "refused" };
  }

  const flattened = flatten(plan.deterministic);
  if (flattened.status === "refused") return flattened;
  if (flattened.clauses.length === 0) return { refusal: "matches-nothing", status: "refused" };

  const clauses: NotificationSilenceClause[] = [];
  for (const tests of flattened.clauses) {
    // Every clause separately, because a disjunction is only as bounded as its loosest branch.
    if (!namesApplication(tests)) return { refusal: "unbounded-application", status: "refused" };
    const parsed = notificationSilenceClauseSchema.safeParse({ tests });
    if (!parsed.success) return { refusal: "too-complex", status: "refused" };
    clauses.push(parsed.data);
  }

  const rule = notificationSilenceRuleSchema.safeParse({
    action: options.action,
    awaitsModel: plan.semantic !== undefined,
    clauses,
    filterRuleId: options.filterRuleId,
    observing: options.observing,
  });
  if (!rule.success) return { refusal: "too-complex", status: "refused" };
  return { rule: rule.data, status: "compiled" };
}

function passes(test: NotificationSilenceTest, item: Record<string, unknown>): boolean {
  const raw = readFilterField(item, test.field);
  if (test.operator === "exists") return raw !== undefined && raw !== null && raw !== "";
  if (typeof raw !== "string") return false;

  const actual = normalizeSilenceText(raw);
  if (test.operator === "in") {
    return test.values.some((value) => normalizeSilenceText(value) === actual);
  }
  const expected = normalizeSilenceText(test.values[0] ?? "");
  if (test.operator === "equals") return actual === expected;
  if (test.operator === "contains") return actual.includes(expected);
  return actual.startsWith(expected);
}

/**
 * Evaluates compiled clauses against one notification.
 *
 * The Kotlin listener runs the same decision over the same shape; this exists so the app can show a
 * person what a rule would do before they authorize it, and so both implementations can be held to
 * one set of vectors.
 */
export function evaluateNotificationSilenceClauses(
  clauses: readonly NotificationSilenceClause[],
  item: Record<string, unknown>,
): boolean {
  return clauses.some((clause) => clause.tests.every((test) => passes(test, item)));
}

/** The first authorized rule that matches, in the order given. */
export function matchNotificationSilenceRule(
  rules: readonly NotificationSilenceRule[],
  item: Record<string, unknown>,
): NotificationSilenceRule | undefined {
  return rules.find((rule) => evaluateNotificationSilenceClauses(rule.clauses, item));
}
