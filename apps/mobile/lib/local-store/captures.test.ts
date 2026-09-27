import type { IngressEnvelope } from "@relay/contracts";
import { extractSourceEvents, normalizeSourceFacts } from "@relay/domain";
import { describe, expect, it, vi } from "vitest";

import { LOCAL_STORE_MIGRATIONS } from "./schema";
import type { LocalStore, LocalStoreTransaction, SqlParameter } from "./database";

vi.mock("expo-crypto", () => {
  let counter = 0;
  return {
    randomUUID: () => {
      counter += 1;
      return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
    },
  };
});

const { derivedCaptureIds, persistDerivedCapture, storedCaptureCounts } =
  await import("./captures");

/** The slice of `node:sqlite` this double needs. */
type SqliteStatement = {
  all: (...parameters: readonly SqlParameter[]) => readonly Record<string, unknown>[];
  get: (...parameters: readonly SqlParameter[]) => Record<string, unknown> | undefined;
  run: (...parameters: readonly SqlParameter[]) => void;
};
type SqliteDatabase = {
  close: () => void;
  exec: (s: string) => void;
  prepare: (s: string) => SqliteStatement;
};
type SqliteConstructor = new (path: string) => SqliteDatabase;

const sqlite = await (async (): Promise<SqliteConstructor | undefined> => {
  const specifier = "node:sqlite";
  try {
    const loaded = (await import(specifier)) as { DatabaseSync?: SqliteConstructor };
    return loaded.DatabaseSync;
  } catch {
    return undefined;
  }
})();

/**
 * A real SQLite behind the narrowed store contract.
 *
 * The point is to run the module's own statements rather than a stand-in for them: an idempotency
 * claim that rests on a unique index is only worth as much as the index actually refusing the second
 * write. Transactions are real too, so a partial write would be visible.
 */
function localStoreDouble(): { close: () => void; store: LocalStore } {
  if (sqlite === undefined) throw new Error("node:sqlite unavailable");
  const database = new sqlite(":memory:");
  for (const statement of LOCAL_STORE_MIGRATIONS.flat()) database.exec(statement);

  const transaction: LocalStoreTransaction = {
    execAsync: (source) => {
      database.exec(source);
      return Promise.resolve();
    },
    runAsync: (source, params) => {
      database.prepare(source).run(...params);
      return Promise.resolve(undefined);
    },
  };

  const store: LocalStore = {
    execAsync: (source) => transaction.execAsync(source),
    getAllAsync: <Row>(source: string, params: SqlParameter[]) =>
      Promise.resolve(database.prepare(source).all(...params) as Row[]),
    getFirstAsync: <Row>(source: string, params: SqlParameter[]) =>
      Promise.resolve((database.prepare(source).get(...params) ?? null) as Row | null),
    runAsync: (source, params) => transaction.runAsync(source, params),
    withExclusiveTransactionAsync: async (task) => {
      database.exec("BEGIN");
      try {
        await task(transaction);
        database.exec("COMMIT");
      } catch (error: unknown) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { close: () => database.close(), store };
}

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
  const eventSet = extractSourceEvents(factSet);
  return {
    eventSet,
    eventSetFingerprint: "e".repeat(64),
    factSet,
    factSetFingerprint: "f".repeat(64),
  };
}

describe.skipIf(sqlite === undefined)("persistDerivedCapture", () => {
  it("writes the capture, its facts and its event", async () => {
    const { close, store } = localStoreDouble();
    const derived = derivationFor(envelope);

    const counts = await persistDerivedCapture(store, "tenant-a", envelope, derived);

    expect(counts).toEqual({ events: 1, facts: derived.factSet.facts.length });
    await expect(storedCaptureCounts(store, "tenant-a", envelope.id)).resolves.toEqual(counts);
    close();
  });

  it("stores the subject and sender but never a body", async () => {
    const { close, store } = localStoreDouble();
    await persistDerivedCapture(store, "tenant-a", envelope, derivationFor(envelope));

    const row = await store.getFirstAsync<Record<string, unknown>>(
      "SELECT * FROM source_items WHERE tenant_id = ? AND id = ?",
      ["tenant-a", envelope.id],
    );
    expect(row?.subject).toBe(envelope.subject);
    expect(row?.sender).toBe(envelope.sender);
    // The body is the one field this store must not hold, and the envelope carried one.
    expect(Object.keys(row ?? {})).not.toContain("body");
    expect(JSON.stringify(row)).not.toContain("Example Station at");
    close();
  });

  it("is idempotent, so a repeated pass adds nothing", async () => {
    const { close, store } = localStoreDouble();
    const derived = derivationFor(envelope);

    await persistDerivedCapture(store, "tenant-a", envelope, derived);
    await persistDerivedCapture(store, "tenant-a", envelope, derived);

    // Both writes claim what they derived; the store holds one copy because the schema's identity
    // refuses the second, not because anything checked first.
    await expect(storedCaptureCounts(store, "tenant-a", envelope.id)).resolves.toEqual({
      events: 1,
      facts: derived.factSet.facts.length,
    });
    const captures = await store.getAllAsync<{ id: string }>(
      "SELECT id FROM source_items WHERE tenant_id = ?",
      ["tenant-a"],
    );
    expect(captures).toHaveLength(1);
    close();
  });

  it("keeps two tenants' derivations of the same capture apart", async () => {
    const { close, store } = localStoreDouble();
    const derived = derivationFor(envelope);

    await persistDerivedCapture(store, "tenant-a", envelope, derived);
    await persistDerivedCapture(store, "tenant-b", envelope, derived);

    await expect(storedCaptureCounts(store, "tenant-a", envelope.id)).resolves.toEqual({
      events: 1,
      facts: derived.factSet.facts.length,
    });
    await expect(storedCaptureCounts(store, "tenant-b", envelope.id)).resolves.toEqual({
      events: 1,
      facts: derived.factSet.facts.length,
    });
    close();
  });

  it("stores an uncertain fact with a reason and no value", async () => {
    const { close, store } = localStoreDouble();
    // Two contradictory amounts make the normalizer emit an uncertain fact rather than pick one.
    const contradictory: IngressEnvelope = {
      ...envelope,
      id: "20000000-0000-4000-8000-0000000000b2",
      attributes: { amount: ["14.20", "99.99"] },
    };
    const derived = derivationFor(contradictory);
    const uncertain = derived.factSet.facts.filter((fact) => fact.certainty === "uncertain");
    expect(uncertain.length).toBeGreaterThan(0);

    await persistDerivedCapture(store, "tenant-a", contradictory, derived);

    const rows = await store.getAllAsync<{
      uncertainty_reason: string | null;
      value: string | null;
    }>(
      "SELECT value, uncertainty_reason FROM source_facts WHERE tenant_id = ? AND certainty = 'uncertain'",
      ["tenant-a"],
    );
    expect(rows).toHaveLength(uncertain.length);
    for (const row of rows) {
      expect(row.value).toBeNull();
      expect(row.uncertainty_reason).not.toBeNull();
    }
    close();
  });
});

describe.skipIf(sqlite === undefined)("derivedCaptureIds", () => {
  it("reports a capture derived at the given versions and not at others", async () => {
    const { close, store } = localStoreDouble();
    const derived = derivationFor(envelope);
    await persistDerivedCapture(store, "tenant-a", envelope, derived);

    const { normalizerVersion, extractorVersion } = derived.eventSet;
    await expect(
      derivedCaptureIds(store, "tenant-a", normalizerVersion, extractorVersion),
    ).resolves.toEqual(new Set([envelope.id]));

    // A bumped extractor must look undone, so the pass re-derives rather than freezing history.
    await expect(
      derivedCaptureIds(store, "tenant-a", normalizerVersion, extractorVersion + 1),
    ).resolves.toEqual(new Set());
    await expect(
      derivedCaptureIds(store, "tenant-b", normalizerVersion, extractorVersion),
    ).resolves.toEqual(new Set());
    close();
  });
});
