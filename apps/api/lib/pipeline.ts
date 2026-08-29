import { getCloudflareContext } from "@opennextjs/cloudflare";

import type {
  FilterCompileInternalRequest,
  GmailDisconnectRequest,
  VerifiedGmailCursor,
} from "@relay/contracts";

type PipelineMessage = {
  userId: string;
  envelope: unknown;
};

async function publishPrivate(
  path:
    | "/internal/filters/compile"
    | "/internal/gmail/cursor"
    | "/internal/gmail/disconnect"
    | "/internal/ingest",
  message: unknown,
  allowLocalStub: boolean,
  signal?: AbortSignal,
): Promise<Response> {
  const secret = process.env.RELAY_INGEST_SHARED_SECRET;
  if (secret === undefined) {
    return Response.json({ accepted: false, reason: "internal-secret-missing" }, { status: 503 });
  }
  const headers = {
    "content-type": "application/json",
    "x-relay-internal-secret": secret,
  };
  const body = JSON.stringify(message);
  const init: RequestInit = { method: "POST", headers, body };
  if (signal !== undefined) init.signal = signal;
  const pipelineUrl = process.env.RELAY_PIPELINE_URL;
  if (process.env.NODE_ENV !== "production" && pipelineUrl !== undefined) {
    return fetch(`${pipelineUrl}${path}`, init);
  }

  try {
    const { env } = getCloudflareContext();
    return await env.PIPELINE.fetch(`https://pipeline.internal${path}`, init);
  } catch {
    if (
      allowLocalStub &&
      process.env.NODE_ENV !== "production" &&
      process.env.RELAY_ALLOW_LOCAL_STUB === "true"
    ) {
      return Response.json({ accepted: true, mode: "local-stub" }, { status: 202 });
    }
    return Response.json({ accepted: false, reason: "pipeline-unavailable" }, { status: 503 });
  }
}

export async function publishIngress(message: PipelineMessage): Promise<Response> {
  return publishPrivate("/internal/ingest", message, true);
}

export async function publishFilterCompilation(
  request: FilterCompileInternalRequest,
): Promise<Response> {
  return publishPrivate("/internal/filters/compile", request, false);
}

export async function publishGmailCursor(cursor: VerifiedGmailCursor): Promise<Response> {
  return publishPrivate("/internal/gmail/cursor", cursor, false);
}

export async function publishGmailDisconnect(
  request: GmailDisconnectRequest,
  signal?: AbortSignal,
): Promise<Response> {
  return publishPrivate("/internal/gmail/disconnect", request, false, signal);
}
