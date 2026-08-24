import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "supabase/database.generated.ts");

function run(command, args, input) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, env: process.env, stdio: "pipe" });
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

export function normalizeGeneratedTypes(generated) {
  const comment = "  // Allows to automatically instantiate createClient with right options";
  const publicSchema = "  public: {";
  const start = generated.indexOf(comment);
  if (start === -1) {
    if (generated.includes("__InternalSupabase")) {
      throw new Error("Supabase generated unsupported internal metadata");
    }
    return generated;
  }

  const end = generated.indexOf(publicSchema, start);
  const metadata = end === -1 ? [] : generated.slice(start, end).trimEnd().split("\n");
  const expectedComment =
    "  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)";
  if (
    metadata.length !== 5 ||
    metadata[0] !== comment ||
    metadata[1] !== expectedComment ||
    metadata[2] !== "  __InternalSupabase: {" ||
    !/^\s{4}PostgrestVersion: "[^"]+";$/u.test(metadata[3] ?? "") ||
    metadata[4] !== "  };"
  ) {
    throw new Error("Supabase generated unsupported internal metadata");
  }

  return generated.slice(0, start) + generated.slice(end);
}

async function generateTypes(remote) {
  const target = remote ? ["--project-id", process.env.RELAY_SUPABASE_PROJECT_REF] : ["--local"];
  if (remote && !/^[a-z]{20}$/u.test(process.env.RELAY_SUPABASE_PROJECT_REF ?? "")) {
    throw new Error("RELAY_SUPABASE_PROJECT_REF must be a 20-letter project ref");
  }
  const generated = await run("supabase", [
    "gen",
    "types",
    "typescript",
    ...target,
    "--schema",
    "public",
  ]);
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
    if (current !== generated) {
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
