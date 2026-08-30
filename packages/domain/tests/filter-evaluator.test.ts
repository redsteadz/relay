import { describe, expect, it } from "vitest";

import { filterPlanSchema, type FilterExpression, type FilterPlan } from "@relay/contracts";

import { evaluateFilter, evaluateFilterPlan } from "../src/filter-evaluator.js";

function plan(overrides: Partial<FilterPlan> = {}): FilterPlan {
  return filterPlanSchema.parse({
    schemaVersion: 1,
    compilerVersion: 1,
    intent: "synthetic intent",
    deterministic: { field: "subject", operator: "contains", value: "invoice" },
    ...overrides,
  });
}

const item = {
  attributes: { amount: "10.50", currency: "USD", merchant: "Synthetic Store" },
  category: "work-notes",
  sender: "billing@example.test",
  source: { applicationId: "com.example.app", kind: "email" },
  subject: "Your Invoice is ready",
};

describe("operators", () => {
  it.each([
    ["equals", "sender", "billing@example.test", true],
    ["equals", "sender", "other@example.test", false],
    ["contains", "subject", "invoice", true],
    ["contains", "subject", "refund", false],
    ["starts-with", "subject", "your invoice", true],
    ["starts-with", "subject", "invoice", false],
  ])("%s on %s with %j is %s", (operator, field, value, expected) => {
    const evaluation = evaluateFilterPlan(
      plan({ deterministic: { field, operator, value } as FilterExpression }),
      item,
    );
    expect(evaluation.decision).toBe(expected ? "match" : "no-match");
  });

  it("matches in against any normalized candidate", () => {
    const deterministic = {
      field: "source.kind",
      operator: "in",
      value: ["sms", "email"],
    } as FilterExpression;
    expect(evaluateFilter(plan({ deterministic }), item)).toBe("match");
  });

  it("reports exists for a present field and a missing one", () => {
    const present = { field: "sender", operator: "exists" } as FilterExpression;
    const absent = { field: "attributes.merchant", operator: "exists" } as FilterExpression;
    expect(evaluateFilter(plan({ deterministic: present }), item)).toBe("match");
    expect(evaluateFilter(plan({ deterministic: absent }), { ...item, attributes: {} })).toBe(
      "no-match",
    );
  });

  it("treats an empty string as absent for exists", () => {
    const deterministic = { field: "sender", operator: "exists" } as FilterExpression;
    expect(evaluateFilter(plan({ deterministic }), { ...item, sender: "" })).toBe("no-match");
  });

  it("compares money as an exact decimal string rather than a number", () => {
    const deterministic = {
      field: "attributes.amount",
      operator: "equals",
      value: "10.5",
    } as FilterExpression;
    // "10.50" and "10.5" are the same quantity but not the same exact decimal string, and the
    // repository forbids routing money through a float to decide that.
    expect(evaluateFilter(plan({ deterministic }), item)).toBe("no-match");
  });
});

describe("tri-state behaviour", () => {
  it("returns no-match for an absent field without consulting the semantic clause", () => {
    const evaluation = evaluateFilterPlan(
      plan({
        deterministic: { field: "subject", operator: "contains", value: "invoice" },
        semantic: { allowedFields: ["subject"], minimumConfidence: 0.8, question: "urgent?" },
      }),
      { ...item, subject: undefined },
    );
    expect(evaluation.decision).toBe("no-match");
  });

  it("returns undecided only when the deterministic part passes and a semantic clause exists", () => {
    const evaluation = evaluateFilterPlan(
      plan({
        semantic: { allowedFields: ["subject"], minimumConfidence: 0.8, question: "urgent?" },
      }),
      item,
    );
    expect(evaluation.decision).toBe("undecided");
  });

  it("returns match when the deterministic part passes with no semantic clause", () => {
    expect(evaluateFilter(plan(), item)).toBe("match");
  });

  it("treats a never node as a failed predicate", () => {
    expect(evaluateFilter(plan({ deterministic: { never: true } }), item)).toBe("no-match");
  });
});

describe("recorded evaluation", () => {
  it("records the plan versions", () => {
    const evaluation = evaluateFilterPlan(plan(), item);
    expect(evaluation).toMatchObject({ compilerVersion: 1, schemaVersion: 1 });
  });

  it("records every matched predicate with its position", () => {
    const deterministic = {
      all: [
        { field: "subject", operator: "contains", value: "invoice" },
        { field: "sender", operator: "equals", value: "billing@example.test" },
      ],
    } as FilterExpression;

    expect(evaluateFilterPlan(plan({ deterministic }), item).matchedPredicates).toEqual([
      { field: "subject", operator: "contains", path: "all[0]" },
      { field: "sender", operator: "equals", path: "all[1]" },
    ]);
  });

  it("records no matched predicate when nothing matched", () => {
    const deterministic = {
      field: "subject",
      operator: "contains",
      value: "refund",
    } as FilterExpression;
    expect(evaluateFilterPlan(plan({ deterministic }), item).matchedPredicates).toEqual([]);
  });

  it("never returns a field value, only field names and operators", () => {
    const evaluation = evaluateFilterPlan(plan(), item);
    const serialized = JSON.stringify(evaluation);
    expect(serialized).not.toContain("Your Invoice");
    expect(serialized).not.toContain("billing@example.test");
  });
});
