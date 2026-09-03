/**
 * Deterministic fact candidates read from an envelope's own subject and body.
 *
 * Normalizer version 1 read only `attributes`, which meant a provider that carries no structured
 * metadata -- Gmail above all -- produced a sender fact and nothing else. Every such capture then
 * fell to the same untyped event, so the inbox could not tell an invoice from a newsletter.
 *
 * These extractors are pure, bounded, and never guess. A pattern either resolves to exactly one
 * canonical value or it yields nothing: an ambiguous numeric date, an unknown currency code, and a
 * bare number with no unit all produce no candidate rather than a plausible one. Text is matched as
 * data; no branch here is selected by provider kind, and nothing read from text can choose an
 * endpoint, credential, or action.
 *
 * Candidates carry the character span they were read from, so a fact derived from text can be
 * traced back to its position without the provenance record repeating the value.
 */

import {
  amountFactValueSchema,
  currencyFactValueSchema,
  referenceFactValueSchema,
  type IngressEnvelope,
} from "@relay/contracts";

/** The only envelope fields these extractors may read. */
export type TextSource = Pick<IngressEnvelope, "body" | "subject">;

/**
 * Longest prefix of each field that is scanned. A body may legally reach a megabyte; scanning all
 * of it would let one capture dominate a tenant's processing budget for no extraction benefit,
 * because structured detail in a message appears near its start.
 */
export const TEXT_FACT_SCAN_LIMIT = 20_000;

/** Cap per kind. Beyond this the field is treated as too noisy to read a single value from. */
const MAX_TEXT_CANDIDATES = 8;

/** How far before a date a cue word may sit and still govern its role. */
const CUE_WINDOW = 48;

export type TextField = "subject" | "body";

export type TextCandidate = {
  field: TextField;
  value: unknown;
  start: number;
  end: number;
};

/**
 * ISO 4217 codes recognized in text. An allowlist rather than `[A-Z]{3}`, because a bare
 * three-letter regex reads "THE 100" and "VAT 20" as money.
 */
const CURRENCY_CODES = new Set([
  "AED",
  "AUD",
  "BRL",
  "CAD",
  "CHF",
  "CNY",
  "CZK",
  "DKK",
  "EUR",
  "GBP",
  "HKD",
  "HUF",
  "IDR",
  "ILS",
  "INR",
  "JPY",
  "KRW",
  "MXN",
  "MYR",
  "NOK",
  "NZD",
  "PHP",
  "PKR",
  "PLN",
  "RON",
  "RUB",
  "SAR",
  "SEK",
  "SGD",
  "THB",
  "TRY",
  "TWD",
  "USD",
  "VND",
  "ZAR",
]);

/**
 * Only symbols with one unambiguous ISO code. `$` is deliberately absent: it is USD, CAD, AUD, and
 * more, and picking one would invent a currency the message never stated.
 */
const CURRENCY_SYMBOLS = new Map([
  ["€", "EUR"],
  ["£", "GBP"],
  ["¥", "JPY"],
]);

const MONTHS = new Map(
  [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ].flatMap((name, index) => {
    const month = index + 1;
    return [
      [name, month],
      [name.slice(0, 3), month],
    ] as [string, number][];
  }),
);

// Delivery and arrival read as `due`: they are dates you wait on, which the event extractor
// turns into a "Delivery reminder" when an order or tracking reference is present.
// A cue may be separated from its date by one short connector ("delivery on 4 May", "due by the
// 5th"), but not by arbitrary prose, which would let a cue govern an unrelated date further away.
const CONNECTOR = String.raw`(?:\s+(?:on|by|at|for|before|the))*`;
const DUE_CUE = new RegExp(
  String.raw`(?:due|deadline|expires?|expiry|pay(?:able)?\s+by|last\s+day|delivery|deliver(?:ed|s)?|arrives?)${CONNECTOR}[^\p{L}\p{N}]{0,12}$`,
  "iu",
);
const START_CUE = new RegExp(
  String.raw`(?:starts?|begins?|scheduled|appointment|meeting)${CONNECTOR}[^\p{L}\p{N}]{0,12}$`,
  "iu",
);

const NUMBER = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?`;
const CODE_BEFORE = new RegExp(String.raw`\b([A-Z]{3})\s{0,2}(${NUMBER})\b`, "gu");
const CODE_AFTER = new RegExp(String.raw`\b(${NUMBER})\s{0,2}([A-Z]{3})\b`, "gu");
const SYMBOL_BEFORE = new RegExp(String.raw`([€£¥])\s{0,2}(${NUMBER})`, "gu");
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/gu;
const MONTH_FIRST = /\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gu;
const DAY_FIRST = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9}),?\s+(\d{4})\b/gu;
const REFERENCE =
  /\b(order|invoice|tracking|booking|confirmation|reservation)\b[^\S\r\n]{0,3}(?:number|no\.?|num\.?|#|:)?[^\S\r\n]{0,3}([A-Za-z0-9][A-Za-z0-9-]{3,31})\b/giu;

const REFERENCE_KINDS = new Map<string, string>([
  ["order", "order"],
  ["invoice", "invoice"],
  ["tracking", "tracking"],
  ["booking", "booking"],
  ["confirmation", "booking"],
  ["reservation", "booking"],
]);

function scannable(envelope: TextSource): [TextField, string][] {
  const fields: [TextField, string][] = [];
  if (envelope.subject !== undefined && envelope.subject.length > 0) {
    fields.push(["subject", envelope.subject.slice(0, TEXT_FACT_SCAN_LIMIT)]);
  }
  if (envelope.body !== undefined && envelope.body.length > 0) {
    fields.push(["body", envelope.body.slice(0, TEXT_FACT_SCAN_LIMIT)]);
  }
  return fields;
}

/** Strips grouping separators and accepts only what the exact-decimal contract already allows. */
function decimalString(raw: string): string | undefined {
  const stripped = raw.replaceAll(",", "");
  const parsed = amountFactValueSchema.safeParse(stripped);
  return parsed.success ? parsed.data : undefined;
}

/** Builds a canonical UTC instant, rejecting a date that does not exist such as 2026-02-31. */
function instantFor(year: number, month: number, day: number): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1000 || year > 9999)
    return undefined;
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const timestamp = Date.parse(`${iso}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) return undefined;
  // Date.parse rolls an impossible day forward, so a mismatch means the written date was not real.
  if (new Date(timestamp).toISOString().slice(0, 10) !== iso) return undefined;
  return `${iso}T00:00:00Z`;
}

function roleBefore(text: string, index: number): "due" | "start" | undefined {
  const preceding = text.slice(Math.max(0, index - CUE_WINDOW), index);
  if (DUE_CUE.test(preceding)) return "due";
  if (START_CUE.test(preceding)) return "start";
  return undefined;
}

function bounded(candidates: TextCandidate[]): TextCandidate[] {
  return candidates.slice(0, MAX_TEXT_CANDIDATES);
}

/**
 * Amounts stated with an explicit unit. A bare number is never money: an order count, a street
 * number, and a percentage all look identical without one.
 */
export function textAmountCandidates(envelope: TextSource): {
  amounts: TextCandidate[];
  currencies: TextCandidate[];
} {
  const amounts: TextCandidate[] = [];
  const currencies: TextCandidate[] = [];
  for (const [field, text] of scannable(envelope)) {
    const record = (
      amount: string | undefined,
      code: string | undefined,
      match: RegExpExecArray,
    ) => {
      if (amount === undefined) return;
      const start = match.index;
      const end = match.index + match[0].length;
      amounts.push({ field, value: amount, start, end });
      if (code === undefined) return;
      const parsed = currencyFactValueSchema.safeParse(code);
      if (parsed.success) currencies.push({ field, value: parsed.data, start, end });
    };

    for (const match of text.matchAll(CODE_BEFORE)) {
      if (!CURRENCY_CODES.has(match[1] ?? "")) continue;
      record(decimalString(match[2] ?? ""), match[1], match);
    }
    for (const match of text.matchAll(CODE_AFTER)) {
      if (!CURRENCY_CODES.has(match[2] ?? "")) continue;
      record(decimalString(match[1] ?? ""), match[2], match);
    }
    for (const match of text.matchAll(SYMBOL_BEFORE)) {
      record(decimalString(match[2] ?? ""), CURRENCY_SYMBOLS.get(match[1] ?? ""), match);
    }
  }
  return { amounts: bounded(amounts), currencies: bounded(currencies) };
}

/**
 * Dates that a cue word gives a role. A date with no cue is skipped rather than filed as
 * `occurred`, which would contradict the envelope's own timestamp and make every dated message
 * uncertain.
 *
 * Numeric slash dates are never read: `03/04/2026` is two different days depending on locale, and
 * choosing one would be a guess presented as a fact.
 */
export function textDateCandidates(envelope: TextSource): TextCandidate[] {
  const candidates: TextCandidate[] = [];
  for (const [field, text] of scannable(envelope)) {
    const push = (instant: string | undefined, match: RegExpExecArray): void => {
      if (instant === undefined) return;
      const role = roleBefore(text, match.index);
      if (role === undefined) return;
      candidates.push({
        field,
        value: { role, instant },
        start: match.index,
        end: match.index + match[0].length,
      });
    };

    for (const match of text.matchAll(ISO_DATE)) {
      push(instantFor(Number(match[1]), Number(match[2]), Number(match[3])), match);
    }
    for (const match of text.matchAll(MONTH_FIRST)) {
      const month = MONTHS.get((match[1] ?? "").toLowerCase());
      if (month === undefined) continue;
      push(instantFor(Number(match[3]), month, Number(match[2])), match);
    }
    for (const match of text.matchAll(DAY_FIRST)) {
      const month = MONTHS.get((match[2] ?? "").toLowerCase());
      if (month === undefined) continue;
      push(instantFor(Number(match[3]), month, Number(match[1])), match);
    }
  }
  return bounded(candidates);
}

/** References stated with their own noun, so an arbitrary alphanumeric token is never a reference. */
export function textReferenceCandidates(envelope: TextSource): TextCandidate[] {
  const candidates: TextCandidate[] = [];
  for (const [field, text] of scannable(envelope)) {
    for (const match of text.matchAll(REFERENCE)) {
      const kind = REFERENCE_KINDS.get((match[1] ?? "").toLowerCase());
      if (kind === undefined) continue;
      const parsed = referenceFactValueSchema.safeParse({ kind, value: match[2] ?? "" });
      if (!parsed.success) continue;
      candidates.push({
        field,
        value: parsed.data,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }
  return bounded(candidates);
}
