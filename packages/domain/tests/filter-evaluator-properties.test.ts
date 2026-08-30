import { describe, expect, it, vi } from "vitest";

import { filterPlanSchema, type FilterExpression, type FilterPlan } from "@relay/contracts";

import { evaluateFilter, FilterEvaluationLimitError } from "../src/filter-evaluator.js";

// A seeded generator keeps these property checks reproducible, which the repository requires of
// fixtures, and avoids adding a property-testing dependency for one package.
function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIELDS = ["subject", "sender", "body", "source.applicationId"] as const;
const VALUES = ["invoice", "receipt", "synthetic", "caf\u00e9", "a b"] as const;
const OPERATORS = ["equals", "contains", "starts-with"] as const;

function randomPredicate(random: () => number): FilterExpression {
  const field = FIELDS[Math.floor(random() * FIELDS.length)] ?? "subject";
  const operator = OPERATORS[Math.floor(random() * OPERATORS.length)] ?? "equals";
  const value = VALUES[Math.floor(random() * VALUES.length)] ?? "invoice";
  return { field, operator, value };
}

function randomItem(random: () => number): Record<string, unknown> {
  const maybe = (value: string) => (random() < 0.25 ? undefined : value);
  return {
    body: maybe("a synthetic body with an invoice inside"),
    sender: maybe("billing@example.test"),
    source: { applicationId: maybe("com.example.app"), kind: "email" },
    subject: maybe("Your Invoice  is ready"),
  };
}

function planFor(deterministic: FilterExpression): FilterPlan {
  return filterPlanSchema.parse({
    schemaVersion: 1,
    compilerVersion: 1,
    intent: "synthetic intent",
    deterministic,
  });
}

const decide = (expression: FilterExpression, item: Record<string, unknown>) =>
  evaluateFilter(planFor(expression), item);

describe("boolean properties", () => {
  it("satisfies De Morgan over AND for 200 generated cases", () => {
    const random = mulberry32(20260829);
    for (let round = 0; round < 200; round += 1) {
      const a = randomPredicate(random);
      const b = randomPredicate(random);
      const item = randomItem(random);
      expect(decide({ not: { all: [a, b] } }, item)).toBe(
        decide({ any: [{ not: a }, { not: b }] }, item),
      );
    }
  });

  it("satisfies De Morgan over OR for 200 generated cases", () => {
    const random = mulberry32(760);
    for (let round = 0; round < 200; round += 1) {
      const a = randomPredicate(random);
      const b = randomPredicate(random);
      const item = randomItem(random);
      expect(decide({ not: { any: [a, b] } }, item)).toBe(
        decide({ all: [{ not: a }, { not: b }] }, item),
      );
    }
  });

  it("is idempotent and involutive for 200 generated cases", () => {
    const random = mulberry32(4242);
    for (let round = 0; round < 200; round += 1) {
      const a = randomPredicate(random);
      const item = randomItem(random);
      const alone = decide(a, item);
      expect(decide({ all: [a, a] }, item)).toBe(alone);
      expect(decide({ any: [a, a] }, item)).toBe(alone);
      expect(decide({ not: { not: a } }, item)).toBe(alone);
    }
  });
});

describe("unicode normalization properties", () => {
  it("decides NFKC-equivalent values identically", () => {
    const random = mulberry32(99);
    // Composed vs decomposed accents, fullwidth vs ASCII, and collapsible whitespace must agree.
    const equivalents: [string, string][] = [
      ["caf\u00e9", "cafe\u0301"],
      ["\uff29\uff2e\uff36\uff2f\uff29\uff23\uff25", "INVOICE"],
      ["Your   Invoice", "Your Invoice"],
      ["  invoice  ", "invoice"],
    ];
    for (const [left, right] of equivalents) {
      for (let round = 0; round < 10; round += 1) {
        const predicate = randomPredicate(random);
        expect(decide(predicate, { body: left, sender: left, subject: left })).toBe(
          decide(predicate, { body: right, sender: right, subject: right }),
        );
      }
    }
  });

  it("matches a predicate value written in a different but equivalent form", () => {
    const composed = {
      field: "subject",
      operator: "equals",
      value: "caf\u00e9",
    } as FilterExpression;
    expect(decide(composed, { subject: "cafe\u0301" })).toBe("match");
  });
});

describe("absent value properties", () => {
  it("never matches a comparison operator on an absent field", () => {
    const random = mulberry32(31337);
    for (let round = 0; round < 200; round += 1) {
      // Every field the generator can pick is absent from this item.
      expect(decide(randomPredicate(random), { source: {} })).toBe("no-match");
    }
  });

  it.each([undefined, null, ""])("treats %j as absent for every comparison", (value) => {
    for (const operator of OPERATORS) {
      const predicate = { field: "subject", operator, value: "invoice" } as FilterExpression;
      expect(decide(predicate, { subject: value })).toBe("no-match");
    }
  });
});

describe("bounded evaluation", () => {
  it("reads and normalizes a large field once regardless of predicate count", () => {
    const body = `${"synthetic ".repeat(100_000)}invoice`;
    const predicates = Array.from({ length: 16 }, () => ({
      field: "body",
      operator: "contains",
      value: "invoice",
    })) as FilterExpression[];

    const normalize = vi.spyOn(String.prototype, "normalize");
    try {
      expect(decide({ all: predicates }, { body })).toBe("match");
      // One normalization for the body, plus one per predicate's own short value. Without the
      // per-evaluation cache the megabyte body would be normalized sixteen times.
      const longCalls = normalize.mock.instances.filter(
        (instance) => String(instance).length > 1000,
      );
      expect(longCalls).toHaveLength(1);
    } finally {
      normalize.mockRestore();
    }
  });

  it("rejects a plan deeper than the contract allows instead of recursing without bound", () => {
    let deep: FilterExpression = { field: "subject", operator: "exists" };
    for (let level = 0; level < 12; level += 1) deep = { not: deep };

    expect(() => evaluateFilter({ ...planFor({ never: true }), deterministic: deep }, {})).toThrow(
      FilterEvaluationLimitError,
    );
  });

  it("rejects a plan with more nodes than the contract allows", () => {
    const wide = {
      all: Array.from({ length: 16 }, () => ({
        any: Array.from({ length: 16 }, () => ({ field: "subject", operator: "exists" })),
      })),
    } as FilterExpression;

    expect(() => evaluateFilter({ ...planFor({ never: true }), deterministic: wide }, {})).toThrow(
      FilterEvaluationLimitError,
    );
  });
});

describe("purity", () => {
  it("does not mutate the item it evaluates", () => {
    const frozen = Object.freeze({
      sender: "billing@example.test",
      source: Object.freeze({ kind: "email" }),
      subject: "Your Invoice",
    });

    expect(() => decide(randomPredicate(mulberry32(7)), frozen)).not.toThrow();
    expect(frozen).toEqual({
      sender: "billing@example.test",
      source: { kind: "email" },
      subject: "Your Invoice",
    });
  });

  it("never calls a provider or logs, including when the deterministic part fails", () => {
    const fetchMock = vi.fn();
    const logs = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", fetchMock);
    try {
      const withSemantic = filterPlanSchema.parse({
        schemaVersion: 1,
        compilerVersion: 1,
        intent: "synthetic intent",
        deterministic: { field: "subject", operator: "contains", value: "refund" },
        semantic: { allowedFields: ["subject"], minimumConfidence: 0.8, question: "urgent?" },
      });

      expect(evaluateFilter(withSemantic, { subject: "Your Invoice" })).toBe("no-match");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(logs).not.toHaveBeenCalled();
      expect(errors).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      logs.mockRestore();
      errors.mockRestore();
    }
  });
});
