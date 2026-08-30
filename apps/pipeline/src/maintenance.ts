import { readPersistenceConfiguration, supabaseBackendHeaders } from "./configuration";
import type { Env } from "./env";
import { listDueGmailConnections, scheduleGmailMaintenance } from "./gmail";
import { executeKekRotationBatch } from "./key-rotation";
import { recordPipelineMetric } from "./metrics";
import { logPipelineError } from "./observability";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type MaintenanceName = "gmail" | "kek-rotation" | "retention";

export const MAINTENANCE_TASK_TIMEOUT_MS = 30_000;

function retentionBody(env: Env): string {
  const controlledNow = env.RELAY_E2E_RETENTION_NOW;
  if (controlledNow === undefined) return "{}";
  let supabaseUrl: URL;
  try {
    supabaseUrl = new URL(env.SUPABASE_URL ?? "");
  } catch (error: unknown) {
    throw new Error("Controlled retention time is invalid", { cause: error });
  }
  if (
    env.RELAY_E2E_MODE !== "true" ||
    new Date(controlledNow).toISOString() !== controlledNow ||
    supabaseUrl.protocol !== "http:" ||
    (supabaseUrl.hostname !== "127.0.0.1" && supabaseUrl.hostname !== "localhost")
  ) {
    throw new Error("Controlled retention time is invalid");
  }
  return JSON.stringify({ p_now: controlledNow });
}

function fetcherWithSignal(fetcher: Fetcher, signal: AbortSignal): Fetcher {
  return (input, init) => fetcher(input, { ...init, signal });
}

async function attemptMaintenance(
  env: Env,
  name: MaintenanceName,
  failureMetric: "gmail_maintenance_failed" | "kek_rotation_failed" | "retention_purge_failed",
  operation: (signal: AbortSignal) => Promise<void>,
): Promise<MaintenanceName | undefined> {
  const startedAt = performance.now();
  const logStartedAt = Date.now();
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("Scheduled maintenance task timed out"));
    }, MAINTENANCE_TASK_TIMEOUT_MS);
  });
  try {
    await Promise.race([operation(controller.signal), timeoutPromise]);
    return undefined;
  } catch (error: unknown) {
    recordPipelineMetric(
      env.PIPELINE_METRICS,
      failureMetric,
      1,
      performance.now() - startedAt,
      env.DEBUG,
    );
    logPipelineError(env, "background.maintenance_task_failed", error, {
      code: `MAINTENANCE_${name.replaceAll("-", "_").toUpperCase()}_FAILED`,
      integration: name === "gmail" ? "google-gmail" : "supabase",
      operation: name,
      startedAt: logStartedAt,
    });
    return name;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export async function runScheduledMaintenance(env: Env, fetcher: Fetcher = fetch): Promise<void> {
  const configuration = readPersistenceConfiguration(env);
  const supabase = configuration.supabase;
  if (supabase === undefined) return;

  const failures = (
    await Promise.all([
      attemptMaintenance(env, "retention", "retention_purge_failed", async (signal) => {
        const retentionStartedAt = performance.now();
        const response = await fetcher(`${supabase.url}/rest/v1/rpc/purge_expired_raw_payloads`, {
          method: "POST",
          headers: supabaseBackendHeaders(supabase.serviceRoleKey),
          body: retentionBody(env),
          signal,
        });
        if (!response.ok) throw new Error("Retention cleanup failed");
        let purged: unknown;
        try {
          purged = await response.json<unknown>();
        } catch (error: unknown) {
          throw new Error("Retention cleanup response is invalid", { cause: error });
        }
        if (typeof purged !== "number" || !Number.isSafeInteger(purged) || purged < 0) {
          throw new Error("Retention cleanup response is invalid");
        }
        recordPipelineMetric(
          env.PIPELINE_METRICS,
          "retention_purge",
          purged,
          performance.now() - retentionStartedAt,
          env.DEBUG,
        );
      }),
      attemptMaintenance(env, "kek-rotation", "kek_rotation_failed", async (signal) => {
        await executeKekRotationBatch(env, fetcherWithSignal(fetcher, signal));
      }),
      attemptMaintenance(env, "gmail", "gmail_maintenance_failed", async (signal) => {
        const dueConnections = await listDueGmailConnections(
          env,
          fetcherWithSignal(fetcher, signal),
        );
        const results = await Promise.allSettled(
          dueConnections.map((connection) => scheduleGmailMaintenance(env, connection, signal)),
        );
        if (results.some((result) => result.status === "rejected")) {
          throw new Error("Gmail maintenance scheduling failed");
        }
      }),
    ])
  ).filter((failure): failure is MaintenanceName => failure !== undefined);

  if (failures.length > 0) {
    throw new Error(`Scheduled maintenance failed: ${failures.join(",")}`);
  }
}
