/**
 * The web build has no local store.
 *
 * Android is the only platform that captures, so it is the only platform with anything to derive.
 * Opening a store here would create a second, emptier source of truth for a build that cannot
 * capture, and it would pull `expo-sqlite`'s wasm implementation into the web export, which cannot
 * resolve it. Callers reach this only by ignoring `localStoreSupported`, so it fails rather than
 * pretending to have opened something.
 *
 * Typed as the driver's signature while ignoring the argument, so web and native stay interchangeable
 * without naming a parameter this implementation has no use for.
 */

import type { SQLiteDatabase } from "expo-sqlite";

export const openSqliteDatabase: (name: string) => Promise<SQLiteDatabase> = () =>
  Promise.reject(new Error("The local store is unavailable on web"));
