import { describe, expect, it } from "vitest";

import { ingressEnvelopeSchema, type FilterPlan, type IngressEnvelope } from "@relay/contracts";

import gmailFixture from "./fixtures/gmail.json" with { type: "json" };
import notificationFixture from "./fixtures/notification.json" with { type: "json" };
import smsFixture from "./fixtures/sms.json" with { type: "json" };

import {
  contentFingerprint,
  compileFilterPlan,
  evaluateFilter,
  normalizeCategoryName,
  normalizeSourceFacts,
  sourceFactSetFingerprint,
  sourceIdentity,
} from "../src/index.js";

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
  it("uses an unambiguous provider identity tuple", () => {
    expect(sourceIdentity(item)).toBe('["notification",null,"42"]');
  });

  it("does not collide omitted accounts with literal account values", () => {
    const omittedAccount = {
      ...item,
      source: { ...item.source, externalId: "device:42" },
    };
    const literalAccount = {
      ...item,
      source: { ...item.source, accountId: "device", externalId: "42" },
    };
    expect(sourceIdentity(omittedAccount)).not.toBe(sourceIdentity(literalAccount));
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
      compilerVersion: 1,
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

describe("compileFilterPlan", () => {
  it("compiles supported natural-language clauses into a validated deterministic plan", () => {
    const result = compileFilterPlan('from Gmail and subject contains "receipt and invoice"');

    expect(result.plan).toMatchObject({
      schemaVersion: 1,
      compilerVersion: 1,
      deterministic: {
        all: [
          { field: "source.kind", operator: "equals", value: "gmail" },
          { field: "subject", operator: "contains", value: "receipt and invoice" },
        ],
      },
    });
    expect(result.unsupportedClauses).toEqual([]);
  });

  it("keeps unsupported clauses visible behind a minimized semantic fallback", () => {
    const result = compileFilterPlan("application is com.example.bank and looks urgent");

    expect(result.plan.deterministic).toEqual({
      field: "source.applicationId",
      operator: "equals",
      value: "com.example.bank",
    });
    expect(result.plan.semantic).toMatchObject({
      minimumConfidence: 0.8,
      allowedFields: ["subject", "body"],
    });
    expect(result.unsupportedClauses).toEqual([
      { text: "looks urgent", reason: "semantic-required" },
    ]);
  });

  it("resolves only trusted active category descriptors", () => {
    const result = compileFilterPlan('category is "Travel Deals"', [
      { name: "Travel Deals", slug: "travel-deals" },
    ]);
    expect(result.plan.deterministic).toEqual({
      field: "category",
      operator: "equals",
      value: "travel-deals",
    });
  });

  it("does not turn action language into provider or operation controls", () => {
    const result = compileFilterPlan("please send matching messages to a webhook endpoint");
    const serialized = JSON.stringify(result.plan);

    expect(result.unsupportedClauses).toEqual([
      {
        text: "please send matching messages to a webhook endpoint",
        reason: "action-intent-not-allowed",
      },
    ]);
    expect(result.plan.semantic).toBeUndefined();
    expect(result.plan.deterministic).toEqual({ never: true });
    expect(serialized).not.toContain('"provider"');
    expect(serialized).not.toContain('"operation"');
    expect(compileFilterPlan(result.plan.intent)).toEqual(result);
  });

  it("fails closed for invalid typed values without disclosing semantic fields", () => {
    const result = compileFilterPlan(`amount is ${"1".repeat(1_025)}`);

    expect(result.plan.deterministic).toEqual({ never: true });
    expect(result.plan.semantic).toBeUndefined();
    expect(result.unsupportedClauses[0]?.reason).toBe("invalid-value");

    const oversizedSender = compileFilterPlan(`sent by ${"a".repeat(1_025)}`);
    expect(oversizedSender.plan.deterministic).toEqual({ never: true });
    expect(oversizedSender.unsupportedClauses[0]?.reason).toBe("invalid-value");
  });

  it("does not treat apostrophes as quoted clause delimiters", () => {
    const result = compileFilterPlan("sender is O'Reilly and subject contains receipt");

    expect(result.plan.deterministic).toEqual({
      all: [
        { field: "sender", operator: "equals", value: "O'Reilly" },
        { field: "subject", operator: "contains", value: "receipt" },
      ],
    });
  });
});

describe("normalizeSourceFacts", () => {
  it("normalizes a synthetic Gmail form with exact money and field provenance", () => {
    const envelope = ingressEnvelopeSchema.parse(gmailFixture);
    const result = normalizeSourceFacts(envelope);
    const amount = result.facts.find((fact) => fact.kind === "amount");

    expect(amount).toMatchObject({
      certainty: "certain",
      value: "12345678901234567890.001200",
      provenance: [{ field: "attributes.amount" }],
    });
    expect(result.facts.map((fact) => fact.kind)).toEqual([
      "sender",
      "date",
      "date",
      "date",
      "amount",
      "currency",
      "merchant",
      "location",
      "reference",
    ]);
    expect(result.facts.every((fact) => fact.sourceItemId === envelope.id)).toBe(true);
    expect(result.facts.every((fact) => fact.provenance.length > 0)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(envelope.body);
    expect(JSON.stringify(result)).not.toContain(envelope.subject);
  });

  it("normalizes multiple locations from a synthetic notification form", () => {
    const result = normalizeSourceFacts(ingressEnvelopeSchema.parse(notificationFixture));

    expect(result.facts.filter((fact) => fact.kind === "location")).toHaveLength(2);
    expect(result.facts.find((fact) => fact.kind === "reference")).toMatchObject({
      certainty: "certain",
      value: { kind: "transaction", value: "TX-SYNTHETIC-21" },
    });
  });

  it("keeps invalid and contradictory SMS extraction uncertain without candidate values", () => {
    const result = normalizeSourceFacts(ingressEnvelopeSchema.parse(smsFixture));
    const uncertain = result.facts.filter((fact) => fact.certainty === "uncertain");

    expect(uncertain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "date", uncertaintyReason: "invalid" }),
        expect.objectContaining({ kind: "amount", uncertaintyReason: "contradictory" }),
        expect.objectContaining({ kind: "currency", uncertaintyReason: "invalid" }),
      ]),
    );
    expect(uncertain.every((fact) => !("value" in fact))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("8.50");
    expect(JSON.stringify(result)).not.toContain("9.50");
    expect(JSON.stringify(result)).not.toContain("not-a-date");
  });

  it("uses the same domain path regardless of source provider", () => {
    const gmail = ingressEnvelopeSchema.parse(gmailFixture);
    const smsShape = { ...gmail, source: { ...gmail.source, kind: "sms" as const } };

    expect(normalizeSourceFacts(smsShape)).toEqual(normalizeSourceFacts(gmail));
  });

  it("canonicalizes equivalent offset dates before contradiction checks", () => {
    const envelope = ingressEnvelopeSchema.parse({
      ...notificationFixture,
      occurredAt: "2026-08-29T09:00:00.1Z",
      attributes: {
        dates: { role: "occurred", instant: "2026-08-29T10:00:00.1000+01:00" },
      },
    });
    const occurred = normalizeSourceFacts(envelope).facts.find(
      (fact) =>
        fact.kind === "date" && fact.certainty === "certain" && fact.value.role === "occurred",
    );

    expect(occurred).toMatchObject({
      value: { role: "occurred", instant: "2026-08-29T09:00:00.100000000Z" },
      provenance: [{ field: "occurredAt" }, { field: "attributes.dates" }],
    });
  });

  it("preserves distinct sub-millisecond instants", () => {
    const first = normalizeSourceFacts(
      ingressEnvelopeSchema.parse({
        ...notificationFixture,
        occurredAt: "2026-08-29T09:00:00.0001Z",
        attributes: {},
      }),
    );
    const second = normalizeSourceFacts(
      ingressEnvelopeSchema.parse({
        ...notificationFixture,
        occurredAt: "2026-08-29T09:00:00.0009Z",
        attributes: {},
      }),
    );
    const occurredInstant = (facts: typeof first.facts): string | undefined => {
      const fact = facts.find(
        (candidate) =>
          candidate.kind === "date" &&
          candidate.certainty === "certain" &&
          candidate.value.role === "occurred",
      );
      return fact?.certainty === "certain" && fact.kind === "date" ? fact.value.instant : undefined;
    };

    expect(occurredInstant(first.facts)).toBe("2026-08-29T09:00:00.000100000Z");
    expect(occurredInstant(second.facts)).toBe("2026-08-29T09:00:00.000900000Z");
    expect(occurredInstant(first.facts)).not.toBe(occurredInstant(second.facts));
  });

  it("fingerprints complete normalized facts beyond legacy content fields", async () => {
    const original = ingressEnvelopeSchema.parse(notificationFixture);
    const changedAttributes = ingressEnvelopeSchema.parse({
      ...notificationFixture,
      attributes: { ...notificationFixture.attributes, amount: "99.00" },
    });

    await expect(contentFingerprint(changedAttributes)).resolves.toBe(
      await contentFingerprint(original),
    );
    await expect(
      sourceFactSetFingerprint(normalizeSourceFacts(changedAttributes)),
    ).resolves.not.toBe(await sourceFactSetFingerprint(normalizeSourceFacts(original)));
  });

  it("bounds oversized untrusted candidate arrays as one uncertain field", () => {
    const envelope = ingressEnvelopeSchema.parse({
      ...notificationFixture,
      attributes: { amount: Array.from({ length: 16 }, () => "1.00") },
    });

    expect(normalizeSourceFacts(envelope).facts).toContainEqual(
      expect.objectContaining({
        kind: "amount",
        certainty: "uncertain",
        uncertaintyReason: "invalid",
        provenance: [{ field: "attributes.amount" }],
      }),
    );
  });
});

describe("normalizeCategoryName", () => {
  // These expectations are duplicated verbatim by `categories.test.sql`, which asserts the same
  // rule against the `normalized_name` generated column. If one side changes, the other must too.
  it.each([
    ["  Wörk   Notes ", "wörk notes"],
    ["WÖRK NOTES", "wörk notes"],
    ["A   B", "a b"],
    ["Ｆｕｌｌｗｉｄｔｈ", "fullwidth"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeCategoryName(input)).toBe(expected);
  });

  it("collapses names that differ only by case and whitespace onto one key", () => {
    expect(normalizeCategoryName("  Work   Notes ")).toBe(normalizeCategoryName("WORK NOTES"));
  });
});
