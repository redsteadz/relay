import { describe, expect, it } from "vitest";

import {
  CAPTURE_SCOPED_TABLES,
  FORBIDDEN_LOCAL_COLUMNS,
  LOCAL_STORE_MIGRATIONS,
  LOCAL_STORE_SCHEMA_VERSION,
  LOCAL_STORE_TABLES,
} from "./schema";

const statements = LOCAL_STORE_MIGRATIONS.flat();
const ddl = statements.join("\n");

/**
 * The narrow slice of `node:sqlite` these tests use.
 *
 * Declared here rather than pulled from `@types/node`, which this app does not and should not carry:
 * the mobile runtime is Hermes, and the only reason Node's SQLite appears at all is that it lets the
 * schema be executed rather than pattern-matched during a unit test.
 */
type SqliteStatement = {
  all: () => readonly Record<string, unknown>[];
  run: (...parameters: readonly string[]) => void;
};

type SqliteDatabase = {
  close: () => void;
  exec: (source: string) => void;
  prepare: (source: string) => SqliteStatement;
};

type SqliteConstructor = new (path: string) => SqliteDatabase;

/**
 * `node:sqlite` is unflagged from Node 23 and needs `--experimental-sqlite` on the pinned 22.x, so
 * the cases that execute the schema skip rather than silently passing where it is absent. The
 * structural assertions below always run. The specifier is held in a variable so the bundler does not
 * try to resolve a Node builtin for a React Native target.
 */
const sqlite = await (async (): Promise<SqliteConstructor | undefined> => {
  const specifier = "node:sqlite";
  try {
    const loaded = (await import(specifier)) as { DatabaseSync?: SqliteConstructor };
    return loaded.DatabaseSync;
  } catch {
    return undefined;
  }
})();

function migratedDatabase(): SqliteDatabase {
  if (sqlite === undefined) throw new Error("node:sqlite unavailable");
  const database = new sqlite(":memory:");
  for (const statement of statements) database.exec(statement);
  return database;
}

describe("local store schema", () => {
  it("has one migration per schema version", () => {
    expect(LOCAL_STORE_MIGRATIONS).toHaveLength(LOCAL_STORE_SCHEMA_VERSION);
  });

  it("creates every table it claims to clear", () => {
    for (const table of LOCAL_STORE_TABLES) {
      expect(ddl).toContain(`CREATE TABLE ${table} (`);
    }
  });

  it("scopes every table by tenant", () => {
    const created = statements.filter((statement) => statement.startsWith("CREATE TABLE "));
    expect(created).toHaveLength(LOCAL_STORE_TABLES.length);
    for (const statement of created) expect(statement).toContain("tenant_id TEXT NOT NULL");
  });

  it("derives capture-scoped tables from the full table list", () => {
    for (const table of CAPTURE_SCOPED_TABLES) expect(LOCAL_STORE_TABLES).toContain(table);
  });

  it("deletes source_items last so a capture outlives its children during a sweep", () => {
    expect(CAPTURE_SCOPED_TABLES.at(-1)).toBe("source_items");
  });

  // The privacy decision for this store is that it holds no source text: the readable copy of what a
  // capture said stays in capture_content under a per-tenant Keystore key. That is a property of the
  // schema, so it is asserted as one rather than left to review.
  it("holds no column that could become a second home for source content or a secret", () => {
    for (const column of FORBIDDEN_LOCAL_COLUMNS) {
      expect(ddl).not.toMatch(new RegExp(`\\b${column}\\b`, "u"));
    }
  });
});

describe.skipIf(sqlite === undefined)("local store schema, executed", () => {
  it("is valid SQLite that applies cleanly from empty", () => {
    const database = migratedDatabase();
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name as string);
    database.close();
    expect(tables).toEqual([...LOCAL_STORE_TABLES].sort());
  });

  it("allows one current classification per capture and refuses a second", () => {
    const database = migratedDatabase();
    const insert = `INSERT INTO classifications
      (tenant_id, id, source_item_id, method, origin, created_at)
      VALUES ('t', ?, 'capture-1', 'deterministic', 'device', '2026-09-27T12:00:00Z')`;
    database.prepare(insert).run("first");
    expect(() => database.prepare(insert).run("second")).toThrow(/UNIQUE/iu);

    // Superseding the first frees the slot, which is what makes re-filing possible at all.
    database
      .prepare(
        "UPDATE classifications SET superseded_at = '2026-09-27T12:00:01Z' WHERE id = 'first'",
      )
      .run();
    expect(() => database.prepare(insert).run("second")).not.toThrow();
    database.close();
  });

  it("refuses a device classification that claims a semantic method", () => {
    const database = migratedDatabase();
    expect(() =>
      database
        .prepare(
          `INSERT INTO classifications
             (tenant_id, id, source_item_id, method, origin, created_at)
           VALUES ('t', 'x', 'capture-1', 'semantic', 'device', '2026-09-27T12:00:00Z')`,
        )
        .run(),
    ).toThrow(/CHECK/iu);
    database.close();
  });

  it("keeps two tenants' rows from colliding on the same capture id", () => {
    const database = migratedDatabase();
    const insert = `INSERT INTO source_items
      (tenant_id, id, source, occurred_at, captured_at, created_at)
      VALUES (?, 'shared-id', 'notification', '2026-09-27T12:00:00Z', '2026-09-27T12:00:00Z', '2026-09-27T12:00:00Z')`;
    database.prepare(insert).run("tenant-a");
    expect(() => database.prepare(insert).run("tenant-b")).not.toThrow();
    expect(() => database.prepare(insert).run("tenant-a")).toThrow(/UNIQUE/iu);
    database.close();
  });

  it("stores one derivation of a capture once per normalizer and extractor version", () => {
    const database = migratedDatabase();
    const insert = `INSERT INTO relay_events
      (tenant_id, id, source_item_id, normalizer_version, extractor_version, ordinal, kind, title,
       temporal_status, created_at)
      VALUES ('t', ?, 'capture-1', 2, 1, 0, 'fact', 'Source fact', 'none', '2026-09-27T12:00:00Z')`;
    database.prepare(insert).run("event-1");
    expect(() => database.prepare(insert).run("event-2")).toThrow(/UNIQUE/iu);
    database.close();
  });
});
