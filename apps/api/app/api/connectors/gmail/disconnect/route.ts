import { canonicalUuidSchema } from "@relay/contracts";

import { authenticateRequest } from "../../../../../lib/auth";
import { publishGmailDisconnect } from "../../../../../lib/pipeline";

const MAX_DISCONNECT_BODY_BYTES = 4096;

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_DISCONNECT_BODY_BYTES)
  ) {
    throw new Error("Disconnect request is invalid");
  }
  if (request.body === null) throw new Error("Disconnect request is invalid");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > MAX_DISCONNECT_BODY_BYTES) {
      await reader.cancel();
      throw new Error("Disconnect request is invalid");
    }
    chunks.push(next.value);
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  let body: unknown;
  try {
    body = await readBoundedJson(request);
  } catch {
    return Response.json(
      { error: { code: "invalid_request", message: "Request body must be valid JSON" } },
      { status: 400 },
    );
  }

  const candidate =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : undefined;
  const connectionId = canonicalUuidSchema.safeParse(candidate?.connectionId);
  if (candidate === undefined || Object.keys(candidate).length !== 1 || !connectionId.success) {
    return Response.json(
      { error: { code: "invalid_request", message: "connectionId is required" } },
      { status: 400 },
    );
  }

  try {
    const result = await publishGmailDisconnect({
      schemaVersion: 1,
      connectionId: connectionId.data,
      userId: auth.userId,
    });
    if (result.status === 404) {
      return Response.json(
        { error: { code: "connection_not_found", message: "Connection not found" } },
        { status: 404 },
      );
    }
    if (!result.ok) throw new Error("Gmail disconnect unavailable");

    return Response.json({
      disconnected: true,
      connectionId: connectionId.data,
      tokenRevoked: true,
    });
  } catch {
    return Response.json(
      { error: { code: "disconnect_failed", message: "Failed to disconnect Gmail" } },
      { status: 503 },
    );
  }
}
