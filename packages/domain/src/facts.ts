import {
  amountFactValueSchema,
  canonicalFactInstantSchema,
  currencyFactValueSchema,
  factDateRoleSchema,
  locationFactValueSchema,
  merchantFactValueSchema,
  normalizationDateCandidateSchema,
  referenceFactValueSchema,
  senderFactValueSchema,
  sourceFactSetSchema,
  type FactDateRole,
  type FactKind,
  type FactProvenance,
  type IngressEnvelope,
  type SourceFact,
  type SourceFactSet,
} from "@relay/contracts";

import { textAmountCandidates, textDateCandidates, textReferenceCandidates } from "./text-facts.js";

/**
 * Version 2 reads the envelope's own subject and body as fact evidence. Version 1 read only
 * `attributes`, which left every provider that carries no structured metadata with a sender fact
 * and nothing more. Text is consulted only where attributes supplied nothing for that kind or date
 * role, so a capture that already carries structured detail normalizes exactly as it did under
 * version 1.
 */
export const SOURCE_FACT_NORMALIZER_VERSION = 2 as const;

type Candidate = { field: string; value: unknown; start?: number; end?: number };
type FactDraft = SourceFact extends infer Fact
  ? Fact extends SourceFact
    ? Omit<Fact, "ordinal">
    : never
  : never;

const DATE_ROLES = factDateRoleSchema.options;
const MAX_ATTRIBUTE_CANDIDATES = 15;
const OFFSET_INSTANT_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/u;

function candidates(value: unknown, field: string): Candidate[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return [{ field, value }];
  if (value.length === 0 || value.length > MAX_ATTRIBUTE_CANDIDATES) {
    return [{ field, value: undefined }];
  }
  return (value as unknown[]).map((candidate, index) => ({
    field: `${field}[${index}]`,
    value: candidate,
  }));
}

/**
 * Attributes win. Text is read only where the envelope declared nothing for that kind, so a source
 * that already states its own amount never has that value re-litigated against its prose.
 */
function orText(attributeEntries: Candidate[], textEntries: Candidate[]): Candidate[] {
  return attributeEntries.length > 0 ? attributeEntries : textEntries;
}

function provenance(entries: Candidate[]): FactProvenance[] {
  const unique = new Map<string, FactProvenance>();
  for (const entry of entries) {
    const record: FactProvenance =
      entry.start !== undefined && entry.end !== undefined
        ? { field: entry.field, start: entry.start, end: entry.end }
        : { field: entry.field };
    unique.set(`${record.field}:${record.start ?? ""}:${record.end ?? ""}`, record);
  }
  // The contract bounds provenance at 16 entries; a noisier field is still evidence for the value.
  return [...unique.values()].slice(0, 16);
}

function uncertain(
  sourceItemId: string,
  kind: FactKind,
  reason: "contradictory" | "invalid",
  entries: Candidate[],
): FactDraft {
  return {
    sourceItemId,
    normalizerVersion: SOURCE_FACT_NORMALIZER_VERSION,
    kind,
    certainty: "uncertain",
    uncertaintyReason: reason,
    provenance: provenance(entries),
  };
}

function canonicalizeFactInstant(value: string): string | undefined {
  const match = OFFSET_INSTANT_PATTERN.exec(value);
  if (match === null) return undefined;
  const date = match[1];
  const time = match[2];
  const fraction = (match[3] ?? "").padEnd(9, "0");
  const offset = match[4];
  if (date === undefined || time === undefined || offset === undefined) return undefined;
  const timestamp = Date.parse(`${date}T${time}${offset}`);
  if (!Number.isFinite(timestamp)) return undefined;
  const utcSecond = new Date(timestamp).toISOString().slice(0, 19);
  const canonical = canonicalFactInstantSchema.safeParse(`${utcSecond}.${fraction}Z`);
  return canonical.success ? canonical.data : undefined;
}

function scalarFact(
  sourceItemId: string,
  kind: "amount" | "currency" | "merchant" | "sender",
  entries: Candidate[],
): FactDraft[] {
  if (entries.length === 0) return [];
  const schema =
    kind === "amount"
      ? amountFactValueSchema
      : kind === "currency"
        ? currencyFactValueSchema
        : kind === "merchant"
          ? merchantFactValueSchema
          : senderFactValueSchema;
  const parsed = entries.map((entry) => schema.safeParse(entry.value));
  if (parsed.some((result) => !result.success)) {
    return [uncertain(sourceItemId, kind, "invalid", entries)];
  }

  const values = [...new Set(parsed.flatMap((result) => (result.success ? [result.data] : [])))];
  if (values.length !== 1) {
    return [uncertain(sourceItemId, kind, "contradictory", entries)];
  }
  const value = values[0];
  if (value === undefined) return [uncertain(sourceItemId, kind, "invalid", entries)];
  const identity = {
    sourceItemId,
    normalizerVersion: SOURCE_FACT_NORMALIZER_VERSION,
    certainty: "certain" as const,
    provenance: provenance(entries),
  };

  switch (kind) {
    case "amount":
      return [{ ...identity, kind, value }];
    case "currency":
      return [{ ...identity, kind, value }];
    case "merchant":
      return [{ ...identity, kind, value }];
    case "sender":
      return [{ ...identity, kind, value }];
  }
}

function dateFacts(sourceItemId: string, envelope: IngressEnvelope): FactDraft[] {
  const grouped = new Map<FactDateRole, Candidate[]>();
  const invalid: Candidate[] = [];
  const add = (role: FactDateRole, entry: Candidate): void => {
    if (typeof entry.value !== "string") {
      invalid.push(entry);
      return;
    }
    const canonical = canonicalizeFactInstant(entry.value);
    if (canonical === undefined) {
      invalid.push(entry);
      return;
    }
    const existing = grouped.get(role) ?? [];
    existing.push({ ...entry, value: canonical });
    grouped.set(role, existing);
  };
  add("occurred", { field: "occurredAt", value: envelope.occurredAt });
  add("captured", { field: "capturedAt", value: envelope.capturedAt });

  for (const entry of candidates(envelope.attributes.dates, "attributes.dates")) {
    const parsed = normalizationDateCandidateSchema.safeParse(entry.value);
    if (parsed.success) add(parsed.data.role, { ...entry, value: parsed.data.instant });
    else invalid.push(entry);
  }

  // Text fills a role the envelope did not state. Gap-filling per role rather than per kind keeps
  // a stated due date authoritative while still reading a start date the attributes omitted, and
  // stops a date read from prose from contradicting one the source declared.
  //
  // The declared roles are captured before any text is added, so two conflicting dates read from
  // the same text still reach the contradiction check below instead of the first one winning.
  const declaredRoles = new Set(grouped.keys());
  for (const entry of textDateCandidates(envelope)) {
    const parsed = normalizationDateCandidateSchema.safeParse(entry.value);
    if (!parsed.success || declaredRoles.has(parsed.data.role)) continue;
    add(parsed.data.role, { ...entry, value: parsed.data.instant });
  }

  const facts: FactDraft[] = [];
  for (const role of DATE_ROLES) {
    const entries = grouped.get(role);
    if (entries === undefined) continue;
    const instants = [...new Set(entries.map((entry) => entry.value as string))];
    if (instants.length !== 1) {
      facts.push(uncertain(sourceItemId, "date", "contradictory", entries));
      continue;
    }
    const instant = instants[0];
    if (instant === undefined) {
      facts.push(uncertain(sourceItemId, "date", "invalid", entries));
      continue;
    }
    facts.push({
      sourceItemId,
      normalizerVersion: SOURCE_FACT_NORMALIZER_VERSION,
      kind: "date",
      certainty: "certain",
      value: { role, instant },
      provenance: provenance(entries),
    });
  }
  if (invalid.length > 0) facts.push(uncertain(sourceItemId, "date", "invalid", invalid));
  return facts;
}

function pluralFacts(
  sourceItemId: string,
  kind: "location" | "reference",
  entries: Candidate[],
): FactDraft[] {
  if (entries.length === 0) return [];
  const valid = new Map<string, { entry: Candidate; value: unknown }>();
  const invalid: Candidate[] = [];
  for (const entry of entries) {
    const parsed =
      kind === "location"
        ? locationFactValueSchema.safeParse(entry.value)
        : referenceFactValueSchema.safeParse(entry.value);
    if (parsed.success) valid.set(JSON.stringify(parsed.data), { entry, value: parsed.data });
    else invalid.push(entry);
  }

  const facts: FactDraft[] = [];
  for (const { entry, value } of valid.values()) {
    const identity = {
      sourceItemId,
      normalizerVersion: SOURCE_FACT_NORMALIZER_VERSION,
      certainty: "certain" as const,
      provenance: provenance([entry]),
    };
    if (kind === "location") {
      facts.push({ ...identity, kind, value: locationFactValueSchema.parse(value) });
    } else {
      facts.push({ ...identity, kind, value: referenceFactValueSchema.parse(value) });
    }
  }
  if (invalid.length > 0) facts.push(uncertain(sourceItemId, kind, "invalid", invalid));
  return facts;
}

/**
 * Converts canonical envelope fields into provider-neutral facts. Source kind never controls
 * extraction; all untrusted attribute candidates pass shared runtime schemas before use.
 */
export function normalizeSourceFacts(envelope: IngressEnvelope): SourceFactSet {
  const senderEntries = [
    ...(envelope.sender === undefined ? [] : [{ field: "sender", value: envelope.sender }]),
    ...candidates(envelope.attributes.sender, "attributes.sender"),
  ];
  const text = textAmountCandidates(envelope);
  const drafts: FactDraft[] = [
    ...scalarFact(envelope.id, "sender", senderEntries),
    ...dateFacts(envelope.id, envelope),
    ...scalarFact(
      envelope.id,
      "amount",
      orText(candidates(envelope.attributes.amount, "attributes.amount"), text.amounts),
    ),
    ...scalarFact(
      envelope.id,
      "currency",
      orText(candidates(envelope.attributes.currency, "attributes.currency"), text.currencies),
    ),
    ...scalarFact(
      envelope.id,
      "merchant",
      candidates(envelope.attributes.merchant, "attributes.merchant"),
    ),
    ...pluralFacts(
      envelope.id,
      "location",
      candidates(envelope.attributes.location, "attributes.location"),
    ),
    ...pluralFacts(
      envelope.id,
      "reference",
      orText(
        candidates(envelope.attributes.reference, "attributes.reference"),
        textReferenceCandidates(envelope),
      ),
    ),
  ];

  return sourceFactSetSchema.parse({
    schemaVersion: 1,
    sourceItemId: envelope.id,
    normalizerVersion: SOURCE_FACT_NORMALIZER_VERSION,
    facts: drafts.map((fact, ordinal) => ({ ...fact, ordinal })),
  });
}

/** SHA-256 over the complete runtime-validated normalizer output, serialized in contract order. */
export async function sourceFactSetFingerprint(candidate: SourceFactSet): Promise<string> {
  const factSet = sourceFactSetSchema.parse(candidate);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(factSet)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
