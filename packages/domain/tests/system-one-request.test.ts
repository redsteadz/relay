import { describe, expect, it } from "vitest";

import { filterPlanSchema, type SemanticDisclosure } from "@relay/contracts";

import {
  parseSystemOneEvaluation,
  systemOneRequestBody,
  SYSTEM_ONE_QUESTION_KEY,
} from "../src/system-one-request";

const clause = filterPlanSchema.parse({
  compilerVersion: 1,
  intent: "marketing",
  schemaVersion: 1,
  semantic: { allowedFields: ["subject"], minimumConfidence: 0.8, question: "Is this marketing?" },
}).semantic!;

function disclosure(...fields: { field: string; value: string }[]): SemanticDisclosure {
  return {
    disclosedFields: fields.map((entry) => entry.field) as SemanticDisclosure["disclosedFields"],
    fields: fields.map((entry) => ({ ...entry, truncated: false })) as SemanticDisclosure["fields"],
    redactions: [],
  };
}

describe("the request a decision engine is sent", () => {
  // The whole reason this protocol is safer than the chat one: captured text is a value in a typed
  // object, not content inside a prompt, so there is no prompt for it to escape into.
  it("puts disclosed fields in a typed state rather than in a prompt", () => {
    const body = systemOneRequestBody(clause, disclosure({ field: "subject", value: "50% off" }), {
      model: "jev-latest",
    });
    expect(body.state).toStrictEqual({ subject: "50% off" });
    expect(JSON.stringify(body)).not.toContain("role");
    expect(JSON.stringify(body)).not.toContain("messages");
  });

  // A `choice` question would need Relay to invent category names the clause never had. The filter
  // asks one yes/no thing, which is what `noul` means.
  it("asks one noul question under a known key", () => {
    const body = systemOneRequestBody(clause, disclosure(), { model: "jev-latest" });
    const questions = body.questions as Record<string, { instructions: string; type: string }>;
    expect(Object.keys(questions)).toStrictEqual([SYSTEM_ONE_QUESTION_KEY]);
    expect(questions[SYSTEM_ONE_QUESTION_KEY]?.type).toBe("noul");
    expect(questions[SYSTEM_ONE_QUESTION_KEY]?.instructions).toContain("Is this marketing?");
  });

  /*
    The protocol requires both criteria on a `noul` question and rejects the request without them.
    Omitting them cost a release: every evaluation came back as a refusal, the candidate stayed
    `awaiting-model` for ever, and because a gateway rejects a malformed request before it is a
    billed generation, the provider's own activity log showed nothing either. A regression here is
    invisible from both ends, so it is asserted from this one.
  */
  it("states what true and false mean, which the protocol requires", () => {
    const body = systemOneRequestBody(clause, disclosure(), { model: "jev-latest" });
    const questions = body.questions as Record<string, { criteria?: Record<string, string> }>;
    const criteria = questions[SYSTEM_ONE_QUESTION_KEY]?.criteria;
    expect(Object.keys(criteria ?? {}).sort()).toStrictEqual(["false", "true"]);
    expect(criteria?.true).toMatch(/\S/u);
    expect(criteria?.false).toMatch(/\S/u);
  });

  // The act behind a match is clearing someone's notification, so the direction taken when the
  // deciding field was redacted has to be the inert one.
  it("sends unreadable captures towards no-match rather than match", () => {
    const body = systemOneRequestBody(clause, disclosure(), { model: "jev-latest" });
    const questions = body.questions as Record<string, { criteria: Record<string, string> }>;
    expect(questions[SYSTEM_ONE_QUESTION_KEY]?.criteria.false).toContain("nothing shown here");
  });

  it("explains the redaction placeholders it may have sent", () => {
    const body = systemOneRequestBody(clause, disclosure(), { model: "jev-latest" });
    const questions = body.questions as Record<string, { instructions: string }>;
    expect(questions[SYSTEM_ONE_QUESTION_KEY]?.instructions).toContain("[redacted:");
  });
});

describe("reading a decision engine's answer", () => {
  function reply(answer: unknown) {
    return { answers: { [SYSTEM_ONE_QUESTION_KEY]: answer }, model: "jev-1.13.0" };
  }

  it("reads a yes above the midpoint and a no below it", () => {
    expect(parseSystemOneEvaluation(reply({ noul: 0.94, type: "noul" }))).toMatchObject({
      matched: true,
      status: "ok",
    });
    expect(parseSystemOneEvaluation(reply({ noul: 0.02, type: "noul" }))).toMatchObject({
      matched: false,
      status: "ok",
    });
  });

  // The subtle one. A `noul` of 0.02 is a *confident* no-match; reporting 0.02 as the confidence
  // would make `resolveSemanticDecision` discard the clearest answers the model ever gives.
  it("reads confidence as distance from undecided, not as the probability", () => {
    const no = parseSystemOneEvaluation(reply({ noul: 0.02, type: "noul" }));
    const yes = parseSystemOneEvaluation(reply({ noul: 0.98, type: "noul" }));
    if (no.status !== "ok" || yes.status !== "ok") throw new Error("expected both to parse");
    expect(no.confidence).toBeCloseTo(0.96);
    expect(yes.confidence).toBeCloseTo(0.96);

    const unsure = parseSystemOneEvaluation(reply({ noul: 0.5, type: "noul" }));
    if (unsure.status !== "ok") throw new Error("expected a parse");
    expect(unsure.confidence).toBe(0);
  });

  // An endpoint that reports its own certainty knows more about it than the arithmetic does.
  it("prefers a confidence the endpoint supplied", () => {
    const parsed = parseSystemOneEvaluation(reply({ confidence: 0.6, noul: 0.99, type: "noul" }));
    expect(parsed).toMatchObject({ confidence: 0.6, status: "ok" });
  });

  // A reply to a different question is not an answer, however well formed.
  it.each([
    ["no answers object", { model: "jev" }],
    ["the answer under another key", { answers: { somethingElse: { noul: 0.9 } } }],
    ["a missing probability", { answers: { [SYSTEM_ONE_QUESTION_KEY]: { type: "noul" } } }],
    ["a probability out of range", { answers: { [SYSTEM_ONE_QUESTION_KEY]: { noul: 1.4 } } }],
    [
      "a probability that is not a number",
      { answers: { [SYSTEM_ONE_QUESTION_KEY]: { noul: "yes" } } },
    ],
    ["an array", []],
    ["null", null],
  ])("refuses %s", (_label, payload) => {
    expect(parseSystemOneEvaluation(payload)).toStrictEqual({ status: "invalid-response" });
  });
});
