import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";
import { mkdtemp } from "node:fs/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(root, "fixtures/demo-ingress.json");
const userId = "00000000-0000-4000-8000-000000000001";
const failedUserId = "00000000-0000-4000-8000-000000000099";
const fingerprintDuplicateId = "cf4c3c89-0a15-4edb-94df-77786bcdddb5";
const deadLetterId = "cf4c3c89-0a15-4edb-94df-77786bcdddb6";
const deadLetterSubject = "Synthetic persistence failure";
const deadLetterBody = "SYNTHETIC FAILURE BODY MUST NOT APPEAR";
const pipelineUrl = "http://127.0.0.1:8787";
const apiUrl = "http://127.0.0.1:3300";
const maxLogBytes = 64_000;

let stage = "initialization";
let temporaryDirectory;
let startedSupabase = false;
const children = [];

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function pnpmInvocation(args) {
  return { args, command: "pnpm" };
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

async function stopChild(running) {
  if (running.child.exitCode === null) {
    try {
      if (process.platform === "win32") running.child.kill("SIGTERM");
      else process.kill(-running.child.pid, "SIGTERM");
    } catch {
      // Process already exited.
    }
    for (let attempt = 0; attempt < 20 && running.child.exitCode === null; attempt += 1) {
      await delay(100);
    }
    if (running.child.exitCode === null) {
      try {
        if (process.platform === "win32") running.child.kill("SIGKILL");
        else process.kill(-running.child.pid, "SIGKILL");
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
    authorization: `Bearer ${status.SECRET_KEY}`,
    "content-type": "application/json",
  };
}

async function sourceRows(status, query) {
  const response = await globalThis.fetch(`${status.API_URL}/rest/v1/source_items?${query}`, {
    headers: serviceHeaders(status),
  });
  if (!response.ok) throw new Error("Local source metadata query failed");
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("Local source metadata response is invalid");
  return rows;
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

function assertEncryptedRow(row, fixture) {
  requireCondition(row.encryption_environment === "development", "Encryption owner mismatch");
  requireCondition(row.key_version === 1, "KEK version mismatch");
  for (const field of ["raw_ciphertext", "raw_nonce", "wrapped_data_key", "wrap_nonce"]) {
    requireCondition(
      typeof row[field] === "string" && row[field].startsWith("\\x"),
      "Encrypted source field is missing",
    );
  }
  const encrypted = [row.raw_ciphertext, row.raw_nonce, row.wrapped_data_key, row.wrap_nonce]
    .join("")
    .toLowerCase();
  for (const plaintext of [fixture.sender, fixture.subject, fixture.body]) {
    requireCondition(
      !encrypted.includes(Buffer.from(plaintext, "utf8").toString("hex")),
      "Plaintext appeared in encrypted persistence",
    );
  }
  const lifetime = Date.parse(row.raw_expires_at) - Date.parse(row.created_at);
  requireCondition(lifetime === 7 * 24 * 60 * 60 * 1000, "Raw retention is not seven days");
}

function assertLogsContainNoSensitiveData() {
  for (const running of children) {
    if (running.privacyViolation) throw new Error("Sensitive fixture appeared in process logs");
  }
}

async function main() {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
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
    "build",
  ]);

  temporaryDirectory = await mkdtemp(join(tmpdir(), "relay-local-e2e-"));
  const kek = randomBytes(32).toString("base64");
  const keyring = JSON.stringify({
    activeVersion: 1,
    keys: { 1: kek },
  });
  const ingressSecret = randomBytes(32).toString("base64url");
  const forbiddenProcessOutput = [
    fixture.sender,
    fixture.subject,
    fixture.body,
    deadLetterSubject,
    deadLetterBody,
    kek,
    keyring,
    ingressSecret,
    status.PUBLISHABLE_KEY,
    status.SECRET_KEY,
  ];
  const envFile = join(temporaryDirectory, "pipeline.env");
  await writeFile(
    envFile,
    [
      `RELAY_CREDENTIAL_KEK_KEYRING=${keyring}`,
      `RELAY_INGEST_SHARED_SECRET=${ingressSecret}`,
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
    `id=eq.${encodeURIComponent(fixture.id)}&select=id,user_id,raw_ciphertext,raw_nonce,wrapped_data_key,wrap_nonce,key_version,encryption_environment,created_at,raw_expires_at`,
  );
  requireCondition(rows.length === 1, "Synthetic source row was not durable");
  assertEncryptedRow(rows[0], fixture);

  stage = "source duplicate rejection";
  await sendIngress(fixture, userId);
  await poll(
    "source duplicate result",
    () => e2eResult(ingressSecret, userId, fixture.id),
    (value) => value?.status === "duplicate-source",
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

  stage = "dead-letter delivery";
  const deadLetterFixture = {
    ...fixture,
    body: deadLetterBody,
    id: deadLetterId,
    source: { ...fixture.source, externalId: "demo-dead-letter" },
    subject: deadLetterSubject,
  };
  await sendIngress(deadLetterFixture, failedUserId);
  const deadLetter = await poll(
    "dead-letter result",
    () => e2eResult(ingressSecret, failedUserId, deadLetterFixture.id),
    (value) => value?.status === "dead-letter",
    45_000,
  );
  requireCondition(deadLetter.keyVersion === 1, "Dead-letter metadata KEK version mismatch");
  const failedRows = await sourceRows(
    status,
    `id=eq.${encodeURIComponent(deadLetterFixture.id)}&select=id`,
  );
  requireCondition(failedRows.length === 0, "Failed persistence unexpectedly created a row");

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
    "Local E2E passed: encrypted persistence, deduplication, DLQ, and retention cleanup",
  );
}
