import { describe, expect, it } from "vitest";

import { classifyDemoCapture } from "./classify";
import { applyCapture } from "./ingest";
import { DEMO_SCENARIOS, demoScenario } from "./scenarios";
import { seedTables } from "./seed";
import type { DemoRow, DemoTables } from "./types";

const NOW = Date.parse("2026-09-07T12:00:00.000Z");

function categoryNameFor(tables: DemoTables, id: unknown): string | undefined {
  const row = tables.categories?.find((category) => category.id === id);
  return typeof row?.name === "string" ? row.name : undefined;
}

/** What each scenario is meant to demonstrate, stated as the outcome it must actually reach. */
const EXPECTED: Readonly<Record<string, { category?: string; kind: string }>> = {
  "boarding-pass": { kind: "unfiled" },
  "calendar-invite": { kind: "unfiled" },
  "card-payment": { category: "Transactions", kind: "filed" },
  "conflicting-dates": { kind: "unfiled" },
  "gmail-receipt": { kind: "field-unavailable" },
  "parcel-delivery": { category: "Deliveries", kind: "filed" },
  promotion: { category: "Promotions", kind: "filed" },
  "verification-code": { category: "Security", kind: "filed" },
  "work-message": { category: "Communication", kind: "filed" },
};

describe("demo seed", () => {
  it("compiles every seeded rule to a plan that can decide something", () => {
    const tables = seedTables(NOW);
    const rules = tables.filter_rules ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      const plan = rule.plan as { deterministic?: unknown; semantic?: unknown };
      // A rule that compiled to `never` would appear in the list and quietly decide nothing.
      expect(plan.deterministic).not.toEqual({ never: true });
      expect(plan.deterministic ?? plan.semantic).toBeDefined();
    }
  });

  it("opens on an inbox that already reaches every outcome the screen can show", () => {
    const tables = seedTables(NOW);
    const events = tables.relay_events ?? [];
    const filed = new Set(
      (tables.classifications ?? []).map((row) => row.source_item_id as string),
    );

    expect(events.some((event) => event.due_at !== null || event.starts_at !== null)).toBe(true);
    expect(events.some((event) => event.date_ambiguity !== null)).toBe(true);
    expect(events.some((event) => filed.has(event.source_item_id as string))).toBe(true);
    expect(events.some((event) => !filed.has(event.source_item_id as string))).toBe(true);
    expect((tables.action_runs ?? []).some((run) => run.status === "awaiting-approval")).toBe(true);
    expect((tables.audit_log ?? []).length).toBeGreaterThan(0);
  });

  it("keeps a device classification recorded as one", () => {
    const tables = seedTables(NOW);
    for (const row of tables.classifications ?? []) {
      expect(row.origin).toBe("device");
      expect(row.method).toBe("deterministic");
      expect(row.superseded_at).toBeNull();
    }
  });
});

describe("demo scenarios", () => {
  it("covers every scenario in the catalogue", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(
      DEMO_SCENARIOS.map((scenario) => scenario.id).sort(),
    );
  });

  for (const scenario of DEMO_SCENARIOS) {
    it(`files "${scenario.label}" the way the studio says it will`, () => {
      const tables = seedTables(NOW);
      const built = demoScenario(scenario.id);
      expect(built).toBeDefined();
      const input = (built as NonNullable<typeof built>).build(NOW, 0);
      const capture = applyCapture(tables, input);
      const filed = classifyDemoCapture(
        tables,
        input,
        capture.sourceItemId,
        new Date(NOW).toISOString(),
      );

      const expected = EXPECTED[scenario.id];
      expect(expected).toBeDefined();
      expect(filed.outcome.kind).toBe(expected?.kind);
      if (expected?.category === undefined) {
        expect(filed.row).toBeUndefined();
        return;
      }
      const row = filed.row as DemoRow;
      expect(categoryNameFor(tables, row.category_id)).toBe(expected.category);
      expect(row.rationale).toEqual(expect.stringContaining("Matched"));
    });
  }

  it("derives facts and an event for every capture it generates", () => {
    const tables = seedTables(NOW);
    for (const scenario of DEMO_SCENARIOS) {
      const capture = applyCapture(tables, scenario.build(NOW, 1));
      expect(capture.factCount).toBeGreaterThan(0);
      expect(capture.eventIds.length).toBeGreaterThan(0);
    }
  });

  it("proposes an action only for a capture that carries a deadline", () => {
    const tables = seedTables(NOW);
    const delivery = applyCapture(tables, DEMO_SCENARIOS[1].build(NOW, 2));
    const promotion = applyCapture(
      tables,
      (demoScenario("promotion") as NonNullable<ReturnType<typeof demoScenario>>).build(NOW, 2),
    );
    expect(delivery.proposedActions).toBe(1);
    expect(promotion.proposedActions).toBe(0);
  });
});
