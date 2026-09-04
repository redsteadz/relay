import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listFilterRevisions, saveFilterRule } from "./filters";

const planRow = {
  compilerVersion: 1,
  deterministic: { field: "source.kind", operator: "equals", value: "sms" },
  intent: "Receipts from my bank",
  schemaVersion: 1,
};

const revisionRow = {
  created_at: "2026-08-29T10:00:00Z",
  enabled: true,
  id: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
  intent: "Receipts from my bank",
  name: "Receipts",
  plan: planRow,
  series_id: "06f96f7d-3e1a-4a66-b98e-58be9766b96e",
  user_id: "638ce145-a77d-4c32-b798-cb398e881fc9",
  version: 1,
};

function supabaseReturning(result: { data: unknown; error: unknown }) {
  const order = vi.fn();
  const chain = { order };
  order.mockReturnValueOnce(chain).mockReturnValueOnce(Promise.resolve(result));
  const select = vi.fn().mockReturnValue(chain);
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as unknown as SupabaseClient, from, select };
}

describe("filter revision reads", () => {
  it("reads revisions under row-level security, not through the Relay API", async () => {
    const { client, from, select } = supabaseReturning({ data: [revisionRow], error: null });
    const revisions = await listFilterRevisions(client);

    expect(from).toHaveBeenCalledWith("filter_rules");
    // No user filter is sent: the select policy scopes rows to the caller, and a client-side
    // predicate would imply the app is the one enforcing tenancy.
    expect(select.mock.calls[0]?.[0]).toContain("series_id");
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      seriesId: "06f96f7d-3e1a-4a66-b98e-58be9766b96e",
      version: 1,
    });
  });

  it("refuses a stored plan that no longer satisfies the contract", async () => {
    // A rule that cannot be parsed must not render as one that means something else.
    const { client } = supabaseReturning({
      data: [{ ...revisionRow, plan: { ...planRow, compilerVersion: 99 } }],
      error: null,
    });
    await expect(listFilterRevisions(client)).rejects.toMatchObject({
      code: "FILTER_RULE_QUERY_FAILED",
    });
  });

  it("surfaces a database failure as a typed error", async () => {
    const { client } = supabaseReturning({ data: null, error: { code: "PGRST301" } });
    await expect(listFilterRevisions(client)).rejects.toMatchObject({
      code: "FILTER_RULE_QUERY_FAILED",
    });
  });
});

describe("filter rule writes", () => {
  beforeEach(() => vi.stubEnv("EXPO_PUBLIC_API_URL", "https://api.relay.test"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const compiled = {
    rule: {
      createdAt: "2026-08-29T10:00:00Z",
      enabled: true,
      id: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
      intent: "Receipts from my bank",
      name: "Receipts",
      plan: planRow,
      seriesId: "06f96f7d-3e1a-4a66-b98e-58be9766b96e",
      userId: "638ce145-a77d-4c32-b798-cb398e881fc9",
      version: 1,
    },
    supportedPredicates: [{ field: "sender", operators: ["contains"] }],
    unsupportedClauses: [],
  };

  it("saves through the Relay API, never by writing the table directly", async () => {
    // `insert` on filter_rules is revoked from every role; the API compiles in the pipeline and a
    // security-definer function is the only writer. A client cannot store a plan of its own.
    const fetchMock = vi.fn().mockResolvedValue(Response.json(compiled, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const saved = await saveFilterRule("token", {
      intent: "Receipts from my bank",
      name: "Receipts",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.relay.test/api/filters/compile");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(saved.rule.version).toBe(1);
  });

  it("sends the revision pair so a concurrent edit conflicts instead of overwriting", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(compiled, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await saveFilterRule("token", {
      expectedVersion: 2,
      intent: "Receipts from my bank",
      name: "Receipts",
      seriesId: "06f96f7d-3e1a-4a66-b98e-58be9766b96e",
    });

    const init = fetchMock.mock.calls[0]?.[1] as { body?: string } | undefined;
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    expect(body.expectedVersion).toBe(2);
    expect(body.seriesId).toBe("06f96f7d-3e1a-4a66-b98e-58be9766b96e");
  });

  it("carries the conflict code so the editor can explain a lost update", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: { code: "filter_revision_conflict" } }, { status: 409 }),
        ),
    );
    await expect(
      saveFilterRule("token", { intent: "Receipts", name: "Receipts" }),
    ).rejects.toMatchObject({ apiCode: "filter_revision_conflict" });
  });

  it("refuses a compilation response that does not satisfy the contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ rule: { name: "Receipts" } }, { status: 201 })),
    );
    await expect(
      saveFilterRule("token", { intent: "Receipts", name: "Receipts" }),
    ).rejects.toMatchObject({ reason: "malformed-response" });
  });
});
