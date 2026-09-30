import type { FilterPlan } from "@relay/contracts";
import { compileFilterPlan } from "@relay/domain";
import { describe, expect, it } from "vitest";

import { classifiableRules } from "@/features/inbox/models/deviceClassification";

import { classifiableRuleRows, classifyDemoCapture } from "./classify";
import { demoUuid } from "./ids";
import { emptyTables, type DemoRow } from "./types";

const CATEGORIES = [
  { name: "Deliveries", slug: "delivery" },
  { name: "Household", slug: "household" },
];

function ruleRow(series: string, categoryId: string): DemoRow {
  return {
    category_id: categoryId,
    enabled: true,
    id: demoUuid(`rule:${series}`),
    intent: "app is com.example.parcels",
    name: "Parcels",
    plan: compileFilterPlan("app is com.example.parcels", CATEGORIES).plan,
    series_id: demoUuid(`series:${series}`),
    version: 1,
  };
}

/**
 * Filing is first-match-wins, so rule order is part of the decision. Two rules sharing a name are
 * the case where an order that only compared names would depend on insertion order, and so could
 * file the same capture differently here than on a device.
 */
describe("demo filing order", () => {
  const first = ruleRow("first", demoUuid("category:delivery"));
  const second = ruleRow("second", demoUuid("category:household"));
  const rows = [first, second];

  it("tries rules in exactly the order the device pass does", () => {
    const device = classifiableRules(
      rows.map((row) => ({
        categoryId: row.category_id as string,
        enabled: true,
        id: row.id as string,
        name: row.name as string,
        plan: row.plan as FilterPlan,
        seriesId: row.series_id as string,
        version: 1,
      })),
    );
    expect(classifiableRuleRows(rows).map((rule) => rule.id)).toEqual(
      device.map((rule) => rule.id),
    );
    // The same answer whichever order the rows were stored in.
    expect(classifiableRuleRows([...rows].reverse()).map((rule) => rule.id)).toEqual(
      device.map((rule) => rule.id),
    );
  });

  it("files a capture by the rule a device would have chosen", () => {
    const tables = { ...emptyTables(), filter_rules: [second, first] };
    const winner = [first, second].sort((left, right) =>
      (left.series_id as string).localeCompare(right.series_id as string),
    )[0];

    const filed = classifyDemoCapture(
      tables,
      { applicationId: "com.example.parcels", sourceKind: "notification" },
      demoUuid("capture:parcel"),
      "2026-09-30T12:00:00.000Z",
    );
    expect(filed.outcome.kind).toBe("filed");
    expect(filed.row?.filter_rule_id).toBe(winner?.id);
    expect(filed.row?.category_id).toBe(winner?.category_id);
  });
});
