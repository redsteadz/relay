import {
  deadLetterReplayRequestSchema,
  healthResponseSchema,
  ingressEnvelopeSchema,
  relayUserIdSchema,
} from "@relay/contracts";

import type { Env } from "./env";
import { handleGmailDisconnect, handleVerifiedGmailCursor } from "./gmail";
import { publishEncryptedIngress } from "./ingress";
import { listDeadLetterItems, replayDeadLetterItem } from "./recovery";

function isInternalRequest(request: Request, env: Env): boolean {
  const expected = env.RELAY_INGEST_SHARED_SECRET;
  return expected.length > 0 && request.headers.get("x-relay-internal-secret") === expected;
}

function isRecoveryRequest(request: Request, env: Env): boolean {
  const expected = env.RELAY_RECOVERY_SHARED_SECRET;
  return expected.length > 0 && request.headers.get("x-relay-recovery-secret") === expected;
}

export async function handlePipelineRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return Response.json(
      healthResponseSchema.parse({ service: "relay-pipeline", status: "ok", version: "0.1.0" }),
    );
  }

  if (url.pathname.startsWith("/internal/recovery/")) {
    if (!isRecoveryRequest(request, env)) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (request.method === "GET" && url.pathname === "/internal/recovery/dead-letters") {
      const rawLimit = url.searchParams.get("limit") ?? "100";
      if (!/^\d{1,3}$/u.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100) {
        return Response.json({ error: "invalid" }, { status: 400 });
      }
      try {
        return Response.json({ items: await listDeadLetterItems(env, Number(rawLimit)) });
      } catch {
        return Response.json({ error: "recovery-unavailable" }, { status: 503 });
      }
    }

    const replayMatch = /^\/internal\/recovery\/dead-letters\/([^/]+)\/replay$/u.exec(url.pathname);
    if (request.method === "POST" && replayMatch?.[1] !== undefined) {
      const value = await request.json<{ requestId?: unknown }>().catch(() => undefined);
      const replay = deadLetterReplayRequestSchema.safeParse({
        id: replayMatch[1],
        requestId: value?.requestId,
      });
      if (!replay.success) return Response.json({ error: "invalid" }, { status: 400 });
      try {
        const accepted = await replayDeadLetterItem(env, replay.data.id, replay.data.requestId);
        return accepted
          ? Response.json({ accepted: true, ...replay.data }, { status: 202 })
          : Response.json({ accepted: false, reason: "unavailable" }, { status: 409 });
      } catch {
        return Response.json({ accepted: false, reason: "recovery-unavailable" }, { status: 503 });
      }
    }
    return new Response("Not found", { status: 404 });
  }

  if (!isInternalRequest(request, env)) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (
    env.RELAY_E2E_MODE === "true" &&
    request.method === "GET" &&
    url.pathname === "/internal/e2e/result"
  ) {
    const userId = relayUserIdSchema.safeParse(url.searchParams.get("userId"));
    const envelopeId = relayUserIdSchema.safeParse(url.searchParams.get("envelopeId"));
    if (!userId.success || !envelopeId.success) {
      return Response.json({ error: "invalid" }, { status: 400 });
    }
    const coordinator = env.TENANT_COORDINATOR.getByName(userId.data);
    return coordinator.fetch(
      `https://coordinator.internal/e2e/result?envelopeId=${encodeURIComponent(envelopeId.data)}`,
    );
  }

  if (request.method === "POST" && url.pathname === "/internal/gmail/cursor") {
    const value = await request.json<unknown>().catch(() => undefined);
    return handleVerifiedGmailCursor(env, value);
  }

  if (request.method === "POST" && url.pathname === "/internal/gmail/disconnect") {
    const value = await request.json<unknown>().catch(() => undefined);
    return handleGmailDisconnect(env, value);
  }

  if (request.method === "POST" && url.pathname === "/internal/ingest") {
    const value = await request
      .json<{ userId?: unknown; envelope?: unknown }>()
      .catch(() => undefined);
    const userId = relayUserIdSchema.safeParse(value?.userId);
    const envelope = ingressEnvelopeSchema.safeParse(value?.envelope);
    if (!userId.success || !envelope.success) {
      return Response.json({ accepted: false, reason: "invalid" }, { status: 400 });
    }
    if (envelope.data.source.kind === "gmail") {
      return Response.json({ accepted: false, reason: "reserved-source" }, { status: 400 });
    }

    const published = await publishEncryptedIngress(env, userId.data, envelope.data, "device");
    if (!published.accepted) {
      return Response.json(published, {
        status: published.reason === "queue-message-too-large" ? 413 : 503,
      });
    }
    return Response.json({ accepted: true }, { status: 202 });
  }

  if (request.method === "POST" && url.pathname === "/internal/actions") {
    return Response.json(
      { accepted: false, reason: "action-ledger-not-configured" },
      { status: 501 },
    );
  }

  return new Response("Not found", { status: 404 });
}
