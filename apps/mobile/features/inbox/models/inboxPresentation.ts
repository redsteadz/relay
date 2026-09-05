import type { EventKind, FactKind } from "@relay/contracts";

/**
 * Inbox grouping.
 *
 * `needs-review` is reserved for what Relay could not resolve: a contradictory date, or evidence it
 * read as uncertain. It is deliberately not driven by an event's `requiresReview` flag, which means
 * "not confident enough to automate" rather than "a person must look at this". Most captures sit
 * below that automation threshold in the ordinary case, so promoting them would fill the inbox with
 * warnings and bury the one item that matters.
 */
/**
 * Where an item sits in the inbox.
 *
 * `filed` and `unfiled` replace the single `quiet` group. "Filed quietly" was the only thing the
 * inbox could say about an item nothing had classified, which made a capture Relay had actively
 * filed indistinguishable from one it had never looked at. Separating them is what lets the screen
 * say which of the two it is.
 */
export type InboxGroup = "actionable" | "filed" | "needs-review" | "unfiled";

/** A fact that supports an event, shown as its evidence rather than as its own inbox row. */
export type InboxEvidence = {
  certain: boolean;
  kind: FactKind;
  label: string;
};

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
  /** Provider-assigned conversation id, when the source names one of its own. */
  threadId: string | undefined;
};

/**
 * The filter decision that placed this item in a category.
 *
 * `method` records how the decision was reached, so a deterministic rule and a semantic clause are
 * never presented as the same kind of claim.
 */
export type InboxCategory = {
  confidence: number | undefined;
  /** The rule revision that filed this, when a rule did. Revisions are immutable, so it is exact. */
  filterRuleId: string | undefined;
  method: string;
  name: string | undefined;
  /**
   * Who decided this.
   *
   * A device decides from what it can read; the server decides from the raw payload as well. Saying
   * which is not decoration -- a device-authored classification must never gate a provider effect,
   * and a reader is entitled to know which kind they are looking at.
   */
  origin: "device" | "server";
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
  content: InboxContent | undefined;
  processing: InboxProcessing;
  retention: InboxRetention;
  source: InboxSource;
};

/**
 * What the capture actually said, read from the device's own encrypted copy.
 *
 * Absent when the capturing device is not this one, or when local retention has already dropped it.
 * The server never holds this, so its absence is normal rather than an error.
 */
export type InboxContent = {
  body: string | undefined;
  subject: string | undefined;
};

export type InboxItem = {
  /** Human name of the capturing application, falling back to its package identifier. */
  appLabel: string;
  content: InboxContent | undefined;
  category: InboxCategory | undefined;
  confidence: number | undefined;
  evidence: readonly InboxEvidence[];
  /**
   * Certain fact values, keyed by kind.
   *
   * Kept beside `evidence` rather than derived from it because evidence labels are formatted for a
   * reader and filing must compare what the pipeline actually derived. These are also how a capture
   * whose body this device cannot read is still filed on an amount or a merchant: the pipeline
   * extracted them from that body server-side, so the signal survives without the text.
   */
  factValues: Readonly<Record<string, string>>;
  group: InboxGroup;
  id: string;
  kind: string;
  occurredAt: string;
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
  /** Groups captures that continue one conversation. Undefined when an item stands alone. */
  threadKey: string | undefined;
  title: string;
};

/**
 * Titles and summaries the extractor emits when it found nothing specific.
 *
 * They describe the extractor's own state rather than the capture, so they are never shown. An item
 * that reaches this list is displayed from what it actually carried instead: what it said, who sent
 * it, or failing both, which application it came from.
 */
const PLACEHOLDER_TITLES = new Set(["Source fact"]);
const PLACEHOLDER_SUMMARIES = new Set(["Structured source facts available.", "Sender available."]);

const REVIEW_REASON_TEXT: Record<string, string> = {
  contradictory: "Relay read conflicting values for this.",
  "inconsistent-range": "The start and end times disagree.",
  invalid: "The value Relay read is not a valid one.",
};

/**
 * Applications common enough to name.
 *
 * Only the capturing package is stored, so anything unlisted shows its package identifier rather
 * than a guess. Naming the wrong application would be worse than showing an exact one.
 */
const APP_LABEL: Record<string, string> = {
  "com.google.android.apps.messaging": "Messages",
  "com.google.android.gm": "Gmail",
  "com.instagram.android": "Instagram",
  "com.whatsapp": "WhatsApp",
};

/**
 * Icons for the applications and sources a capture can come from.
 *
 * An unlisted application gets the generic capture icon rather than a guess, matching how its label
 * falls back to the exact package rather than inventing a name.
 */
const APP_ICON: Record<string, string> = {
  "com.google.android.apps.messaging": "message-text",
  "com.google.android.gm": "gmail",
  "com.instagram.android": "instagram",
  "com.whatsapp": "whatsapp",
};

const SOURCE_ICON: Record<string, string> = {
  gmail: "gmail",
  notification: "bell-outline",
  sms: "message-text",
  unknown: "help-circle-outline",
};

const SOURCE_LABEL: Record<string, string> = {
  gmail: "Gmail",
  notification: "Android notification",
  sms: "SMS",
  unknown: "Source no longer retained",
};

export function appIconFor(source: InboxSource): string {
  if (source.applicationId !== undefined) {
    const icon = APP_ICON[source.applicationId];
    if (icon !== undefined) return icon;
  }
  return SOURCE_ICON[source.kind] ?? "bell-outline";
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function clockTime(value: Date): string {
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

/**
 * Formats a capture time for reading rather than for precision.
 *
 * Today shows the clock alone, because the date is the one thing a reader already knows. An older
 * capture adds the day, and one from another year adds the year, so a timestamp never implies a
 * recency it does not have. Times render in the reader's own zone; the stored value stays UTC.
 */
export function formatCaptureTime(iso: string, now: Date = new Date()): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return "";
  const sameDay =
    value.getFullYear() === now.getFullYear() &&
    value.getMonth() === now.getMonth() &&
    value.getDate() === now.getDate();
  if (sameDay) return clockTime(value);
  const day = `${String(value.getDate())} ${MONTHS[value.getMonth()] ?? ""}`;
  return value.getFullYear() === now.getFullYear()
    ? `${day}, ${clockTime(value)}`
    : `${day} ${String(value.getFullYear())}, ${clockTime(value)}`;
}

export function appLabelFor(source: InboxSource): string {
  if (source.applicationId === undefined) return SOURCE_LABEL[source.kind] ?? source.kind;
  return APP_LABEL[source.applicationId] ?? source.applicationId;
}

function reasonText(reason: string): string {
  return REVIEW_REASON_TEXT[reason] ?? "Relay flagged this for review.";
}

/**
 * Renders a fact value for display.
 *
 * Date facts carry a role and an instant rather than a bare string, so the instant is shown with the
 * role that explains which moment it describes.
 */
export function evidenceLabel(kind: FactKind, value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const instant = record.instant;
    const role = record.role;
    if (typeof instant === "string") {
      return typeof role === "string" ? `${role} ${instant}` : instant;
    }
    const amount = record.amount;
    if (typeof amount === "string" || typeof amount === "number") return String(amount);
  }
  return kind;
}

export function inboxEvidence(fact: InboxFactInput): InboxEvidence {
  return {
    certain: fact.certainty === "certain",
    kind: fact.kind,
    label: evidenceLabel(fact.kind, fact.value),
  };
}

function reviewReasons(
  event: InboxEventInput,
  evidence: readonly InboxEvidence[],
  uncertainReasons: readonly string[],
): string[] {
  const reasons: string[] = [];
  if (event.dateAmbiguity !== null) reasons.push(reasonText(event.dateAmbiguity));
  for (const reason of uncertainReasons) reasons.push(reasonText(reason));
  if (reasons.length === 0 && evidence.some((fact) => !fact.certain)) {
    reasons.push("Relay read some supporting values as uncertain.");
  }
  return reasons;
}

/**
 * Builds the text search reads.
 *
 * Only derived fields and retained metadata are included, matching what the item and its evidence
 * already show. Searching cannot reach anything a person could not otherwise read on the screen,
 * and evidence stays searchable even though it is not its own row.
 */
function searchTextFor(
  title: string,
  summary: string | undefined,
  kind: string,
  context: InboxContext,
  appLabel: string,
  evidence: readonly InboxEvidence[],
): string {
  return [
    title,
    summary,
    context.content?.subject,
    context.content?.body,
    kind,
    appLabel,
    context.category?.name,
    context.source.applicationId,
    context.source.sender,
    context.source.subject,
    ...evidence.map((fact) => `${fact.kind} ${fact.label}`),
  ]
    .filter((part): part is string => part !== undefined && part !== "")
    .join(" ")
    .toLowerCase();
}

/**
 * What to call this item.
 *
 * A real extraction leads, because "USD 14.20 transaction" is what Relay understood rather than
 * merely what arrived. Where extraction found nothing it emits a placeholder, and the item is named
 * by what it said, then by who sent it, and only then by the application it came from. A person
 * never sees the placeholder.
 */
function displayTitle(
  event: InboxEventInput,
  context: InboxContext,
  evidence: readonly InboxEvidence[],
  appLabel: string,
): string {
  if (!PLACEHOLDER_TITLES.has(event.title)) return event.title;
  const said = context.content?.subject;
  if (said !== undefined && said.length > 0) return said;
  const sender = evidence.find((fact) => fact.kind === "sender")?.label;
  if (sender !== undefined && sender.length > 0) return sender;
  return appLabel;
}

function displaySummary(event: InboxEventInput, context: InboxContext): string | undefined {
  const said = context.content?.body;
  if (said !== undefined && said.length > 0) return said;
  const summary = event.summary ?? undefined;
  return summary === undefined || PLACEHOLDER_SUMMARIES.has(summary) ? undefined : summary;
}

export function inboxItemForEvent(
  event: InboxEventInput,
  context: InboxContext,
  facts: readonly InboxFactInput[] = [],
): InboxItem {
  const evidence = facts.map(inboxEvidence);
  const factValues: Record<string, string> = {};
  for (const fact of facts) {
    // Fact values are jsonb. Amount, currency and merchant are stored as plain strings, and only a
    // string can answer a filter predicate, so anything else is left out rather than stringified
    // into a shape a rule was never written against.
    if (
      fact.certainty === "certain" &&
      typeof fact.value === "string" &&
      factValues[fact.kind] === undefined
    ) {
      factValues[fact.kind] = fact.value;
    }
  }
  const uncertainReasons = facts
    .filter((fact) => fact.certainty !== "certain" && fact.uncertaintyReason !== null)
    .map((fact) => fact.uncertaintyReason as string);
  const reasons = reviewReasons(event, evidence, uncertainReasons);
  const scheduledAt = event.startsAt ?? event.dueAt ?? undefined;
  const appLabel = appLabelFor(context.source);
  return {
    appLabel,
    content: context.content,
    category: context.category,
    confidence: event.confidence ?? undefined,
    evidence,
    factValues,
    // Unresolved first, then work with a time, then everything Relay simply recorded. An event
    // Relay declined to automate is not itself a problem, so it files quietly unless something
    // about it is genuinely unresolved.
    group:
      reasons.length > 0
        ? "needs-review"
        : scheduledAt !== undefined
          ? "actionable"
          : context.category === undefined
            ? "unfiled"
            : "filed",
    id: event.id,
    kind: event.kind,
    occurredAt: event.createdAt,
    processing: context.processing,
    retention: context.retention,
    reviewReasons: reasons,
    scheduledAt,
    searchText: searchTextFor(
      event.title,
      event.summary ?? undefined,
      event.kind,
      context,
      appLabel,
      evidence,
    ),
    source: context.source,
    sourceItemId: event.sourceItemId,
    summary: displaySummary(event, context),
    threadKey: inboxThreadKey(context.source),
    title: displayTitle(event, context, evidence, appLabel),
  };
}

const GROUP_ORDER: readonly InboxGroup[] = ["needs-review", "actionable", "filed", "unfiled"];

function compareWithin(group: InboxGroup, left: InboxItem, right: InboxItem): number {
  if (group === "actionable") {
    // Soonest first: an actionable list is read forwards in time.
    return (left.scheduledAt ?? "").localeCompare(right.scheduledAt ?? "");
  }
  // Everything else reads newest first, because recency is what makes an unresolved item relevant.
  return right.occurredAt.localeCompare(left.occurredAt);
}

/**
 * Normalizes text used to match one conversation to another.
 *
 * Matches the comparison rules the deterministic filter evaluator already uses -- NFKC, collapsed
 * whitespace, lowercase -- so two spellings of one name group together rather than splitting a
 * conversation in half.
 */
function normalizeThreadText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

/** Reply and forward markers, so a reply joins the conversation it answers. */
const REPLY_PREFIX = /^(?:re|fw|fwd|aw|sv|vs)\s*(?:\[\d+\])?\s*:\s*/iu;

function subjectThreadText(subject: string): string {
  let remaining = subject;
  // Mail clients stack prefixes ("Re: Fwd: Re: ..."), so strip repeatedly rather than once.
  for (let guard = 0; guard < 8 && REPLY_PREFIX.test(remaining); guard += 1) {
    remaining = remaining.replace(REPLY_PREFIX, "");
  }
  return normalizeThreadText(remaining);
}

/**
 * The conversation an item belongs to.
 *
 * A provider that names its own thread is believed before anything is inferred: Gmail assigns a
 * thread ID, and using it means a renamed subject never splits a conversation and two unrelated
 * messages sharing a subject never merge.
 *
 * Failing that, a conversation is the other party within one application, which is what a chat
 * notification actually continues. Subject is the last resort and is only meaningful for mail.
 *
 * Returns undefined when nothing identifies a conversation, because grouping unrelated items under
 * a fabricated parent would be worse than leaving them apart.
 */
export function inboxThreadKey(source: InboxSource): string | undefined {
  if (source.threadId !== undefined && source.threadId.length > 0) {
    return `provider:${source.kind}:${source.threadId}`;
  }
  const scope = source.applicationId ?? source.kind;
  if (source.sender !== undefined && source.sender.length > 0) {
    return `sender:${scope}:${normalizeThreadText(source.sender)}`;
  }
  if (source.subject !== undefined && source.subject.length > 0) {
    const subject = subjectThreadText(source.subject);
    if (subject.length > 0) return `subject:${scope}:${subject}`;
  }
  return undefined;
}

export type InboxThread = {
  /** Newest item, shown as the thread's face. */
  latest: InboxItem;
  /** Every item in the conversation, newest first. `latest` included. */
  items: readonly InboxItem[];
  key: string;
};

/**
 * Collapses items that continue one conversation.
 *
 * An item with no thread key becomes its own single-item thread rather than being dropped or pooled
 * with other unrelated items, so a list still accounts for everything it was given.
 */
export function groupByThread(items: readonly InboxItem[]): readonly InboxThread[] {
  const threads = new Map<string, InboxItem[]>();
  const order: string[] = [];
  for (const [index, item] of items.entries()) {
    // A keyless item is kept distinct by position, which cannot collide with a real key.
    const key = item.threadKey ?? `solo:${index.toString()}:${item.id}`;
    const existing = threads.get(key);
    if (existing === undefined) {
      threads.set(key, [item]);
      order.push(key);
    } else {
      existing.push(item);
    }
  }
  return order.map((key) => {
    const grouped = [...(threads.get(key) ?? [])].sort((left, right) =>
      right.occurredAt.localeCompare(left.occurredAt),
    );
    // `order` is built from a non-empty first insert, so a group always has a newest item.
    return { items: grouped, key, latest: grouped[0] };
  });
}

/**
 * Stable identity for the application or source a capture came from.
 *
 * Routes are addressed by this rather than by display name: a label is resolved from the device and
 * can differ between phones, change when an application is renamed, and collide between two
 * packages that chose the same name. The package identifier does none of those.
 *
 * Captures with no application -- Gmail and SMS arrive as sources rather than apps -- key on their
 * source kind, so every capture belongs to exactly one group and none are stranded.
 */
export function inboxAppKey(source: InboxSource): string {
  return source.applicationId === undefined
    ? `source:${source.kind}`
    : `app:${source.applicationId}`;
}

/** Everything a list needs to show one application without reading its captures again. */
export type InboxAppSummary = {
  /** Newest capture in the group, for ordering and for saying how recent it is. */
  latestOccurredAt: string;
  /** Captures needing attention, so a busy application does not hide one urgent item. */
  actionable: number;
  /** Total captures. Distinct from `conversations`, which counts threads. */
  captures: number;
  conversations: number;
  icon: string;
  key: string;
  label: string;
  needsReview: number;
};

/**
 * Summarises the applications a set of captures came from, busiest first.
 *
 * Counts both captures and conversations because they differ once threads collapse, and a count
 * that does not say which it measures invites the reader to trust the wrong number.
 */
export function summariseByApp(
  items: readonly InboxItem[],
  labels: ReadonlyMap<string, string> = new Map(),
): readonly InboxAppSummary[] {
  const groups = new Map<string, InboxItem[]>();
  for (const item of items) {
    const key = inboxAppKey(item.source);
    const existing = groups.get(key);
    if (existing === undefined) groups.set(key, [item]);
    else existing.push(item);
  }

  return [...groups.entries()]
    .map(([key, grouped]) => {
      const first = grouped[0];
      const applicationId = first.source.applicationId;
      return {
        actionable: grouped.filter((item) => item.group === "actionable").length,
        captures: grouped.length,
        conversations: groupByThread(grouped).length,
        icon: appIconFor(first.source),
        key,
        label:
          applicationId === undefined
            ? first.appLabel
            : (labels.get(applicationId) ?? first.appLabel),
        latestOccurredAt: grouped.reduce(
          (latest, item) => (item.occurredAt > latest ? item.occurredAt : latest),
          grouped[0]?.occurredAt ?? "",
        ),
        needsReview: grouped.filter((item) => item.group === "needs-review").length,
      };
    })
    .sort(
      (left, right) =>
        // Anything waiting on a person outranks volume, then volume, then name for stability.
        right.actionable + right.needsReview - (left.actionable + left.needsReview) ||
        right.captures - left.captures ||
        left.label.localeCompare(right.label),
    );
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

export type InboxAppGroup = { appLabel: string; items: readonly InboxItem[] };

/**
 * Collapses quiet items by capturing application.
 *
 * Quiet items are numerous by design, and a long list of near-identical rows is the noise this inbox
 * exists to remove. Grouping by application keeps every item present and countable while asking for
 * one line of attention per source instead of one per capture.
 */
export function groupByApp(items: readonly InboxItem[]): readonly InboxAppGroup[] {
  const groups = new Map<string, InboxItem[]>();
  for (const item of items) {
    const existing = groups.get(item.appLabel);
    if (existing === undefined) groups.set(item.appLabel, [item]);
    else existing.push(item);
  }
  return [...groups.entries()]
    .map(([appLabel, grouped]) => ({ appLabel, items: grouped }))
    .sort(
      (left, right) =>
        right.items.length - left.items.length || left.appLabel.localeCompare(right.appLabel),
    );
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

export type InboxCategoryGroup = { categoryName: string; items: readonly InboxItem[] };

/**
 * Collects filed items under the category they were filed into.
 *
 * A rule may file a capture without naming a category, which is a real outcome rather than a gap:
 * the classification records that a rule claimed the item and which one. Those are collected under a
 * heading that says exactly that, instead of being dropped or folded in with items nothing matched.
 *
 * Ordered by size and then by name, matching `groupByApp`, so the heaviest category reads first and
 * two runs over the same items always produce the same order.
 */
export function groupByCategory(items: readonly InboxItem[]): readonly InboxCategoryGroup[] {
  const groups = new Map<string, InboxItem[]>();
  for (const item of items) {
    const name = item.category?.name ?? "Filed without a category";
    const existing = groups.get(name);
    if (existing === undefined) groups.set(name, [item]);
    else existing.push(item);
  }
  return [...groups.entries()]
    .map(([categoryName, grouped]) => ({ categoryName, items: grouped }))
    .sort(
      (left, right) =>
        right.items.length - left.items.length ||
        left.categoryName.localeCompare(right.categoryName),
    );
}
