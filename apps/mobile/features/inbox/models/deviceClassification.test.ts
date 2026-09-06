import { describe, expect, it } from "vitest";

import { filterPlanSchema, type FilterPlan, type FilterRuleVersion } from "@relay/contracts";

import {
  availableFieldsFor,
  classifiableRules,
  classificationItemFor,
  classificationPass,
  unfiledReason,
  type ClassifiableCapture,
} from "./deviceClassification";

const CATEGORY = "11111111-1111-4111-8111-111111111111";
const RULE = "22222222-2222-4222-8222-222222222222";

function plan(overrides: Partial<FilterPlan> = {}): FilterPlan {
  return filterPlanSchema.parse({
    schemaVersion: 1,
    compilerVersion: 1,
    intent: "from the bank",
    deterministic: { field: "sender", operator: "contains", value: "bank" },
    ...overrides,
  });
}

function capture(overrides: Partial<ClassifiableCapture> = {}): ClassifiableCapture {
  return {
    category: undefined,
    content: undefined,
    factValues: {},
    source: {
      applicationId: "com.google.android.gm",
      kind: "gmail",
      occurredAt: "2026-09-05T09:00:00.000Z",
      sender: "statements@examplebank.test",
      subject: "Your statement",
      threadId: undefined,
    },
    sourceItemId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ...overrides,
  };
}

function revision(overrides: Partial<FilterRuleVersion> = {}): FilterRuleVersion {
  return {
    categoryId: CATEGORY,
    createdAt: "2026-09-05T09:00:00.000Z",
    enabled: true,
    id: RULE,
    intent: "from the bank",
    name: "Bank",
    plan: plan(),
    seriesId: "33333333-3333-4333-8333-333333333333",
    userId: "44444444-4444-4444-8444-444444444444",
    version: 1,
    ...overrides,
  };
}

describe("classificationItemFor", () => {
  it("shapes a record the evaluator can read", () => {
    expect(classificationItemFor(capture())).toEqual({
      attributes: {},
      sender: "statements@examplebank.test",
      source: { applicationId: "com.google.android.gm", kind: "gmail" },
      subject: "Your statement",
    });
  });

  // The body reached the pipeline, which derived these from it. The device never sees that body, so
  // this is what lets a Gmail capture still be filed on an amount or a merchant.
  it("builds attributes from derived facts rather than a body it cannot read", () => {
    const item = classificationItemFor(
      capture({ factValues: { amount: "51.20", currency: "USD", merchant: "North Station" } }),
    );

    expect(item.attributes).toEqual({
      amount: "51.20",
      currency: "USD",
      merchant: "North Station",
    });
  });

  it("ignores derived facts no filter field reads", () => {
    const item = classificationItemFor(capture({ factValues: { reference: "INV-4", date: "x" } }));

    expect(item.attributes).toEqual({});
  });

  it("prefers this device's own copy of the subject", () => {
    const item = classificationItemFor(
      capture({ content: { body: undefined, subject: "As captured" } }),
    );

    expect(item.subject).toBe("As captured");
  });

  it("includes the body only when the device kept one", () => {
    expect(classificationItemFor(capture())).not.toHaveProperty("body");
    expect(
      classificationItemFor(capture({ content: { body: "Invoice", subject: undefined } })),
    ).toMatchObject({ body: "Invoice" });
  });
});

describe("availableFieldsFor", () => {
  it("reports body as unreadable for a capture this device did not keep", () => {
    expect(availableFieldsFor(capture()).has("body")).toBe(false);
  });

  it("reports body as readable once the device holds its own copy", () => {
    const held = capture({ content: { body: "Invoice", subject: undefined } });

    expect(availableFieldsFor(held).has("body")).toBe(true);
  });

  it("always offers the fields the server supplies", () => {
    const fields = availableFieldsFor(capture());

    for (const field of ["sender", "subject", "source.kind", "attributes.amount"] as const) {
      expect(fields.has(field)).toBe(true);
    }
  });
});

describe("classifiableRules", () => {
  it("keeps only the newest revision of a series", () => {
    const rules = classifiableRules([
      revision({ id: "old", version: 1 }),
      revision({ id: "new", version: 2 }),
    ]);

    expect(rules.map((rule) => rule.id)).toEqual(["new"]);
  });

  it("drops a disabled rule", () => {
    expect(classifiableRules([revision({ enabled: false })])).toEqual([]);
  });

  it("orders by name so the sequence matches what a person sees", () => {
    const rules = classifiableRules([
      revision({ id: "b", name: "Bravo", seriesId: "s-b" }),
      revision({ id: "a", name: "Alpha", seriesId: "s-a" }),
    ]);

    expect(rules.map((rule) => rule.id)).toEqual(["a", "b"]);
  });

  it("breaks a shared name on series so every device agrees", () => {
    const rules = classifiableRules([
      revision({ id: "second", name: "Same", seriesId: "s-2" }),
      revision({ id: "first", name: "Same", seriesId: "s-1" }),
    ]);

    expect(rules.map((rule) => rule.id)).toEqual(["first", "second"]);
  });
});

describe("classificationPass", () => {
  const rules = classifiableRules([revision()]);

  it("files a capture a rule claims", () => {
    expect(classificationPass([capture()], rules).writes).toEqual([
      {
        categoryId: CATEGORY,
        filterRuleId: RULE,
        rationale: "Matched sender contains",
        sourceItemId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    ]);
  });

  it("writes nothing when there are no rules", () => {
    expect(classificationPass([capture()], []).writes).toEqual([]);
  });

  it("writes nothing for a capture no rule claims", () => {
    const other = capture({
      source: { ...capture().source, sender: "friend@example.test", subject: "Hello" },
    });

    expect(classificationPass([other], rules).writes).toEqual([]);
  });

  it("leaves a capture the server already classified alone", () => {
    const classified = capture({
      category: {
        confidence: 0.9,
        filterRuleId: undefined,
        method: "semantic",
        name: "Promotions",
        origin: "server",
        rationale: undefined,
      },
    });

    expect(classificationPass([classified], rules).writes).toEqual([]);
  });

  it("does not rewrite a decision this device already made", () => {
    const alreadyFiled = capture({
      category: {
        confidence: 1,
        filterRuleId: RULE,
        method: "deterministic",
        name: "Transactions",
        origin: "device",
        rationale: "Matched sender contains",
      },
    });

    expect(classificationPass([alreadyFiled], rules).writes).toEqual([]);
  });

  it("refiles when a different rule now claims the capture", () => {
    const filedByAnother = capture({
      category: {
        confidence: 1,
        filterRuleId: "an-older-rule",
        method: "deterministic",
        name: "Transactions",
        origin: "device",
        rationale: undefined,
      },
    });

    expect(classificationPass([filedByAnother], rules).writes).toHaveLength(1);
  });

  it("files a capture once even when several events derive from it", () => {
    expect(classificationPass([capture(), capture()], rules).writes).toHaveLength(1);
  });

  it("writes nothing for a rule that needs a body this device cannot read", () => {
    const bodyRules = classifiableRules([
      revision({
        plan: plan({ deterministic: { field: "body", operator: "contains", value: "invoice" } }),
      }),
    ]);

    expect(classificationPass([capture()], bodyRules).writes).toEqual([]);
  });

  it("files on the body once the device holds its own copy", () => {
    const bodyRules = classifiableRules([
      revision({
        plan: plan({ deterministic: { field: "body", operator: "contains", value: "invoice" } }),
      }),
    ]);
    const held = capture({ content: { body: "Your invoice is ready", subject: undefined } });

    expect(classificationPass([held], bodyRules).writes).toHaveLength(1);
  });

  // Filing has to be reversible: a rule you disable must stop filing, or the inbox keeps asserting a
  // category no rule would now produce.
  it("withdraws a device classification once no rule claims the capture", () => {
    const filedByGoneRule = capture({
      category: {
        confidence: 1,
        filterRuleId: RULE,
        method: "deterministic",
        name: "Transactions",
        origin: "device",
        rationale: undefined,
      },
      source: { ...capture().source, sender: "friend@example.test", subject: "Hello" },
    });

    const pass = classificationPass([filedByGoneRule], rules);

    expect(pass.writes).toEqual([]);
    expect(pass.withdrawals).toEqual([{ sourceItemId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }]);
  });

  it("withdraws when every rule has been disabled", () => {
    const filed = capture({
      category: {
        confidence: 1,
        filterRuleId: RULE,
        method: "deterministic",
        name: "Transactions",
        origin: "device",
        rationale: undefined,
      },
    });

    expect(classificationPass([filed], []).withdrawals).toHaveLength(1);
  });

  it("withdraws nothing for a capture that was never filed", () => {
    const other = capture({
      source: { ...capture().source, sender: "friend@example.test", subject: "Hello" },
    });

    expect(classificationPass([other], rules).withdrawals).toEqual([]);
  });

  it("never withdraws a server classification", () => {
    const serverFiled = capture({
      category: {
        confidence: 0.9,
        filterRuleId: undefined,
        method: "semantic",
        name: "Promotions",
        origin: "server",
        rationale: undefined,
      },
      source: { ...capture().source, sender: "friend@example.test", subject: "Hello" },
    });

    expect(classificationPass([serverFiled], rules).withdrawals).toEqual([]);
  });

  // A rule this device merely cannot evaluate is not evidence the earlier decision was wrong.
  it("does not withdraw when a rule is undecidable rather than unmatched", () => {
    const bodyRules = classifiableRules([
      revision({
        plan: plan({ deterministic: { field: "body", operator: "contains", value: "invoice" } }),
      }),
    ]);
    const filed = capture({
      category: {
        confidence: 1,
        filterRuleId: RULE,
        method: "deterministic",
        name: "Transactions",
        origin: "device",
        rationale: undefined,
      },
    });

    expect(classificationPass([filed], bodyRules).withdrawals).toEqual([]);
  });

  it("files a rule that names no category, recording that a rule still claimed it", () => {
    const unnamed = classifiableRules([revision({ categoryId: undefined })]);

    expect(classificationPass([capture()], unnamed).writes).toMatchObject([
      { categoryId: undefined },
    ]);
  });
});

describe("unfiledReason", () => {
  it("says a model is needed rather than leaving a gap", () => {
    expect(unfiledReason({ filterRuleId: RULE, kind: "awaiting-model" })).toBe(
      "A rule needs a model to decide this one.",
    );
  });

  it("names the body as the thing it could not read", () => {
    expect(
      unfiledReason({ fields: ["body"], filterRuleId: RULE, kind: "field-unavailable" }),
    ).toContain("message body");
  });

  it("offers no reason for a capture simply no rule matched", () => {
    expect(unfiledReason({ kind: "unfiled" })).toBeUndefined();
  });
});
