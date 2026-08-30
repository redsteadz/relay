export type QueueTimeFilter = "all" | "hour" | "today";

export type SourceQueueItem = {
  attempts: number;
  capturedAt: string;
  id: string;
  label: string;
  searchText: string;
  status: "Pending";
  summary: string;
};

export function filterQueueItems(
  items: readonly SourceQueueItem[],
  query: string,
  filter: QueueTimeFilter,
  now = Date.now(),
): SourceQueueItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const threshold = filter === "hour" ? now - 60 * 60 * 1_000 : today.getTime();

  return items.filter((item) => {
    const matchesSearch =
      normalizedQuery.length === 0 || item.searchText.toLocaleLowerCase().includes(normalizedQuery);
    if (!matchesSearch || filter === "all") return matchesSearch;
    const capturedAt = Date.parse(item.capturedAt);
    return Number.isFinite(capturedAt) && capturedAt >= threshold;
  });
}

export function formatQueueTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(timestamp);
}
