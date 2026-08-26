import { readPersistenceConfiguration, supabaseBackendHeaders } from "./configuration";
import type { Env } from "./env";
import { executeKekRotationBatch } from "./key-rotation";
import { recordPipelineMetric } from "./metrics";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

function retentionBody(env: Env): string {
  const controlledNow = env.RELAY_E2E_RETENTION_NOW;
  if (controlledNow === undefined) return "{}";
  let supabaseUrl: URL;
  try {
    supabaseUrl = new URL(env.SUPABASE_URL ?? "");
  } catch {
    throw new Error("Controlled retention time is invalid");
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

export async function runScheduledMaintenance(env: Env, fetcher: Fetcher = fetch): Promise<void> {
  const configuration = readPersistenceConfiguration(env);
  if (configuration.supabase === undefined) return;

  const startedAt = performance.now();
  const response = await fetcher(
    `${configuration.supabase.url}/rest/v1/rpc/purge_expired_raw_payloads`,
    {
      method: "POST",
      headers: supabaseBackendHeaders(configuration.supabase.serviceRoleKey),
      body: retentionBody(env),
    },
  );
  if (!response.ok) throw new Error(`Retention cleanup failed with ${response.status.toString()}`);
  const purged = await response.json<unknown>().catch(() => undefined);
  if (typeof purged !== "number" || !Number.isSafeInteger(purged) || purged < 0) {
    throw new Error("Retention cleanup response is invalid");
  }
  recordPipelineMetric(
    env.PIPELINE_METRICS,
    "retention_purge",
    purged,
    performance.now() - startedAt,
  );
  await executeKekRotationBatch(env, fetcher);
}
