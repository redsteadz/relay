import type { IngressEnvelope } from "@relay/contracts";
import { extractSourceEvents, normalizeSourceFacts } from "@relay/domain";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/observability", () => ({ logMobileError: vi.fn() }));

vi.mock("expo-crypto", () => {
  let counter = 0;
  return {
    randomUUID: () => {
      counter += 1;
      return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
    },
  };
});

const retained = vi.hoisted(() => ({
  getRetainedCaptureContent: vi.fn((): Promise<Record<string, unknown>> => Promise.resolve({})),
}));
vi.mock("@/modules/relay-device-ingress", () => ({ default: retained }));

/**
 * The store is handed to the reader through the same module it imports, so the reader under test is
 * the shipped one. A real `node:sqlite` stands behind it, which means the schema's own unique indexes
 * and checks are the ones exercised rather than a stand-in's idea of them.
 */
const store = vi.hoisted(() => ({
  open: vi.fn(),
  supported: vi.fn(() => true),
}));

/** Off for every case but the one that asserts a demo build reads nothing. */
const demo = vi.hoisted(() => ({ enabled: vi.fn(() => false) }));
vi.mock("@/lib/demo/mode", () => ({ demoModeEnabled: demo.enabled }));
// Only the two functions the reader actually calls. Re-exporting the real module would pull
// `database.ts` and with it `react-native`, whose Flow syntax this runner cannot parse; the store
// itself is still real, constructed below and handed back through `openLocalStore`.
vi.mock("@/lib/local-store", () => ({
  localStoreSupported: store.supported,
  openLocalStore: store.open,
}));

const { persistDerivedCapture } = await import("@/lib/local-store/captures");
const { setLocalHidden } = await import("@/lib/local-store/hidden");
const { loadNodeSqlite, nodeSqliteLocalStore } = await import("@/lib/local-store/node-sqlite");
const { listLocalInbox } = await import("./localInbox");

const TENANT = "208455fe-e5ae-4dc3-b416-40c7186ac6b2";
const sqlite = await loadNodeSqlite();

const envelope: IngressEnvelope = {
  schemaVersion: 1,
  id: "20000000-0000-4000-8000-0000000000b1",
  occurredAt: "2026-09-27T10:00:00Z",
  capturedAt: "2026-09-27T10:00:01Z",
  source: {
    kind: "notification",
    externalId: "synthetic-notification-b1",
    applicationId: "com.example.syntheticbank",
  },
  sender: "Example Bank",
  subject: "Synthetic card purchase",
  body: "USD 14.20 at Example Station",
  attributes: { amount: "14.20", currency: "USD", merchant: "Example Station" },
};

function derivationFor(item: IngressEnvelope) {
  const factSet = normalizeSourceFacts(item);
  return {
    eventSet: extractSourceEvents(factSet),
    eventSetFingerprint: "e".repeat(64),
    factSet,
    factSetFingerprint: "f".repeat(64),
  };
}

async function seeded() {
  if (sqlite === undefined) throw new Error("node:sqlite unavailable");
  const { close, store: database } = nodeSqliteLocalStore(sqlite);
  await persistDerivedCapture(database, TENANT, envelope, derivationFor(envelope));
  store.open.mockResolvedValue(database);
  store.supported.mockReturnValue(true);
  return { close, database };
}

describe.skipIf(sqlite === undefined)("local inbox read", () => {
  it("returns what this device derived, without reaching the network", async () => {
    const { close } = await seeded();
    try {
      const items = await listLocalInbox(TENANT);
      expect(items.length).toBeGreaterThan(0);
      expect(items[0]?.source.applicationId).toBe("com.example.syntheticbank");
      expect(items[0]?.source.sender).toBe("Example Bank");
    } finally {
      close();
    }
  });

  it("renders the body from the device's retained copy rather than from a local column", async () => {
    const { close } = await seeded();
    // The wrapper parses the stored JSON, so the reader is handed objects rather than text.
    retained.getRetainedCaptureContent.mockResolvedValueOnce({
      [envelope.id]: { body: "USD 14.20 at Example Station", subject: "Synthetic card purchase" },
    });
    try {
      const items = await listLocalInbox(TENANT);
      expect(retained.getRetainedCaptureContent).toHaveBeenCalledWith(TENANT, [envelope.id]);
      expect(items[0]?.summary).toBe("USD 14.20 at Example Station");
    } finally {
      close();
    }
  });

  it("excludes an event this reader removed, so a cold start does not redraw it", async () => {
    const { close, database } = await seeded();
    try {
      const before = await listLocalInbox(TENANT);
      const hiddenId = before[0]?.id;
      expect(hiddenId).toBeDefined();
      await setLocalHidden(database, TENANT, hiddenId, true);

      const after = await listLocalInbox(TENANT);
      expect(after.some((item) => item.id === hiddenId)).toBe(false);

      // Hiding is reversible, so restoring has to put it back rather than leave it flagged.
      await setLocalHidden(database, TENANT, hiddenId, false);
      const restored = await listLocalInbox(TENANT);
      expect(restored.some((item) => item.id === hiddenId)).toBe(true);
    } finally {
      close();
    }
  });

  it("reads nothing for another tenant, because every statement is scoped to one", async () => {
    const { close } = await seeded();
    try {
      const items = await listLocalInbox("5d7a3c4e-0000-4000-8000-000000000999");
      expect(items).toEqual([]);
    } finally {
      close();
    }
  });

  it("reports nothing rather than throwing when the store cannot be opened", async () => {
    store.supported.mockReturnValue(true);
    store.open.mockRejectedValueOnce(new Error("no such file"));
    await expect(listLocalInbox(TENANT)).resolves.toEqual([]);
  });

  it("reports nothing on a platform with no local store, without opening one", async () => {
    store.supported.mockReturnValue(false);
    store.open.mockClear();
    await expect(listLocalInbox(TENANT)).resolves.toEqual([]);
    expect(store.open).not.toHaveBeenCalled();
  });

  /**
   * A demo APK carries the same application id as a real one, so it inherits the data directory of
   * an install it replaced -- this database included. The demo's inbox comes from the demo tables,
   * and reading here would let a demo build show a reader their own captures.
   */
  it("reads nothing in a demo build, without opening the store", async () => {
    demo.enabled.mockReturnValue(true);
    store.supported.mockReturnValue(true);
    store.open.mockClear();
    try {
      await expect(listLocalInbox(TENANT)).resolves.toEqual([]);
      expect(store.open).not.toHaveBeenCalled();
    } finally {
      demo.enabled.mockReturnValue(false);
    }
  });
});
