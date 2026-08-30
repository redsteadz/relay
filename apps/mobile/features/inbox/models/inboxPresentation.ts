import type { EventKind, FactKind } from "@relay/contracts";

/**
 * Inbox grouping.
 *
 * `needs-review` exists so uncertainty is surfaced rather than filtered. An item Relay could not
 * resolve confidently is the item a person most needs to see, so it is ranked above settled work
 * instead of being hidden or silently downgraded.
 */
export type InboxGroup = "actionable" | "needs-review" | "quiet";

export type InboxOrigin = "event" | "fact";

export type InboxEventInput = {
  confidence: number | null;
  createdAt: string;
  dateAmbiguity: string | null;
  dueAt: string | null;
  id: string;
  kind: EventKind;
  requiresReview: boolean;
  sourceItemId: string;
  startsAt: string | null;
  summary: string | null;
  temporalStatus: string;
  title: string;
};

export type InboxFactInput = {
  certainty: string;
  createdAt: string;
  id: string;
  kind: FactKind;
  sourceItemId: string;
  uncertaintyReason: string | null;
  value: unknown;
};

/** Where an item came from, so detail can name the source without reopening the raw payload. */
export type InboxSource = {
  applicationId: string | undefined;
  kind: string;
  occurredAt: string;
  sender: string | undefined;
  subject: string | undefined;
};

/**
 * The filter decision that placed this item in a category.
 *
 * `method` records how the decision was reached, so a deterministic rule and a semantic clause are
 * never presented as the same kind of claim.
 */
export type InboxCategory = {
  confidence: number | undefined;
  method: string;
  name: string | undefined;
  rationale: string | undefined;
};

/**
 * Retention state of the encrypted raw payload behind an item.
 *
 * Raw copies expire seven days after capture. The derived item outlives them, so a screen must be
 * able to say the original is gone rather than implying it could still be opened.
 */
export type InboxRetention = {
  rawExpired: boolean;
  rawExpiresAt: string | undefined;
};

/**
 * Whether the pipeline finished with this item's source.
 *
 * Clients cannot read the dead-letter store by policy, so a failure is visible only as a capture the
 * pipeline accepted but never marked processed. That is reported as unfinished rather than failed,
 * because from here the two are indistinguishable.
 */
export type InboxProcessing = "pending" | "processed";

export type InboxContext = {
  category: InboxCategory | undefined;
  processing: InboxProcessing;
  retention: InboxRetention;
  source: InboxSource;
};

export type InboxItem = {
  category: InboxCategory | undefined;
  confidence: number | undefined;
  group: InboxGroup;
  id: string;
  kind: string;
  occurredAt: string;
  origin: InboxOrigin;
  processing: InboxProcessing;
  retention: InboxRetention;
  /** Why Relay is unsure. Never empty for a `needs-review` item, always empty otherwise. */
  reviewReasons: readonly string[];
  scheduledAt: string | undefined;
  /** Lowercased derived text search matches against. Never includes an expired raw payload. */
  searchText: string;
  source: InboxSource;
  sourceItemId: string;
  summary: string | undefined;
  title: string;
};

/**
 * Builds the text search reads.
 *
 * Only derived fields and retained metadata are included, matching what the item itself already
 * shows. Searching cannot reach anything a person could not otherwise read on the screen.
 */
function searchTextFor(
  title: string,
  summary: string | undefined,
  kind: string,
  context: InboxContext,
): string {
  return [
    title,
    summary,
    kind,
    context.category?.name,
    context.source.applicationId,
    context.source.sender,
    context.source.subject,
  ]
    .filter((part): part is string => part !== undefined && part !== "")
    .join(" ")
    .toLowerCase();
}

const REVIEW_REASON_TEXT: Record<string, string> = {
  contradictory: "Relay read conflicting values for this.",
  "inconsistent-range": "The start and end times disagree.",
  invalid: "The value Relay read is not a valid one.",
  "low-confidence": "Relay is not confident in this reading.",
};

/**
 * Confidence below which an event is reviewed rather than acted on.
 *
 * Extraction reports confidence per event, and a low score means the wording was weak evidence, not
 * that the event is wrong. Reviewing is the conservative reading: the item still appears, ranked
 * where a person will look at it.
 */
const REVIEW_CONFIDENCE = 0.5;

function reasonText(reason: string): string {
  return REVIEW_REASON_TEXT[reason] ?? "Relay flagged this for review.";
}

function eventReviewReasons(event: InboxEventInput): string[] {
  const reasons: string[] = [];
  if (event.dateAmbiguity !== null) reasons.push(reasonText(event.dateAmbiguity));
  if (event.confidence !== null && event.confidence < REVIEW_CONFIDENCE) {
    reasons.push(reasonText("low-confidence"));
  }
  // `requires_review` is the extractor's own verdict. Keep it last so a specific reason reads first,
  // and only add it when nothing more precise already explains the flag.
  if (event.requiresReview && reasons.length === 0) reasons.push(reasonText("unspecified"));
  return reasons;
}

export function inboxItemForEvent(event: InboxEventInput, context: InboxContext): InboxItem {
  const reviewReasons = eventReviewReasons(event);
  const scheduledAt = event.startsAt ?? event.dueAt ?? undefined;
  return {
    category: context.category,
    confidence: event.confidence ?? undefined,
    // A scheduled item is actionable only once Relay trusts when it happens; an ambiguous time makes
    // it reviewable instead, because acting on the wrong date is worse than acting late.
    group:
      reviewReasons.length > 0
        ? "needs-review"
        : scheduledAt === undefined
          ? "quiet"
          : "actionable",
    id: event.id,
    kind: event.kind,
    occurredAt: event.createdAt,
    origin: "event",
    processing: context.processing,
    retention: context.retention,
    reviewReasons,
    scheduledAt,
    searchText: searchTextFor(event.title, event.summary ?? undefined, event.kind, context),
    source: context.source,
    sourceItemId: event.sourceItemId,
    summary: event.summary ?? undefined,
    title: event.title,
  };
}

export function inboxItemForFact(fact: InboxFactInput, context: InboxContext): InboxItem {
  const uncertain = fact.certainty !== "certain";
  const reviewReasons = uncertain ? [reasonText(fact.uncertaintyReason ?? "unspecified")] : [];
  const title = factTitle(fact);
  return {
    category: context.category,
    confidence: undefined,
    // A fact carries no schedule, so it is never actionable on its own. It either needs a person to
    // resolve it or belongs in the quiet record behind the events that cite it.
    group: uncertain ? "needs-review" : "quiet",
    id: fact.id,
    kind: fact.kind,
    occurredAt: fact.createdAt,
    origin: "fact",
    processing: context.processing,
    retention: context.retention,
    reviewReasons,
    scheduledAt: undefined,
    searchText: searchTextFor(title, undefined, fact.kind, context),
    source: context.source,
    sourceItemId: fact.sourceItemId,
    summary: undefined,
    title,
  };
}

function factTitle(fact: InboxFactInput): string {
  const value = fact.value;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fact.kind;
}

const GROUP_ORDER: readonly InboxGroup[] = ["needs-review", "actionable", "quiet"];

function compareWithin(group: InboxGroup, left: InboxItem, right: InboxItem): number {
  if (group === "actionable") {
    // Soonest first: an actionable list is read forwards in time.
    return (left.scheduledAt ?? "").localeCompare(right.scheduledAt ?? "");
  }
  // Everything else reads newest first, because recency is what makes an unresolved item relevant.
  return right.occurredAt.localeCompare(left.occurredAt);
}

export type InboxSection = { group: InboxGroup; items: readonly InboxItem[] };

/**
 * Orders items into sections without dropping any.
 *
 * Returning empty sections rather than omitting them lets a screen say "nothing needs review"
 * explicitly, which is a different statement from having no inbox at all.
 */
export function inboxSections(items: readonly InboxItem[]): readonly InboxSection[] {
  return GROUP_ORDER.map((group) => ({
    group,
    items: items
      .filter((item) => item.group === group)
      .sort((left, right) => compareWithin(group, left, right)),
  }));
}

/**
 * Narrows the inbox by a typed query.
 *
 * Every term must match, so adding words narrows rather than widens. A blank query returns the inbox
 * unchanged rather than nothing, because an empty search box is not a filter.
 */
export function filterInbox(items: readonly InboxItem[], query: string): readonly InboxItem[] {
  const terms = query.toLowerCase().split(/\s+/u).filter(Boolean);
  if (terms.length === 0) return items;
  return items.filter((item) => terms.every((term) => item.searchText.includes(term)));
}

/** Retention state for a raw payload, given when it expires and when the read happens. */
export function inboxRetention(rawExpiresAt: string | null, now: string): InboxRetention {
  return {
    rawExpired: rawExpiresAt !== null && rawExpiresAt <= now,
    rawExpiresAt: rawExpiresAt ?? undefined,
  };
}
