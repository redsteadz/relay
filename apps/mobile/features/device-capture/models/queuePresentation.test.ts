import { describe, expect, it } from "vitest";

import { filterQueueItems, type SourceQueueItem } from "./queuePresentation";

const items: SourceQueueItem[] = [
  {
    attempts: 0,
    capturedAt: "2026-08-30T09:30:00.000Z",
    id: "stable-envelope-id",
    label: "Example app",
    searchText: "Example app pending",
    status: "Pending",
    summary: "Notification captured",
  },
  {
    attempts: 2,
    capturedAt: "2026-08-29T08:00:00.000Z",
    id: "older-envelope-id",
    label: "Another app",
    searchText: "Another app pending",
    status: "Pending",
    summary: "Notification captured",
  },
];

describe("queue presentation", () => {
  it("filters real queue metadata without searching message bodies", () => {
    expect(filterQueueItems(items, "example", "all")).toEqual([items[0]]);
    expect(filterQueueItems(items, "secret body", "all")).toEqual([]);
  });

  it("filters recent items and preserves stable envelope keys", () => {
    const now = Date.parse("2026-08-30T10:00:00.000Z");
    expect(filterQueueItems(items, "", "hour", now).map((item) => item.id)).toEqual([
      "stable-envelope-id",
    ]);
  });
});
