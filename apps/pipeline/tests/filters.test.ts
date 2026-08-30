import { describe, expect, it, vi } from "vitest";

import type { PersistenceConfiguration } from "../src/configuration";
import { compileAndPersistFilter } from "../src/filters";

const configuration: PersistenceConfiguration = {
  environment: "development",
  keyring: { activeVersion: 1, keys: {} },
  supabase: {
    url: "https://supabase.example.test",
    serviceRoleKey: "sb_secret_synthetic_backend_key_12345",
  },
};
const userId = "638ce145-a77d-4c32-b798-cb398e881fc9";
const id = "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8";
const seriesId = "06f96f7d-3e1a-4a66-b98e-58be9766b96e";

function requestUrl(input: string | URL | Request | undefined): URL {
  if (typeof input === "string") return new URL(input);
  if (input instanceof URL) return input;
  if (input instanceof Request) return new URL(input.url);
  throw new Error("Expected a request URL");
}

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
  const parsed: unknown = JSON.parse(init.body);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object request body");
  }
  return parsed as Record<string, unknown>;
}

function storedRevision(body: Record<string, unknown>) {
  return {
    id,
    user_id: userId,
    series_id: seriesId,
    version: 1,
    name: body.p_name,
    intent: body.p_intent,
    plan: body.p_plan,
    supported_predicates: body.p_supported_predicates,
    unsupported_clauses: body.p_unsupported_clauses,
    enabled: body.p_enabled,
    created_at: "2026-08-29T12:00:00.000Z",
  };
}

describe("compileAndPersistFilter", () => {
  it("loads active tenant categories and persists a validated immutable revision", async () => {
    const fetcher = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(Response.json([{ slug: "travel-deals", name: "Travel Deals" }]))
      .mockImplementationOnce((_input, init) => {
        const body = requestBody(init);
        return Promise.resolve(Response.json(storedRevision(body)));
      });

    const response = await compileAndPersistFilter(
      configuration,
      { userId, name: "Travel", intent: "category is Travel Deals" },
      fetcher,
    );

    const categoriesUrl = requestUrl(fetcher.mock.calls[0]?.[0]);
    expect(categoriesUrl.pathname).toBe("/rest/v1/categories");
    expect(categoriesUrl.searchParams.get("user_id")).toBe(`eq.${userId}`);
    expect(categoriesUrl.searchParams.get("archived_at")).toBe("is.null");
    const persistence = fetcher.mock.calls[1];
    expect(requestUrl(persistence?.[0]).pathname).toBe("/rest/v1/rpc/create_filter_rule_revision");
    const persistedBody = requestBody(persistence?.[1]);
    expect(persistedBody).toMatchObject({
      p_user_id: userId,
      p_series_id: null,
      p_expected_version: null,
      p_plan: {
        schemaVersion: 1,
        compilerVersion: 1,
        deterministic: { field: "category", operator: "equals", value: "travel-deals" },
      },
    });
    expect(response.rule).toMatchObject({ seriesId, version: 1, name: "Travel" });
  });

  it("keeps action intent visible without persisting action controls", async () => {
    let persistedBody: Record<string, unknown> | undefined;
    const fetcher = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(Response.json([]))
      .mockImplementationOnce((_input, init) => {
        persistedBody = requestBody(init);
        return Promise.resolve(Response.json(storedRevision(persistedBody)));
      });

    const response = await compileAndPersistFilter(
      configuration,
      { userId, name: "Unsafe", intent: "send matches to a webhook endpoint" },
      fetcher,
    );

    expect(response.unsupportedClauses).toEqual([
      {
        text: "send matches to a webhook endpoint",
        reason: "action-intent-not-allowed",
      },
    ]);
    const serializedPlan = JSON.stringify(persistedBody?.p_plan);
    expect(serializedPlan).not.toContain('"provider"');
    expect(serializedPlan).not.toContain('"endpoint"');
    expect(serializedPlan).not.toContain('"operation"');
  });

  it("maps persistence conflicts without retaining database details", async () => {
    const fetcher = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(
        Response.json({ details: "synthetic-sensitive-database-detail" }, { status: 409 }),
      );

    await expect(
      compileAndPersistFilter(
        configuration,
        {
          userId,
          name: "Receipts",
          intent: "from gmail",
          seriesId,
          expectedVersion: 1,
        },
        fetcher,
      ),
    ).rejects.toMatchObject({
      message: "Filter compilation failed",
      reason: "filter_revision_conflict",
    });
  });
});
