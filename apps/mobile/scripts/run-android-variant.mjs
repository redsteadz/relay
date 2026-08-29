import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const variants = new Set(["development", "sideload"]);
const variant = process.argv[2];
if (!variants.has(variant)) {
  throw new Error("Android build variant must be development or sideload");
}

const forwardedArguments = process.argv.slice(3).filter((argument) => argument !== "--");
if (forwardedArguments.length > 1) {
  throw new Error("Pass at most one Android device serial");
}
const deviceSerial = forwardedArguments[0];

const require = createRequire(import.meta.url);
const expoCli = require.resolve("expo/bin/cli");
const environment = {
  ...process.env,
  ...(deviceSerial === undefined ? {} : { ANDROID_SERIAL: deviceSerial }),
  RELAY_BUILD_VARIANT: variant,
};
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function runExpo(arguments_) {
  const result = spawnSync(process.execPath, [expoCli, ...arguments_], {
    cwd: appRoot,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Expo CNG is authoritative. Cleaning prevents permissions from a previous variant from leaking
// into the generated Android manifest when developers switch between local builds.
runExpo(["prebuild", "--platform", "android", "--clean"]);
runExpo(["run:android", ...(deviceSerial === undefined ? ["--device"] : [])]);
