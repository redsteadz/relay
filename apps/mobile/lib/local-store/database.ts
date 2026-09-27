/**
 * Opening, migrating, pruning and clearing the device's derived store.
 *
 * Reads and writes of individual rows are not here. This module owns the database's lifecycle so the
 * feature modules that query it never have to decide whether it is open or how far it is migrated.
 *
 * Android is the only platform that captures, so it is the only platform with anything to derive.
 * `expo-sqlite` does have a web implementation, but opening a store on web would create a second,
 * emptier source of truth for a build that cannot capture, so the store reports itself unavailable
 * there instead -- the same shape as `requireOptionalNativeModule` returning null for the ingress
 * module.
 */

import { AppError } from "@relay/observability";
import type { SQLiteDatabase } from "expo-sqlite";
import { Platform } from "react-native";

import { logMobileError } from "../observability";

import {
  CAPTURE_SCOPED_TABLES,
  LOCAL_STORE_DATABASE_NAME,
  LOCAL_STORE_MIGRATIONS,
  LOCAL_STORE_TABLES,
} from "./schema";
import { openSqliteDatabase } from "./driver";
import { capturesToPrune, type PrunableCapture, type PruneBounds } from "./retention";

/**
 * The slice of `expo-sqlite` this store uses.
 *
 * Declared structurally rather than aliasing `SQLiteDatabase` so the statements themselves can be
 * executed against any SQLite in a test. The assertion below keeps the two from drifting: if
 * `expo-sqlite` changes one of these signatures, this file stops compiling rather than the store
 * failing on a device.
 */
export type LocalStoreTransaction = {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: SqlParameter[]): Promise<unknown>;
};

export type LocalStore = {
  execAsync(source: string): Promise<void>;
  getAllAsync<Row>(source: string, params: SqlParameter[]): Promise<Row[]>;
  getFirstAsync<Row>(source: string, params: SqlParameter[]): Promise<Row | null>;
  runAsync(source: string, params: SqlParameter[]): Promise<unknown>;
  withExclusiveTransactionAsync(task: (txn: LocalStoreTransaction) => Promise<void>): Promise<void>;
};

/** What a statement may be bound to. Blobs are deliberately absent: this store holds no ciphertext. */
export type SqlParameter = number | string | null;

// A compile-time check that the real database still satisfies the narrowed contract.
const _satisfiesLocalStore = (database: SQLiteDatabase): LocalStore => database;
void _satisfiesLocalStore;

export function localStoreSupported(): boolean {
  return Platform.OS !== "web";
}

function localStoreError(cause: unknown, operation: string, code: string): AppError {
  const normalized = new AppError("Local store operation failed", {
    category: "database",
    cause,
    code,
    integration: "expo-sqlite",
    operation,
    retryable: false,
  });
  logMobileError("database.local_store_failed", normalized, {
    code: normalized.code,
    integration: "expo-sqlite",
    operation,
  });
  return normalized;
}

/**
 * Applies every migration the database has not yet run, each in its own transaction.
 *
 * `user_version` is read and written inside the same exclusive transaction as the statements it
 * describes, so a process killed mid-migration resumes at the step it had actually completed rather
 * than at the one it had started.
 */
export async function migrateLocalStore(database: LocalStore): Promise<number> {
  const row = await database.getFirstAsync<{ user_version: number }>("PRAGMA user_version", []);
  let version = row?.user_version ?? 0;

  for (let index = version; index < LOCAL_STORE_MIGRATIONS.length; index += 1) {
    const statements = LOCAL_STORE_MIGRATIONS[index] ?? [];
    const next = index + 1;
    await database.withExclusiveTransactionAsync(async (transaction) => {
      for (const statement of statements) await transaction.execAsync(statement);
      // PRAGMA does not accept a bound parameter, and `next` is a loop index over a module constant.
      await transaction.execAsync(`PRAGMA user_version = ${next}`);
    });
    version = next;
  }

  return version;
}

let opening: Promise<LocalStore> | undefined;

/**
 * The store, opened once per process and migrated before first use.
 *
 * A failed open clears the memo so a later attempt can retry rather than resolving the same
 * rejection for the lifetime of the app.
 */
export function openLocalStore(): Promise<LocalStore> {
  if (!localStoreSupported()) {
    return Promise.reject(
      localStoreError(undefined, "openLocalStore", "LOCAL_STORE_UNSUPPORTED_PLATFORM"),
    );
  }
  opening ??= (async () => {
    const database = await openSqliteDatabase(LOCAL_STORE_DATABASE_NAME);
    // Write-ahead logging so a capture arriving while the inbox reads does not block on it, and
    // foreign-key enforcement left off deliberately: retention deletes a capture's children
    // explicitly so the order is visible here rather than implied by the schema.
    await database.execAsync("PRAGMA journal_mode = WAL");
    await migrateLocalStore(database);
    return database;
  })().catch((error: unknown) => {
    opening = undefined;
    throw localStoreError(error, "openLocalStore", "LOCAL_STORE_OPEN_FAILED");
  });
  return opening;
}

/** SQLite's default `SQLITE_MAX_VARIABLE_NUMBER` is 999; this leaves room for the tenant binding. */
const DELETE_CHUNK = 500;

/** Drops this tenant's captures that retention no longer covers, and everything derived from them. */
export async function pruneLocalStore(
  database: LocalStore,
  tenantId: string,
  now = Date.now(),
  bounds: PruneBounds = {},
): Promise<number> {
  try {
    const rows = await database.getAllAsync<{ captured_at: string; id: string }>(
      "SELECT id, captured_at FROM source_items WHERE tenant_id = ?",
      [tenantId],
    );
    const doomed = capturesToPrune(
      rows.map((row): PrunableCapture => ({ capturedAt: row.captured_at, sourceItemId: row.id })),
      now,
      bounds,
    );
    if (doomed.length === 0) return 0;

    await database.withExclusiveTransactionAsync(async (transaction) => {
      // Chunked so one sweep of a full store cannot exceed SQLite's bound-parameter limit.
      for (let index = 0; index < doomed.length; index += DELETE_CHUNK) {
        const chunk = doomed.slice(index, index + DELETE_CHUNK);
        const placeholders = chunk.map(() => "?").join(",");
        for (const table of CAPTURE_SCOPED_TABLES) {
          const column = table === "source_items" ? "id" : "source_item_id";
          await transaction.runAsync(
            `DELETE FROM ${table} WHERE tenant_id = ? AND ${column} IN (${placeholders})`,
            [tenantId, ...chunk],
          );
        }
      }
    });
    return doomed.length;
  } catch (error: unknown) {
    throw localStoreError(error, "pruneLocalStore", "LOCAL_STORE_PRUNE_FAILED");
  }
}

/**
 * Removes everything this store holds for one tenant.
 *
 * Called where `clearCaptureQueue` is called, so signing out or deleting an account leaves the
 * derived rows no more behind than it leaves the capture queue.
 *
 * Rows are deleted per tenant rather than the file being dropped, because one file serves every
 * tenant that has signed in on this device, exactly as `relay-capture.db` does.
 */
export async function clearLocalStoreTenant(database: LocalStore, tenantId: string): Promise<void> {
  try {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      for (const table of LOCAL_STORE_TABLES) {
        await transaction.runAsync(`DELETE FROM ${table} WHERE tenant_id = ?`, [tenantId]);
      }
    });
  } catch (error: unknown) {
    throw localStoreError(error, "clearLocalStoreTenant", "LOCAL_STORE_CLEAR_FAILED");
  }
}

/** Opens the store if this platform has one and clears the tenant. Used by the sign-out path. */
export async function clearLocalStoreForTenant(tenantId: string): Promise<void> {
  if (!localStoreSupported()) return;
  const database = await openLocalStore();
  await clearLocalStoreTenant(database, tenantId);
}
