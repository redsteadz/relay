import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(appRoot, "../..");
const smsPermissions = ["android.permission.READ_SMS", "android.permission.RECEIVE_SMS"];

function expoConfig(buildVariant) {
  const result = spawnSync("expo", ["config", "--type", "public", "--json"], {
    cwd: appRoot,
    encoding: "utf8",
    env: { ...process.env, RELAY_BUILD_VARIANT: buildVariant },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Expo config failed for ${buildVariant}`);
  return JSON.parse(result.stdout);
}

const development = expoConfig("development");
const sideload = expoConfig("sideload");
const eas = JSON.parse(readFileSync(resolve(appRoot, "eas.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(resolve(appRoot, "package.json"), "utf8"));
const gitignore = readFileSync(resolve(repositoryRoot, ".gitignore"), "utf8");

assert.equal(development.android.package, "com.redsteadz.relay");
assert.equal(development.owner, "harcoleis-team");
assert.deepEqual(development.android.blockedPermissions, smsPermissions);
assert.equal(development.android.permissions, undefined);
assert.equal(development.extra.relayBuildVariant, "development");
assert.equal(development.extra.eas.projectId, "abda47b3-6e3d-43db-94de-bea147723388");

assert.equal(sideload.android.package, "com.redsteadz.relay");
assert.equal(sideload.owner, "harcoleis-team");
assert.deepEqual(sideload.android.permissions, smsPermissions);
assert.equal(sideload.android.blockedPermissions, undefined);
assert.equal(sideload.extra.relayBuildVariant, "sideload");
assert.equal(sideload.extra.eas.projectId, "abda47b3-6e3d-43db-94de-bea147723388");

assert.deepEqual(eas, {
  cli: {
    version: "22.3.0",
    requireCommit: true,
    appVersionSource: "remote",
  },
  build: {
    base: {
      node: "22.23.2",
      pnpm: "11.23.0",
      environment: "development",
    },
    development: {
      extends: "base",
      developmentClient: true,
      distribution: "internal",
      env: { RELAY_BUILD_VARIANT: "development" },
      android: { buildType: "apk" },
    },
    sideload: {
      extends: "base",
      distribution: "internal",
      env: { RELAY_BUILD_VARIANT: "sideload" },
      android: { buildType: "apk" },
    },
  },
});

assert.equal(packageJson.dependencies["expo-dev-client"], "57.0.15");
assert.match(packageJson.scripts["eas-build-post-install"], /@relay\/contracts build/u);
assert.match(gitignore, /^apps\/mobile\/android\/$/mu);
assert.match(gitignore, /^apps\/mobile\/ios\/$/mu);

globalThis.console.log("Mobile development and sideload build profiles are valid.");
