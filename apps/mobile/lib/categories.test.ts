import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { CategoryError } from "./categories";
import {
  categoryFailureFor,
  createCategory,
  deleteCategory,
  listCategories,
  toCategory,
  updateCategory,
} from "./categories";

type QueryResult = { data: unknown; error: { code?: string } | null };

/**
 * Minimal PostgREST builder stand-in. Every builder method returns the same chainable object, and
 * the object is thenable, so both `await builder.order(...)` and `builder.select(...).single()`
 * resolve to the configured result.
 */
function clientReturning(result: QueryResult) {
  const chain: Record<string, ReturnType<typeof vi.fn>> & {
    then?: unknown;
  } = {};
  for (const method of ["select", "is", "eq", "insert", "update", "delete", "order"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(result));
  (chain as { then: unknown }).then = (
    onFulfilled: (value: QueryResult) => unknown,
    onRejected: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  const from = vi.fn(() => chain);
  return { chain, client: { from } as unknown as SupabaseClient, from };
}

const systemRow = {
  archived_at: null,
  description: null,
  id: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
  is_system: true,
  name: "Transactions",
  quiet_by_default: false,
  slug: "transaction",
  sort_order: 0,
};

describe("toCategory", () => {
  it("maps database columns onto the contract shape", () => {
    expect(toCategory(systemRow)).toEqual({
      id: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
      slug: "transaction",
      name: "Transactions",
      isSystem: true,
      quietByDefault: false,
      sortOrder: 0,
    });
  });

  it("accepts the microsecond offset timestamps PostgREST actually returns", () => {
    expect(
      toCategory({ ...systemRow, archived_at: "2026-08-29T09:39:06.589181+00:00" }).archivedAt,
    ).toBe("2026-08-29T09:39:06.589181+00:00");
  });
});

describe("categoryFailureFor", () => {
  it.each([
    ["23505", "duplicate-name"],
    ["23503", "archive-required"],
    ["42501", "protected-system-category"],
    ["08006", "unavailable"],
    [undefined, "unavailable"],
  ])("maps SQLSTATE %s to %s", (code, expected) => {
    expect(categoryFailureFor(code)).toBe(expected);
  });
});

describe("listCategories", () => {
  it("hides archived categories and orders deterministically by default", async () => {
    const { chain, client, from } = clientReturning({ data: [systemRow], error: null });

    await expect(listCategories(client)).resolves.toEqual([
      {
        id: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
        slug: "transaction",
        name: "Transactions",
        isSystem: true,
        quietByDefault: false,
        sortOrder: 0,
      },
    ]);
    expect(from).toHaveBeenCalledWith("categories");
    expect(chain.is).toHaveBeenCalledWith("archived_at", null);
    expect(chain.order).toHaveBeenNthCalledWith(1, "sort_order", { ascending: true });
    expect(chain.order).toHaveBeenNthCalledWith(2, "id", { ascending: true });
  });

  it("includes archived categories on request", async () => {
    const { chain, client } = clientReturning({ data: [], error: null });

    await listCategories(client, { includeArchived: true });

    expect(chain.is).not.toHaveBeenCalled();
  });

  it("reports a fixed reason without reflecting database detail", async () => {
    const { client } = clientReturning({
      data: null,
      error: { code: "42501", message: "row-level security policy for table categories" } as {
        code?: string;
      },
    });

    await expect(listCategories(client)).rejects.toMatchObject({
      reason: "protected-system-category",
    });
    await expect(listCategories(client)).rejects.toSatisfy(
      (error: CategoryError) => !error.message.includes("row-level security"),
    );
  });
});

describe("createCategory", () => {
  it("binds the tenant and applies documented defaults", async () => {
    const { chain, client } = clientReturning({
      data: { ...systemRow, is_system: false, name: "Work", slug: "work" },
      error: null,
    });

    await createCategory(client, "60000000-0000-4000-8000-000000000001", {
      slug: "work",
      name: "Work",
    });

    expect(chain.insert).toHaveBeenCalledWith({
      user_id: "60000000-0000-4000-8000-000000000001",
      slug: "work",
      name: "Work",
      description: null,
      quiet_by_default: false,
      sort_order: 0,
    });
  });

  it("surfaces a tenant-unique name collision", async () => {
    const { client } = clientReturning({ data: null, error: { code: "23505" } });

    await expect(
      createCategory(client, "60000000-0000-4000-8000-000000000001", {
        slug: "work-2",
        name: "  WORK  ",
      }),
    ).rejects.toMatchObject({ reason: "duplicate-name" });
  });
});

describe("updateCategory", () => {
  it("patches only the fields the caller supplied", async () => {
    const { chain, client } = clientReturning({
      data: { ...systemRow, is_system: false, name: "Renamed", sort_order: 3 },
      error: null,
    });

    await updateCategory(client, systemRow.id, { name: "Renamed", sortOrder: 3 });

    expect(chain.update).toHaveBeenCalledWith({ name: "Renamed", sort_order: 3 });
    expect(chain.eq).toHaveBeenCalledWith("id", systemRow.id);
  });

  it("archives with a timestamp and restores with null", async () => {
    const archived = clientReturning({
      data: { ...systemRow, is_system: false, archived_at: "2026-08-29T10:00:00.000Z" },
      error: null,
    });
    await updateCategory(
      archived.client,
      systemRow.id,
      { archived: true },
      () => "2026-08-29T10:00:00.000Z",
    );
    expect(archived.chain.update).toHaveBeenCalledWith({
      archived_at: "2026-08-29T10:00:00.000Z",
    });

    const restored = clientReturning({ data: { ...systemRow, is_system: false }, error: null });
    await updateCategory(restored.client, systemRow.id, { archived: false });
    expect(restored.chain.update).toHaveBeenCalledWith({ archived_at: null });
  });

  it("reports the system-category guard", async () => {
    const { client } = clientReturning({ data: null, error: { code: "42501" } });

    await expect(
      updateCategory(client, systemRow.id, { name: "Renamed system" }),
    ).rejects.toMatchObject({ reason: "protected-system-category" });
  });
});

describe("deleteCategory", () => {
  it("resolves when the database accepts the removal", async () => {
    const { chain, client } = clientReturning({ data: null, error: null });

    await expect(deleteCategory(client, systemRow.id)).resolves.toBeUndefined();
    expect(chain.delete).toHaveBeenCalled();
    expect(chain.eq).toHaveBeenCalledWith("id", systemRow.id);
  });

  it("tells the caller to archive when classifications still reference the category", async () => {
    const { client } = clientReturning({ data: null, error: { code: "23503" } });

    await expect(deleteCategory(client, systemRow.id)).rejects.toMatchObject({
      reason: "archive-required",
    });
  });
});
