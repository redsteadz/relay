import { describe, expect, it } from "vitest";

import { filterPlanSchema, type FilterField, type FilterPlan } from "@relay/contracts";

import {
  classificationRationale,
  classifyCapture,
  referencedFilterFields,
  type ClassifiableRule,
} from "../src/classification.js";

const ALL_FIELDS: ReadonlySet<FilterField> = new Set([
  "source.kind",
  "source.applicationId",
  "sender",
  "subject",
  "body",
  "category",
  "attributes.currency",
  "attributes.merchant",
  "attributes.amount",
]);

/** What a device can read: everything except the body, which stays encrypted to a server key. */
const WITHOUT_BODY: ReadonlySet<FilterField> = new Set(
  [...ALL_FIELDS].filter((field) => field !== "body"),
);

function plan(overrides: Partial<FilterPlan> = {}): FilterPlan {
  return filterPlanSchema.parse({
    schemaVersion: 1,
    compilerVersion: 1,
    intent: "from the bank",
    deterministic: { field: "sender", operator: "contains", value: "bank" },
    ...overrides,
  });
}

function rule(overrides: Partial<ClassifiableRule> = {}): ClassifiableRule {
  return {
    categoryId: "11111111-1111-4111-8111-111111111111",
    id: "22222222-2222-4222-8222-222222222222",
    plan: plan(),
    ...overrides,
  };
}

const bankItem = { sender: "statements@examplebank.test", subject: "Your statement" };

describe("referencedFilterFields", () => {
  it("collects fields from every branch of an expression", () => {
    const fields = referencedFilterFields(
      plan({
        deterministic: {
          all: [
            { field: "sender", operator: "contains", value: "bank" },
            { any: [{ field: "subject", operator: "contains", value: "receipt" }] },
            { not: { field: "body", operator: "contains", value: "promotion" } },
          ],
        },
      }),
    );

    expect([...fields].sort()).toEqual(["body", "sender", "subject"]);
  });

  it("counts the fields a semantic clause would read", () => {
    const fields = referencedFilterFields(
      plan({
        deterministic: undefined,
        semantic: {
          question: "Is this a receipt?",
          minimumConfidence: 0.8,
          allowedFields: ["sender", "subject"],
        },
      }),
    );

    expect([...fields].sort()).toEqual(["sender", "subject"]);
  });

  it("reports nothing for a plan that can never match", () => {
    expect(referencedFilterFields(plan({ deterministic: { never: true } })).size).toBe(0);
  });
});

describe("classifyCapture", () => {
  it("files a capture under the first rule that matches", () => {
    const result = classifyCapture([rule()], bankItem, ALL_FIELDS);

    expect(result).toMatchObject({
      categoryId: "11111111-1111-4111-8111-111111111111",
      filterRuleId: "22222222-2222-4222-8222-222222222222",
      kind: "filed",
    });
  });

  it("leaves a capture unfiled when no rule claims it", () => {
    expect(classifyCapture([rule()], { sender: "friend@example.test" }, ALL_FIELDS)).toEqual({
      kind: "unfiled",
    });
  });

  it("returns unfiled rather than throwing when there are no rules", () => {
    expect(classifyCapture([], bankItem, ALL_FIELDS)).toEqual({ kind: "unfiled" });
  });

  it("takes the earlier rule when two would both match", () => {
    const first = rule({ categoryId: "aaaaaaaa-1111-4111-8111-111111111111", id: "rule-first" });
    const second = rule({ categoryId: "bbbbbbbb-1111-4111-8111-111111111111", id: "rule-second" });

    expect(classifyCapture([first, second], bankItem, ALL_FIELDS)).toMatchObject({
      categoryId: "aaaaaaaa-1111-4111-8111-111111111111",
      filterRuleId: "rule-first",
    });
  });

  it("files a rule that names no category, recording that it still matched", () => {
    const result = classifyCapture([rule({ categoryId: undefined })], bankItem, ALL_FIELDS);

    expect(result).toMatchObject({ categoryId: undefined, kind: "filed" });
  });

  it("reports a semantic clause as awaiting a model rather than deciding it", () => {
    const semantic = rule({
      plan: plan({
        deterministic: undefined,
        semantic: {
          question: "Is this a receipt?",
          minimumConfidence: 0.8,
          allowedFields: ["sender"],
        },
      }),
    });

    expect(classifyCapture([semantic], bankItem, ALL_FIELDS)).toMatchObject({
      kind: "awaiting-model",
    });
  });

  it("names the field it could not read instead of reading absence as a no-match", () => {
    const bodyRule = rule({
      plan: plan({ deterministic: { field: "body", operator: "contains", value: "invoice" } }),
    });

    expect(classifyCapture([bodyRule], bankItem, WITHOUT_BODY)).toMatchObject({
      fields: ["body"],
      kind: "field-unavailable",
    });
  });

  // A negated predicate is the case that makes silent mis-filing plausible: an unreadable body reads
  // as absent, absence is false, and `not(false)` is a match the capture never earned.
  it("does not let a negated body predicate match a capture whose body it cannot read", () => {
    const negated = rule({
      plan: plan({
        deterministic: { not: { field: "body", operator: "contains", value: "unsubscribe" } },
      }),
    });

    expect(classifyCapture([negated], bankItem, WITHOUT_BODY)).toMatchObject({
      kind: "field-unavailable",
    });
  });

  it("stops at an undecidable rule rather than filing under a later one", () => {
    const undecidable = rule({
      id: "rule-body",
      plan: plan({ deterministic: { field: "body", operator: "contains", value: "invoice" } }),
    });
    const wouldMatch = rule({ id: "rule-sender" });

    expect(classifyCapture([undecidable, wouldMatch], bankItem, WITHOUT_BODY)).toMatchObject({
      filterRuleId: "rule-body",
      kind: "field-unavailable",
    });
  });

  it("still files under an earlier match even when a later rule is undecidable", () => {
    const wouldMatch = rule({ id: "rule-sender" });
    const undecidable = rule({
      id: "rule-body",
      plan: plan({ deterministic: { field: "body", operator: "contains", value: "invoice" } }),
    });

    expect(classifyCapture([wouldMatch, undecidable], bankItem, WITHOUT_BODY)).toMatchObject({
      filterRuleId: "rule-sender",
      kind: "filed",
    });
  });

  it("evaluates a body rule when the body is available", () => {
    const bodyRule = rule({
      plan: plan({ deterministic: { field: "body", operator: "contains", value: "invoice" } }),
    });

    expect(
      classifyCapture([bodyRule], { ...bankItem, body: "Your invoice is ready" }, ALL_FIELDS),
    ).toMatchObject({ kind: "filed" });
  });

  it("produces the same answer for the same input", () => {
    const rules = [rule({ id: "a" }), rule({ id: "b" })];

    expect(classifyCapture(rules, bankItem, ALL_FIELDS)).toEqual(
      classifyCapture(rules, bankItem, ALL_FIELDS),
    );
  });
});

describe("classificationRationale", () => {
  it("names fields and operators, never values", () => {
    const rationale = classificationRationale([
      { field: "sender", operator: "contains", path: "deterministic" },
    ]);

    expect(rationale).toBe("Matched sender contains");
    expect(rationale).not.toContain("bank");
  });

  it("returns nothing when no predicate decided it", () => {
    expect(classificationRationale([])).toBeUndefined();
  });

  it("bounds a rationale built from many predicates", () => {
    const many = Array.from({ length: 64 }, () => ({
      field: "sender" as const,
      operator: "contains" as const,
      path: "deterministic",
    }));

    expect((classificationRationale(many) ?? "").length).toBeLessThanOrEqual(500);
  });
});
