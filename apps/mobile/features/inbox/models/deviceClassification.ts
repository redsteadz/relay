/**
 * Filing captures from this device.
 *
 * The decision itself is `classifyCapture` in `@relay/domain`, shared with any runtime that could
 * make it. What lives here is everything specific to being a phone: which fields this device can
 * actually supply for a given capture, and which classifications are worth writing.
 *
 * The field question is the important one. A capture Relay received through Gmail keeps its body
 * only in `raw_ciphertext`, encrypted to a key the device does not hold, while a capture this device
 * made itself keeps a local copy for thirty days. So `body` is readable for some captures and not
 * others, and the evaluator cannot tell an unreadable field from an absent one -- it would read the
 * gap as `no-match` and, under a negated predicate, as a match the capture never earned. Declaring
 * availability up front is what stops that.
 */

import {
  classificationRationale,
  classifyCapture,
  type CaptureClassification,
  type ClassifiableRule,
} from "@relay/domain";
import type { FilterField, FilterRuleVersion } from "@relay/contracts";

import type { InboxItem } from "./inboxPresentation";

/** Every field except `body`, which depends on whether this device holds the capture. */
const DEVICE_READABLE_FIELDS: readonly FilterField[] = [
  "source.kind",
  "source.applicationId",
  "sender",
  "subject",
  "category",
  "attributes.currency",
  "attributes.merchant",
  "attributes.amount",
];

/** An assembled inbox item carries everything filing needs, so nothing is read twice. */
export type ClassifiableCapture = Pick<
  InboxItem,
  "category" | "content" | "factValues" | "source" | "sourceItemId"
>;

/**
 * The record the evaluator reads, shaped like the envelope a rule was written against.
 *
 * `attributes.*` come from derived facts rather than `source_items.attributes`, which no adapter
 * populates. That is also why a Gmail capture can still be filed on an amount or a merchant: the
 * pipeline extracted those from the body server-side, so the signal survives even though the body
 * itself never reaches the device.
 */
export function classificationItemFor(capture: ClassifiableCapture): Record<string, unknown> {
  const attributes: Record<string, string> = {};
  for (const kind of ["amount", "currency", "merchant"] as const) {
    const value = capture.factValues[kind];
    if (value !== undefined) attributes[kind] = value;
  }

  return {
    attributes,
    // The retained subject is this device's own record of what arrived; the server column is a
    // normalized copy of the same thing. Either answers the field.
    ...((capture.content?.subject ?? capture.source.subject) === undefined
      ? {}
      : { subject: capture.content?.subject ?? capture.source.subject }),
    ...(capture.content?.body === undefined ? {} : { body: capture.content.body }),
    ...(capture.source.sender === undefined ? {} : { sender: capture.source.sender }),
    source: {
      kind: capture.source.kind,
      ...(capture.source.applicationId === undefined
        ? {}
        : { applicationId: capture.source.applicationId }),
    },
  };
}

/** What this device can read for one capture. `body` only when it kept its own copy. */
export function availableFieldsFor(capture: ClassifiableCapture): Set<FilterField> {
  const fields = new Set<FilterField>(DEVICE_READABLE_FIELDS);
  if (capture.content?.body !== undefined) fields.add("body");
  return fields;
}

/**
 * The rules to try, newest revision of each series, in a stable order.
 *
 * Ordered by name so the sequence is the one a person sees in the Rules tab, and broken by series id
 * so two rules sharing a name still resolve the same way on every device and every run.
 */
export function classifiableRules(revisions: readonly FilterRuleVersion[]): ClassifiableRule[] {
  const newest = new Map<string, FilterRuleVersion>();
  for (const revision of revisions) {
    const current = newest.get(revision.seriesId);
    if (current === undefined || revision.version > current.version) {
      newest.set(revision.seriesId, revision);
    }
  }

  return [...newest.values()]
    .filter((revision) => revision.enabled)
    .sort((left, right) =>
      left.name === right.name
        ? left.seriesId.localeCompare(right.seriesId)
        : left.name.localeCompare(right.name),
    )
    .map((revision) => ({
      categoryId: revision.categoryId,
      id: revision.id,
      plan: revision.plan,
    }));
}

/**
 * A capture whose device classification no longer follows from any rule.
 *
 * Withdrawal is what makes filing reversible. A rule that is disabled or edited so it no longer
 * matches must stop filing, or the inbox keeps asserting a category no rule would now produce.
 */
export type ClassificationWithdrawal = { sourceItemId: string };

export type ClassificationWrite = {
  categoryId: string | undefined;
  filterRuleId: string;
  rationale: string | undefined;
  sourceItemId: string;
};

/**
 * The classifications worth writing.
 *
 * Only a capture whose decision actually changed is written. Without this every inbox open would
 * supersede every row and the history that makes a re-filing explainable would fill with rows saying
 * the same thing.
 *
 * A capture the server already classified is left alone. A device refines its own earlier answer but
 * never overrules one made where the whole payload was readable -- the database enforces that too,
 * and agreeing with it here saves a round trip rather than relying on it.
 */
export function classificationPass(
  captures: readonly ClassifiableCapture[],
  rules: readonly ClassifiableRule[],
): { withdrawals: ClassificationWithdrawal[]; writes: ClassificationWrite[] } {
  const writes: ClassificationWrite[] = [];
  const withdrawals: ClassificationWithdrawal[] = [];
  const seen = new Set<string>();

  for (const capture of captures) {
    // Several events can derive from one capture, and a capture is filed once.
    if (seen.has(capture.sourceItemId)) continue;
    seen.add(capture.sourceItemId);

    const existing = capture.category;
    if (existing?.origin === "server") continue;

    const outcome =
      rules.length === 0
        ? ({ kind: "unfiled" } as const)
        : classifyCapture(rules, classificationItemFor(capture), availableFieldsFor(capture));

    if (outcome.kind === "filed") {
      // Already filed here by this device. Rewriting would supersede a row with an identical one
      // and fill the history that explains a re-filing with entries that explain nothing.
      if (existing !== undefined && existing.filterRuleId === outcome.filterRuleId) continue;
      writes.push({
        categoryId: outcome.categoryId,
        filterRuleId: outcome.filterRuleId,
        rationale: classificationRationale(outcome.matchedPredicates),
        sourceItemId: capture.sourceItemId,
      });
      continue;
    }

    // Nothing claims it any more. `unfiled` withdraws; an undecidable outcome does not, because a
    // rule this device merely cannot evaluate is not evidence that the earlier decision was wrong.
    if (outcome.kind === "unfiled" && existing !== undefined) {
      withdrawals.push({ sourceItemId: capture.sourceItemId });
    }
  }

  return { withdrawals, writes };
}

/** Why a capture is not filed, for a card to state plainly instead of leaving a gap. */
export function unfiledReason(outcome: CaptureClassification): string | undefined {
  if (outcome.kind === "awaiting-model") {
    return "A rule needs a model to decide this one.";
  }
  if (outcome.kind === "field-unavailable") {
    return outcome.fields.includes("body")
      ? "A rule reads the message body, which this device cannot read for this capture."
      : "A rule reads something this device cannot read for this capture.";
  }
  return undefined;
}
