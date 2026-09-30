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

import {
  classifiableRules,
  DEVICE_READABLE_FIELDS,
} from "../../features/inbox/models/deviceClassification";
import { DEMO_USER_ID } from "./account";
import { demoRandomUuid } from "./ids";
import type { DemoCaptureInput } from "./ingest";
import type { DemoRow, DemoTables } from "./types";

/**
 * The newest enabled revision of each series, in the order the device pass tries them.
 *
 * Classification is first-match-wins, so the order is part of the decision. It comes from the
 * shipped `classifiableRules` rather than a copy, which is what keeps two rules sharing a name
 * resolving the same way here as on a real device.
 */
export function classifiableRuleRows(rows: readonly DemoRow[]): ClassifiableRule[] {
  return classifiableRules(
    rows.map((row) => ({
      ...(typeof row.category_id === "string" ? { categoryId: row.category_id } : {}),
      enabled: row.enabled === true,
      id: row.id as string,
      name: row.name as string,
      plan: row.plan as FilterPlan,
      seriesId: row.series_id as string,
      version: row.version as number,
    })),
  );
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

  const available = new Set<FilterField>(DEVICE_READABLE_FIELDS);
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
