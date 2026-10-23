// Requires an isolated Chrome started with --remote-debugging-port=9225.
// Talks only to loopback and uses the existing synthetic Expo demo.
/* global fetch, WebSocket */
import process from "node:process";
import { URL } from "node:url";
import { Buffer } from "node:buffer";
import { log } from "node:console";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const origin = new URL(process.argv[2] ?? "http://localhost:8082");
assert(
  ["localhost", "127.0.0.1"].includes(origin.hostname),
  "Only a local synthetic preview is allowed",
);
const targets = await (await fetch("http://127.0.0.1:9225/json/list")).json();
const target = targets.find((item) => item.type === "page");
assert(target?.webSocketDebuggerUrl);
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((done, reject) => {
  socket.addEventListener("open", done, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let serial = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  const request = pending.get(message.id);
  if (request !== undefined) {
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  }
});
function command(method, params = {}) {
  return new Promise((resolveResult, reject) => {
    const id = ++serial;
    pending.set(id, { resolve: resolveResult, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error("Browser evaluation failed");
  return result.result?.value;
}
async function waitFor(expression, message) {
  for (let attempt = 0; attempt < 240; attempt++) {
    if (await evaluate(expression)) return;
    await delay(250);
  }
  throw new Error(message);
}
async function click(label) {
  const clicked = await evaluate(
    `(()=>{const nodes=[...document.querySelectorAll('button,[role="button"],[role="tab"],[role="switch"],a')];const node=nodes.find(item=>(item.getAttribute('aria-label')===${JSON.stringify(label)}||item.getAttribute('aria-label')?.startsWith(${JSON.stringify(label + ".")}))||item.textContent.trim()===${JSON.stringify(label)}||item.textContent.trim().endsWith(${JSON.stringify(label)}));if(!node)return false;node.click();return true;})()`,
  );
  assert(clicked, `Button unavailable: ${label}`);
  await delay(400);
}
const output = resolve("out/smart-google");
await mkdir(output, { recursive: true });
await command("Page.enable");
await command("Storage.clearDataForOrigin", { origin: origin.origin, storageTypes: "all" });
await command("Emulation.setDeviceMetricsOverride", {
  width: 390,
  height: 844,
  deviceScaleFactor: 1,
  mobile: true,
});
await command("Page.navigate", { url: origin.href });
await waitFor(
  "document.body?.innerText.includes('Skip') || document.body?.innerText.includes('Today')",
  "App did not initialize",
);
if (await evaluate("document.body.innerText.includes('Skip')")) await click("Skip");
await waitFor(
  "document.body?.innerText.includes('Today') && document.body?.innerText.includes('Settings')",
  "Main navigation did not initialize",
);
await click("Settings");
await waitFor("document.body?.innerText.includes('Google Workspace')", "Settings did not open");
await click("Google Workspace");
await waitFor(
  "document.body?.innerText.includes('Synthetic preview.')",
  "Synthetic automation UI did not load",
);
await click("Configure and preview");
await waitFor(
  "document.body.innerText.includes('Sender allowlist (comma separated)')",
  "Rule configuration not visible",
);
await click("Save configuration");
await waitFor(
  "!document.body.innerText.includes('Sender allowlist (comma separated)')",
  "Rule configuration was not saved",
);
await click("Enable Google Sheets");
await click("Record a transaction");
await waitFor(
  "document.body.innerText.toLowerCase().includes('blocked')",
  "Disabled service executed a transaction",
);
await click("Enable Google Sheets");
await click("Pause all automations");
await click("Task from Gmail");
await waitFor(
  "document.body.innerText.toLowerCase().includes('paused')",
  "Pause was not explained",
);
await click("Pause all automations");
await click("Record a transaction");
await waitFor(
  "document.body.innerText.toLowerCase().includes('succeeded')",
  "Transaction did not produce a receipt",
);
await click("Propose a meeting");
await waitFor(
  "document.body.innerText.includes('Approve action')",
  "Meeting did not request approval",
);
await click("Approve action");
await click("Task from Gmail");
await waitFor(
  "document.body.innerText.includes('Review the assignment before Friday')",
  "Gmail task preview missing",
);
await click("Approve action");
await click("Request approval");
await waitFor("document.body.innerText.includes('Approve action')", "Approval workflow missing");
await click("Skip");
await click("Duplicate transaction");
await waitFor(
  "document.body.innerText.includes('duplicate')",
  "Duplicate transaction not explained",
);
await click("Permission failure");
await waitFor(
  "document.body.innerText.toLowerCase().includes('permission needed')",
  "Permission failure not visible",
);
await click("Disconnected service");
await waitFor(
  "document.body.innerText.toLowerCase().includes('disconnected')",
  "Disconnected state not visible",
);
const screenshot = await command("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: true,
});
await writeFile(
  resolve(output, "smart-automations-mobile.png"),
  Buffer.from(screenshot.data, "base64"),
);
await command("Emulation.setDeviceMetricsOverride", {
  width: 1280,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
const desktop = await command("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: true,
});
await writeFile(
  resolve(output, "smart-automations-desktop.png"),
  Buffer.from(desktop.data, "base64"),
);
await click("Open Activity");
await waitFor(
  "document.body.innerText.includes('Google Sheets') && document.body.innerText.includes('Completed')",
  "Activity did not include the completed automation receipt",
);
socket.close();
log(
  "PASS: Chrome synthetic initialization, rule configuration, service disable, global pause, transaction receipt, meeting approval, Gmail task approval, skipped approval, duplicate, permission failure, disconnection, Activity receipt; mobile and desktop screenshots saved.",
);
