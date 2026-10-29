import { describe, expect, it } from "vitest";
import { reconcileInbox } from "./reconciliation";
import type { InboxItem } from "./inboxPresentation";

const item = (id: string, sourceItemId = id) => ({ id, sourceItemId }) as InboxItem;

describe("Inbox reconciliation", () => {
  it("keeps unsynchronized local captures with an empty or incomplete server response", () => {
    const local = item("local-event", "pending-source");
    expect(reconcileInbox([], [local], new Set(["pending-source"]))).toEqual([local]);
    const remote = item("server-event", "other-source");
    expect(reconcileInbox([remote], [local], new Set(["pending-source"]))).toEqual([remote, local]);
  });
  it("uses stable source identity despite differing local and server event IDs", () => {
    const remote = item("server-event", "source");
    expect(reconcileInbox([remote], [item("local-event", "source")], new Set(["source"]))).toEqual([
      remote,
    ]);
  });
  it("does not resurrect server-hidden or deleted synchronized records", () => {
    expect(
      reconcileInbox([], [item("hidden-local", "source")], new Set(["source"]), ["source"]),
    ).toEqual([]);
    expect(reconcileInbox([], [item("deleted-synchronized")], new Set())).toEqual([]);
  });
  it("allows an offline local read before the server answers", () => {
    const local = item("local");
    expect(reconcileInbox(undefined, [local], new Set())).toEqual([local]);
  });
});
