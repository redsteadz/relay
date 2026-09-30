/**
 * A real SQLite behind the narrowed store contract, for code that runs outside a device.
 *
 * Node's built-in `node:sqlite` executes the module's own statements -- unique indexes, checks and
 * transactions included -- so a test built on it proves what the SQL does rather than what a
 * stand-in assumed. The app never imports this: Metro bundles only what is reachable, and the
 * specifier is held in a variable so no bundler tries to resolve it either.
 */

import type { LocalStore, LocalStoreTransaction, SqlParameter } from "./database";
import { LOCAL_STORE_MIGRATIONS } from "./schema";

/** The slice of `node:sqlite` this double needs. */
type SqliteStatement = {
  all: (...parameters: readonly SqlParameter[]) => readonly Record<string, unknown>[];
  get: (...parameters: readonly SqlParameter[]) => Record<string, unknown> | undefined;
  run: (...parameters: readonly SqlParameter[]) => void;
};
type SqliteDatabase = {
  close: () => void;
  exec: (source: string) => void;
  prepare: (source: string) => SqliteStatement;
};
export type NodeSqliteConstructor = new (path: string) => SqliteDatabase;

/** `node:sqlite`, or undefined on a Node release that does not ship it. */
export async function loadNodeSqlite(): Promise<NodeSqliteConstructor | undefined> {
  const specifier = "node:sqlite";
  try {
    const loaded = (await import(specifier)) as { DatabaseSync?: NodeSqliteConstructor };
    return loaded.DatabaseSync;
  } catch {
    return undefined;
  }
}

/**
 * An in-memory store.
 *
 * Migrated up front by default, for a test of the statements that run against a store. Pass
 * `migrated: false` to hand out an empty database instead, so `openLocalStore` runs the real
 * migration path -- `user_version` included -- the way it does on a first launch.
 */
export function nodeSqliteLocalStore(
  sqlite: NodeSqliteConstructor,
  options: { migrated?: boolean } = {},
): { close: () => void; store: LocalStore } {
  const database = new sqlite(":memory:");
  if (options.migrated !== false) {
    for (const statement of LOCAL_STORE_MIGRATIONS.flat()) database.exec(statement);
  }

  const transaction: LocalStoreTransaction = {
    execAsync: (source) => {
      database.exec(source);
      return Promise.resolve();
    },
    runAsync: (source, params) => {
      database.prepare(source).run(...params);
      return Promise.resolve(undefined);
    },
  };

  const store: LocalStore = {
    execAsync: (source) => transaction.execAsync(source),
    getAllAsync: <Row>(source: string, params: SqlParameter[]) =>
      Promise.resolve(database.prepare(source).all(...params) as Row[]),
    getFirstAsync: <Row>(source: string, params: SqlParameter[]) =>
      Promise.resolve((database.prepare(source).get(...params) ?? null) as Row | null),
    runAsync: (source, params) => transaction.runAsync(source, params),
    withExclusiveTransactionAsync: async (task) => {
      database.exec("BEGIN");
      try {
        await task(transaction);
        database.exec("COMMIT");
      } catch (error: unknown) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { close: () => database.close(), store };
}
