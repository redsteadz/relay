import type { IngressEnvelope } from "@relay/contracts";

export * from "./facts.js";
export * from "./events.js";
export * from "./filter-compiler.js";
export * from "./filter-evaluator.js";

// Shared by contentFingerprint and normalizeCategoryName. The filter evaluator keeps its own copy
// so the two can be versioned independently: this one feeds persisted fingerprints and category
// uniqueness, and changing it would invalidate stored values.
function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

export function sourceIdentity(item: IngressEnvelope): string {
  return JSON.stringify([item.source.kind, item.source.accountId ?? null, item.source.externalId]);
}

export async function contentFingerprint(item: IngressEnvelope): Promise<string> {
  const canonical = [
    item.source.kind,
    item.source.applicationId ?? "",
    normalizeText(item.sender ?? ""),
    normalizeText(item.subject ?? ""),
    normalizeText(item.body ?? ""),
  ].join("\u001f");
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Canonical category-name normalization: Unicode NFKC, trim, collapse internal whitespace runs to a
 * single space, lowercase.
 *
 * This mirrors the `normalized_name` stored generated column added in
 * `supabase/migrations/202608290002_custom_categories.sql`, which backs the tenant-unique index on
 * category names. The database remains the authority for uniqueness; this exists so a client can
 * predict a collision before issuing a write, and so the rule has one documented definition on each
 * side of the wire.
 */
export function normalizeCategoryName(value: string): string {
  return normalizeText(value);
}
