import { getCloudflareContext } from "@opennextjs/cloudflare";

export function authorizeRecoveryRequest(request: Request): boolean {
  const secret = process.env.RELAY_RECOVERY_SHARED_SECRET;
  return secret !== undefined && request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function requestPipelineRecovery(path: string, init?: RequestInit): Promise<Response> {
  const secret = process.env.RELAY_RECOVERY_SHARED_SECRET;
  if (secret === undefined || secret.length === 0) {
    return Response.json({ error: "recovery-secret-missing" }, { status: 503 });
  }
  const headers = {
    ...init?.headers,
    "content-type": "application/json",
    "x-relay-recovery-secret": secret,
  };
  const pipelineUrl = process.env.RELAY_PIPELINE_URL;
  if (process.env.NODE_ENV !== "production" && pipelineUrl !== undefined) {
    return fetch(`${pipelineUrl}${path}`, { ...init, headers });
  }

  try {
    const { env } = getCloudflareContext();
    return await env.PIPELINE.fetch(`https://pipeline.internal${path}`, { ...init, headers });
  } catch {
    return Response.json({ error: "pipeline-unavailable" }, { status: 503 });
  }
}
