import type { InboxItem } from "@/features/inbox/models/inboxPresentation";

/**
 * The day at a glance.
 *
 * Relay's inbox answers "what arrived"; nothing answered "what did Relay do about it". A person who
 * never opens a receipt still deserves to know the product is working, and three counts and a shape
 * do that in one screenful without asking them to read anything.
 *
 * Everything here is derived from captures already on the device or already fetched for the inbox.
 * No new read, no new retained field, and nothing that is not already shown somewhere else.
 */

/** Hours in a day, which is both the bucket count and the chart's width. */
const HOURS = 24;

export type GlanceCounts = {
  /** Everything that arrived in the window. */
  captured: number;
  /** Captures a rule or a model put in a category, so the reader never had to. */
  filed: number;
  /** Captures Relay could not resolve and is holding for a person. */
  review: number;
  /** Proposals waiting on an explicit decision. */
  waiting: number;
};

function isSameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/** Captures that arrived on the reader's own calendar day, in the reader's own zone. */
export function capturedToday(
  items: readonly InboxItem[],
  now: Date = new Date(),
): readonly InboxItem[] {
  return items.filter((item) => {
    const occurred = new Date(item.source.occurredAt);
    return !Number.isNaN(occurred.getTime()) && isSameDay(occurred, now);
  });
}

/**
 * What happened to today's captures.
 *
 * `waiting` is counted from proposals rather than from the actionable group, because a capture can
 * be actionable without Relay having proposed anything yet, and the number a person is being asked
 * to act on is the number of decisions in front of them.
 */
export function glanceCounts(
  items: readonly InboxItem[],
  waiting: number,
  now: Date = new Date(),
): GlanceCounts {
  const today = capturedToday(items, now);
  return {
    captured: today.length,
    filed: today.filter((item) => item.group === "filed").length,
    review: today.filter((item) => item.group === "needs-review").length,
    waiting,
  };
}

/**
 * When today's captures arrived, one bucket per hour.
 *
 * Local hours, because the chart is read against the reader's own day: a bar under "6pm" has to
 * mean their evening and not UTC's.
 */
export function arrivalBuckets(
  items: readonly InboxItem[],
  now: Date = new Date(),
): readonly number[] {
  const buckets = Array.from({ length: HOURS }, () => 0);
  for (const item of capturedToday(items, now)) {
    const hour = new Date(item.source.occurredAt).getHours();
    buckets[hour] = (buckets[hour] ?? 0) + 1;
  }
  return buckets;
}

/** The four labels written under that chart. */
export const hourTicks = ["12am", "6am", "12pm", "6pm"] as const;

/**
 * How the screen opens.
 *
 * Time of day rather than a name: Relay holds an account, not a relationship, and "Good evening"
 * from a notification router that has read nothing about the person is the most it has earned.
 */
export function glanceGreeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * The one-line verdict under the counts.
 *
 * Stated from what Relay did rather than from what arrived, because the claim the product makes is
 * about quiet: a hundred captures and no interruptions is the good outcome, and a screen that only
 * reported the hundred would read as a failure.
 */
export function glanceSummary(counts: GlanceCounts): string {
  if (counts.captured === 0) return "Nothing has arrived yet today.";
  const quiet = counts.captured - counts.waiting;
  if (counts.waiting === 0) {
    return `${String(counts.captured)} arrived. None of it needed you.`;
  }
  return `${String(quiet)} handled quietly. ${String(counts.waiting)} ${
    counts.waiting === 1 ? "decision is" : "decisions are"
  } waiting on you.`;
}
