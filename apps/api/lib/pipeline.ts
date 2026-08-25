import { getCloudflareContext } from "@opennextjs/cloudflare";

type PipelineMessage = {
  userId: string;
  envelope: unknown;
};

export async function publishIngress(message: PipelineMessage): Promise<Response> {
  const secret = process.env.RELAY_INGEST_SHARED_SECRET;
  if (secret === undefined) {
    return Response.json({ accepted: false, reason: "internal-secret-missing" }, { status: 503 });
  }
  const body = JSON.stringify(message);
  const headers = {
    "content-type": "application/json",
    "x-relay-internal-secret": secret,
  };
  const pipelineUrl = process.env.RELAY_PIPELINE_URL;
  if (process.env.NODE_ENV !== "production" && pipelineUrl !== undefined) {
    return fetch(`${pipelineUrl}/internal/ingest`, { method: "POST", headers, body });
  }

  try {
    const { env } = getCloudflareContext();
    return await env.PIPELINE.fetch("https://pipeline.internal/internal/ingest", {
      method: "POST",
      headers,
      body,
    });
  } catch {
    if (process.env.NODE_ENV !== "production" && process.env.RELAY_ALLOW_LOCAL_STUB === "true") {
      return Response.json({ accepted: true, mode: "local-stub" }, { status: 202 });
    }

    return Response.json({ accepted: false, reason: "pipeline-unavailable" }, { status: 503 });
  }
}
