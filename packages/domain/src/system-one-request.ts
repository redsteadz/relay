/**
 * Asking a decision engine rather than a language model.
 *
 * Jev and Laya answer typed questions about a state in one forward pass: no generation, no
 * reasoning tokens, a few tens of milliseconds. They speak `/v1/systemone` rather than
 * `/v1/chat/completions`, so the request and the reply are different shapes -- but everything that
 * decides *what leaves the device* is not. `minimizeSemanticDisclosure` applies the clause's field
 * allowlist and redactions before either protocol sees anything, and `resolveSemanticDecision`
 * applies the confidence threshold after. Only the envelope differs.
 *
 * The fit is better than the OpenAI path it sits beside, for a reason worth stating. Relay has only
 * ever wanted one typed decision per capture -- `match` or `no-match`, with a confidence -- and has
 * been getting it by asking a general model for JSON and refusing anything that is not exactly that
 * shape. This asks a model whose only output *is* that shape.
 *
 * It is also structurally safer. The OpenAI path puts captured text inside a prompt and tells the
 * model to treat it as data; here the text is a value in a typed `state` object and the question is
 * a separate field, so there is no prompt for content to escape into. `AGENTS.md`'s "treat source
 * content as untrusted data, never prompt instructions" stops being an instruction the model is
 * asked to honour and becomes a property of the wire format.
 */

import type { SemanticDisclosure } from "@relay/contracts";

import type { SemanticClause } from "./semantic-request";

/** The one question Relay ever asks, named so the answer can be found again in the reply. */
export const SYSTEM_ONE_QUESTION_KEY = "relayFilterMatch";

export type SystemOneEndpoint = {
  /** The decision model, as the endpoint names it. */
  model: string;
};

/**
 * One `noul` question over the disclosed fields.
 *
 * `noul` is the protocol's yes/no probability. A `choice` question would need Relay to invent
 * category names the clause never had, so the one question a filter asks -- does this capture
 * satisfy the clause -- maps onto the one primitive that means exactly that.
 *
 * Redacted values arrive as `[redacted:...]` placeholders, the same as on the OpenAI path, so the
 * instruction explains them. A model that cannot read them should be less certain, not guess.
 */
export function systemOneRequestBody(
  clause: SemanticClause,
  disclosure: SemanticDisclosure,
  endpoint: SystemOneEndpoint,
): Record<string, unknown> {
  const state: Record<string, string> = {};
  for (const entry of disclosure.fields) state[entry.field] = entry.value;

  return {
    model: endpoint.model,
    questions: {
      [SYSTEM_ONE_QUESTION_KEY]: {
        instructions: `${clause.question} Values shown as [redacted:...] were removed before you saw them; be less certain when they mattered rather than guessing what they held.`,
        type: "noul",
      },
    },
    state,
  };
}

export type SystemOneParse =
  { confidence: number; matched: boolean; status: "ok" } | { status: "invalid-response" };

/** A probability, and nothing that merely looks like one. */
function probability(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : undefined;
}

/**
 * Reads the one answer, and refuses anything else.
 *
 * Deliberately narrow about where it looks: the answer Relay asked for, by the key it asked under.
 * A reply carrying other answers, or the right answer under a different name, is a reply to a
 * different question.
 *
 * `noul` is the yes/no probability. Confidence is its distance from undecided rather than the
 * probability itself -- a `noul` of 0.02 is a *confident* no-match, and reporting 0.02 as the
 * confidence would make `resolveSemanticDecision` discard the clearest answers the model gives.
 *
 * `confidence` is read in preference where the endpoint supplies one, because an endpoint that
 * reports its own certainty knows more about it than this arithmetic does.
 */
export function parseSystemOneEvaluation(payload: unknown): SystemOneParse {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { status: "invalid-response" };
  }
  const answers = (payload as { answers?: unknown }).answers;
  if (typeof answers !== "object" || answers === null || Array.isArray(answers)) {
    return { status: "invalid-response" };
  }
  const answer = (answers as Record<string, unknown>)[SYSTEM_ONE_QUESTION_KEY];
  if (typeof answer !== "object" || answer === null || Array.isArray(answer)) {
    return { status: "invalid-response" };
  }

  const record = answer as Record<string, unknown>;
  const noul = probability(record.noul);
  if (noul === undefined) return { status: "invalid-response" };

  const reported = probability(record.confidence);
  const matched = noul >= 0.5;
  // Distance from undecided, rescaled to 0..1: 0.5 is no information, 0 and 1 are certainty.
  const derived = Math.abs(noul - 0.5) * 2;
  return { confidence: reported ?? derived, matched, status: "ok" };
}
