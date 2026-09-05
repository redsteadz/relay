import type { EventKind } from "@relay/contracts";

import { formatCaptureTime, type InboxCategory, type InboxItem } from "./inboxPresentation";

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
  const sender = item.source.sender;
  return sender === undefined || sender === "" ? item.appLabel : `${item.appLabel} · ${sender}`;
}

/** What it is and when it arrived, for the trailing corner of a receipt's head. */
export function receiptKindLine(item: InboxItem, now?: Date): string {
  const time = formatCaptureTime(item.source.occurredAt, now);
  const kind = eventKindLabel(item.kind);
  return time === "" ? kind : `${kind} · ${time}`;
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
