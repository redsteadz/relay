import type { LocalStore } from "./database";

/**
 * What this reader removed from their inbox, mirrored locally.
 *
 * The server owns `hidden_inbox_events`; this is the device's copy of it, and it exists because the
 * inbox is now read locally first. Without it a cold start would redraw an item the reader had
 * already removed, for as long as it took the PostgREST read to answer and say so again.
 *
 * Hiding stays reversible, so a restore deletes the row rather than flagging it -- the same shape as
 * the server table, which `restoreInboxEvent` deletes from.
 */
export async function setLocalHidden(
  database: LocalStore,
  tenantId: string,
  eventId: string,
  hidden: boolean,
  now = new Date().toISOString(),
): Promise<void> {
  if (hidden) {
    await database.runAsync(
      `INSERT INTO hidden_inbox_events (tenant_id, event_id, hidden_at)
       VALUES (?, ?, ?)
       ON CONFLICT (tenant_id, event_id) DO UPDATE SET hidden_at = excluded.hidden_at`,
      [tenantId, eventId, now],
    );
    return;
  }
  await database.runAsync("DELETE FROM hidden_inbox_events WHERE tenant_id = ? AND event_id = ?", [
    tenantId,
    eventId,
  ]);
}
