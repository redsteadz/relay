import { describe, expect, it } from "vitest";

import type { FilterPlan, IngressEnvelope } from "@relay/contracts";

import { contentFingerprint, evaluateFilter, sourceIdentity } from "../src/index.js";

const item: IngressEnvelope = {
  schemaVersion: 1,
  id: "b0936974-a8be-4d34-99ed-b141c42aa0ce",
  occurredAt: "2026-08-24T12:00:00Z",
  capturedAt: "2026-08-24T12:00:01Z",
  source: {
    kind: "notification",
    externalId: "42",
    applicationId: "com.example.bank",
  },
  sender: "Example Bank",
  subject: "Card purchase",
  body: "USD 10.00 at Corner Shop",
  attributes: {},
};

describe("sourceIdentity", () => {
  it("uses stable provider identity", () => {
    expect(sourceIdentity(item)).toBe("notification:device:42");
  });
});

describe("contentFingerprint", () => {
  it("normalizes inconsequential whitespace and case", async () => {
    const changed = { ...item, body: "  usd 10.00  AT corner shop " };
    await expect(contentFingerprint(changed)).resolves.toBe(await contentFingerprint(item));
  });
});

describe("evaluateFilter", () => {
  it("defers matching candidates with semantic clauses", () => {
    const plan: FilterPlan = {
      schemaVersion: 1,
      intent: "Bank purchases that represent public transport",
      deterministic: {
        field: "source.applicationId",
        operator: "equals",
        value: "com.example.bank",
      },
      semantic: {
        question: "Does this purchase represent public transport?",
        minimumConfidence: 0.9,
        allowedFields: ["subject", "body"],
      },
    };

    expect(evaluateFilter(plan, item)).toBe("undecided");
  });
});
