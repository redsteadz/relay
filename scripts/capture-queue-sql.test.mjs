// Exercises the shipped Kotlin SQL with Node SQLite. This is not an Android/Keystore test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { URL } from "node:url";

const source = readFileSync(
  new URL(
    "../apps/mobile/modules/relay-device-ingress/android/src/main/java/com/redsteadz/relaydeviceingress/CaptureQueueStore.kt",
    import.meta.url,
  ),
  "utf8",
);
const table = source.match(/CREATE TABLE capture_queue \([\s\S]*?\n {6}\)/)?.[0];
const upgrade = source.match(/"(ALTER TABLE capture_queue ADD COLUMN next_attempt_at[^"]+)"/)?.[1];
const failureUpdate = source.match(/"(UPDATE capture_queue SET next_attempt_at=[^"]+)"/)?.[1];
const pendingIds = source.match(/"(SELECT envelope_id FROM capture_queue WHERE[^"]+)"/)?.[1];
const manualRetry = source
  .slice(source.indexOf("fun retryFailed"))
  .match(/"(UPDATE capture_queue SET state='pending'[^"]+)"/)?.[1];
const count = source
  .slice(source.indexOf("fun unsynchronizedCount"))
  .match(/"(SELECT COUNT\(\*\) FROM capture_queue WHERE[^"]+)"/)?.[1];
assert(table && upgrade && failureUpdate && pendingIds && count && manualRetry);

function seed(database, tenant, id) {
  database
    .prepare(
      "INSERT INTO capture_queue (tenant_id,envelope_id,source_kind,captured_at,expires_at,byte_count,state,nonce,ciphertext) VALUES (?,?, 'sms',0,1000000,1,'pending',X'00',X'00')",
    )
    .run(tenant, id);
}

test("native v4→v5 SQL preserves encrypted pending rows and defaults them to immediately ready", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(table.replace("next_attempt_at INTEGER NOT NULL DEFAULT 0,", ""));
    seed(database, "account-a", "capture-a");
    database.exec(upgrade);
    const row = database
      .prepare("SELECT envelope_id,next_attempt_at,hex(ciphertext) AS encrypted FROM capture_queue")
      .get();
    assert.equal(row.envelope_id, "capture-a");
    assert.equal(row.next_attempt_at, 0);
    assert.equal(row.encrypted, "00");
  } finally {
    database.close();
  }
});

test("native retry SQL backs off, keeps failed rows visible for logout consent, and isolates tenants", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(table);
    seed(database, "account-a", "capture-a");
    seed(database, "account-b", "capture-b");
    const fail = database.prepare(failureUpdate);
    fail.run(1000, "pending", "account-a", "capture-a");
    assert.equal(
      database
        .prepare("SELECT next_attempt_at FROM capture_queue WHERE tenant_id='account-a'")
        .get().next_attempt_at,
      31000,
    );
    fail.run(2000, "pending", "account-a", "capture-a");
    assert.equal(
      database
        .prepare("SELECT next_attempt_at FROM capture_queue WHERE tenant_id='account-a'")
        .get().next_attempt_at,
      62000,
    );
    fail.run(3000, "failed", "account-a", "capture-a");
    assert.deepEqual(
      database
        .prepare(pendingIds)
        .all("account-a", "4000")
        .map((row) => row.envelope_id),
      ["capture-a"],
    );
    assert.equal(Object.values(database.prepare(count).get("account-a", "4000"))[0], 1);
    assert.equal(
      database.prepare("SELECT attempts FROM capture_queue WHERE tenant_id='account-b'").get()
        .attempts,
      0,
    );
    database.prepare(manualRetry).run("account-a", 4000);
    const retried = database
      .prepare(
        "SELECT envelope_id,state,attempts,next_attempt_at FROM capture_queue WHERE tenant_id='account-a'",
      )
      .get();
    assert.deepEqual(
      { ...retried },
      { envelope_id: "capture-a", state: "pending", attempts: 0, next_attempt_at: 0 },
    );
    assert.equal(Object.values(database.prepare(count).get("account-a", "1000001"))[0], 0);
  } finally {
    database.close();
  }
});
