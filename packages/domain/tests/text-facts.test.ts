import { describe, expect, it } from "vitest";

import { ingressEnvelopeSchema, type IngressEnvelope } from "@relay/contracts";

import {
  SOURCE_FACT_NORMALIZER_VERSION,
  normalizeSourceFacts,
  textAmountCandidates,
  textDateCandidates,
  textReferenceCandidates,
  TEXT_FACT_SCAN_LIMIT,
} from "../src/index.js";

/** A Gmail-shaped envelope: transport metadata only, exactly as the provider builds it. */
function gmail(subject: string, body: string, attributes: Record<string, unknown> = {}) {
  return ingressEnvelopeSchema.parse({
    schemaVersion: 1,
    id: "cf4c3c89-0a15-4edb-94df-77786bcddd01",
    occurredAt: "2026-09-01T09:00:00Z",
    capturedAt: "2026-09-01T09:00:00Z",
    source: {
      kind: "gmail",
      externalId: "m1",
      accountId: "cf4c3c89-0a15-4edb-94df-77786bcddd02",
    },
    sender: "Example Store <orders@example.test>",
    subject,
    body,
    attributes: { gmailThreadId: "t1", ...attributes },
  }) satisfies IngressEnvelope;
}

function factOf(envelope: IngressEnvelope, kind: string) {
  return normalizeSourceFacts(envelope).facts.filter((fact) => fact.kind === kind);
}

describe("textAmountCandidates", () => {
  it("reads an amount stated with an ISO currency code", () => {
    const { amounts, currencies } = textAmountCandidates({ subject: "", body: "Amount USD 42.50" });
    expect(amounts.map((entry) => entry.value)).toEqual(["42.50"]);
    expect(currencies.map((entry) => entry.value)).toEqual(["USD"]);
  });

  it("keeps money as an exact decimal string rather than a number", () => {
    const { amounts } = textAmountCandidates({ subject: "", body: "Total USD 10.50" });
    // 10.50 must not become 10.5: the repository forbids routing money through a float.
    expect(amounts[0]?.value).toBe("10.50");
    expect(typeof amounts[0]?.value).toBe("string");
  });

  it("strips grouping separators without reinterpreting the value", () => {
    const { amounts } = textAmountCandidates({ subject: "", body: "Paid USD 1,234.50 today" });
    expect(amounts[0]?.value).toBe("1234.50");
  });

  it("reads a code written after the amount", () => {
    const { amounts, currencies } = textAmountCandidates({
      subject: "",
      body: "12.00 EUR charged",
    });
    expect(amounts[0]?.value).toBe("12.00");
    expect(currencies[0]?.value).toBe("EUR");
  });

  it("takes an amount from an unambiguous symbol but assigns no currency to a dollar sign", () => {
    const euro = textAmountCandidates({ subject: "", body: "Charged €9.99" });
    expect(euro.amounts[0]?.value).toBe("9.99");
    expect(euro.currencies[0]?.value).toBe("EUR");

    const dollar = textAmountCandidates({ subject: "", body: "Charged $9.99" });
    // "$" is USD, CAD, AUD and more; naming one would invent a currency the message never stated.
    expect(dollar.amounts).toEqual([]);
    expect(dollar.currencies).toEqual([]);
  });

  it("ignores a three-letter word that is not a currency", () => {
    const { amounts } = textAmountCandidates({ subject: "", body: "THE 100 best songs, VAT 20" });
    expect(amounts).toEqual([]);
  });

  it("ignores a bare number with no unit", () => {
    const { amounts } = textAmountCandidates({ subject: "", body: "You have 42 unread messages" });
    expect(amounts).toEqual([]);
  });

  it("bounds how much of a long body it scans", () => {
    const body = `${" ".repeat(TEXT_FACT_SCAN_LIMIT)}USD 5.00`;
    expect(textAmountCandidates({ subject: "", body }).amounts).toEqual([]);
  });
});

describe("textDateCandidates", () => {
  it("reads a due date from an explicit cue", () => {
    const [candidate] = textDateCandidates({ subject: "", body: "Payment is due 2026-09-15." });
    expect(candidate?.value).toEqual({ role: "due", instant: "2026-09-15T00:00:00Z" });
  });

  it("reads month-name dates in either order", () => {
    const first = textDateCandidates({ subject: "", body: "Due September 15, 2026" });
    const second = textDateCandidates({ subject: "", body: "Due 15 September 2026" });
    expect(first[0]?.value).toEqual({ role: "due", instant: "2026-09-15T00:00:00Z" });
    expect(second[0]?.value).toEqual({ role: "due", instant: "2026-09-15T00:00:00Z" });
  });

  it("allows one short connector between the cue and the date", () => {
    const [candidate] = textDateCandidates({ subject: "", body: "Delivery on 12 September 2026" });
    expect(candidate?.value).toEqual({ role: "due", instant: "2026-09-12T00:00:00Z" });
  });

  it("treats an appointment as a start rather than a due date", () => {
    const [candidate] = textDateCandidates({ subject: "", body: "Appointment on 2026-09-20" });
    expect(candidate?.value).toEqual({ role: "start", instant: "2026-09-20T00:00:00Z" });
  });

  it("never reads an ambiguous numeric date", () => {
    // 03/04/2026 is two different days depending on locale; choosing one would be a guess.
    expect(textDateCandidates({ subject: "", body: "Due 03/04/2026" })).toEqual([]);
  });

  it("rejects a date that does not exist", () => {
    expect(textDateCandidates({ subject: "", body: "Due 2026-02-31" })).toEqual([]);
  });

  it("ignores a date with no cue, so it cannot contradict the envelope timestamp", () => {
    expect(textDateCandidates({ subject: "", body: "Written on 2026-09-15 in Berlin" })).toEqual(
      [],
    );
  });
});

describe("textReferenceCandidates", () => {
  it("reads references that name their own kind", () => {
    const found = textReferenceCandidates({
      subject: "",
      body: "Order #A-99213 and invoice no. INV-4471 and tracking 1Z999AA10123456784",
    });
    expect(found.map((entry) => entry.value)).toEqual([
      { kind: "order", value: "A-99213" },
      { kind: "invoice", value: "INV-4471" },
      { kind: "tracking", value: "1Z999AA10123456784" },
    ]);
  });

  it("ignores an alphanumeric token with no reference noun", () => {
    expect(textReferenceCandidates({ subject: "", body: "Code XY12345 applies" })).toEqual([]);
  });
});

describe("normalizeSourceFacts with text evidence", () => {
  it("derives money, a due date, and a reference from a Gmail capture", () => {
    const envelope = gmail(
      "Invoice INV-4471",
      "Amount USD 42.50. Payment is due 2026-09-15. Invoice no. INV-4471.",
    );
    const facts = normalizeSourceFacts(envelope);
    expect(facts.normalizerVersion).toBe(SOURCE_FACT_NORMALIZER_VERSION);

    const amount = facts.facts.find((fact) => fact.kind === "amount");
    expect(amount).toMatchObject({ certainty: "certain", value: "42.50" });
    expect(facts.facts.find((fact) => fact.kind === "currency")).toMatchObject({ value: "USD" });
    expect(facts.facts.find((fact) => fact.kind === "reference")).toMatchObject({
      value: { kind: "invoice", value: "INV-4471" },
    });
    const due = facts.facts.find(
      (fact) => fact.kind === "date" && fact.certainty === "certain" && fact.value.role === "due",
    );
    expect(due).toBeDefined();
  });

  it("records the character span a text fact was read from", () => {
    const facts = normalizeSourceFacts(gmail("Receipt", "Amount USD 42.50 charged"));
    const amount = facts.facts.find((fact) => fact.kind === "amount");
    expect(amount?.provenance[0]).toMatchObject({ field: "body" });
    expect(amount?.provenance[0]?.start).toBeTypeOf("number");
    expect(amount?.provenance[0]?.end).toBeGreaterThan(amount?.provenance[0]?.start ?? 0);
  });

  it("lets a declared attribute win over the same kind read from text", () => {
    const envelope = gmail("Receipt", "Body says USD 42.50", { amount: "99.00" });
    const [amount] = factOf(envelope, "amount");
    expect(amount).toMatchObject({ certainty: "certain", value: "99.00" });
    expect(amount?.provenance).toEqual([{ field: "attributes.amount" }]);
  });

  it("marks two different amounts in one body as contradictory rather than picking one", () => {
    const envelope = gmail("Receipt", "Total USD 10.00 but USD 99.99 authorized");
    const [amount] = factOf(envelope, "amount");
    expect(amount).toMatchObject({ certainty: "uncertain", uncertaintyReason: "contradictory" });
  });

  it("leaves a message with nothing structured to read untouched", () => {
    const envelope = gmail("This week at Example", "Here is what happened. Read more on our blog.");
    expect(factOf(envelope, "amount")).toEqual([]);
    expect(factOf(envelope, "reference")).toEqual([]);
    const dates = normalizeSourceFacts(envelope).facts.filter((fact) => fact.kind === "date");
    // Only the envelope's own occurred and captured instants.
    expect(dates).toHaveLength(2);
  });

  it("keeps a declared date role authoritative while filling a role text alone supplies", () => {
    const envelope = gmail("Trip", "Departure is due 2026-09-15", {
      dates: [{ role: "due", instant: "2026-10-01T00:00:00Z" }],
    });
    const due = normalizeSourceFacts(envelope).facts.find(
      (fact) => fact.kind === "date" && fact.certainty === "certain" && fact.value.role === "due",
    );
    expect(due).toMatchObject({ value: { instant: "2026-10-01T00:00:00.000000000Z" } });
  });
});
