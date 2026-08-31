import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/observability", () => ({ logMobileError: vi.fn() }));

import { listInbox } from "./inbox";

type Result = { data: unknown[] | null; error: unknown };

function client(results: Record<string, Result>) {
  const calls: string[] = [];
  return {
    calls,
    supabase: {
      from(table: string) {
        calls.push(table);
        const settle = () => Promise.resolve(results[table] ?? { data: [], error: null });
        // PostgREST query builders are thenable, so a query that ends without `limit` still awaits.
        const builder = {
          limit: settle,
          order: () => builder,
          select: () => builder,
          then: (resolve: (value: unknown) => unknown) => settle().then(resolve),
        };
        return builder;
      },
    },
  };
}

const eventRow = {
  confidence: 0.9,
  created_at: "2026-08-30T21:00:00.000Z",
  date_ambiguity: null,
  due_at: null,
  id: "11111111-1111-4111-8111-111111111111",
  kind: "task",
  requires_review: false,
  source_item_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  starts_at: "2026-09-01T09:00:00.000Z",
  summary: "Summary",
  temporal_status: "resolved",
  title: "Review the statement",
};

const factRow = {
  certainty: "uncertain",
  created_at: "2026-08-30T21:00:00.000Z",
  id: "22222222-2222-4222-8222-222222222222",
  kind: "amount",
  source_item_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  uncertainty_reason: "contradictory",
  value: "42.50",
};

describe("listInbox", () => {
  it("reads events and facts as separate observations", async () => {
    const { calls, supabase } = client({
      relay_events: { data: [eventRow], error: null },
      source_facts: { data: [factRow], error: null },
    });

    const items = await listInbox(supabase as never);

    expect(calls.sort()).toEqual([
      "categories",
      "classifications",
      "relay_events",
      "source_facts",
      "source_items",
    ]);
    expect(items.map((item) => item.origin).sort()).toEqual(["event", "fact"]);
    expect(items.find((item) => item.origin === "event")?.group).toBe("actionable");
    expect(items.find((item) => item.origin === "fact")?.group).toBe("needs-review");
  });

  it("explains where an item came from and which decision placed it", async () => {
    const { supabase } = client({
      categories: { data: [{ id: "cat-1", name: "Finance" }], error: null },
      classifications: {
        data: [
          {
            category_id: "cat-1",
            confidence: 0.77,
            method: "deterministic",
            rationale: "Rule 3",
            source_item_id: eventRow.source_item_id,
          },
        ],
        error: null,
      },
      relay_events: { data: [eventRow], error: null },
      source_facts: { data: [], error: null },
      source_items: {
        data: [
          {
            application_id: "com.google.android.gm",
            id: eventRow.source_item_id,
            occurred_at: "2026-08-30T20:59:00.000Z",
            processed_at: "2026-08-30T21:00:05.000Z",
            raw_expires_at: "2026-09-06T21:00:00.000Z",
            sender: "billing@example.test",
            source: "notification",
            subject: "Statement ready",
          },
        ],
        error: null,
      },
    });

    const [item] = await listInbox(supabase as never, "2026-08-31T00:00:00.000Z");

    expect(item?.source.kind).toBe("notification");
    expect(item?.source.applicationId).toBe("com.google.android.gm");
    expect(item?.category).toEqual({
      confidence: 0.77,
      method: "deterministic",
      name: "Finance",
      rationale: "Rule 3",
    });
    expect(item?.processing).toBe("processed");
    expect(item?.retention.rawExpired).toBe(false);
  });

  it("marks a raw payload that has already expired", async () => {
    const { supabase } = client({
      relay_events: { data: [eventRow], error: null },
      source_facts: { data: [], error: null },
      source_items: {
        data: [
          {
            application_id: null,
            id: eventRow.source_item_id,
            occurred_at: "2026-08-01T00:00:00.000Z",
            processed_at: null,
            raw_expires_at: "2026-08-08T00:00:00.000Z",
            sender: null,
            source: "notification",
            subject: null,
          },
        ],
        error: null,
      },
    });

    const [item] = await listInbox(supabase as never, "2026-08-31T00:00:00.000Z");

    expect(item?.retention.rawExpired).toBe(true);
    expect(item?.processing).toBe("pending");
  });

  it("states an unknown source rather than dropping an item whose source row is gone", async () => {
    const { supabase } = client({
      relay_events: { data: [eventRow], error: null },
      source_facts: { data: [], error: null },
      source_items: { data: [], error: null },
    });

    const [item] = await listInbox(supabase as never);

    expect(item?.source.kind).toBe("unknown");
    expect(item?.category).toBeUndefined();
  });

  it("reports a failed event read without leaking the row payload", async () => {
    const { supabase } = client({
      relay_events: { data: null, error: { code: "PGRST301", message: "denied" } },
      source_facts: { data: [], error: null },
    });

    await expect(listInbox(supabase as never)).rejects.toMatchObject({
      code: "INBOX_READ_FAILED",
      name: "InboxError",
      operation: "listRelayEvents",
      retryable: true,
    });
  });

  it("reports a failed fact read distinctly from an event read", async () => {
    const { supabase } = client({
      relay_events: { data: [], error: null },
      source_facts: { data: null, error: { code: "PGRST301" } },
    });

    await expect(listInbox(supabase as never)).rejects.toMatchObject({
      operation: "listSourceFacts",
    });
  });

  it("treats an empty tenant as an empty inbox rather than an error", async () => {
    const { supabase } = client({
      relay_events: { data: [], error: null },
      source_facts: { data: [], error: null },
    });

    await expect(listInbox(supabase as never)).resolves.toEqual([]);
  });
});
