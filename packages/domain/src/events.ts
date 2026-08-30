import {
  EVENT_AUTOMATION_MIN_CONFIDENCE,
  EVENT_SUMMARY_MAX_LENGTH,
  EVENT_TITLE_MAX_LENGTH,
  sourceEventSetSchema,
  sourceFactSetSchema,
  type SourceEvent,
  type SourceEventSet,
  type SourceFact,
  type SourceFactSet,
} from "@relay/contracts";

export const SOURCE_EVENT_EXTRACTOR_VERSION = 1 as const;

type CertainDateFact = Extract<SourceFact, { certainty: "certain"; kind: "date" }>;
type CertainLocationFact = Extract<SourceFact, { certainty: "certain"; kind: "location" }>;
type CertainReferenceFact = Extract<SourceFact, { certainty: "certain"; kind: "reference" }>;
type CertainTextFact = Extract<
  SourceFact,
  { certainty: "certain"; kind: "amount" | "currency" | "merchant" | "sender" }
>;

function boundedDisplayText(value: string, maximum: number): string {
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (normalized.length <= maximum) return normalized;
  let truncated = normalized.slice(0, maximum - 3);
  const finalCodeUnit = truncated.charCodeAt(truncated.length - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) truncated = truncated.slice(0, -1);
  return `${truncated.trimEnd()}...`;
}

function referenceLabel(reference: CertainReferenceFact | undefined): string | undefined {
  switch (reference?.value.kind) {
    case "booking":
      return "Booking";
    case "invoice":
      return "Invoice";
    case "order":
      return "Order";
    case "tracking":
      return "Tracking";
    case "transaction":
      return "Transaction";
    case "other":
      return "Source";
    default:
      return undefined;
  }
}

/**
 * Creates one concise event from normalized facts. Raw subject/body text and provider kind are not
 * inputs, so source content cannot become an instruction or be copied into a derived summary.
 */
export function extractSourceEvents(candidate: SourceFactSet): SourceEventSet {
  const factSet = sourceFactSetSchema.parse(candidate);
  let amount: CertainTextFact | undefined;
  let currency: CertainTextFact | undefined;
  let merchant: CertainTextFact | undefined;
  let sender: CertainTextFact | undefined;
  let location: CertainLocationFact | undefined;
  let reference: CertainReferenceFact | undefined;
  const dates = new Map<string, CertainDateFact>();
  const uncertain: SourceFact[] = [];

  for (const fact of factSet.facts) {
    if (fact.certainty === "uncertain") {
      uncertain.push(fact);
      continue;
    }
    switch (fact.kind) {
      case "amount":
        amount ??= fact;
        break;
      case "currency":
        currency ??= fact;
        break;
      case "date":
        dates.set(fact.value.role, fact);
        break;
      case "location":
        if (
          location === undefined ||
          fact.value.role === "event" ||
          (location.value.role !== "event" && fact.value.role === "destination")
        ) {
          location = fact;
        }
        break;
      case "merchant":
        merchant ??= fact;
        break;
      case "reference":
        reference ??= fact;
        break;
      case "sender":
        sender ??= fact;
        break;
    }
  }

  const start = dates.get("start");
  const end = dates.get("end");
  const due = dates.get("due");
  const uncertainDate = uncertain.find((fact) => fact.kind === "date");
  const inconsistentRange =
    end !== undefined && (start === undefined || end.value.instant <= start.value.instant);
  const kind =
    start !== undefined
      ? "calendar-event"
      : due !== undefined
        ? "reminder"
        : reference?.value.kind === "tracking" || reference?.value.kind === "order"
          ? "task"
          : "fact";

  let temporal: Pick<
    SourceEvent,
    "dateAmbiguity" | "dueAt" | "endsAt" | "startsAt" | "temporalStatus" | "timeZone"
  >;
  if (inconsistentRange) {
    temporal = {
      temporalStatus: "ambiguous",
      timeZone: null,
      dateAmbiguity: "inconsistent-range",
    };
  } else if (start !== undefined) {
    temporal = {
      temporalStatus: "resolved",
      timeZone: "UTC",
      startsAt: start.value.instant,
      ...(end === undefined ? {} : { endsAt: end.value.instant }),
    };
  } else if (due !== undefined) {
    temporal = { temporalStatus: "resolved", timeZone: "UTC", dueAt: due.value.instant };
  } else if (uncertainDate?.certainty === "uncertain") {
    temporal = {
      temporalStatus: "ambiguous",
      timeZone: null,
      dateAmbiguity: uncertainDate.uncertaintyReason,
    };
  } else {
    temporal = { temporalStatus: "none", timeZone: null };
  }

  const displayAmount = amount?.kind === "amount" ? amount.value : undefined;
  const displayCurrency = currency?.kind === "currency" ? currency.value : undefined;
  const label = referenceLabel(reference);
  let title: string;
  if (kind === "calendar-event") {
    title = "Calendar event";
  } else if (kind === "reminder") {
    title =
      label === "Invoice" || label === "Booking"
        ? `${label} reminder`
        : label === "Order" || label === "Tracking"
          ? "Delivery reminder"
          : "Reminder";
  } else if (kind === "task") {
    title = reference?.value.kind === "tracking" ? "Track delivery" : "Review order";
  } else if (displayAmount !== undefined) {
    title = `${displayCurrency === undefined ? "Amount" : displayCurrency} ${displayAmount} transaction`;
  } else {
    title = label === undefined ? "Source fact" : `${label} update`;
  }

  const summaryParts: string[] = [];
  if (displayAmount !== undefined) {
    summaryParts.push(
      `Amount: ${displayCurrency === undefined ? displayAmount : `${displayCurrency} ${displayAmount}`}.`,
    );
  }
  if (merchant !== undefined) summaryParts.push("Merchant available.");
  if (location !== undefined) summaryParts.push("Location available.");
  if (label !== undefined) summaryParts.push(`${label} reference available.`);
  if (summaryParts.length === 0 && sender !== undefined) {
    summaryParts.push("Sender available.");
  }
  if (summaryParts.length === 0) summaryParts.push("Structured source facts available.");

  let confidence =
    kind === "calendar-event"
      ? 0.95
      : kind === "reminder"
        ? 0.9
        : kind === "task"
          ? 0.85
          : displayAmount !== undefined && displayCurrency !== undefined && merchant !== undefined
            ? 0.95
            : 0.75;
  if (uncertain.length > 0) confidence = Math.min(confidence, 0.6);
  if (inconsistentRange) confidence = 0.5;

  const evidence = new Map<number, SourceFact>();
  const addEvidence = (fact: SourceFact | undefined): void => {
    if (fact !== undefined && evidence.size < 16) evidence.set(fact.ordinal, fact);
  };
  addEvidence(amount);
  addEvidence(currency);
  addEvidence(merchant);
  addEvidence(sender);
  addEvidence(location);
  addEvidence(reference);
  addEvidence(start);
  addEvidence(end);
  addEvidence(due);
  addEvidence(uncertainDate);
  addEvidence(uncertain[0]);
  if (evidence.size === 0) addEvidence(factSet.facts[0]);

  return sourceEventSetSchema.parse({
    schemaVersion: 1,
    sourceItemId: factSet.sourceItemId,
    normalizerVersion: factSet.normalizerVersion,
    extractorVersion: SOURCE_EVENT_EXTRACTOR_VERSION,
    events: [
      {
        sourceItemId: factSet.sourceItemId,
        normalizerVersion: factSet.normalizerVersion,
        extractorVersion: SOURCE_EVENT_EXTRACTOR_VERSION,
        ordinal: 0,
        kind,
        title: boundedDisplayText(title, EVENT_TITLE_MAX_LENGTH),
        summary: boundedDisplayText(summaryParts.join(" "), EVENT_SUMMARY_MAX_LENGTH),
        confidence,
        requiresReview:
          confidence < EVENT_AUTOMATION_MIN_CONFIDENCE || temporal.temporalStatus === "ambiguous",
        ...temporal,
        provenance: [...evidence.values()]
          .sort((left, right) => left.ordinal - right.ordinal)
          .map((fact) => ({ factOrdinal: fact.ordinal, fields: fact.provenance })),
      },
    ],
  });
}

/** SHA-256 over complete runtime-validated extractor output, excluding database row IDs. */
export async function sourceEventSetFingerprint(candidate: SourceEventSet): Promise<string> {
  const eventSet = sourceEventSetSchema.parse(candidate);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(eventSet)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
