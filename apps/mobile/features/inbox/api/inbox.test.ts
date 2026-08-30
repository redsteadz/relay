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
        const builder = {
          limit: () => Promise.resolve(results[table] ?? { data: [], error: null }),
          order: () => builder,
          select: () => builder,
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

    expect(calls.sort()).toEqual(["relay_events", "source_facts"]);
    expect(items.map((item) => item.origin).sort()).toEqual(["event", "fact"]);
    expect(items.find((item) => item.origin === "event")?.group).toBe("actionable");
    expect(items.find((item) => item.origin === "fact")?.group).toBe("needs-review");
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
