import {
  categorySchema,
  type Category,
  type CategoryCreateRequest,
  type CategoryUpdateRequest,
} from "@relay/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

// Categories are tenant-owned and reachable directly under row-level security, so this module talks
// to PostgREST rather than the Relay API. Every invariant it surfaces is enforced by the database
// (see supabase/migrations/202608290002_custom_categories.sql); this layer only translates the
// resulting SQLSTATE into something a screen can explain, and never decides access itself.
const categoryColumns =
  "id, slug, name, description, is_system, quiet_by_default, sort_order, archived_at";

export type CategoryFailure =
  "archive-required" | "duplicate-name" | "protected-system-category" | "unavailable";

export class CategoryError extends Error {
  constructor(readonly reason: CategoryFailure) {
    super("Category request failed");
  }
}

type CategoryRow = {
  archived_at: string | null;
  description: string | null;
  id: string;
  is_system: boolean;
  name: string;
  quiet_by_default: boolean;
  slug: string;
  sort_order: number;
};

export function toCategory(row: CategoryRow): Category {
  return categorySchema.parse({
    id: row.id,
    slug: row.slug,
    name: row.name,
    ...(row.description === null ? {} : { description: row.description }),
    isSystem: row.is_system,
    quietByDefault: row.quiet_by_default,
    sortOrder: row.sort_order,
    ...(row.archived_at === null ? {} : { archivedAt: row.archived_at }),
  });
}

/**
 * Maps a PostgREST error to a fixed reason.
 *
 * `23505` is the tenant-unique normalized-name index, `23503` is the trigger refusing to delete a
 * category that still explains historical classifications, and `42501` covers both the system-row
 * guards and a row-level security rejection. Unknown codes stay `unavailable` so no database detail
 * reaches the interface.
 */
export function categoryFailureFor(code: string | undefined): CategoryFailure {
  if (code === "23505") return "duplicate-name";
  if (code === "23503") return "archive-required";
  if (code === "42501") return "protected-system-category";
  return "unavailable";
}

export async function listCategories(
  client: SupabaseClient,
  options: { includeArchived?: boolean } = {},
): Promise<Category[]> {
  let query = client.from("categories").select(categoryColumns);
  if (options.includeArchived !== true) query = query.is("archived_at", null);
  const { data, error } = await query
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error !== null) throw new CategoryError(categoryFailureFor(error.code));
  return (data as CategoryRow[]).map(toCategory);
}

export async function createCategory(
  client: SupabaseClient,
  userId: string,
  request: CategoryCreateRequest,
): Promise<Category> {
  const { data, error } = await client
    .from("categories")
    .insert({
      user_id: userId,
      slug: request.slug,
      name: request.name,
      description: request.description ?? null,
      quiet_by_default: request.quietByDefault ?? false,
      sort_order: request.sortOrder ?? 0,
    })
    .select(categoryColumns)
    .single();
  if (error !== null) throw new CategoryError(categoryFailureFor(error.code));
  return toCategory(data);
}

export async function updateCategory(
  client: SupabaseClient,
  id: string,
  request: CategoryUpdateRequest,
  now: () => string = () => new Date().toISOString(),
): Promise<Category> {
  const patch: Record<string, unknown> = {};
  if (request.name !== undefined) patch.name = request.name;
  if (request.description !== undefined) patch.description = request.description;
  if (request.quietByDefault !== undefined) patch.quiet_by_default = request.quietByDefault;
  if (request.sortOrder !== undefined) patch.sort_order = request.sortOrder;
  if (request.archived !== undefined) patch.archived_at = request.archived ? now() : null;

  const { data, error } = await client
    .from("categories")
    .update(patch)
    .eq("id", id)
    .select(categoryColumns)
    .single();
  if (error !== null) throw new CategoryError(categoryFailureFor(error.code));
  return toCategory(data);
}

/**
 * Permanent removal. The database refuses this for system categories and for any category that
 * still has classifications, so callers should offer archiving as the ordinary way to retire one.
 */
export async function deleteCategory(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from("categories").delete().eq("id", id);
  if (error !== null) throw new CategoryError(categoryFailureFor(error.code));
}
