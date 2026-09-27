/**
 * A local stand-in for the slice of PostgREST the app actually uses.
 *
 * The feature modules keep their real queries -- column lists, `->>` accessors, ordering, bounded
 * limits, `superseded_at is null` -- because a demo that swapped them for local shortcuts would stop
 * exercising the code that ships. What is replaced is only where the rows come from.
 *
 * It is deliberately not a database. There is no row-level security here because there is one
 * tenant, and no query planner because every table is a bounded array.
 */

import { normalizeCategoryName } from "@relay/domain";

import { demoRandomUuid } from "./ids";
import { demoDatabase } from "./store";
import type { DemoRow } from "./types";

export type DemoQueryError = {
  code: string;
  details: string | null;
  hint: string | null;
  message: string;
};

export type DemoQueryResult<T> = { data: T; error: DemoQueryError | null };

type Projection = { alias: string; column: string; key: string | undefined };
type Ordering = { ascending: boolean; column: string };
type Predicate = (row: DemoRow) => boolean;
type Mutation =
  | { kind: "delete" }
  | { kind: "insert"; rows: DemoRow[] }
  | { kind: "select" }
  | { kind: "update"; patch: DemoRow }
  | { kind: "upsert"; conflict: readonly string[]; rows: DemoRow[] };

/**
 * What the database would have supplied, and what it would have refused.
 *
 * A column with a default is not optional in a read: `categories` is selected with `is_system` and
 * `archived_at`, and a row inserted without them would fail the contract the moment it was read
 * back. The refusals matter for the same reason -- the category screen offers archiving instead of
 * deletion precisely because the database refuses to delete a category that still explains a
 * classification, and a demo where the delete silently succeeded would teach the wrong lesson.
 */
type TablePolicy = {
  defaults?: () => DemoRow;
  insertGuard?: (candidate: DemoRow, existing: readonly DemoRow[]) => DemoQueryError | undefined;
  deleteGuard?: (candidate: DemoRow) => DemoQueryError | undefined;
};

function constraint(code: string, message: string): DemoQueryError {
  return { code, details: null, hint: null, message };
}

const POLICIES: Readonly<Record<string, TablePolicy>> = {
  categories: {
    defaults: () => ({
      archived_at: null,
      created_at: new Date().toISOString(),
      description: null,
      id: demoRandomUuid(),
      is_system: false,
      quiet_by_default: false,
      sort_order: 0,
    }),
    deleteGuard: (candidate) => {
      if (candidate.is_system === true) {
        return constraint("42501", "System categories cannot be deleted");
      }
      const referenced = demoDatabase
        .rows("classifications")
        .some((row) => row.category_id === candidate.id);
      return referenced
        ? constraint("23503", "Category still explains a classification")
        : undefined;
    },
    insertGuard: (candidate, existing) => {
      const name = typeof candidate.name === "string" ? normalizeCategoryName(candidate.name) : "";
      const collides = existing.some(
        (row) => typeof row.name === "string" && normalizeCategoryName(row.name) === name,
      );
      return collides ? constraint("23505", "Category name is already in use") : undefined;
    },
  },
  hidden_inbox_events: {
    defaults: () => ({ created_at: new Date().toISOString(), id: demoRandomUuid() }),
  },
};

function parseSelect(columns: string): Projection[] {
  if (columns.trim() === "*") return [];
  return columns
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const separator = part.indexOf(":");
      if (separator === -1) return { alias: part, column: part, key: undefined };
      const alias = part.slice(0, separator).trim();
      const expression = part.slice(separator + 1).trim();
      const accessor = expression.indexOf("->>");
      if (accessor === -1) return { alias, column: expression, key: undefined };
      return {
        alias,
        column: expression.slice(0, accessor).trim(),
        key: expression.slice(accessor + 3).trim(),
      };
    });
}

/** `->>` yields text or null, which is what the callers of those aliases already expect. */
function readJsonKey(container: unknown, key: string): string | null {
  if (typeof container !== "object" || container === null) return null;
  const value = (container as Record<string, unknown>)[key];
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function project(row: DemoRow, projections: readonly Projection[]): DemoRow {
  if (projections.length === 0) return { ...row };
  const projected: DemoRow = {};
  for (const projection of projections) {
    projected[projection.alias] =
      projection.key === undefined
        ? (row[projection.column] ?? null)
        : readJsonKey(row[projection.column], projection.key);
  }
  return projected;
}

/**
 * Orders two column values.
 *
 * Only the scalar types a sorted column actually holds are compared -- timestamps and text as
 * strings, versions and ordinals as numbers. Anything else keeps its relative position rather than
 * being stringified into an order that would mean nothing.
 */
function compare(left: unknown, right: unknown): number {
  if (left === right) return 0;
  if (left === null || left === undefined) return 1;
  if (right === null || right === undefined) return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "string" && typeof right === "string") return left.localeCompare(right);
  return 0;
}

export class DemoQuery<T> implements PromiseLike<DemoQueryResult<T>> {
  private readonly orderings: Ordering[] = [];
  private readonly predicates: Predicate[] = [];
  private projections: Projection[] = [];
  private rowLimit: number | undefined;
  private cardinality: "maybe" | "one" | undefined;

  constructor(
    private readonly table: string,
    private readonly mutation: Mutation,
  ) {}

  select(columns = "*"): this {
    this.projections = parseSelect(columns);
    return this;
  }

  eq(column: string, value: unknown): this {
    this.predicates.push((row) => row[column] === value);
    return this;
  }

  is(column: string, value: null): this {
    this.predicates.push((row) => (row[column] ?? null) === value);
    return this;
  }

  in(column: string, values: readonly unknown[]): this {
    const wanted = new Set(values);
    this.predicates.push((row) => wanted.has(row[column]));
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orderings.push({ ascending: options?.ascending !== false, column });
    return this;
  }

  limit(count: number): this {
    this.rowLimit = count;
    return this;
  }

  /** Terminal shapes rather than filters, matching PostgREST's own semantics. */
  single(): this {
    this.cardinality = "one";
    return this;
  }

  maybeSingle(): this {
    this.cardinality = "maybe";
    return this;
  }

  then<TResult1 = DemoQueryResult<T>, TResult2 = never>(
    onfulfilled?: ((value: DemoQueryResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private matches(row: DemoRow): boolean {
    return this.predicates.every((predicate) => predicate(row));
  }

  private async run(): Promise<DemoQueryResult<T>> {
    await demoDatabase.ready();
    const rows = demoDatabase.rows(this.table);
    const mutation = this.mutation;
    let affected: DemoRow[];

    switch (mutation.kind) {
      case "insert": {
        const policy = POLICIES[this.table];
        affected = mutation.rows.map((row) => ({ ...policy?.defaults?.(), ...row }));
        for (const candidate of affected) {
          const refusal = policy?.insertGuard?.(candidate, rows);
          if (refusal !== undefined) return { data: null as T, error: refusal };
        }
        rows.unshift(...affected);
        demoDatabase.touch();
        break;
      }
      case "upsert": {
        const defaults = POLICIES[this.table]?.defaults;
        affected = [];
        for (const candidate of mutation.rows) {
          const existing = rows.find((row) =>
            mutation.conflict.every((column) => row[column] === candidate[column]),
          );
          // Defaults belong to the insert alone: applying them on the conflicting path would give
          // an existing row a new identity every time it was written.
          if (existing === undefined) {
            const inserted = { ...defaults?.(), ...candidate };
            rows.unshift(inserted);
            affected.push(inserted);
          } else {
            Object.assign(existing, candidate);
            affected.push(existing);
          }
        }
        demoDatabase.touch();
        break;
      }
      case "update": {
        affected = rows.filter((row) => this.matches(row));
        for (const row of affected) Object.assign(row, mutation.patch);
        demoDatabase.touch();
        break;
      }
      case "delete": {
        affected = rows.filter((row) => this.matches(row));
        const guard = POLICIES[this.table]?.deleteGuard;
        for (const candidate of affected) {
          const refusal = guard?.(candidate);
          if (refusal !== undefined) return { data: null as T, error: refusal };
        }
        demoDatabase.replace(
          this.table,
          rows.filter((row) => !affected.includes(row)),
        );
        demoDatabase.touch();
        break;
      }
      case "select": {
        affected = rows.filter((row) => this.matches(row));
        break;
      }
    }

    if (this.orderings.length > 0) {
      affected = [...affected].sort((left, right) => {
        for (const ordering of this.orderings) {
          const result = compare(left[ordering.column], right[ordering.column]);
          if (result !== 0) return ordering.ascending ? result : -result;
        }
        return 0;
      });
    }
    if (this.rowLimit !== undefined) affected = affected.slice(0, this.rowLimit);

    const projected = affected.map((row) => project(row, this.projections));
    if (this.cardinality === undefined) {
      return { data: projected as T, error: null };
    }
    if (projected.length === 1) return { data: projected[0] as T, error: null };
    if (this.cardinality === "maybe" && projected.length === 0) {
      return { data: null as T, error: null };
    }
    return {
      data: null as T,
      error: {
        code: "PGRST116",
        details: null,
        hint: null,
        message: "Demo query expected exactly one row",
      },
    };
  }
}

export function demoTableQuery(table: string) {
  return {
    delete: () => new DemoQuery<DemoRow[]>(table, { kind: "delete" }),
    insert: (payload: DemoRow | DemoRow[]) =>
      new DemoQuery<DemoRow>(table, {
        kind: "insert",
        rows: Array.isArray(payload) ? payload : [payload],
      }),
    select: (columns = "*") => new DemoQuery<DemoRow[]>(table, { kind: "select" }).select(columns),
    update: (patch: DemoRow) => new DemoQuery<DemoRow>(table, { kind: "update", patch }),
    upsert: (payload: DemoRow | DemoRow[], options?: { onConflict?: string }) =>
      new DemoQuery<DemoRow>(table, {
        conflict: (options?.onConflict ?? "id").split(",").map((column) => column.trim()),
        kind: "upsert",
        rows: Array.isArray(payload) ? payload : [payload],
      }),
  };
}
