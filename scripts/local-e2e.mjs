import { spawn, spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";
import { mkdtemp } from "node:fs/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(root, "fixtures/demo-ingress.json");
const deviceFixturePath = resolve(root, "fixtures/device-notifications.json");
const userId = "00000000-0000-4000-8000-000000000001";
const failedUserId = "00000000-0000-4000-8000-000000000099";
const fingerprintDuplicateId = "cf4c3c89-0a15-4edb-94df-77786bcdddb5";
const deadLetterId = "cf4c3c89-0a15-4edb-94df-77786bcdddb6";
const databaseConflictSeedId = "cf4c3c89-0a15-4edb-94df-77786bcdddb7";
const databaseConflictFirstId = "cf4c3c89-0a15-4edb-94df-77786bcdddb8";
const databaseConflictSecondId = "cf4c3c89-0a15-4edb-94df-77786bcdddb9";
const deadLetterSubject = "Synthetic persistence failure";
const deadLetterBody = "SYNTHETIC FAILURE BODY MUST NOT APPEAR";
const databaseConflictBody = "SYNTHETIC DATABASE CONFLICT BODY MUST NOT APPEAR";
const pipelineUrl = "http://127.0.0.1:8787";
const apiUrl = "http://127.0.0.1:3300";
const maxLogBytes = 64_000;
// Opt-in: the device half needs the mobile workspace and is not part of the CI dispatch run (#199).
const deviceBoundary = process.argv.includes("--device");
const deviceUserId = "00000000-0000-4000-8000-000000000003";
const deviceUserEmail = "relay-device-harness@example.test";
const deviceHarnessTimeoutMs = 15 * 60_000;

let stage = "initialization";
let temporaryDirectory;
let startedSupabase = false;
let deviceSummary;
const children = [];

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function pnpmInvocation(args) {
  return { args, command: process.platform === "win32" ? "pnpm.cmd" : "pnpm" };
}

function appendLog(current, chunk) {
  return `${current}${chunk.toString("utf8")}`.slice(-maxLogBytes);
}

function runPnpm(args, options = {}) {
  const invocation = pnpmInvocation(args);
  return new Promise((resolveRun, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: root,
      env: options.env ?? process.env,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout = appendLog(stdout, chunk);
    });
    child.stderr.resume();
    child.once("error", () => reject(new Error("Local command could not start")));
    child.once("exit", (code) => {
      if (code === 0) resolveRun(stdout);
      else reject(new Error("Local command failed"));
    });
  });
}

function scanProcessOutput(running, stream, chunk, forbidden) {
  const output = `${running.scanTails[stream]}${chunk.toString("utf8")}`;
  if (forbidden.some((value) => output.includes(value))) running.privacyViolation = true;
  const overlap = Math.max(...forbidden.map((value) => value.length - 1));
  running.scanTails[stream] = output.slice(-overlap);
}

function startPnpm(name, args, env, forbidden) {
  const invocation = pnpmInvocation(args);
  const child = spawn(invocation.command, invocation.args, {
    cwd: root,
    detached: process.platform !== "win32",
    env,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const running = {
    child,
    closed: new Promise((resolveClose) => child.once("close", resolveClose)),
    name,
    privacyViolation: false,
    scanTails: { stderr: "", stdout: "" },
  };
  child.stdout.on("data", (chunk) => {
    scanProcessOutput(running, "stdout", chunk, forbidden);
  });
  child.stderr.on("data", (chunk) => {
    scanProcessOutput(running, "stderr", chunk, forbidden);
  });
  children.push(running);
  return running;
}

/**
 * Ends a child and everything it started.
 *
 * On Windows each child runs through `cmd.exe`, and killing that shell leaves the server it launched
 * running -- holding its port, its output pipes and the temporary directory. `taskkill /T` ends the
 * whole tree. Elsewhere the child leads its own process group.
 */
function killTree(running, signal) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(running.child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    process.kill(-running.child.pid, signal);
  }
}

async function stopChild(running) {
  if (running.child.exitCode === null) {
    try {
      killTree(running, "SIGTERM");
    } catch {
      // Process already exited.
    }
    for (let attempt = 0; attempt < 20 && running.child.exitCode === null; attempt += 1) {
      await delay(100);
    }
    if (running.child.exitCode === null) {
      try {
        killTree(running, "SIGKILL");
      } catch {
        // Process already exited.
      }
    }
  }
  await Promise.race([
    running.closed,
    delay(5000).then(() => {
      throw new Error("Local process shutdown timed out");
    }),
  ]);
}

async function waitForHttp(url, running, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (running.child.exitCode !== null) throw new Error(`${running.name} exited before readiness`);
    try {
      const response = await globalThis.fetch(url, {
        signal: globalThis.AbortSignal.timeout(1000),
      });
      if (response.ok) return;
    } catch {
      // Service is still starting.
    }
    await delay(250);
  }
  throw new Error(`${running.name} readiness timed out`);
}

async function poll(description, operation, predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await operation();
    if (predicate(value)) return value;
    await delay(250);
  }
  throw new Error(`${description} timed out`);
}

function localSupabaseStatus(value) {
  let status;
  try {
    status = JSON.parse(value);
  } catch {
    throw new Error("Local Supabase status is invalid");
  }
  const required = ["API_URL", "PUBLISHABLE_KEY", "SECRET_KEY"];
  for (const key of required) {
    if (typeof status[key] !== "string" || status[key].length === 0) {
      throw new Error("Local Supabase status is incomplete");
    }
  }
  const url = new URL(status.API_URL);
  if (url.protocol !== "http:" || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")) {
    throw new Error("Harness refuses non-loopback Supabase URL");
  }
  return status;
}

async function readSupabaseStatus(environment) {
  return localSupabaseStatus(
    await runPnpm(["exec", "supabase", "status", "-o", "json"], { env: environment }),
  );
}

function serviceHeaders(status) {
  return {
    apikey: status.SECRET_KEY,
    "content-type": "application/json",
  };
}

async function sourceRows(status, query) {
  return tableRows(status, "source_items", query);
}

async function tableRows(status, table, query) {
  const response = await globalThis.fetch(`${status.API_URL}/rest/v1/${table}?${query}`, {
    headers: serviceHeaders(status),
  });
  if (!response.ok) throw new Error("Local metadata query failed");
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("Local metadata response is invalid");
  return rows;
}

async function insertSourceMetadata(status, row) {
  const response = await globalThis.fetch(`${status.API_URL}/rest/v1/source_items`, {
    method: "POST",
    headers: { ...serviceHeaders(status), prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!response.ok) throw new Error("Local source metadata seed failed");
}

async function deleteSourceMetadata(status, id) {
  const response = await globalThis.fetch(
    `${status.API_URL}/rest/v1/source_items?id=eq.${encodeURIComponent(id)}`,
    { method: "DELETE", headers: serviceHeaders(status) },
  );
  if (!response.ok) throw new Error("Local source metadata deletion failed");
}

async function sendIngress(envelope, relayUserId) {
  const response = await globalThis.fetch(`${apiUrl}/api/ingest`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-relay-development-user": relayUserId,
    },
    body: JSON.stringify({ deviceId: "19784902-e7a4-4f7f-b04d-e3a78c876629", envelope }),
  });
  if (response.status !== 202) {
    stage = `synthetic ingress acceptance (HTTP ${response.status})`;
    throw new Error("Local API did not accept synthetic ingress");
  }
}

async function e2eResult(ingressSecret, relayUserId, envelopeId) {
  const url = new URL("/internal/e2e/result", pipelineUrl);
  url.searchParams.set("userId", relayUserId);
  url.searchParams.set("envelopeId", envelopeId);
  const response = await globalThis.fetch(url, {
    headers: { "x-relay-internal-secret": ingressSecret },
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error("Local pipeline result query failed");
  const value = await response.json();
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Local pipeline result is invalid");
  }
  return value;
}

function assertEncryptedRow(row, plaintexts) {
  requireCondition(row.encryption_environment === "development", "Encryption owner mismatch");
  requireCondition(row.key_version === 1, "KEK version mismatch");
  requireCondition(
    typeof row.fact_set_fingerprint === "string" &&
      /^[0-9a-f]{64}$/u.test(row.fact_set_fingerprint),
    "Fact-set fingerprint is missing",
  );
  for (const field of ["raw_ciphertext", "raw_nonce", "wrapped_data_key", "wrap_nonce"]) {
    requireCondition(
      typeof row[field] === "string" && row[field].startsWith("\\x"),
      "Encrypted source field is missing",
    );
  }
  const encrypted = [row.raw_ciphertext, row.raw_nonce, row.wrapped_data_key, row.wrap_nonce]
    .join("")
    .toLowerCase();
  for (const plaintext of plaintexts) {
    requireCondition(
      !encrypted.includes(Buffer.from(plaintext, "utf8").toString("hex")),
      "Plaintext appeared in encrypted persistence",
    );
  }
  const lifetime = Date.parse(row.raw_expires_at) - Date.parse(row.created_at);
  requireCondition(
    lifetime > 6 * 24 * 60 * 60 * 1000 && lifetime <= 7 * 24 * 60 * 60 * 1000,
    "Raw retention is not anchored to original seven-day acceptance window",
  );
}

function assertFactRows(rows, fixture) {
  requireCondition(rows.length === 6, "Synthetic fact rows were not durable");
  requireCondition(
    rows.map((row) => row.kind).join(",") === "sender,date,date,amount,currency,merchant",
    "Synthetic fact kinds or ordering differ",
  );
  requireCondition(
    rows.every(
      (row, ordinal) =>
        row.source_item_id === fixture.id &&
        row.normalizer_version === 2 &&
        row.ordinal === ordinal &&
        row.certainty === "certain" &&
        Array.isArray(row.provenance) &&
        row.provenance.length > 0,
    ),
    "Synthetic facts lack source linkage or field provenance",
  );
  const amount = rows.find((row) => row.kind === "amount");
  requireCondition(
    typeof amount?.value === "string" && amount.value === fixture.attributes.amount,
    "Synthetic amount did not preserve its exact decimal string",
  );
  const serialized = JSON.stringify(rows);
  requireCondition(!serialized.includes(fixture.subject), "Subject appeared in structured facts");
  requireCondition(!serialized.includes(fixture.body), "Raw body appeared in structured facts");
}

function assertEventRows(rows, fixture) {
  requireCondition(rows.length === 1, "Synthetic event row was not durable");
  const event = rows[0];
  requireCondition(
    event.source_item_id === fixture.id &&
      event.normalizer_version === 2 &&
      event.extractor_version === 1 &&
      event.ordinal === 0 &&
      event.kind === "fact",
    "Synthetic event lacks versioned source identity",
  );
  requireCondition(
    event.title === "USD 14.20 transaction" &&
      event.summary === "Amount: USD 14.20. Merchant available.",
    "Synthetic event title or summary differs",
  );
  requireCondition(
    event.confidence === 0.95 &&
      event.requires_review === false &&
      event.temporal_status === "none" &&
      event.time_zone === null,
    "Synthetic event confidence or time policy differs",
  );
  requireCondition(
    typeof event.event_set_fingerprint === "string" &&
      /^[0-9a-f]{64}$/u.test(event.event_set_fingerprint) &&
      Array.isArray(event.provenance) &&
      event.provenance.length > 0,
    "Synthetic event fingerprint or provenance is missing",
  );
  const serialized = JSON.stringify(rows);
  requireCondition(!serialized.includes(fixture.subject), "Subject appeared in event output");
  requireCondition(!serialized.includes(fixture.body), "Raw body appeared in event output");
}

function assertLogsContainNoSensitiveData() {
  for (const running of children) {
    if (running.privacyViolation) throw new Error("Sensitive fixture appeared in process logs");
  }
}

/** Every string a device notification carries, so no process may print one. */
function deviceFixturePlaintexts(deviceFixture) {
  return Object.values(deviceFixture.notifications).flatMap((notification) =>
    [notification.title, notification.text, notification.messagingSender].filter(
      (value) => typeof value === "string",
    ),
  );
}

/** The device stages, in order. A stage missing from the device's result is itself a failure. */
const deviceStages = [
  "device: rule setup (online)",
  "device: listener allow/deny",
  "device: envelope",
  "device: queue",
  "device: derivation (offline)",
  "device: offline classification by rule",
  "device: offline inbox shows capture under its rule's category",
  "sync: upload",
  "sync: server copy visible",
  "sync: classification precedence (ADR-0014)",
  "sync: device files a synced capture",
  "sync: filing converges",
  "probe: #179 no-op sync is observable",
  "probe: #178 held capture uploads while paused",
];
const deviceOutcomes = new Set([
  "blocked",
  "failed",
  "known-failure",
  "known-failure-resolved",
  "passed",
]);

/**
 * A real session for a synthetic account, as a signed-in phone holds one.
 *
 * The password exists only for this run, and it and both tokens join the forbidden output before
 * anything that could print them starts.
 */
async function createDeviceSession(status, forbidden) {
  const password = randomBytes(24).toString("base64url");
  forbidden.push(password);
  const created = await globalThis.fetch(`${status.API_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: serviceHeaders(status),
    body: JSON.stringify({
      email: deviceUserEmail,
      email_confirm: true,
      id: deviceUserId,
      password,
    }),
  });
  if (!created.ok) throw new Error("Local device account creation failed");
  const signedIn = await globalThis.fetch(`${status.API_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: status.PUBLISHABLE_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email: deviceUserEmail, password }),
  });
  if (!signedIn.ok) throw new Error("Local device sign-in failed");
  const session = await signedIn.json();
  if (
    typeof session?.access_token !== "string" ||
    typeof session?.refresh_token !== "string" ||
    session?.user?.id !== deviceUserId
  ) {
    throw new Error("Local device session is invalid");
  }
  forbidden.push(session.access_token, session.refresh_token);
  return session;
}

async function waitForExit(running, timeoutMs) {
  await Promise.race([
    running.closed,
    // Unreferenced, so a long deadline never holds the process open once the child has exited.
    delay(timeoutMs, undefined, { ref: false }).then(() => {
      throw new Error(`${running.name} did not finish`);
    }),
  ]);
  return running.child.exitCode;
}

function deviceResult(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.stages) ||
    typeof value.envelopes !== "object" ||
    typeof value.fingerprints !== "object"
  ) {
    throw new Error("Device result is invalid");
  }
  for (const entry of value.stages) {
    if (typeof entry?.name !== "string" || !deviceOutcomes.has(entry.outcome)) {
      throw new Error("Device result is invalid");
    }
  }
  return value;
}

async function categoryId(status, slug) {
  const rows = await tableRows(
    status,
    "categories",
    `user_id=eq.${deviceUserId}&slug=eq.${encodeURIComponent(slug)}&select=id`,
  );
  requireCondition(rows.length === 1, "Device category is missing");
  return rows[0].id;
}

/** The synced half, asserted the way the server half above asserts an ingested capture. */
async function assertDeviceSourceItems(status, ingressSecret, result, deviceFixture) {
  for (const name of ["purchase", "parcel"]) {
    const id = result.envelopes[name];
    requireCondition(typeof id === "string", "Device result omitted an envelope id");
    await poll(
      "device capture persistence",
      () => e2eResult(ingressSecret, deviceUserId, id),
      (value) => value?.status === "persisted",
      45_000,
    );
    const notification = deviceFixture.notifications[name];
    const rows = await sourceRows(
      status,
      `id=eq.${encodeURIComponent(id)}&select=id,user_id,application_id,fact_set_fingerprint,raw_ciphertext,raw_nonce,wrapped_data_key,wrap_nonce,key_version,encryption_environment,created_at,raw_expires_at`,
    );
    requireCondition(
      rows.length === 1 &&
        rows[0].user_id === deviceUserId &&
        rows[0].application_id === notification.packageName,
      "Device capture was not durable under its own tenant and application",
    );
    assertEncryptedRow(
      rows[0],
      [notification.title, notification.text, notification.messagingSender].filter(
        (value) => typeof value === "string",
      ),
    );
    requireCondition(
      rows[0].fact_set_fingerprint === result.fingerprints[name],
      "Device and server derivations of the same capture disagree",
    );
    const facts = await tableRows(
      status,
      "source_facts",
      `source_item_id=eq.${encodeURIComponent(id)}&select=id`,
    );
    const events = await tableRows(
      status,
      "relay_events",
      `source_item_id=eq.${encodeURIComponent(id)}&select=id`,
    );
    requireCondition(facts.length > 0 && events.length === 1, "Device capture was not derived");
  }
}

async function classificationRows(status, sourceItemId) {
  return tableRows(
    status,
    "classifications",
    `source_item_id=eq.${encodeURIComponent(sourceItemId)}&select=origin,method,confidence,category_id,filter_rule_id,superseded_at`,
  );
}

/** ADR-0014: a capture the server could file keeps the server's answer, and the device adds none. */
async function assertServerPrecedence(status, result, deviceFixture) {
  const rows = await classificationRows(status, result.envelopes.purchase);
  const current = rows.filter((row) => row.superseded_at === null);
  const transactions = await categoryId(status, deviceFixture.rules.purchase.categorySlug);
  requireCondition(
    current.length === 1 &&
      current[0].origin === "server" &&
      current[0].category_id === transactions,
    "The server's classification is not the current one",
  );
  requireCondition(
    !rows.some((row) => row.origin === "device"),
    "A device classification was recorded over the server's",
  );
}

/** The only path by which a device-origin classification reaches the server today. */
async function assertDeviceClassification(status, result, deviceFixture) {
  const rule = deviceFixture.rules.parcel;
  const rows = await classificationRows(status, result.envelopes.parcel);
  const current = rows.filter((row) => row.superseded_at === null);
  const deliveries = await categoryId(status, rule.categorySlug);
  const revisions = await tableRows(
    status,
    "filter_rules",
    `user_id=eq.${deviceUserId}&name=eq.${encodeURIComponent(rule.name)}&select=id&order=version.desc&limit=1`,
  );
  requireCondition(
    current.length === 1 &&
      current[0].origin === "device" &&
      current[0].method === "deterministic" &&
      Number(current[0].confidence) === 1 &&
      current[0].category_id === deliveries &&
      current[0].filter_rule_id === revisions[0]?.id,
    "The device's classification did not reach the server as recorded",
  );
}

async function assertHeldCaptureSynced(ingressSecret, result) {
  const id = result.envelopes.held;
  requireCondition(typeof id === "string", "Device result omitted the held envelope id");
  await poll(
    "held capture persistence",
    () => e2eResult(ingressSecret, deviceUserId, id),
    (value) => value?.status === "persisted",
    45_000,
  );
}

function printDeviceStages(records) {
  globalThis.console.log("Device boundary stages:");
  for (const entry of records) {
    const notes = [
      entry.step === undefined ? undefined : `at ${entry.step}`,
      entry.issues === undefined ? undefined : entry.issues.join(", "),
      entry.blockedBy === undefined ? undefined : `after ${entry.blockedBy}`,
    ].filter((note) => note !== undefined);
    globalThis.console.log(
      `  ${entry.outcome.padEnd(22)} ${entry.name}${notes.length > 0 ? ` (${notes.join("; ")})` : ""}`,
    );
  }
}

/**
 * Runs the device half and asserts where it lands.
 *
 * The device process runs the shipped mobile code under Vitest (`apps/mobile/e2e`), writes one
 * outcome per stage, and prints nothing this script relies on. Server checks run after the device
 * stage they follow, and every outcome is printed before the first failure is reported.
 */
async function runDeviceBoundary(status, ingressSecret, forbidden, environment, deviceFixture) {
  stage = "device: account session";
  const session = await createDeviceSession(status, forbidden);
  const sessionPath = join(temporaryDirectory, "device-session.json");
  const resultPath = join(temporaryDirectory, "device-result.json");
  await writeFile(sessionPath, JSON.stringify(session), { mode: 0o600 });

  stage = "device boundary run";
  // The device half runs the real transports; demo mode would answer them locally instead.
  const deviceEnvironment = { ...environment };
  delete deviceEnvironment.EXPO_PUBLIC_RELAY_DEMO;
  const device = startPnpm(
    "device",
    ["--filter", "@relay/mobile", "exec", "vitest", "run", "--config", "vitest.e2e.config.mjs"],
    {
      ...deviceEnvironment,
      EXPO_PUBLIC_API_URL: apiUrl,
      EXPO_PUBLIC_DEBUG: "relay:mobile",
      EXPO_PUBLIC_SUPABASE_ANON_KEY: status.PUBLISHABLE_KEY,
      EXPO_PUBLIC_SUPABASE_URL: status.API_URL,
      RELAY_E2E_DEVICE_RESULT: resultPath,
      RELAY_E2E_DEVICE_SESSION: sessionPath,
    },
    forbidden,
  );
  const exitCode = await waitForExit(device, deviceHarnessTimeoutMs);
  let resultText;
  try {
    resultText = await readFile(resultPath, "utf8");
  } catch {
    throw new Error("Device harness wrote no result");
  }
  stage = "device result privacy";
  requireCondition(
    !forbidden.some((value) => resultText.includes(value)),
    "Device result exposed sensitive data",
  );
  stage = "device boundary run";
  const result = deviceResult(JSON.parse(resultText));

  const serverChecks = new Map([
    [
      "sync: upload",
      {
        name: "sync: source_items (server)",
        run: () => assertDeviceSourceItems(status, ingressSecret, result, deviceFixture),
      },
    ],
    [
      "sync: classification precedence (ADR-0014)",
      {
        name: "sync: classification precedence (ADR-0014) (server)",
        run: () => assertServerPrecedence(status, result, deviceFixture),
      },
    ],
    [
      "sync: device files a synced capture",
      {
        name: "sync: device files a synced capture (server)",
        run: () => assertDeviceClassification(status, result, deviceFixture),
      },
    ],
    [
      "probe: #178 held capture uploads while paused",
      {
        name: "probe: #178 held capture uploads while paused (server)",
        run: () => assertHeldCaptureSynced(ingressSecret, result),
      },
    ],
  ]);

  const records = [];
  const reported = new Map(result.stages.map((entry) => [entry.name, entry]));
  for (const name of deviceStages) {
    const entry = reported.get(name) ?? { name, outcome: "failed", step: "stage never reported" };
    records.push(entry);
    const check = serverChecks.get(name);
    if (check === undefined) continue;
    if (entry.outcome !== "passed") {
      records.push({ blockedBy: name, name: check.name, outcome: "blocked" });
      continue;
    }
    stage = check.name;
    try {
      await check.run();
      records.push({ name: check.name, outcome: "passed" });
    } catch {
      records.push({ name: check.name, outcome: "failed" });
    }
  }
  printDeviceStages(records);

  const failures = records.filter(
    (entry) => entry.outcome === "failed" || entry.outcome === "known-failure-resolved",
  );
  if (failures.length > 0) {
    stage = failures[0].name;
    throw new Error("Device boundary stage failed");
  }
  if (exitCode !== 0) {
    stage = "device boundary run";
    throw new Error("Device harness failed outside a stage");
  }
  const known = records.filter((entry) => entry.outcome === "known-failure").length;
  const passed = records.filter((entry) => entry.outcome === "passed").length;
  return `device boundary (${String(passed)} stages passed, ${String(known)} known failures)`;
}

async function main() {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const deviceFixture = deviceBoundary
    ? JSON.parse(await readFile(deviceFixturePath, "utf8"))
    : undefined;
  const localEnvironment = {
    ...process.env,
    RELAY_AUTH_SITE_URL: "http://localhost:3000",
    RELAY_AUTH_WEB_REDIRECT_URL: "http://localhost:8081/auth/callback",
  };

  stage = "local Supabase startup";
  let status;
  try {
    status = await readSupabaseStatus(localEnvironment);
  } catch {
    await runPnpm(["exec", "supabase", "start"], { env: localEnvironment });
    startedSupabase = true;
    status = await readSupabaseStatus(localEnvironment);
  }

  stage = "local database reset";
  await runPnpm(["exec", "supabase", "db", "reset", "--local"], { env: localEnvironment });
  status = await readSupabaseStatus(localEnvironment);

  stage = "workspace dependency build";
  await runPnpm([
    "--filter",
    "@relay/contracts",
    "--filter",
    "@relay/crypto",
    "--filter",
    "@relay/domain",
    ...(deviceBoundary ? ["--filter", "@relay/observability"] : []),
    "build",
  ]);

  temporaryDirectory = await mkdtemp(join(tmpdir(), "relay-local-e2e-"));
  const kek = randomBytes(32).toString("base64");
  const keyring = JSON.stringify({
    activeVersion: 1,
    keys: { 1: kek },
  });
  const ingressSecret = randomBytes(32).toString("base64url");
  const recoverySecret = randomBytes(32).toString("base64url");
  const forbiddenProcessOutput = [
    fixture.sender,
    fixture.subject,
    fixture.body,
    deadLetterSubject,
    deadLetterBody,
    databaseConflictBody,
    kek,
    keyring,
    ingressSecret,
    recoverySecret,
    status.PUBLISHABLE_KEY,
    status.SECRET_KEY,
    ...(deviceFixture === undefined ? [] : deviceFixturePlaintexts(deviceFixture)),
  ];
  const envFile = join(temporaryDirectory, "pipeline.env");
  await writeFile(
    envFile,
    [
      `RELAY_CREDENTIAL_KEK_KEYRING=${keyring}`,
      `RELAY_INGEST_SHARED_SECRET=${ingressSecret}`,
      `RELAY_RECOVERY_SHARED_SECRET=${recoverySecret}`,
      `SUPABASE_URL=${status.API_URL}`,
      `SUPABASE_SERVICE_ROLE_KEY=${status.SECRET_KEY}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );

  stage = "local pipeline startup";
  const pipeline = startPnpm(
    "pipeline",
    [
      "--filter",
      "@relay/pipeline",
      "exec",
      "wrangler",
      "dev",
      "--config",
      "wrangler.e2e.jsonc",
      "--env-file",
      envFile,
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      "8787",
      "--inspector-port",
      "9231",
      "--persist-to",
      join(temporaryDirectory, "wrangler-state"),
      "--test-scheduled",
      "--show-interactive-dev-session=false",
    ],
    localEnvironment,
    forbiddenProcessOutput,
  );
  await waitForHttp(`${pipelineUrl}/health`, pipeline);

  stage = "local API startup";
  const api = startPnpm(
    "api",
    ["--filter", "@relay/api", "exec", "next", "dev", "--hostname", "127.0.0.1", "--port", "3300"],
    {
      ...localEnvironment,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: status.PUBLISHABLE_KEY,
      NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
      RELAY_INGEST_SHARED_SECRET: ingressSecret,
      RELAY_PIPELINE_URL: pipelineUrl,
      RELAY_RECOVERY_SHARED_SECRET: recoverySecret,
    },
    forbiddenProcessOutput,
  );
  await waitForHttp(`${apiUrl}/api/health`, api);

  stage = "synthetic ingress acceptance";
  await sendIngress(fixture, userId);
  stage = "encrypted persistence";
  const persisted = await poll(
    "encrypted persistence",
    () => e2eResult(ingressSecret, userId, fixture.id),
    (value) => value?.status === "persisted",
  );
  requireCondition(persisted.keyVersion === 1, "Persisted result KEK version mismatch");
  const rows = await sourceRows(
    status,
    `id=eq.${encodeURIComponent(fixture.id)}&select=id,user_id,fact_set_fingerprint,raw_ciphertext,raw_nonce,wrapped_data_key,wrap_nonce,key_version,encryption_environment,created_at,raw_expires_at`,
  );
  requireCondition(rows.length === 1, "Synthetic source row was not durable");
  assertEncryptedRow(rows[0], [fixture.sender, fixture.subject, fixture.body]);
  const factRows = await tableRows(
    status,
    "source_facts",
    `source_item_id=eq.${encodeURIComponent(fixture.id)}&select=source_item_id,normalizer_version,ordinal,kind,certainty,value,provenance&order=ordinal.asc`,
  );
  assertFactRows(factRows, fixture);
  const eventRows = await tableRows(
    status,
    "relay_events",
    `source_item_id=eq.${encodeURIComponent(fixture.id)}&select=source_item_id,normalizer_version,extractor_version,ordinal,event_set_fingerprint,kind,title,summary,confidence,requires_review,temporal_status,time_zone,provenance`,
  );
  assertEventRows(eventRows, fixture);

  stage = "source duplicate rejection";
  await sendIngress(fixture, userId);
  await poll(
    "source duplicate result",
    () => e2eResult(ingressSecret, userId, fixture.id),
    (value) => value?.status === "duplicate-source",
  );
  const retriedFactRows = await tableRows(
    status,
    "source_facts",
    `source_item_id=eq.${encodeURIComponent(fixture.id)}&select=id`,
  );
  requireCondition(retriedFactRows.length === 6, "Duplicate ingress created additional fact rows");
  const retriedEventRows = await tableRows(
    status,
    "relay_events",
    `source_item_id=eq.${encodeURIComponent(fixture.id)}&select=id`,
  );
  requireCondition(
    retriedEventRows.length === 1,
    "Duplicate ingress created additional event rows",
  );

  stage = "fingerprint duplicate rejection";
  const fingerprintDuplicate = {
    ...fixture,
    id: fingerprintDuplicateId,
    source: { ...fixture.source, externalId: "demo-card-purchase-copy" },
  };
  await sendIngress(fingerprintDuplicate, userId);
  await poll(
    "fingerprint duplicate result",
    () => e2eResult(ingressSecret, userId, fingerprintDuplicate.id),
    (value) => value?.status === "duplicate-fingerprint",
  );
  const userRows = await sourceRows(status, `user_id=eq.${encodeURIComponent(userId)}&select=id`);
  requireCondition(userRows.length === 1, "Duplicate ingress created another source row");

  stage = "database source identity conflict";
  await insertSourceMetadata(status, {
    application_id: fixture.source.applicationId,
    captured_at: fixture.capturedAt,
    content_fingerprint: "b".repeat(64),
    external_id: "database-conflict",
    id: databaseConflictSeedId,
    occurred_at: fixture.occurredAt,
    source: fixture.source.kind,
    user_id: userId,
  });
  for (const [id, body] of [
    [databaseConflictFirstId, databaseConflictBody],
    [databaseConflictSecondId, `${databaseConflictBody} SECOND`],
  ]) {
    const databaseConflict = {
      ...fixture,
      body,
      id,
      source: { ...fixture.source, externalId: "database-conflict" },
    };
    await sendIngress(databaseConflict, userId);
    await poll(
      "database duplicate result",
      () => e2eResult(ingressSecret, userId, databaseConflict.id),
      (value) => value?.status === "duplicate-database",
    );
  }
  const conflictRows = await sourceRows(
    status,
    `id=in.(${databaseConflictSeedId},${databaseConflictFirstId},${databaseConflictSecondId})&select=id`,
  );
  requireCondition(
    conflictRows.length === 1 && conflictRows[0].id === databaseConflictSeedId,
    "Database duplicate outcome polluted source identity cache",
  );

  stage = "dead-letter delivery";
  const deadLetterFixture = {
    ...fixture,
    body: deadLetterBody,
    id: deadLetterId,
    source: { ...fixture.source, externalId: "demo-dead-letter" },
    subject: deadLetterSubject,
  };
  await insertSourceMetadata(status, {
    captured_at: fixture.capturedAt,
    content_fingerprint: "c".repeat(64),
    external_id: "dead-letter-conflict-owner",
    id: deadLetterId,
    occurred_at: fixture.occurredAt,
    source: fixture.source.kind,
    user_id: failedUserId,
  });
  await sendIngress(deadLetterFixture, userId);
  const deadLetter = await poll(
    "dead-letter result",
    () => e2eResult(ingressSecret, userId, deadLetterFixture.id),
    (value) => value?.status === "dead-letter",
    45_000,
  );
  requireCondition(deadLetter.keyVersion === 1, "Dead-letter metadata KEK version mismatch");
  const recoveryRows = await tableRows(
    status,
    "dead_letter_items",
    `id=eq.${encodeURIComponent(deadLetterFixture.id)}&select=id,envelope_id,failure_code,status,accepted_at,raw_expires_at,ciphertext,nonce,wrapped_data_key,wrap_nonce,key_version,replay_count`,
  );
  requireCondition(recoveryRows.length === 1, "Dead-letter record was not durable");
  requireCondition(recoveryRows[0].status === "available", "Dead-letter record is not recoverable");
  requireCondition(
    recoveryRows[0].failure_code === "tenant_id_conflict",
    "Dead-letter failure code mismatch",
  );
  for (const field of ["ciphertext", "nonce", "wrapped_data_key", "wrap_nonce"]) {
    requireCondition(
      typeof recoveryRows[0][field] === "string" && recoveryRows[0][field].startsWith("\\x"),
      "Encrypted dead-letter field is missing",
    );
  }
  requireCondition(
    !JSON.stringify(recoveryRows).includes(deadLetterBody) &&
      !JSON.stringify(recoveryRows).includes(deadLetterSubject),
    "Dead-letter persistence exposed source plaintext",
  );

  stage = "metadata-only dead-letter inspection";
  const inventoryResponse = await globalThis.fetch(
    `${apiUrl}/api/recovery/dead-letters?limit=100`,
    {
      headers: { authorization: `Bearer ${recoverySecret}` },
    },
  );
  requireCondition(inventoryResponse.ok, "Recovery inventory request failed");
  const inventory = await inventoryResponse.json();
  const inventoryJson = JSON.stringify(inventory);
  requireCondition(
    inventory.items?.some((item) => item.id === deadLetterId),
    "Recovery inventory omitted dead-letter item",
  );
  for (const forbidden of [
    "ciphertext",
    "nonce",
    "wrappedKey",
    deadLetterBody,
    deadLetterSubject,
  ]) {
    requireCondition(!inventoryJson.includes(forbidden), "Recovery inventory exposed payload data");
  }

  stage = "idempotent dead-letter replay";
  await deleteSourceMetadata(status, deadLetterId);
  const replayRequestId = randomUUID();
  const replayResponse = await globalThis.fetch(`${apiUrl}/api/recovery/dead-letters`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${recoverySecret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ id: deadLetterId, requestId: replayRequestId }),
  });
  requireCondition(replayResponse.status === 202, "Recovery replay was not accepted");
  const completedRecovery = await poll(
    "dead-letter replay completion",
    () =>
      tableRows(
        status,
        "dead_letter_items",
        `id=eq.${encodeURIComponent(deadLetterId)}&select=status,ciphertext,nonce,wrapped_data_key,wrap_nonce,key_version,replay_count`,
      ),
    (value) => value.length === 1 && value[0].status === "succeeded",
  );
  requireCondition(
    completedRecovery[0].ciphertext === null &&
      completedRecovery[0].nonce === null &&
      completedRecovery[0].wrapped_data_key === null &&
      completedRecovery[0].wrap_nonce === null &&
      completedRecovery[0].key_version === null,
    "Completed replay retained recoverable ciphertext",
  );
  const replayedSources = await sourceRows(
    status,
    `id=eq.${encodeURIComponent(deadLetterId)}&select=id`,
  );
  requireCondition(replayedSources.length === 1, "Replay did not create exactly one source row");
  const repeatedReplay = await globalThis.fetch(`${apiUrl}/api/recovery/dead-letters`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${recoverySecret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ id: deadLetterId, requestId: replayRequestId }),
  });
  requireCondition(
    repeatedReplay.status === 409,
    "Completed replay was unexpectedly accepted again",
  );
  const actionRows = await tableRows(
    status,
    "action_runs",
    `user_id=eq.${encodeURIComponent(userId)}&select=id`,
  );
  requireCondition(actionRows.length === 0, "Replay created an action side effect");

  stage = "controlled retention cleanup";
  const scheduled = await globalThis.fetch(`${pipelineUrl}/__scheduled?cron=17%20*%20*%20*%20*`);
  requireCondition(scheduled.ok, "Local scheduled maintenance failed");
  const purgedRows = await poll(
    "controlled retention cleanup",
    () =>
      sourceRows(
        status,
        `id=eq.${encodeURIComponent(fixture.id)}&select=raw_ciphertext,raw_nonce,wrapped_data_key,wrap_nonce,key_version,encryption_environment`,
      ),
    (value) =>
      value.length === 1 &&
      value[0].raw_ciphertext === null &&
      value[0].raw_nonce === null &&
      value[0].wrapped_data_key === null &&
      value[0].wrap_nonce === null &&
      value[0].key_version === null &&
      value[0].encryption_environment === null,
  );
  requireCondition(purgedRows.length === 1, "Controlled retention removed source metadata");
  const retainedFactRows = await tableRows(
    status,
    "source_facts",
    `source_item_id=eq.${encodeURIComponent(fixture.id)}&select=id`,
  );
  requireCondition(retainedFactRows.length === 6, "Raw retention cleanup removed derived facts");
  const retainedEventRows = await tableRows(
    status,
    "relay_events",
    `source_item_id=eq.${encodeURIComponent(fixture.id)}&select=id`,
  );
  requireCondition(retainedEventRows.length === 1, "Raw retention cleanup removed derived event");

  if (deviceFixture !== undefined) {
    deviceSummary = await runDeviceBoundary(
      status,
      ingressSecret,
      forbiddenProcessOutput,
      localEnvironment,
      deviceFixture,
    );
  }
}

let completed = false;
try {
  await main();
  completed = true;
} catch {
  globalThis.console.error(`Local E2E failed during ${stage}`);
  process.exitCode = 1;
} finally {
  let shutdownFailed = false;
  for (const child of [...children].reverse()) {
    try {
      await stopChild(child);
    } catch {
      shutdownFailed = true;
    }
  }
  if (shutdownFailed) {
    globalThis.console.error("Local E2E failed during local process shutdown");
    completed = false;
    process.exitCode = 1;
  } else {
    try {
      assertLogsContainNoSensitiveData();
    } catch {
      globalThis.console.error("Local E2E failed during privacy log assertion");
      completed = false;
      process.exitCode = 1;
    }
  }
  if (temporaryDirectory !== undefined)
    await rm(temporaryDirectory, { force: true, recursive: true });
  if (startedSupabase) {
    try {
      await runPnpm(["exec", "supabase", "stop", "--no-backup"]);
    } catch {
      process.exitCode = 1;
    }
  }
}

if (completed && process.exitCode !== 1) {
  globalThis.console.log(
    `Local E2E passed: encrypted persistence, typed facts/events, deduplication, DLQ recovery, replay, and retention cleanup${deviceSummary === undefined ? "" : `; ${deviceSummary}`}`,
  );
}
