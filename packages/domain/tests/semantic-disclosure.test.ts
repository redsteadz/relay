import { describe, expect, it } from "vitest";

import {
  filterFieldSchema,
  filterPlanSchema,
  MAX_SEMANTIC_DISCLOSURE_CHARACTERS,
  MAX_SEMANTIC_FIELD_CHARACTERS,
  semanticEvaluationSchema,
  type FilterField,
  type FilterPlan,
} from "@relay/contracts";

import { minimizeSemanticDisclosure, resolveSemanticDecision } from "../src/semantic-disclosure.js";
import injectionFixture from "./fixtures/semantic-injection.json" with { type: "json" };

type Clause = NonNullable<FilterPlan["semantic"]>;

/** Control and format characters, minus the newline and tab that are ordinary message layout. */
const HIDDEN_CHARACTERS = /(?![\n\t])[\p{Cc}\p{Cf}]/u;

function clause(overrides: Partial<Clause> = {}): Clause {
  const plan = filterPlanSchema.parse({
    schemaVersion: 1,
    compilerVersion: 1,
    intent: "synthetic intent",
    semantic: {
      question: "Is this urgent?",
      minimumConfidence: 0.8,
      allowedFields: ["subject"],
      ...overrides,
    },
  });
  if (plan.semantic === undefined) throw new Error("fixture plan lost its semantic clause");
  return plan.semantic;
}

const item = {
  attributes: { amount: "10.50", currency: "USD", merchant: "Synthetic Store" },
  category: "work-notes",
  sender: "billing@example.test",
  source: { applicationId: "com.example.app", kind: "email" },
  subject: "Your Invoice is ready",
};

function valueOf(fields: { field: FilterField; value: string }[], field: FilterField): string {
  const found = fields.find((entry) => entry.field === field);
  if (found === undefined) throw new Error(`expected ${field} to be disclosed`);
  return found.value;
}

describe("field minimization", () => {
  it("discloses only the clause's allowlisted fields", () => {
    const disclosure = minimizeSemanticDisclosure(
      clause({ allowedFields: ["subject", "attributes.merchant"] }),
      item,
    );
    expect(disclosure.disclosedFields).toEqual(["subject", "attributes.merchant"]);
    expect(disclosure.fields.map((entry) => entry.field)).toEqual([
      "subject",
      "attributes.merchant",
    ]);
  });

  it("orders disclosed fields canonically rather than by the clause's own order", () => {
    const forward = minimizeSemanticDisclosure(
      clause({ allowedFields: ["sender", "subject", "body"] }),
      { ...item, body: "synthetic body" },
    );
    const reversed = minimizeSemanticDisclosure(
      clause({ allowedFields: ["body", "subject", "sender"] }),
      { ...item, body: "synthetic body" },
    );
    expect(forward).toEqual(reversed);
    expect(forward.disclosedFields).toEqual(["sender", "subject", "body"]);
  });

  it("omits fields that are absent, empty, or not strings", () => {
    const disclosure = minimizeSemanticDisclosure(
      clause({ allowedFields: ["subject", "body", "attributes.amount"] }),
      { subject: "kept", body: "   ", attributes: { amount: 10.5 } },
    );
    expect(disclosure.disclosedFields).toEqual(["subject"]);
  });

  it("never reads a field the clause did not allow", () => {
    const disclosure = minimizeSemanticDisclosure(clause({ allowedFields: ["subject"] }), item);
    const serialized = JSON.stringify(disclosure);
    expect(serialized).not.toContain("billing@example.test");
    expect(serialized).not.toContain("Synthetic Store");
  });

  it("bounds one field and the whole disclosure", () => {
    const long = "a".repeat(MAX_SEMANTIC_FIELD_CHARACTERS * 3);
    const disclosure = minimizeSemanticDisclosure(
      clause({ allowedFields: filterFieldSchema.options }),
      {
        source: { kind: long, applicationId: long },
        sender: long,
        subject: long,
        body: long,
        category: long,
        attributes: { currency: long, merchant: long, amount: long },
      },
    );
    for (const entry of disclosure.fields) {
      expect(entry.value.length).toBeLessThanOrEqual(MAX_SEMANTIC_FIELD_CHARACTERS);
    }
    const total = disclosure.fields.reduce((sum, entry) => sum + entry.value.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_SEMANTIC_DISCLOSURE_CHARACTERS);
    expect(disclosure.fields.some((entry) => entry.truncated)).toBe(true);
  });
});

describe("redaction", () => {
  it.each([
    ["email-address", "write to billing.dept@example.test today"],
    ["url", "open https://example.test/session/98765432 now"],
    ["api-key", "the key sk-exampleexamplekey00 is active"],
    ["payment-card", "card 4111111111111111 was charged"],
    ["phone-number", "call +1 (555) 0100 4242 back"],
    ["long-digit-sequence", "reference 98765432101 attached"],
  ])("removes a %s from a disclosed field", (kind, body) => {
    const disclosure = minimizeSemanticDisclosure(clause({ allowedFields: ["body"] }), { body });
    expect(disclosure.redactions).toEqual([{ field: "body", kind, count: 1 }]);
    expect(valueOf(disclosure.fields, "body")).toContain(`[redacted:${kind}]`);
  });

  it("keeps short digit runs that carry meaning", () => {
    const disclosure = minimizeSemanticDisclosure(clause({ allowedFields: ["body"] }), {
      body: "due on the 15th, 3 items, room 402",
    });
    expect(disclosure.redactions).toEqual([]);
    expect(valueOf(disclosure.fields, "body")).toBe("due on the 15th, 3 items, room 402");
  });

  it("counts repeated redactions of the same class once per field", () => {
    const disclosure = minimizeSemanticDisclosure(clause({ allowedFields: ["body"] }), {
      body: "reach one@example.test or two@example.test",
    });
    expect(disclosure.redactions).toEqual([{ field: "body", kind: "email-address", count: 2 }]);
  });

  it("discloses an exact-decimal amount without redacting its digits", () => {
    const disclosure = minimizeSemanticDisclosure(
      clause({ allowedFields: ["attributes.amount"] }),
      { attributes: { amount: "123456.78" } },
    );
    expect(valueOf(disclosure.fields, "attributes.amount")).toBe("123456.78");
    expect(disclosure.redactions).toEqual([]);
  });

  it("redacts an amount that is not an exact decimal instead of trusting it", () => {
    const disclosure = minimizeSemanticDisclosure(
      clause({ allowedFields: ["attributes.amount"] }),
      { attributes: { amount: "acct 4000123412341234" } },
    );
    expect(valueOf(disclosure.fields, "attributes.amount")).toBe("[redacted:long-digit-sequence]");
  });

  it("strips control and format characters that hide text from a human reviewer", () => {
    const disclosure = minimizeSemanticDisclosure(clause({ allowedFields: ["subject"] }), {
      subject: "Recei‮pt​ for order",
    });
    const value = valueOf(disclosure.fields, "subject");
    expect(value).not.toMatch(HIDDEN_CHARACTERS);
    expect(value).toBe("Receipt for order");
  });

  it("redacts before truncating, so a secret cannot survive by straddling the boundary", () => {
    const filler = "b".repeat(MAX_SEMANTIC_FIELD_CHARACTERS - 8);
    const disclosure = minimizeSemanticDisclosure(clause({ allowedFields: ["body"] }), {
      body: `${filler}4111111111111111 tail`,
    });
    const value = valueOf(disclosure.fields, "body");
    expect(disclosure.redactions).toEqual([{ field: "body", kind: "payment-card", count: 1 }]);
    expect(value).not.toContain("4111");
    expect(value).not.toMatch(/\[redacted:[a-z-]*$/u);
  });

  it("records a class and a count and never a removed value", () => {
    const disclosure = minimizeSemanticDisclosure(clause({ allowedFields: ["body"] }), {
      body: "card 4111111111111111 and mail to billing@example.test",
    });
    for (const redaction of disclosure.redactions) {
      expect(Object.keys(redaction).sort()).toEqual(["count", "field", "kind"]);
    }
    expect(JSON.stringify(disclosure.redactions)).not.toContain("4111");
    expect(JSON.stringify(disclosure.redactions)).not.toContain("example.test");
  });
});

describe("prompt-injection fixtures", () => {
  it.each(injectionFixture.cases.map((testCase) => [testCase.name, testCase] as const))(
    "%s discloses only allowlisted fields and keeps injected text as data",
    (_name, testCase) => {
      const disclosure = minimizeSemanticDisclosure(
        clause({ allowedFields: ["subject", "body"] }),
        testCase.item,
      );
      expect(
        disclosure.disclosedFields.every((field) => field === "subject" || field === "body"),
      ).toBe(true);
      // Injected text stays in the payload; minimization neither obeys it nor removes it. What it
      // must not do is let the sender field ride along because the body asked nicely.
      expect(JSON.stringify(disclosure.fields)).not.toContain('@example.test","field":"sender');
      for (const entry of disclosure.fields) {
        expect(entry.value).not.toMatch(HIDDEN_CHARACTERS);
      }
    },
  );

  it("redacts the credentials and identifiers an injected message carries", () => {
    const testCase = injectionFixture.cases.find(
      (entry) => entry.name === "credential-and-identifier-bearing",
    );
    if (testCase === undefined) throw new Error("fixture case is missing");
    const disclosure = minimizeSemanticDisclosure(
      clause({ allowedFields: ["subject", "body", "attributes.amount"] }),
      testCase.item,
    );
    const kinds = new Set(disclosure.redactions.map((redaction) => redaction.kind));
    expect(kinds.has("payment-card")).toBe(true);
    expect(kinds.has("url")).toBe(true);
    expect(kinds.has("api-key")).toBe(true);
    const serialized = JSON.stringify(disclosure.fields);
    expect(serialized).not.toContain("4111111111111111");
    expect(serialized).not.toContain("sk-exampleexamplekey00");
    expect(serialized).not.toContain("https://example.test/session/98765432");
    // The amount is the field the clause exists to judge, so it survives intact.
    expect(valueOf(disclosure.fields, "attributes.amount")).toBe("1420.75");
  });
});

describe("confidence threshold", () => {
  const evaluation = (overrides: Record<string, unknown> = {}) =>
    semanticEvaluationSchema.parse({
      decision: "match",
      confidence: 0.9,
      rationale: "synthetic rationale",
      ...overrides,
    });

  it("accepts an answer at or above the clause minimum", () => {
    expect(resolveSemanticDecision({ minimumConfidence: 0.8 }, evaluation())).toBe("match");
    expect(resolveSemanticDecision({ minimumConfidence: 0.9 }, evaluation())).toBe("match");
  });

  it("holds a low-confidence match at undecided rather than firing it", () => {
    const low = evaluation({ confidence: 0.79 });
    expect(resolveSemanticDecision({ minimumConfidence: 0.8 }, low)).toBe("undecided");
  });

  it("holds a low-confidence rejection at undecided too", () => {
    const low = evaluation({ decision: "no-match", confidence: 0.1 });
    expect(resolveSemanticDecision({ minimumConfidence: 0.8 }, low)).toBe("undecided");
  });

  it("passes through a confident rejection", () => {
    const confident = evaluation({ decision: "no-match", confidence: 1 });
    expect(resolveSemanticDecision({ minimumConfidence: 0.8 }, confident)).toBe("no-match");
  });
});
