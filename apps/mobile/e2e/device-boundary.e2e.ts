/**
 * One synthetic notification, followed across the device boundary (#197).
 *
 * `scripts/local-e2e.mjs --device` starts the local Supabase, API and pipeline, signs a synthetic
 * account in, and runs this file. Everything here is the shipped mobile code except the native
 * capture module, which Node cannot run: `lib/demo/device-ingress.ts` stands in for it, applying the
 * listener's gates and policy and holding the queue with the native semantics. The Kotlin itself --
 * the listener service, the envelope factory and the Keystore-encrypted queue -- stays covered only
 * by the module's JUnit tests, so the first stages below verify the bridge contract, not the Kotlin.
 *
 * "Offline" is real `fetch` behind a gate that rejects every request; "online" is the real local
 * stack. The demo's own Supabase and API stand-ins are deliberately not used: they would answer
 * while offline, and nothing they stored would reach `source_items`.
 *
 * Each stage is one test, named for what it proves. A stage whose prerequisite did not pass is
 * recorded as blocked rather than run. `afterAll` writes every stage's outcome to the file the
 * orchestrator names, and the orchestrator asserts the server half and prints the outcomes. Nothing
 * here prints a value: checks fail with fixed messages, and the orchestrator scans this process's
 * output for the fixture's plaintext and the session's credentials.
 */

import { createClient, type Session } from "@supabase/supabase-js";
import { afterAll, describe, test, vi } from "vitest";

import fixture from "../../../fixtures/device-notifications.json";

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));

const secureStore = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-secure-store", () => ({
  deleteItemAsync: (key: string) => {
    secureStore.delete(key);
    return Promise.resolve();
  },
  getItemAsync: (key: string) => Promise.resolve(secureStore.get(key) ?? null),
  setItemAsync: (key: string, value: string) => {
    secureStore.set(key, value);
    return Promise.resolve();
  },
}));

// Every id this device mints is derived, so a rerun registers the same installation and writes the
// same local rows.
vi.mock("expo-crypto", async () => {
  const { demoUuid } = await import("@/lib/demo/ids");
  let created = 0;
  return {
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    digest: (algorithm: string, data: BufferSource) => crypto.subtle.digest(algorithm, data),
    randomUUID: () => {
      created += 1;
      return demoUuid(`device-boundary:${String(created)}`);
    },
  };
});

const asyncStorage = vi.hoisted(() => new Map<string, string>());
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: (key: string) => Promise.resolve(asyncStorage.get(key) ?? null),
    removeItem: (key: string) => {
      asyncStorage.delete(key);
      return Promise.resolve();
    },
    setItem: (key: string, value: string) => {
      asyncStorage.set(key, value);
      return Promise.resolve();
    },
  },
}));

// The real local store, migrated by `openLocalStore` on first use, on Node's own SQLite.
vi.mock("@/lib/local-store/driver", async () => {
  const { loadNodeSqlite, nodeSqliteLocalStore } = await import("@/lib/local-store/node-sqlite");
  const sqlite = await loadNodeSqlite();
  return {
    openSqliteDatabase: () =>
      sqlite === undefined
        ? Promise.reject(new Error("node:sqlite is unavailable"))
        : Promise.resolve(nodeSqliteLocalStore(sqlite, { migrated: false }).store),
  };
});

vi.mock("@/modules/relay-device-ingress", async () => ({
  default: (await import("@/lib/demo/device-ingress")).demoDeviceIngress,
}));

import { listFilterRevisions, saveFilterRule } from "@/features/filters/api/filters";
import { recordDeviceClassifications } from "@/features/inbox/api/classifications";
import { listInbox } from "@/features/inbox/api/inbox";
import {
  classifiableRules,
  classificationPass,
} from "@/features/inbox/models/deviceClassification";
import { filterByCategory, type InboxItem } from "@/features/inbox/models/inboxPresentation";
import { deriveCapture } from "@/lib/capture-derivation";
import { listCategories } from "@/lib/categories";
import {
  demoDeviceIngress,
  demoPostNotification,
  type DemoCaptureDecision,
  type DemoPostedNotification,
} from "@/lib/demo/device-ingress";
import { demoDatabase } from "@/lib/demo/store";
import { syncDeviceCaptures } from "@/lib/device-capture-sync";
import { LOCAL_STORE_TABLES, openLocalStore, storedCaptureCounts } from "@/lib/local-store";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`The device harness needs ${name}; run it with pnpm e2e:local --device`);
  }
  return value;
}

const sessionPath = required("RELAY_E2E_DEVICE_SESSION");
const resultPath = required("RELAY_E2E_DEVICE_RESULT");
const supabaseUrl = required("EXPO_PUBLIC_SUPABASE_URL");
const supabaseKey = required("EXPO_PUBLIC_SUPABASE_ANON_KEY");
required("EXPO_PUBLIC_API_URL");

/** A real session for a synthetic account, signed in by the orchestrator. */
/**
 * The slice of `node:fs` this harness uses. The mobile project carries no Node types, so the module
 * is loaded through a specifier held in a variable, the way the local store double loads SQLite.
 */
type FileSystem = {
  readFileSync: (path: string, encoding: "utf8") => string;
  writeFileSync: (path: string, data: string, options: { mode: number }) => void;
};
const fileSystemSpecifier = "node:fs";
const fileSystem = (await import(fileSystemSpecifier)) as FileSystem;

const session = JSON.parse(fileSystem.readFileSync(sessionPath, "utf8")) as Session;
const tenantId = session.user.id;

/**
 * The only network this device has.
 *
 * Offline, every request is refused the way a phone without signal refuses it, and counted, so a
 * stage can tell "the app reached for the network" apart from "the app did the wrong thing". Online,
 * only loopback is reachable: this harness never talks to anything the orchestrator did not start.
 */
const network = { blocked: 0, online: true };
const realFetch = globalThis.fetch;
function gatedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const target = new URL(input instanceof Request ? input.url : String(input));
  if (target.hostname !== "127.0.0.1" && target.hostname !== "localhost") {
    return Promise.reject(new TypeError("The device harness only reaches loopback"));
  }
  if (!network.online) {
    network.blocked += 1;
    return Promise.reject(new TypeError("Network request failed"));
  }
  return realFetch(input, init);
}
vi.stubGlobal("fetch", gatedFetch);

/** A signed-in client, as the app holds one, with every request going through the gate. */
const client = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  global: { fetch: gatedFetch, headers: { Authorization: `Bearer ${session.access_token}` } },
});

type NotificationName = keyof typeof fixture.notifications;
type FixtureNotification = {
  expect: DemoCaptureDecision;
  flags?: number;
  key: string;
  messagingSender?: string;
  packageName: string;
  postedSecondsAgo: number;
  text: string;
  title: string;
};
const notifications = fixture.notifications as Record<NotificationName, FixtureNotification>;

function posted(name: NotificationName, now: number): DemoPostedNotification {
  const notification = notifications[name];
  return {
    flags: notification.flags,
    key: notification.key,
    messagingSender: notification.messagingSender,
    packageName: notification.packageName,
    postedAt: now - notification.postedSecondsAgo * 1000,
    text: notification.text,
    title: notification.title,
  };
}

/** What the orchestrator needs from this process, and nothing it could not also check itself. */
type Outcome = "blocked" | "failed" | "known-failure" | "known-failure-resolved" | "passed";
type StageRecord = {
  blockedBy?: string;
  issues?: readonly string[];
  name: string;
  outcome: Outcome;
  step?: string;
};
const result = {
  envelopes: {} as Partial<Record<NotificationName, string>>,
  fingerprints: {} as Partial<Record<NotificationName, string>>,
  schemaVersion: 1,
  stages: [] as StageRecord[],
};
const outcomes = new Map<string, Outcome>();
const state: { categories: Awaited<ReturnType<typeof listCategories>> } = { categories: [] };

let currentStep: string | undefined;
/** Names the part of a stage that is running, so a failure says where inside the stage it stopped. */
function step(name: string): void {
  currentStep = name;
}

class HarnessCheckFailed extends Error {}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new HarnessCheckFailed(message);
}

type KnownFailure = { issues: readonly string[] };

/**
 * Stages that cannot pass until the device is the system of record for its own captures (#190).
 *
 * They still make their full assertion. A failure counts as known only when it came from the app
 * reaching for a network it does not have; a harness check failing is always a real failure. A
 * known failure that starts passing fails the run until its marker is removed here. When #193 and
 * #194 land, point these stages at the offline read and record paths they add, then delete the
 * markers.
 */
const OFFLINE_FILING: KnownFailure = { issues: ["#194"] };
const OFFLINE_INBOX: KnownFailure = { issues: ["#193"] };

function record(entry: StageRecord): void {
  result.stages.push(entry);
  outcomes.set(entry.name, entry.outcome);
}

function stage(
  name: string,
  options: { after: readonly string[]; knownFailure?: KnownFailure },
  run: () => Promise<void>,
): void {
  test(name, async (context) => {
    const blockedBy = options.after.find((dependency) => outcomes.get(dependency) !== "passed");
    if (blockedBy !== undefined) {
      record({ blockedBy, name, outcome: "blocked" });
      context.skip();
      return;
    }

    currentStep = undefined;
    const blockedBefore = network.blocked;
    try {
      await run();
    } catch (error: unknown) {
      const { knownFailure } = options;
      const known =
        knownFailure !== undefined &&
        network.blocked > blockedBefore &&
        !(error instanceof HarnessCheckFailed);
      if (known) {
        record({
          issues: knownFailure.issues,
          name,
          outcome: "known-failure",
          ...(currentStep === undefined ? {} : { step: currentStep }),
        });
        return;
      }
      record({
        name,
        outcome: "failed",
        ...(currentStep === undefined ? {} : { step: currentStep }),
      });
      throw new Error(`${name} failed`, { cause: error });
    }

    if (options.knownFailure !== undefined) {
      record({ issues: options.knownFailure.issues, name, outcome: "known-failure-resolved" });
      throw new Error(`${name} now passes; remove its known-failure marker`);
    }
    record({ name, outcome: "passed" });
  });
}

async function poll<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs: number,
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return undefined;
}

function envelopeId(name: NotificationName): string {
  const id = result.envelopes[name];
  check(id !== undefined, "An earlier stage did not record the capture's envelope id");
  return id;
}

function category(slug: string) {
  const found = state.categories.find((candidate) => candidate.slug === slug);
  check(found !== undefined, "A category the fixture names is missing");
  return found;
}

function itemFor(items: readonly InboxItem[], name: NotificationName): InboxItem | undefined {
  return items.find((item) => item.sourceItemId === envelopeId(name));
}

/** A structured record the mobile logger wrote, whatever its level or event. */
function isMobileRecord(line: unknown): boolean {
  if (typeof line !== "string" || !line.startsWith("{")) return false;
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
  return (
    typeof entry === "object" &&
    entry !== null &&
    (entry as { namespace?: unknown }).namespace === "relay:mobile"
  );
}

async function queuedRows() {
  await demoDatabase.ready();
  return demoDatabase.rows("capture_queue").filter((row) => row.tenant_id === tenantId);
}

const RULES = "device: rule setup (online)";
const LISTENER = "device: listener allow/deny";
const ENVELOPE = "device: envelope";
const QUEUE = "device: queue";
const DERIVATION = "device: derivation (offline)";
const UPLOAD = "sync: upload";
const VISIBLE = "sync: server copy visible";
const DEVICE_FILES = "sync: device files a synced capture";

describe("device boundary", () => {
  stage(RULES, { after: [] }, async () => {
    network.online = true;
    step("categories read");
    state.categories = await listCategories(client);
    const rule = fixture.rules.purchase;
    step("rule saved");
    const saved = await saveFilterRule(session.access_token, {
      categoryId: category(rule.categorySlug).id,
      intent: rule.intent,
      name: rule.name,
    });
    check(saved.rule.enabled, "The rule was not saved enabled");
    step("capture configured");
    await demoDeviceIngress.configureNotificationCapture(
      tenantId,
      [...fixture.allowedPackages],
      false,
    );
    network.online = false;
  });

  stage(LISTENER, { after: [RULES] }, async () => {
    const now = Date.now();
    for (const name of ["purchase", "parcel", "chat", "summary", "own"] as const) {
      step(name);
      const heard = await demoPostNotification(posted(name, now), now);
      check(heard.decision === notifications[name].expect, "The listener decided differently");
      if (heard.envelopeId !== undefined) result.envelopes[name] = heard.envelopeId;
    }
    step("queue contents");
    const queued = await demoDeviceIngress.getReadyCaptures(tenantId, now);
    const ids = queued.map((entry) => entry.envelope.id).sort();
    check(
      ids.join() === [envelopeId("purchase"), envelopeId("parcel")].sort().join(),
      "The queue does not hold exactly the allowed captures",
    );
  });

  stage(ENVELOPE, { after: [LISTENER] }, async () => {
    const now = Date.now();
    const queued = await demoDeviceIngress.getReadyCaptures(tenantId, now);
    for (const name of ["purchase", "parcel"] as const) {
      step(name);
      const envelope = queued.find((entry) => entry.envelope.id === envelopeId(name))?.envelope;
      check(envelope !== undefined, "A captured envelope is missing from the queue");
      const notification = notifications[name];
      check(
        envelope.source.kind === "notification" &&
          envelope.source.externalId === envelope.id &&
          envelope.source.applicationId === notification.packageName,
        "The envelope's source is not the one the native factory builds",
      );
      check(envelope.sender === undefined, "The envelope carries a top-level sender");
      check(
        envelope.attributes.sender === notification.messagingSender,
        "The envelope's structured sender differs from the posted one",
      );
      check(
        envelope.subject === notification.title && envelope.body === notification.text,
        "The envelope's text differs from what was posted",
      );
    }
    step("redelivery");
    const later = now + 5_000;
    const redelivered = await demoPostNotification(
      { ...posted("purchase", later), postedAt: later - 1_000 },
      later,
    );
    check(redelivered.envelopeId === envelopeId("purchase"), "A redelivery minted a new id");
    check(
      (await demoDeviceIngress.getReadyCaptures(tenantId, later)).length === 2,
      "A redelivery changed the queue",
    );
  });

  stage(QUEUE, { after: [ENVELOPE] }, async () => {
    step("pending");
    const queued = await demoDeviceIngress.getReadyCaptures(tenantId, Date.now());
    check(
      queued.length === 2 && queued.every((entry) => entry.attempts === 0),
      "Queued captures are not pending at zero attempts",
    );
    step("retained copy");
    const retained = await demoDeviceIngress.getRetainedCaptureContent(tenantId, [
      envelopeId("purchase"),
      envelopeId("parcel"),
    ]);
    for (const name of ["purchase", "parcel"] as const) {
      check(
        retained[envelopeId(name)]?.body === notifications[name].text &&
          retained[envelopeId(name)]?.subject === notifications[name].title,
        "The device did not keep its own copy of a capture",
      );
    }
    step("refused notifications");
    const refused = new Set(
      (["chat", "summary", "own"] as const).map((name) => notifications[name].text),
    );
    check(
      !demoDatabase.rows("retained_content").some((row) => refused.has(row.body as string)),
      "A refused notification left a copy on the device",
    );
  });

  stage(DERIVATION, { after: [QUEUE] }, async () => {
    check(!network.online, "The harness is not offline");
    step("offline sync");
    const blockedBefore = network.blocked;
    const outcome = await syncDeviceCaptures(session).then(
      () => "resolved",
      () => "rejected",
    );
    check(
      outcome === "rejected" && network.blocked > blockedBefore,
      "An offline sync did not stop at the network",
    );

    step("local store");
    const store = await openLocalStore();
    for (const name of ["purchase", "parcel"] as const) {
      const counts = await storedCaptureCounts(store, tenantId, envelopeId(name));
      check(counts.facts > 0 && counts.events > 0, "A capture was not derived on the device");
    }
    step("no body text");
    const bodies = (["purchase", "parcel"] as const).map((name) => notifications[name].text);
    for (const table of LOCAL_STORE_TABLES) {
      const rows = await store.getAllAsync<Record<string, unknown>>(`SELECT * FROM ${table}`, []);
      const stored = JSON.stringify(rows);
      check(!bodies.some((body) => stored.includes(body)), "The local store holds capture text");
    }

    step("queue untouched");
    const queued = await demoDeviceIngress.getReadyCaptures(tenantId, Date.now());
    check(
      queued.length === 2 && queued.every((entry) => entry.attempts === 0),
      "An offline sync changed the queue",
    );
    step("fingerprints");
    for (const entry of queued) {
      const derived = await deriveCapture(entry.envelope);
      check(derived.status === "derived", "A queued capture could not be derived");
      const name = entry.envelope.id === envelopeId("purchase") ? "purchase" : "parcel";
      result.fingerprints[name] = derived.derived.factSetFingerprint;
    }
  });

  stage(
    "device: offline classification by rule",
    { after: [DERIVATION], knownFailure: OFFLINE_FILING },
    async () => {
      check(!network.online, "The harness is not offline");
      step("rules read");
      const rules = classifiableRules(await listFilterRevisions(client));
      step("inbox read");
      const items = await listInbox(client, tenantId);
      step("classification");
      const { writes } = classificationPass(items, rules);
      const filed = writes.find((write) => write.sourceItemId === envelopeId("purchase"));
      check(
        filed?.categoryId === category(fixture.rules.purchase.categorySlug).id,
        "The device did not file the capture by its rule",
      );
    },
  );

  stage(
    "device: offline inbox shows capture under its rule's category",
    { after: [DERIVATION], knownFailure: OFFLINE_INBOX },
    async () => {
      check(!network.online, "The harness is not offline");
      // The sequence `useInbox` runs on a screen: read, file what it can, record, read again.
      step("rules read");
      const rules = classifiableRules(await listFilterRevisions(client));
      step("inbox read");
      const pass = classificationPass(await listInbox(client, tenantId), rules);
      step("classification recorded");
      const recorded = await recordDeviceClassifications(client, pass.writes, pass.withdrawals);
      check(recorded.failed === 0, "Filing could not be recorded");
      step("inbox reread");
      const items = await listInbox(client, tenantId);
      step("category");
      const slug = fixture.rules.purchase.categorySlug;
      check(
        filterByCategory(items, slug, state.categories).some(
          (item) => item.sourceItemId === envelopeId("purchase"),
        ),
        "The capture is not shown under its rule's category",
      );
    },
  );

  stage(UPLOAD, { after: [DERIVATION] }, async () => {
    network.online = true;
    step("sync");
    await syncDeviceCaptures(session);
    step("acknowledgement");
    const left = await queuedRows();
    if (left.length > 0) {
      // Counts only: enough to tell a drain that never ran from one that failed every attempt.
      const attempts = left.map((row) => String(row.attempts)).join(",");
      step(`acknowledgement: ${String(left.length)} rows left at attempts ${attempts}`);
    }
    check(left.length === 0, "Uploaded captures were not acknowledged");
  });

  stage(VISIBLE, { after: [UPLOAD] }, async () => {
    const items = await poll(
      () => listInbox(client, tenantId),
      (read) => itemFor(read, "purchase") !== undefined && itemFor(read, "parcel") !== undefined,
      60_000,
    );
    check(items !== undefined, "The server copy never reached this device's inbox");
  });

  stage("sync: classification precedence (ADR-0014)", { after: [VISIBLE] }, async () => {
    // Events land before the pipeline files a capture, so wait for its decision rather than race it.
    step("server classification");
    const items = await poll(
      () => listInbox(client, tenantId),
      (read) => itemFor(read, "purchase")?.category !== undefined,
      30_000,
    );
    check(items !== undefined, "The server never filed the capture");
    const item = itemFor(items, "purchase");
    const transactions = category(fixture.rules.purchase.categorySlug);
    check(
      item?.category?.origin === "server" && item.category.name === transactions.name,
      "The capture was not filed by the server under its rule's category",
    );

    step("device pass");
    const rules = classifiableRules(await listFilterRevisions(client));
    const pass = classificationPass(items, rules);
    check(
      !pass.writes.some((write) => write.sourceItemId === item.sourceItemId) &&
        !pass.withdrawals.some((withdrawal) => withdrawal.sourceItemId === item.sourceItemId),
      "The device tried to overrule the server's classification",
    );
    step("device decision");
    const own = classificationPass([{ ...item, category: undefined }], rules);
    check(
      own.writes[0]?.categoryId === transactions.id,
      "The device would have filed the capture somewhere else",
    );
    step("inbox category");
    check(
      filterByCategory(items, transactions.slug, state.categories).some(
        (candidate) => candidate.sourceItemId === item.sourceItemId,
      ),
      "The capture is not shown under its rule's category",
    );
  });

  stage(DEVICE_FILES, { after: [VISIBLE] }, async () => {
    const rule = fixture.rules.parcel;
    const deliveries = category(rule.categorySlug);
    step("rule saved");
    await saveFilterRule(session.access_token, {
      categoryId: deliveries.id,
      intent: rule.intent,
      name: rule.name,
    });
    step("device pass");
    const rules = classifiableRules(await listFilterRevisions(client));
    const pass = classificationPass(await listInbox(client, tenantId), rules);
    check(
      pass.writes.length === 1 &&
        pass.writes[0]?.sourceItemId === envelopeId("parcel") &&
        pass.writes[0].categoryId === deliveries.id &&
        pass.withdrawals.length === 0,
      "The device pass did not file exactly the synced capture",
    );
    step("classification recorded");
    const recorded = await recordDeviceClassifications(client, pass.writes, pass.withdrawals);
    check(recorded.changed === 1 && recorded.failed === 0, "The device's filing was not recorded");
    step("inbox category");
    const items = await listInbox(client, tenantId);
    const item = itemFor(items, "parcel");
    check(
      item?.category?.origin === "device" && item.category.name === deliveries.name,
      "The inbox does not show the device's filing",
    );
    check(
      filterByCategory(items, deliveries.slug, state.categories).some(
        (candidate) => candidate.sourceItemId === item.sourceItemId,
      ),
      "The capture is not shown under the new rule's category",
    );
  });

  stage("sync: filing converges", { after: [DEVICE_FILES] }, async () => {
    const rules = classifiableRules(await listFilterRevisions(client));
    const pass = classificationPass(await listInbox(client, tenantId), rules);
    check(
      pass.writes.length === 0 && pass.withdrawals.length === 0,
      "A second filing pass still found work to do",
    );
  });

  stage("probe: #179 no-op sync is observable", { after: [UPLOAD] }, async () => {
    step("queue empty");
    check((await queuedRows()).length === 0, "The queue was not empty before the probe");
    step("sync");
    const levels = ["debug", "error", "info", "log", "warn"] as const;
    const spies = levels.map((level) => vi.spyOn(console, level));
    try {
      await syncDeviceCaptures(session);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    const reported = spies
      .flatMap((spy) => spy.mock.calls)
      .filter((call) => isMobileRecord(call[0]));
    step("observable outcome");
    check(reported.length > 0, "A sync with nothing to upload reported nothing");
  });

  stage("probe: #178 held capture uploads while paused", { after: [UPLOAD] }, async () => {
    const now = Date.now();
    step("capture");
    const held = await demoPostNotification(posted("held", now), now);
    check(
      held.decision === "capture" && held.envelopeId !== undefined,
      "The held capture was refused",
    );
    result.envelopes.held = held.envelopeId;
    step("pause");
    await demoDeviceIngress.configureNotificationCapture(
      tenantId,
      [...fixture.allowedPackages],
      true,
    );
    step("sync");
    await syncDeviceCaptures(session);
    step("acknowledgement");
    check(
      !(await queuedRows()).some((row) => row.envelope_id === held.envelopeId),
      "A capture taken before the pause was never uploaded",
    );
  });
});

afterAll(() => {
  fileSystem.writeFileSync(resultPath, JSON.stringify(result), { mode: 0o600 });
});
