/**
 * Builds the sideloadable demo APK.
 *
 * Continuous Native Generation is authoritative, so the Android project is regenerated before the
 * build rather than trusted from a previous variant: switching between variants otherwise leaves the
 * earlier one's permissions in the manifest.
 *
 * `EXPO_PUBLIC_RELAY_DEMO` is set in the environment rather than in a `.env` file on purpose. Expo
 * does not override a variable that is already set, and a `.env.local` carrying this would silently
 * turn an ordinary local build into a demo one.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const expoCli = require.resolve("expo/bin/cli");

const environment = {
  ...process.env,
  EXPO_PUBLIC_RELAY_DEMO: "enabled",
  RELAY_BUILD_VARIANT: "sideload",
};

function run(command, argumentList, cwd) {
  const result = spawnSync(command, argumentList, { cwd, env: environment, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, [expoCli, "prebuild", "--platform", "android", "--clean"], appRoot);
run(resolve(appRoot, "android/gradlew"), ["assembleRelease"], resolve(appRoot, "android"));

const apk = resolve(appRoot, "android/app/build/outputs/apk/release/app-release.apk");
if (!existsSync(apk)) {
  throw new Error("Gradle reported success but produced no release APK");
}

// Copied out of the Gradle tree under a name that says what it is, because the artefact is meant to
// be handed to someone and `app-release.apk` says nothing about which build they were given.
const distribution = resolve(appRoot, "dist/relay-demo.apk");
mkdirSync(dirname(distribution), { recursive: true });
copyFileSync(apk, distribution);
process.stdout.write(`\nDemo APK: ${distribution}\n`);
