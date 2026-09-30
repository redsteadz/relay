/**
 * The shape of the demo's local store.
 *
 * Rows are kept in the column vocabulary PostgREST would return rather than in a friendlier local
 * shape, because the readers are the shipped feature modules: `features/inbox/api/inbox.ts` selects
 * `raw_expires_at` and `attributes->>gmailThreadId`, and it has to keep doing so unchanged.
 */
export type DemoRow = Record<string, unknown>;

export type DemoTables = Record<string, DemoRow[]>;

/** Every table the app reads or writes. Named here so seeding and resetting cannot miss one. */
export const DEMO_TABLES = [
  "account_deletions",
  "action_rules",
  "action_runs",
  "audit_log",
  "capture_settings",
  "categories",
  "classifications",
  "connections",
  "disclosures",
  "filter_rules",
  "hidden_inbox_events",
  "openai_credentials",
  "relay_events",
  "retained_content",
  "source_facts",
  "source_items",
] as const;

export function emptyTables(): DemoTables {
  const tables: DemoTables = {};
  for (const table of DEMO_TABLES) tables[table] = [];
  return tables;
}
