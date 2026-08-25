import type { Env } from "./env";
import { executeKekRotationBatch } from "./key-rotation";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export async function runScheduledMaintenance(env: Env, fetcher: Fetcher = fetch): Promise<void> {
  if (env.SUPABASE_URL === undefined || env.SUPABASE_SERVICE_ROLE_KEY === undefined) {
    if (env.RELAY_ALLOW_LOCAL_DURABILITY === "true") return;
    throw new Error("Retention cleanup requires Supabase configuration");
  }

  const response = await fetcher(`${env.SUPABASE_URL}/rest/v1/rpc/purge_expired_raw_payloads`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
    },
    body: "{}",
  });
  if (!response.ok) throw new Error(`Retention cleanup failed with ${response.status.toString()}`);
  await executeKekRotationBatch(env, fetcher);
}
