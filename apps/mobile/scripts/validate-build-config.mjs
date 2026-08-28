import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(appRoot, "../..");
const expoCli = resolve(appRoot, "node_modules/expo/bin/cli");
const buildConstants = JSON.parse(
  readFileSync(resolve(appRoot, "config/build.constants.json"), "utf8"),
);
const { app, buildVariants, sms } = buildConstants;

function expoConfig(buildVariant) {
  const result = spawnSync(process.execPath, [expoCli, "config", "--type", "public", "--json"], {
    cwd: appRoot,
    encoding: "utf8",
    env: { ...process.env, RELAY_BUILD_VARIANT: buildVariant },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Expo config failed for ${buildVariant}: ${result.stderr.trim()}`);
  }
  return JSON.parse(result.stdout);
}

const development = expoConfig(buildVariants.development);
const sideload = expoConfig(buildVariants.sideload);
const eas = JSON.parse(readFileSync(resolve(appRoot, "eas.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(resolve(appRoot, "package.json"), "utf8"));
const gitignore = readFileSync(resolve(repositoryRoot, ".gitignore"), "utf8");
const moduleManifest = readFileSync(
  resolve(appRoot, "modules/relay-device-ingress/android/src/main/AndroidManifest.xml"),
  "utf8",
);

assert.equal(development.android.package, app.androidApplicationId);
assert.equal(development.owner, app.owner);
assert.deepEqual(development.android.blockedPermissions, sms.permissions);
assert.equal(development.android.permissions, undefined);
assert.equal(development.extra.relayBuildVariant, buildVariants.development);
assert.equal(development.extra.eas.projectId, app.projectId);

assert.equal(sideload.android.package, app.androidApplicationId);
assert.equal(sideload.owner, app.owner);
assert.deepEqual(sideload.android.permissions, sms.permissions);
assert.equal(sideload.android.blockedPermissions, undefined);
assert.equal(sideload.extra.relayBuildVariant, buildVariants.sideload);
assert.equal(sideload.extra.eas.projectId, app.projectId);

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
    [buildVariants.development]: {
      extends: "base",
      developmentClient: true,
      distribution: "internal",
      env: { RELAY_BUILD_VARIANT: buildVariants.development },
      android: { buildType: "apk" },
    },
    [buildVariants.sideload]: {
      extends: "base",
      distribution: "internal",
      env: { RELAY_BUILD_VARIANT: buildVariants.sideload },
      android: { buildType: "apk" },
    },
  },
});

assert.equal(packageJson.dependencies["expo-dev-client"], "57.0.15");
assert.match(packageJson.scripts["eas-build-post-install"], /@relay\/contracts build/u);
assert.match(gitignore, /^apps\/mobile\/android\/$/mu);
assert.match(gitignore, /^apps\/mobile\/ios\/$/mu);
for (const permission of sms.permissions) assert.equal(moduleManifest.includes(permission), false);
assert.equal(moduleManifest.includes(sms.receivedAction), false);

globalThis.console.log("Mobile development and sideload build profiles are valid.");
