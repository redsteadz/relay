import {
  filterFieldSchema,
  MAX_SEMANTIC_DISCLOSURE_CHARACTERS,
  MAX_SEMANTIC_FIELD_CHARACTERS,
  semanticDisclosureSchema,
  type FilterField,
  type FilterPlan,
  type SemanticDisclosedField,
  type SemanticDisclosure,
  type SemanticEvaluation,
  type SemanticRedaction,
  type SemanticRedactionKind,
} from "@relay/contracts";

import { readFilterField } from "./field-access.js";
import type { FilterDecision } from "./filter-evaluator.js";

type SemanticClause = NonNullable<FilterPlan["semantic"]>;

/**
 * Canonical disclosure order.
 *
 * Field order follows the contract enum rather than the order clauses happened to appear in the
 * user's intent, so two plans that disclose the same fields produce identical disclosure records
 * and can be compared in an audit.
 */
const FIELD_ORDER: readonly FilterField[] = filterFieldSchema.options;

/**
 * Exact-decimal money, matching `exactDecimalStringSchema` in the contracts.
 *
 * `attributes.amount` is the one field the digit-run rule below must not touch: redacting it would
 * strip the very value an amount clause exists to judge. Disclosing it verbatim is only safe while
 * it is provably a bare decimal, so anything else is redacted whole rather than trusted.
 */
const EXACT_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;

/**
 * Unicode control and format characters.
 *
 * Bidirectional overrides and zero-width joiners let visually identical text carry a different
 * literal sequence, which is a way to smuggle an instruction past a human reading a rule. They are
 * deleted rather than replaced, so what is disclosed is the text a human would have seen rendered.
 * Newline and tab survive because they are ordinary message layout.
 */
const CONTROL_CHARACTERS = /(?![\n\t])[\p{Cc}\p{Cf}]/gu;

/**
 * Separators a human writes inside a phone number or an account number: space, parentheses, dot,
 * the Unicode dash range U+2010 to U+2015, and a plain hyphen. Used as character-class source, so
 * the escapes stay literal here and are interpreted once by the `RegExp` constructor.
 */
const DIGIT_SEPARATORS = String.raw` ().‐-―-`;

const REDACTION_PATTERN = new RegExp(
  [
    String.raw`(?<emailAddress>[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+)`,
    String.raw`(?<url>(?:https?|ftp|mailto|data|file):[^\s<>"]{3,})`,
    String.raw`(?<apiKey>\b(?:sk|pk|rk|api|key|token|bearer|secret|password|pwd)[-_][\p{L}\p{N}_-]{12,})`,
    String.raw`(?<digitRun>\+?\p{Nd}(?:[\p{Nd}${DIGIT_SEPARATORS}]{4,}\p{Nd})?)`,
  ].join("|"),
  "gu",
);

const DIGIT_SEPARATOR_PATTERN = new RegExp(`[${DIGIT_SEPARATORS}]`, "u");

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (!Number.isInteger(digit)) return false;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Classifies a run of digits, or returns undefined to leave it alone.
 *
 * A run shorter than six digits is ordinary prose -- a date, a quantity, a house number -- and
 * redacting it would degrade the question without protecting anything.
 */
function classifyDigitRun(match: string): SemanticRedactionKind | undefined {
  const digits = match.replace(/\D/gu, "");
  if (digits.length < 6) return undefined;
  if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) return "payment-card";
  if (match.startsWith("+") || DIGIT_SEPARATOR_PATTERN.test(match)) return "phone-number";
  return "long-digit-sequence";
}

function classifyMatch(
  groups: Record<string, string | undefined>,
): SemanticRedactionKind | undefined {
  if (groups.emailAddress !== undefined) return "email-address";
  if (groups.url !== undefined) return "url";
  if (groups.apiKey !== undefined) return "api-key";
  if (groups.digitRun !== undefined) return classifyDigitRun(groups.digitRun);
  return undefined;
}

function placeholder(kind: SemanticRedactionKind): string {
  return `[redacted:${kind}]`;
}

/**
 * Truncates without splitting a placeholder in half.
 *
 * `[redacted:payment-` reads as if part of a card number survived. Cutting back to the start of an
 * unterminated placeholder keeps the disclosed text honest about what it contains.
 */
function truncateAt(value: string, limit: number): string {
  const cut = value.slice(0, limit);
  const opened = cut.lastIndexOf("[redacted:");
  return opened !== -1 && !cut.slice(opened).includes("]") ? cut.slice(0, opened) : cut;
}

function redact(
  field: FilterField,
  value: string,
  counts: Map<SemanticRedactionKind, number>,
): string {
  const skipDigitRuns = field === "attributes.amount";
  return value.replace(REDACTION_PATTERN, (match: string, ...rest: unknown[]) => {
    const groups = rest.at(-1) as Record<string, string | undefined>;
    if (skipDigitRuns && groups.digitRun !== undefined) return match;
    const kind = classifyMatch(groups);
    if (kind === undefined) return match;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    return placeholder(kind);
  });
}

function disclosableValue(field: FilterField, raw: unknown): string | undefined {
  // Mirrors the evaluator: a field that is absent, null, or not a string is not disclosed. Money
  // that is not an exact decimal string is a contract violation upstream, never a float to round.
  if (typeof raw !== "string") return undefined;
  const sanitized = raw.replace(CONTROL_CHARACTERS, "").trim();
  if (sanitized.length === 0) return undefined;
  if (field === "attributes.amount" && !EXACT_DECIMAL.test(sanitized)) {
    return placeholder("long-digit-sequence");
  }
  return sanitized;
}

/**
 * Builds the minimized payload for one semantic clause.
 *
 * Only the clause's own `allowedFields` are read, so a clause about a subject cannot pull a body
 * along with it. Each value is stripped of control characters, redacted, and bounded, and the
 * running total is bounded again across fields, so one clause discloses a fixed maximum regardless
 * of how large the source item is.
 *
 * The returned `redactions` carry a class and a count and never a value or an offset: the record
 * says an email address was removed from the body, not which one.
 */
export function minimizeSemanticDisclosure(
  clause: SemanticClause,
  item: Record<string, unknown>,
): SemanticDisclosure {
  const requested = new Set(clause.allowedFields);
  const fields: SemanticDisclosedField[] = [];
  const redactions: SemanticRedaction[] = [];
  let remaining = MAX_SEMANTIC_DISCLOSURE_CHARACTERS;

  for (const field of FIELD_ORDER) {
    if (!requested.has(field) || remaining === 0) continue;
    const value = disclosableValue(field, readFilterField(item, field));
    if (value === undefined) continue;

    const counts = new Map<SemanticRedactionKind, number>();
    // Redaction runs before truncation. Cutting first could split a card number across the
    // boundary, leaving a fragment that no longer matches and therefore is never removed.
    const redacted = redact(field, value, counts);
    const limit = Math.min(MAX_SEMANTIC_FIELD_CHARACTERS, remaining);
    const bounded = redacted.length > limit ? truncateAt(redacted, limit) : redacted;
    if (bounded.length === 0) continue;

    remaining -= bounded.length;
    fields.push({ field, value: bounded, truncated: bounded.length < redacted.length });
    for (const [kind, count] of [...counts].sort(([left], [right]) => left.localeCompare(right))) {
      redactions.push({ field, kind, count });
    }
  }

  return semanticDisclosureSchema.parse({
    fields,
    disclosedFields: fields.map((entry) => entry.field),
    redactions,
  });
}

/**
 * Applies the clause's confidence threshold to a model answer.
 *
 * The decision is Relay's. A model that reports `match` below the threshold yields `undecided`, not
 * a match, so a low-confidence answer can never reach an automatic effect. `no-match` is subject to
 * the same threshold: an uncertain rejection is equally unusable as a decision.
 */
export function resolveSemanticDecision(
  clause: Pick<SemanticClause, "minimumConfidence">,
  evaluation: SemanticEvaluation,
): FilterDecision {
  return evaluation.confidence < clause.minimumConfidence ? "undecided" : evaluation.decision;
}
