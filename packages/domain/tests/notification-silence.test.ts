import { describe, expect, it } from "vitest";

import {
  filterPlanSchema,
  notificationSilenceRuleSchema,
  type FilterExpression,
  type FilterPlan,
} from "@relay/contracts";

import {
  compileNotificationSilenceRule,
  evaluateNotificationSilenceClauses,
  matchNotificationSilenceRule,
  normalizeSilenceText,
  SILENCE_MAX_CLAUSES,
} from "../src/notification-silence.js";

const RULE_ID = "7f1a2b3c-4d5e-4f60-8a91-b2c3d4e5f607";

function plan(deterministic: FilterExpression, semantic?: FilterPlan["semantic"]): FilterPlan {
  return filterPlanSchema.parse({
    schemaVersion: 1,
    compilerVersion: 1,
    intent: "synthetic intent",
    deterministic,
    ...(semantic === undefined ? {} : { semantic }),
  });
}

function compile(deterministic: FilterExpression, semantic?: FilterPlan["semantic"]) {
  return compileNotificationSilenceRule(plan(deterministic, semantic), {
    action: "snooze",
    filterRuleId: RULE_ID,
    observing: false,
  });
}

const courier: FilterExpression = {
  field: "source.applicationId",
  operator: "equals",
  value: "com.courier.app",
};

/**
 * The vectors the Kotlin listener asserts too.
 *
 * `NotificationSilencePolicyTest` holds the same table. Normalization drifting between the runtime
 * that compiles a rule and the runtime that acts on it would clear a notification the reader never
 * described, so neither side gets to define it alone.
 */
const NORMALIZATION_VECTORS: readonly [string, string][] = [
  ["Out For Delivery", "out for delivery"],
  ["  out   for\tdelivery  ", "out for delivery"],
  ["OUT\u00a0FOR\u00a0DELIVERY", "out for delivery"],
  ["out\u2009for\u2009delivery", "out for delivery"],
  ["\ufb01nal notice", "final notice"],
  ["\u2163 quarter", "iv quarter"],
  ["caf\u00e9", "caf\u00e9"],
  ["", ""],
];

describe("normalizeSilenceText", () => {
  it.each(NORMALIZATION_VECTORS)("normalizes %j to %j", (input, expected) => {
    expect(normalizeSilenceText(input)).toBe(expected);
  });
});

describe("what compiles", () => {
  /**
   * A semantic clause is a second step, not a disqualification.
   *
   * The literal tests decide that a notification is a candidate and a model decides whether it
   * matches, so the compiled rule carries the fact that an answer is still owed. The device can
   * reach a model now (ADR-0019); before, this was refused outright.
   */
  it("compiles a rule carrying a semantic clause, marked as awaiting a model", () => {
    const result = compile(courier, {
      question: "is this urgent?",
      minimumConfidence: 0.8,
      allowedFields: ["subject"],
    });
    expect(result.status).toBe("compiled");
    if (result.status !== "compiled") return;
    expect(result.rule.awaitsModel).toBe(true);
    // The application predicate still has to be there: a model answers within the scope the
    // deterministic part already established, never instead of it.
    expect(result.rule.clauses[0]?.tests[0]?.field).toBe("source.applicationId");
  });

  it("marks a purely deterministic rule as owing no answer", () => {
    const result = compile(courier);
    expect(result.status).toBe("compiled");
    if (result.status !== "compiled") return;
    expect(result.rule.awaitsModel).toBe(false);
  });

  it("compiles a bare application predicate", () => {
    const result = compile(courier);
    expect(result.status).toBe("compiled");
    if (result.status !== "compiled") return;
    expect(result.rule).toStrictEqual({
      action: "snooze",
      clauses: [
        {
          tests: [
            {
              field: "source.applicationId",
              operator: "equals",
              values: ["com.courier.app"],
            },
          ],
        },
      ],
      awaitsModel: false,
      filterRuleId: RULE_ID,
      observing: false,
      unscoped: false,
    });
  });

  it("flattens a conjunction into one clause", () => {
    const result = compile({
      all: [courier, { field: "subject", operator: "contains", value: "out for delivery" }],
    });
    expect(result.status).toBe("compiled");
    if (result.status !== "compiled") return;
    expect(result.rule.clauses).toHaveLength(1);
    expect(result.rule.clauses[0]?.tests).toHaveLength(2);
  });

  it("flattens a disjunction into one clause per branch", () => {
    const result = compile({
      any: [
        { all: [courier, { field: "subject", operator: "contains", value: "delivered" }] },
        {
          all: [
            { field: "source.applicationId", operator: "equals", value: "com.other.app" },
            { field: "subject", operator: "starts-with", value: "promo" },
          ],
        },
      ],
    });
    expect(result.status).toBe("compiled");
    if (result.status !== "compiled") return;
    expect(result.rule.clauses).toHaveLength(2);
  });

  it("distributes a conjunction over a disjunction", () => {
    const result = compile({
      all: [
        courier,
        {
          any: [
            { field: "subject", operator: "contains", value: "delivered" },
            { field: "subject", operator: "contains", value: "dispatched" },
          ],
        },
      ],
    });
    expect(result.status).toBe("compiled");
    if (result.status !== "compiled") return;
    // Each branch keeps the application predicate, which is exactly why distribution is needed:
    // a clause that lost it would match any application.
    expect(result.rule.clauses).toHaveLength(2);
    for (const clause of result.rule.clauses) {
      expect(clause.tests.map((test) => test.field)).toContain("source.applicationId");
    }
  });

  it("does not emit the same comparison twice in one clause", () => {
    const result = compile({ all: [courier, courier] });
    expect(result.status).toBe("compiled");
    if (result.status !== "compiled") return;
    expect(result.rule.clauses[0]?.tests).toHaveLength(1);
  });

  it("carries an in-predicate's whole value list", () => {
    const result = compile({
      field: "source.applicationId",
      operator: "in",
      value: ["com.courier.app", "com.other.app"],
    });
    expect(result.status).toBe("compiled");
    if (result.status !== "compiled") return;
    expect(result.rule.clauses[0]?.tests[0]?.values).toStrictEqual([
      "com.courier.app",
      "com.other.app",
    ]);
  });
});

// The shape `compileFilterPlan` produces from a purely descriptive intent -- every clause
// `semantic-required`, so no deterministic key at all. Quieting by description is the feature
// (ADR-0020), so it compiles to a rule with no literal tests that a model decides per notification.
describe("a rule with nothing literal in it", () => {
  const describing = filterPlanSchema.parse({
    schemaVersion: 1,
    compilerVersion: 1,
    intent: "marketing",
    semantic: {
      question: "is this marketing?",
      minimumConfidence: 0.8,
      allowedFields: ["subject"],
    },
  });

  it("compiles to an unscoped rule a model decides", () => {
    const result = compileNotificationSilenceRule(describing, {
      action: "snooze",
      filterRuleId: RULE_ID,
      observing: false,
    });
    expect(result).toStrictEqual({
      rule: {
        action: "snooze",
        awaitsModel: true,
        clauses: [],
        filterRuleId: RULE_ID,
        observing: false,
        unscoped: true,
      },
      status: "compiled",
    });
  });

  // The flag and the shape are redundant on purpose: a dropped clause must refuse rather than widen
  // a rule that cancels notifications to the whole shade.
  it("refuses a rule whose flag and shape disagree", () => {
    expect(
      notificationSilenceRuleSchema.safeParse({
        action: "snooze",
        awaitsModel: true,
        clauses: [],
        filterRuleId: RULE_ID,
        observing: false,
        unscoped: false,
      }).success,
    ).toBe(false);
  });

  // Nothing narrows it and nothing decides it, so it would act on everything unconditionally.
  it("refuses an unscoped rule that owes no model an answer", () => {
    expect(
      notificationSilenceRuleSchema.safeParse({
        action: "dismiss",
        awaitsModel: false,
        clauses: [],
        filterRuleId: RULE_ID,
        observing: false,
        unscoped: true,
      }).success,
    ).toBe(false);
  });
});

describe("what is refused", () => {
  // `filterPlanSchema` already refuses a plan with neither part, so this is defence rather than a
  // reachable path -- and the one place it has to hold: falling through would build an unscoped rule
  // that no model decides, which cancels every notification unconditionally. Constructed past the
  // contract on purpose: the refusal is a runtime `.refine`, so the static type admits a plan with
  // neither part and this is the only way to reach the branch at all.
  it("refuses a plan with neither a deterministic nor a semantic part", () => {
    const result = compileNotificationSilenceRule(
      { compilerVersion: 1, intent: "synthetic intent", schemaVersion: 1 },
      { action: "snooze", filterRuleId: RULE_ID, observing: false },
    );
    expect(result).toStrictEqual({ refusal: "no-deterministic-clause", status: "refused" });
  });

  // Absence reads as false, so `not(subject contains "x")` is satisfied by a notification Android
  // supplied no subject for -- a match the rule never described.
  it("refuses negation", () => {
    const result = compile({ all: [courier, { not: { field: "subject", operator: "exists" } }] });
    expect(result).toStrictEqual({ refusal: "negation-unsupported", status: "refused" });
  });

  it.each([
    ["category", { field: "category", operator: "equals", value: "finance" }],
    ["body", { field: "body", operator: "contains", value: "receipt" }],
    ["sender", { field: "sender", operator: "contains", value: "courier" }],
    ["attributes.merchant", { field: "attributes.merchant", operator: "exists" }],
  ] as [string, FilterExpression][])("refuses the unreadable field %s", (field, predicate) => {
    const result = compile({ all: [courier, predicate] });
    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.refusal).toBe("unreadable-field");
    expect(result.unreadableFields).toStrictEqual([field]);
  });

  // #38 required every rule to name an application and ADR-0020 lifted it. These three used to be
  // refusals; they compile now, because the capture allowlist is what bounds the reach and the dry
  // run, the review and the stops are what make the act safe.
  it("compiles a rule that names no application", () => {
    const result = compile({ field: "subject", operator: "contains", value: "delivery" });
    expect(result.status).toBe("compiled");
  });

  it("compiles a disjunction with one branch naming no application", () => {
    const result = compile({
      any: [courier, { field: "subject", operator: "contains", value: "delivery" }],
    });
    expect(result.status).toBe("compiled");
  });

  // `contains` still describes an application rather than naming one -- `com.courier.app.evil`
  // satisfies it -- but that is now the reader's business rather than a refusal.
  it("compiles an application predicate that only describes the application", () => {
    const result = compile({
      field: "source.applicationId",
      operator: "contains",
      value: "courier",
    });
    expect(result.status).toBe("compiled");
  });

  // A rule with literal tests is never unscoped, however loose those tests are. Only the absence of
  // a deterministic part makes a rule apply to everything.
  it("marks a loosely scoped rule as scoped all the same", () => {
    const result = compile({ field: "subject", operator: "contains", value: "delivery" });
    if (result.status !== "compiled") throw new Error("expected a compiled rule");
    expect(result.rule.unscoped).toBe(false);
    expect(result.rule.clauses).toHaveLength(1);
  });

  it("refuses an expression that matches nothing", () => {
    const result = compile({ all: [courier, { never: true }] });
    expect(result).toStrictEqual({ refusal: "matches-nothing", status: "refused" });
  });

  // A conjunction of disjunctions multiplies rather than adds, so a plan the contract accepts --
  // every node within its child and depth limits -- can still expand past what the snapshot carries
  // and the listener loops over. Truncating would match strictly more than the rule asked for, so
  // the whole rule is refused.
  it("refuses an expression that expands past the clause bound", () => {
    function anyOf(prefix: string, count: number): FilterExpression {
      return {
        any: Array.from({ length: count }, (_, index) => ({
          field: "subject" as const,
          operator: "contains" as const,
          value: `${prefix}-${index.toString()}`,
        })),
      };
    }

    // 4 x 4 = 16 clauses is exactly the bound and compiles.
    const atBound = compile({ all: [courier, anyOf("left", 4), anyOf("right", 4)] });
    expect(atBound.status).toBe("compiled");
    if (atBound.status === "compiled") {
      expect(atBound.rule.clauses).toHaveLength(SILENCE_MAX_CLAUSES);
    }

    // One more factor doubles it to 32.
    const result = compile({
      all: [courier, anyOf("left", 4), anyOf("right", 4), anyOf("extra", 2)],
    });
    expect(result).toStrictEqual({ refusal: "too-complex", status: "refused" });
  });
});

describe("evaluating compiled clauses", () => {
  const notification = {
    source: { applicationId: "com.courier.app", kind: "notification" },
    subject: "Your parcel is OUT FOR DELIVERY",
  };

  function clausesFor(expression: FilterExpression) {
    const result = compile(expression);
    if (result.status !== "compiled")
      throw new Error(`expected a compiled rule: ${result.refusal}`);
    return result.rule.clauses;
  }

  it("matches when every test in a clause passes", () => {
    const clauses = clausesFor({
      all: [courier, { field: "subject", operator: "contains", value: "out for delivery" }],
    });
    expect(evaluateNotificationSilenceClauses(clauses, notification)).toBe(true);
  });

  it("does not match when one test in the clause fails", () => {
    const clauses = clausesFor({
      all: [courier, { field: "subject", operator: "contains", value: "delivered" }],
    });
    expect(evaluateNotificationSilenceClauses(clauses, notification)).toBe(false);
  });

  it("matches through either branch of a disjunction", () => {
    const clauses = clausesFor({
      any: [
        { all: [courier, { field: "subject", operator: "contains", value: "delivered" }] },
        { all: [courier, { field: "subject", operator: "contains", value: "out for delivery" }] },
      ],
    });
    expect(evaluateNotificationSilenceClauses(clauses, notification)).toBe(true);
  });

  it("does not match a different application", () => {
    const clauses = clausesFor(courier);
    expect(
      evaluateNotificationSilenceClauses(clauses, {
        source: { applicationId: "com.unrelated.app", kind: "notification" },
        subject: "Your parcel is out for delivery",
      }),
    ).toBe(false);
  });

  // Android supplies no subject for plenty of notifications. An absent field fails a comparison
  // rather than passing it, which is what keeps a narrowing predicate narrowing.
  it("does not match when the field is absent", () => {
    const clauses = clausesFor({
      all: [courier, { field: "subject", operator: "contains", value: "delivery" }],
    });
    expect(
      evaluateNotificationSilenceClauses(clauses, {
        source: { applicationId: "com.courier.app", kind: "notification" },
      }),
    ).toBe(false);
  });

  it("returns the first matching rule and no other", () => {
    const first = compile(courier);
    const second = compile({
      field: "source.applicationId",
      operator: "equals",
      value: "com.other.app",
    });
    if (first.status !== "compiled" || second.status !== "compiled") throw new Error("setup");
    expect(matchNotificationSilenceRule([first.rule, second.rule], notification)).toBe(first.rule);
    expect(matchNotificationSilenceRule([second.rule], notification)).toBeUndefined();
  });
});
