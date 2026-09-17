import { afterEach, describe, expect, it, vi } from "vitest";

import { filterPlanSchema, ingressEnvelopeSchema } from "@relay/contracts";

import { evaluateFilterPlan, readFilterField } from "@relay/domain";

import { activeRules, classificationItem, classifyCapture } from "../src/classification";

const USER = "208455fe-e5ae-4dc3-b416-40c7186ac6b2";

function envelope(overrides: Record<string, unknown> = {}) {
  return ingressEnvelopeSchema.parse({
    schemaVersion: 1,
    id: "cf4c3c89-0a15-4edb-94df-77786bcddd01",
    occurredAt: "2026-09-01T09:00:00Z",
    capturedAt: "2026-09-01T09:00:00Z",
    source: { kind: "notification", externalId: "n1", applicationId: "com.example.shop" },
    sender: "Deals",
    subject: "50% off everything",
    body: "Unsubscribe at any time",
    attributes: { amount: "10.00" },
    ...overrides,
  });
}

const deterministicPlan = {
  compilerVersion: 1,
  deterministic: { field: "subject", operator: "contains", value: "off" },
  intent: "subject contains off",
  schemaVersion: 1,
};

const configuration = {
  supabase: { serviceRoleKey: "sb_secret_synthetic", url: "https://project.supabase.test" },
};

/** Answers the rule read, then records every write for inspection. */
function backend(rules: unknown[]) {
  const writes: { body: unknown; url: string }[] = [];
  const fetcher = vi.fn((input: unknown, init?: { body?: string; method?: string }) => {
    const url = String(input);
    if (url.includes("/filter_rules")) {
      return Promise.resolve(new Response(JSON.stringify(rules), { status: 200 }));
    }
    if (url.includes("/classifications")) {
      writes.push({ body: JSON.parse(init?.body ?? "{}"), url });
      return Promise.resolve(new Response("", { status: 201 }));
    }
    return Promise.resolve(new Response("[]", { status: 200 }));
  });
  return { fetcher, writes };
}

describe("classificationItem", () => {
  /**
   * This asserted the flat keys the module used to build, which read correctly to a person and
   * resolved to nothing through `readFilterField`. Asserting the shape was what made the bug look
   * deliberate, so it now asserts what the evaluator can actually read.
   */
  it("exposes the fields a rule may test, through the reader the evaluator uses", () => {
    const item = classificationItem(envelope());

    expect(readFilterField(item, "source.kind")).toBe("notification");
    expect(readFilterField(item, "source.applicationId")).toBe("com.example.shop");
    expect(readFilterField(item, "attributes.amount")).toBe("10.00");
    expect(readFilterField(item, "subject")).toBe("50% off everything");
  });

  it("omits a field the capture did not carry rather than passing an empty one", () => {
    const item = classificationItem(envelope({ subject: undefined, body: undefined }));
    expect("subject" in item).toBe(false);
    expect("body" in item).toBe(false);
  });

  // The regression itself: a rule reading a dotted field has to match here exactly as it does in the
  // rule editor's preview and on the device.
  it("matches a plan written against a dotted field", () => {
    const item = classificationItem(envelope());
    const plan = filterPlanSchema.parse({
      schemaVersion: 1,
      compilerVersion: 1,
      intent: "from a notification",
      deterministic: { field: "source.kind", operator: "equals", value: "notification" },
    });

    expect(evaluateFilterPlan(plan, item).decision).toBe("match");
  });
});

describe("activeRules", () => {
  const row = (seriesId: string, version: number, id = `${seriesId}-${version.toString()}`) => ({
    category_id: null,
    id,
    plan: deterministicPlan,
    series_id: seriesId,
    version,
  });

  it("keeps only the newest version of each rule series", () => {
    const active = activeRules([row("a", 1), row("a", 3), row("a", 2)]);
    expect(active).toHaveLength(1);
    expect(active[0]?.version).toBe(3);
  });

  it("keeps distinct series apart", () => {
    expect(activeRules([row("a", 1), row("b", 1)])).toHaveLength(2);
  });

  it("orders rules stably so identical captures meet the same rule first", () => {
    const once = activeRules([row("b", 1), row("a", 1)]).map((rule) => rule.series_id);
    const twice = activeRules([row("a", 1), row("b", 1)]).map((rule) => rule.series_id);
    expect(once).toEqual(twice);
  });
});

describe("classifyCapture", () => {
  it("files a capture into the category of the first matching rule", async () => {
    const { fetcher, writes } = backend([
      { category_id: "cat-1", id: "rule-1", plan: deterministicPlan, series_id: "s1", version: 1 },
    ]);
    vi.stubGlobal("fetch", fetcher);

    const outcome = await classifyCapture(configuration as never, envelope(), USER, {});

    expect(outcome).toMatchObject({
      categoryId: "cat-1",
      method: "deterministic",
      status: "stored",
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.body).toMatchObject({
      category_id: "cat-1",
      method: "deterministic",
      source_item_id: "cf4c3c89-0a15-4edb-94df-77786bcddd01",
      user_id: USER,
    });
    vi.unstubAllGlobals();
  });

  it("records no classification when no rule matches", async () => {
    const plan = {
      ...deterministicPlan,
      deterministic: { field: "subject", operator: "contains", value: "invoice" },
    };
    const { fetcher, writes } = backend([
      { category_id: "cat-1", id: "rule-1", plan, series_id: "s1", version: 1 },
    ]);
    vi.stubGlobal("fetch", fetcher);

    expect(await classifyCapture(configuration as never, envelope(), USER, {})).toEqual({
      status: "unmatched",
    });
    expect(writes).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it("skips a stored plan that no longer satisfies the contract without failing the capture", async () => {
    const { fetcher, writes } = backend([
      { category_id: null, id: "broken", plan: { nonsense: true }, series_id: "s0", version: 1 },
      { category_id: "cat-1", id: "rule-1", plan: deterministicPlan, series_id: "s1", version: 1 },
    ]);
    vi.stubGlobal("fetch", fetcher);

    const outcome = await classifyCapture(configuration as never, envelope(), USER, {});
    expect(outcome).toMatchObject({ ruleId: "rule-1", status: "stored" });
    expect(writes).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("never records a rationale carrying the content that decided it", async () => {
    const { fetcher, writes } = backend([
      { category_id: "cat-1", id: "rule-1", plan: deterministicPlan, series_id: "s1", version: 1 },
    ]);
    vi.stubGlobal("fetch", fetcher);

    await classifyCapture(configuration as never, envelope(), USER, {});
    const rationale = String((writes[0]?.body as { rationale: string }).rationale);
    expect(rationale).not.toContain("50% off everything");
    expect(rationale).not.toContain("Unsubscribe");
    expect(rationale).toContain("rule-1");
    vi.unstubAllGlobals();
  });

  it("reports a tenant with no rules as skipped rather than unmatched", async () => {
    const { fetcher } = backend([]);
    vi.stubGlobal("fetch", fetcher);
    expect(await classifyCapture(configuration as never, envelope(), USER, {})).toEqual({
      reason: "no-rules",
      status: "skipped",
    });
    vi.unstubAllGlobals();
  });

  it("does nothing when persistence is not configured", async () => {
    expect(await classifyCapture({} as never, envelope(), USER, {})).toEqual({
      reason: "not-configured",
      status: "skipped",
    });
  });
});

type RuleRow = {
  category_id: string | null;
  id: string;
  plan: unknown;
  series_id: string;
  version: number;
};

const unmatchedPlan = {
  ...deterministicPlan,
  deterministic: { field: "subject", operator: "contains", value: "invoice" },
  intent: "subject contains invoice",
};

function rule(seriesId: string, version: number, plan: unknown, categoryId?: string): RuleRow {
  return {
    category_id: categoryId ?? null,
    id: `${seriesId}-${version.toString()}`,
    plan,
    series_id: seriesId,
    version,
  };
}

/** `series_id` wide enough to sort lexicographically in creation order. */
const series = (index: number): string => `s${index.toString().padStart(3, "0")}`;

/**
 * A `filter_rules` stand-in that honours `order`, `limit` and a `series_id` cursor.
 *
 * #204 was a query-shape defect: the rows the pipeline never evaluated were dropped by PostgREST,
 * before any code in this repository saw them. The `backend` helper above answers every read with
 * every row it was given, so it cannot observe that class of bug at all -- which is why the rule
 * loader had passing tests while silently losing whole rule series. This fake sorts and pages the
 * way PostgREST does, so what is asserted is the query the pipeline actually issues.
 */
function pagedBackend(rows: readonly RuleRow[]) {
  const requests: URL[] = [];
  const writes: { body: unknown; url: string }[] = [];

  const compare = (left: RuleRow, right: RuleRow, order: readonly string[]): number => {
    for (const term of order) {
      const [field = "", direction = "asc"] = term.split(".");
      const leftValue = left[field as keyof RuleRow];
      const rightValue = right[field as keyof RuleRow];
      const result =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue));
      if (result !== 0) return direction === "desc" ? -result : result;
    }
    return 0;
  };

  const fetcher = vi.fn((input: unknown, init?: { body?: string; method?: string }) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/filter_rules")) {
      requests.push(url);
      let matching = [...rows];
      const cursor = url.searchParams.get("series_id");
      if (cursor !== null && cursor.startsWith("gt.")) {
        const after = cursor.slice(3);
        matching = matching.filter((row) => row.series_id > after);
      }
      const order = (url.searchParams.get("order") ?? "").split(",").filter((term) => term !== "");
      matching.sort((left, right) => compare(left, right, order));
      const limit = Number(url.searchParams.get("limit") ?? String(matching.length));
      return Promise.resolve(
        new Response(JSON.stringify(matching.slice(0, limit)), { status: 200 }),
      );
    }
    if (url.pathname.endsWith("/classifications")) {
      writes.push({ body: JSON.parse(init?.body ?? "{}"), url: String(input) });
      return Promise.resolve(new Response("", { status: 201 }));
    }
    return Promise.resolve(new Response("[]", { status: 200 }));
  });

  return { fetcher, requests, writes };
}

describe("loadActiveRules", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /**
   * The defect in #204, as reported: one rule edited past the cap hid every other rule.
   *
   * `version` is per series, not global, so a global `version.desc` sort ranks one series' edit
   * history above every other tenant rule. Sixty revisions rather than the reported fifty so the
   * fiftieth-highest version is still above rule B's version 1, which keeps the reproduction free
   * of a sort tie.
   */
  it("evaluates a rule series that a frequently edited series would have paged out", async () => {
    const edited = Array.from({ length: 60 }, (_, index) =>
      rule(series(0), index + 1, unmatchedPlan),
    );
    const { fetcher, writes } = pagedBackend([
      ...edited,
      rule(series(1), 1, deterministicPlan, "cat-2"),
    ]);
    vi.stubGlobal("fetch", fetcher);

    const outcome = await classifyCapture(configuration as never, envelope(), USER, {});

    expect(outcome).toMatchObject({
      categoryId: "cat-2",
      ruleId: `${series(1)}-1`,
      status: "stored",
    });
    expect(writes).toHaveLength(1);
  });

  /**
   * The cap has to bound rules, which is what its comment claims, rather than bound rows. Forty-nine
   * noisy series of twenty revisions each puts 980 rows ahead of the only rule that matches, so the
   * capture is filed only if the read pages by series instead of stopping at a row count.
   */
  it("reaches every series within the cap even when revisions outnumber a page", async () => {
    const noisy = Array.from({ length: 49 }, (_, seriesIndex) =>
      Array.from({ length: 20 }, (_, index) => rule(series(seriesIndex), index + 1, unmatchedPlan)),
    ).flat();
    const { fetcher, requests } = pagedBackend([
      ...noisy,
      rule(series(49), 1, deterministicPlan, "cat-2"),
    ]);
    vi.stubGlobal("fetch", fetcher);

    const outcome = await classifyCapture(configuration as never, envelope(), USER, {});

    expect(outcome).toMatchObject({ ruleId: `${series(49)}-1`, status: "stored" });
    // Ordered so the newest revision of a series is the first row of its group, which is what makes
    // a cursor on `series_id` safe to advance past rows it has not read.
    for (const request of requests) {
      expect(request.searchParams.get("order")).toBe("series_id.asc,version.desc");
    }
  });

  it("keeps the newest revision of a series rather than the one a page happened to end on", async () => {
    const { fetcher, writes } = pagedBackend([
      rule(series(0), 1, unmatchedPlan, "cat-old"),
      rule(series(0), 2, deterministicPlan, "cat-new"),
    ]);
    vi.stubGlobal("fetch", fetcher);

    await classifyCapture(configuration as never, envelope(), USER, {});

    expect(writes[0]?.body).toMatchObject({ category_id: "cat-new" });
  });

  it("logs a bounded count when the cap truncates the ruleset, naming no rule", async () => {
    const rows = Array.from({ length: 60 }, (_, index) => rule(series(index), 1, unmatchedPlan));
    const { fetcher } = pagedBackend(rows);
    vi.stubGlobal("fetch", fetcher);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await classifyCapture(configuration as never, envelope(), USER, {});

    expect(warn).toHaveBeenCalledOnce();
    const entry = warn.mock.calls[0]?.[0] as string;
    expect(JSON.parse(entry)).toMatchObject({
      event: "ingress.rule_cap_reached",
      level: "warn",
      namespace: "relay:pipeline",
      ruleSeriesEvaluated: 50,
    });
    // A count and nothing else: no rule id, no intent, and no tenant identifier.
    expect(entry).not.toContain(series(0));
    expect(entry).not.toContain("subject contains invoice");
    expect(entry).not.toContain(USER);
  });

  it("stays silent when the ruleset fits within the cap", async () => {
    const { fetcher } = pagedBackend([rule(series(0), 1, deterministicPlan, "cat-1")]);
    vi.stubGlobal("fetch", fetcher);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await classifyCapture(configuration as never, envelope(), USER, {});

    expect(warn).not.toHaveBeenCalled();
  });
});
