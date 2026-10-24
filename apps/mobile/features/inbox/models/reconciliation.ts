import type { InboxItem } from "./inboxPresentation";

/** Server identities include hidden events. Only captures still awaiting upload supplement a read. */
export function reconcileInbox(
  server: readonly InboxItem[] | undefined,
  local: readonly InboxItem[],
  pendingSourceIds: ReadonlySet<string>,
  observedSourceIds: readonly string[] = [],
): readonly InboxItem[] {
  if (server === undefined) return local;
  const known = new Set([...observedSourceIds, ...server.map((item) => item.sourceItemId)]);
  return [
    ...server,
    ...local.filter(
      (item) => pendingSourceIds.has(item.sourceItemId) && !known.has(item.sourceItemId),
    ),
  ];
}
