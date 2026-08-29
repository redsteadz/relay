import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "supabase/database.generated.ts");

// Windows exposes `supabase` and `prettier` only as `.CMD` shims, which Node refuses to execute
// without a shell, and routing an argument array through a shell is deprecated (DEP0190) because
// the arguments are concatenated rather than escaped. Both tools are Node programs, so on Windows
// resolve their entry scripts and run them under the current Node binary. Other platforms keep the
// plain PATH lookup, so CI behaviour is unchanged.
const nodeEntryPoints = {
  prettier: "prettier/bin/prettier.cjs",
  supabase: "supabase/dist/supabase.js",
};
const requireFromScript = createRequire(import.meta.url);

function spawnTool(command, args, options) {
  const entryPoint = process.platform === "win32" ? nodeEntryPoints[command] : undefined;
  if (entryPoint === undefined) return spawn(command, args, options);
  return spawn(process.execPath, [requireFromScript.resolve(entryPoint), ...args], options);
}

function run(command, args, input, env = process.env) {
  return new Promise((resolveRun, reject) => {
    const child = spawnTool(command, args, { cwd: root, env, stdio: "pipe" });
    const stdout = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.resume();
    child.on("error", () => reject(new Error(`${command} could not start`)));
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`${command} failed with exit code ${code}`));
      else resolveRun(Buffer.concat(stdout).toString("utf8"));
    });
    child.stdin.end(input);
  });
}

export function localTypeGenerationEnvironment(environment, status) {
  const databaseUrl = /^DB_URL="([^"]+)"$/mu.exec(status)?.[1];
  if (databaseUrl === undefined) throw new Error("Supabase local status omitted DB_URL");
  const password = new URL(databaseUrl).password;
  if (password.length === 0) throw new Error("Supabase local DB_URL omitted its password");
  return { ...environment, SUPABASE_DB_PASSWORD: decodeURIComponent(password) };
}

// Git stores this file with LF, but a Windows checkout with `core.autocrlf=true` materialises
// CRLF in the working tree while the generator always emits LF. A raw comparison would report
// stale types on Windows even when the committed file is byte-correct in git. `write` still emits
// LF, so the committed form never changes.
function withUnixLineEndings(value) {
  return value.split("\r\n").join("\n");
}

export function normalizeGeneratedTypes(generated) {
  const marker = "  __InternalSupabase: {";
  const publicSchema = "  public: {";
  const markerStart = generated.indexOf(marker);
  if (markerStart === -1) return generated;

  const end = generated.indexOf(publicSchema, markerStart);
  const metadata = end === -1 ? [] : generated.slice(markerStart, end).trimEnd().split("\n");
  if (
    metadata.length !== 3 ||
    metadata[0] !== marker ||
    !/^\s{4}PostgrestVersion: "[^"]+";$/u.test(metadata[1] ?? "") ||
    metadata[2] !== "  };"
  ) {
    throw new Error("Supabase generated unsupported internal metadata");
  }

  let removalStart = markerStart;
  const comments = [];
  let lineEnd = markerStart - 1;
  while (lineEnd >= 0) {
    const lineStart = generated.lastIndexOf("\n", lineEnd - 1) + 1;
    const line = generated.slice(lineStart, lineEnd);
    if (!line.startsWith("  // ")) break;
    comments.unshift(line);
    removalStart = lineStart;
    lineEnd = lineStart - 1;
  }
  if (
    comments.length > 0 &&
    (!comments.some((line) => line.includes("createClient")) ||
      !comments.some((line) => line.includes("PostgrestVersion")))
  ) {
    throw new Error("Supabase generated unsupported internal metadata comments");
  }

  return generated.slice(0, removalStart) + generated.slice(end);
}

async function generateTypes(remote) {
  const target = remote ? ["--project-id", process.env.RELAY_SUPABASE_PROJECT_REF] : ["--local"];
  if (remote && !/^[a-z]{20}$/u.test(process.env.RELAY_SUPABASE_PROJECT_REF ?? "")) {
    throw new Error("RELAY_SUPABASE_PROJECT_REF must be a 20-letter project ref");
  }
  const environment = remote
    ? process.env
    : localTypeGenerationEnvironment(process.env, await run("supabase", ["status", "-o", "env"]));
  const generated = await run(
    "supabase",
    ["gen", "types", "typescript", ...target, "--schema", "public"],
    undefined,
    environment,
  );
  if (!generated.includes("export type Database")) {
    throw new Error("Supabase returned an invalid database type definition");
  }
  return normalizeGeneratedTypes(await run("prettier", ["--parser", "typescript"], generated));
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "write" && mode !== "check" && mode !== "check-remote") {
    throw new Error("Usage: supabase-types.mjs <write|check|check-remote>");
  }

  const generated = await generateTypes(mode === "check-remote");
  if (mode === "check" || mode === "check-remote") {
    const current = await readFile(outputPath, "utf8");
    if (withUnixLineEndings(current) !== withUnixLineEndings(generated)) {
      throw new Error(
        mode === "check-remote"
          ? "Remote database types differ from committed types"
          : "Supabase database types are stale; run pnpm supabase:types",
      );
    }
    return;
  }

  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, generated, { encoding: "utf8", mode: 0o644 });
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    globalThis.console.error(
      error instanceof Error ? error.message : "Supabase type generation failed",
    );
    process.exitCode = 1;
  });
}
