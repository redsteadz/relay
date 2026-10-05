import type { EventKind } from "@relay/contracts";

import {
  formatCaptureTime,
  type InboxCategory,
  type InboxEvidence,
  type InboxItem,
} from "./inboxPresentation";

/**
 * The receipt anatomy.
 *
 * Every item Relay holds is presented as the same four-part record -- what arrived, what was read
 * from it, how it was filed, and what is proposed because of it -- and this module derives those
 * parts. The inbox, the detail screen and the ledger all read from here, so a fact cannot be
 * described one way in a list and another way when opened.
 *
 * Nothing here invents a value. Where a part is unknown it is absent, and the screen says so.
 */

/** How an event's own kind is named to a reader. */
const KIND_LABEL: Readonly<Record<EventKind, string>> = {
  "calendar-event": "Appointment",
  fact: "Record",
  reminder: "Reminder",
  task: "Task",
};

/**
 * How the filing decision was reached.
 *
 * The three values are the `classifications.method` check constraint, and naming them apart is a
 * privacy claim rather than a stylistic one: a deterministic match read nothing but the fields a
 * rule names, while a semantic one sent allowlisted fields to a model. Presenting both as "filed"
 * would hide the only difference that matters.
 */
const METHOD_LABEL: Readonly<Record<string, string>> = {
  deterministic: "Deterministic",
  manual: "Set by you",
  semantic: "Semantic fallback",
};

export function eventKindLabel(kind: string): string {
  return KIND_LABEL[kind as EventKind] ?? "Record";
}

/**
 * The single initial standing in for a source.
 *
 * Relay only stores a package identifier, so an application it cannot name gets its own first
 * letter rather than a borrowed logo. Claiming to know a brand Relay has never resolved would be a
 * small lie in the most repeated element on the screen.
 */
export function receiptGlyph(appLabel: string): string {
  const letter = [...appLabel].find((character) => /\p{L}|\p{N}/u.test(character));
  return letter === undefined ? "?" : letter.toUpperCase();
}

/** Where it came from: the capturing application, then the party it came from. */
export function receiptSourceLine(item: InboxItem): string {
  const sender = receiptSender(item);
  return sender === undefined ? item.appLabel : `${item.appLabel} · ${sender}`;
}

/**
 * Who it came from, wherever that was recorded.
 *
 * A Gmail capture carries a sender on the source. An Android notification usually does not: the
 * posting application puts the correspondent in the notification's own title, which extraction then
 * reads as the item's title because nothing more specific was found. Both are the same fact to a
 * reader, so both are resolved here rather than at each call site.
 */
export function receiptSender(item: InboxItem): string | undefined {
  const sender = item.source.sender;
  if (sender !== undefined && sender !== "") return sender;
  const derived = item.evidence.find((fact) => fact.kind === "sender")?.value;
  if (derived !== undefined && derived !== "") return derived;
  // The title stands in for the sender only when it is not already doing the louder job below.
  return item.summary === undefined || item.title === item.summary ? undefined : item.title;
}

/**
 * The one line a capture is named by in a list, and the quieter line under it.
 *
 * What a notification said is the line a person is looking for, and the title it arrived with is
 * usually the correspondent -- so setting the title large and the body in muted type put a phone
 * number where the message should be and made every row from one chat look identical. The lead is
 * therefore what was said whenever Relay holds it; the sender keeps its place in the meta line
 * above, where a reader already looks for provenance.
 *
 * Where no readable copy exists -- another device captured it, or retention has dropped it -- the
 * title leads exactly as before, because it is then the only thing Relay can honestly show.
 */
export function receiptLead(item: InboxItem): string {
  return item.summary ?? item.title;
}

/**
 * When it arrived, for the trailing corner of a receipt's head.
 *
 * The event's own kind is deliberately not repeated here. In a list every notification is a
 * `Record`, so pairing that word with a timestamp spent the most valuable line on the card -- the
 * one beside the sender -- restating what the list already is. The kind is named on the receipt
 * itself, where it distinguishes one capture from another.
 */
export function receiptTimeLine(item: InboxItem, now?: Date): string {
  return formatCaptureTime(item.source.occurredAt, now);
}

/**
 * The facts worth chipping in a list.
 *
 * An instant is dropped. A notification that derived nothing else still derives the moment it
 * arrived, so chipping instants put a date on every card and made a list of them look like a list of
 * timestamps rather than a list of messages -- while the arrival time is already in the card's own
 * corner. An amount or a merchant is kept: that is a value a reader checks at a glance.
 *
 * Nothing is lost, because the receipt shows the full evidence set unfiltered.
 */
export function listEvidence(
  evidence: readonly InboxEvidence[],
  shown?: readonly (string | undefined)[],
): readonly InboxEvidence[] {
  const already = new Set(shown?.filter((value): value is string => value !== undefined));
  return evidence.filter((fact) => !fact.isInstant && !already.has(fact.value));
}

/**
 * The filing decision, as one line.
 *
 * `certain` drives the mark beside it: a deterministic match is a check, and anything that needed a
 * model or was left unresolved is a tilde. The distinction is the point of the line.
 */
export type ReceiptDecision = { certain: boolean; text: string };

export function receiptDecision(
  category: InboxCategory | undefined,
  unresolved: boolean,
): ReceiptDecision | undefined {
  if (category === undefined) {
    return unresolved ? { certain: false, text: "Unfiled · needs your review" } : undefined;
  }
  const method = METHOD_LABEL[category.method] ?? category.method;
  const parts = [category.name ?? "Unfiled", method];
  // Who decided is part of the claim, not decoration. A device decides from what it can read; the
  // server decides from the raw payload as well, and only a server decision may ever gate a
  // provider effect. A reader is entitled to know which one they are looking at.
  if (category.origin === "device") parts.push("on this device");
  if (unresolved) parts.push("unresolved");
  else if (category.confidence !== undefined) {
    parts.push(`${Math.round(category.confidence * 100).toString()}%`);
  }
  return { certain: !unresolved && category.method === "deterministic", text: parts.join(" · ") };
}

/**
 * A fact's value as read on screen.
 *
 * Instants are stored UTC and shown in the reader's own zone, which is why formatting happens here
 * rather than where the fact was derived.
 */
export function receiptFactValue(fact: { isInstant: boolean; value: string }, now?: Date): string {
  if (!fact.isInstant) return fact.value;
  const formatted = formatCaptureTime(fact.value, now);
  return formatted === "" ? fact.value : formatted;
}
