/**
 * The only place `expo-sqlite` is imported as a value.
 *
 * Metro resolves `driver.web.ts` ahead of this file for a web bundle, and that matters more than it
 * looks: `expo-sqlite`'s web implementation imports `wa-sqlite.wasm`, which the web export cannot
 * resolve without wasm asset configuration. Isolating the import here means the web bundle never
 * reaches it, rather than the whole export failing over a store web does not have.
 *
 * `database.ts` imports the type separately with `import type`, which is erased, so it stays platform
 * neutral.
 */

import * as SQLite from "expo-sqlite";

export function openSqliteDatabase(name: string): Promise<SQLite.SQLiteDatabase> {
  return SQLite.openDatabaseAsync(name);
}
