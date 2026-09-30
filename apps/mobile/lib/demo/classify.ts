/**
 * Filing a demo capture with the shipped classifier.
 *
 * `classifyCapture` is the same decision the device pass makes in `useInbox`, run here so a capture
 * is already filed by the time someone switches tabs to look at it -- and so the Demo studio can say
 * which rule claimed it, or why none did, in the words the receipt uses.
 *
 * The evaluation record is built from the capture's own input rather than from the stored rows,
 * because that is the same information the inbox reassembles: what it said, who sent it, which
 * application produced it, and the values the normalizer derived.
 */

import type { FilterField, FilterPlan } from "@relay/contracts";
import {
  classificationRationale,
  classifyCapture,
  filterItem,
  type CaptureClassification,
  type ClassifiableRule,
} from "@relay/domain";

import { DEMO_USER_ID } from "./account";
import { demoRandomUuid } from "./ids";
import type { DemoCaptureInput } from "./ingest";
import type { DemoRow, DemoTables } from "./types";

/** Fields a phone can always read. `body` is added per capture, when this device kept a copy. */
const DEVICE_FIELDS: readonly FilterField[] = [
  "source.kind",
  "source.applicationId",
  "sender",
  "subject",
  "category",
  "attributes.currency",
  "attributes.merchant",
  "attributes.amount",
];

/** The newest enabled revision of each series, in the order the classifier expects. */
export function classifiableRuleRows(rows: readonly DemoRow[]): ClassifiableRule[] {
  const newest = new Map<string, DemoRow>();
  for (const row of rows) {
    const current = newest.get(row.series_id as string);
    if (current === undefined || (row.version as number) > (current.version as number)) {
      newest.set(row.series_id as string, row);
    }
  }
  return [...newest.values()]
    .filter((row) => row.enabled === true)
    .sort((left, right) => (left.name as string).localeCompare(right.name as string))
    .map((row) => ({
      categoryId: (row.category_id as string | null) ?? undefined,
      id: row.id as string,
      plan: row.plan as FilterPlan,
    }));
}

export type DemoClassification = {
  outcome: CaptureClassification;
  row: DemoRow | undefined;
};

export function classifyDemoCapture(
  tables: DemoTables,
  input: DemoCaptureInput,
  sourceItemId: string,
  createdAt: string,
): DemoClassification {
  const attributes = input.attributes ?? {};
  const record = filterItem({
    attributes: {
      ...(typeof attributes.amount === "string" ? { amount: attributes.amount } : {}),
      ...(typeof attributes.currency === "string" ? { currency: attributes.currency } : {}),
      ...(typeof attributes.merchant === "string" ? { merchant: attributes.merchant } : {}),
    },
    ...(input.retainContent === false || input.body === undefined ? {} : { body: input.body }),
    ...(input.sender === undefined ? {} : { sender: input.sender }),
    source: {
      ...(input.applicationId === undefined ? {} : { applicationId: input.applicationId }),
      kind: input.sourceKind,
    },
    ...(input.subject === undefined ? {} : { subject: input.subject }),
  });

  const available = new Set<FilterField>(DEVICE_FIELDS);
  if (input.retainContent !== false && input.body !== undefined) available.add("body");

  const outcome = classifyCapture(
    classifiableRuleRows(tables.filter_rules ?? []),
    record,
    available,
  );
  if (outcome.kind !== "filed") return { outcome, row: undefined };
  return {
    outcome,
    row: {
      category_id: outcome.categoryId ?? null,
      confidence: 1,
      created_at: createdAt,
      filter_rule_id: outcome.filterRuleId,
      id: demoRandomUuid(),
      method: "deterministic",
      origin: "device",
      rationale: classificationRationale(outcome.matchedPredicates) ?? null,
      source_item_id: sourceItemId,
      superseded_at: null,
      user_id: DEMO_USER_ID,
    },
  };
}
