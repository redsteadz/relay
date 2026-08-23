import { healthResponseSchema, ingressEnvelopeSchema } from "@relay/contracts";
import { encryptValue } from "@relay/crypto";

import { TenantCoordinator } from "./coordinator";
import type { Env, IngressQueueMessage } from "./env";
import { ActionWorkflow } from "./workflow";

export { ActionWorkflow, TenantCoordinator };

function isInternalRequest(request: Request, env: Env): boolean {
  const expected = env.RELAY_INGEST_SHARED_SECRET;
  return expected.length > 0 && request.headers.get("x-relay-internal-secret") === expected;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json(
        healthResponseSchema.parse({ service: "relay-pipeline", status: "ok", version: "0.1.0" }),
      );
    }

    if (!isInternalRequest(request, env)) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (request.method === "POST" && url.pathname === "/internal/ingest") {
      const value = await request.json<{ userId?: unknown; envelope?: unknown }>();
      const envelope = ingressEnvelopeSchema.safeParse(value.envelope);
      if (typeof value.userId !== "string" || !envelope.success) {
        return Response.json({ accepted: false, reason: "invalid" }, { status: 400 });
      }

      if (env.RELAY_CREDENTIAL_KEK.length === 0) {
        return Response.json(
          { accepted: false, reason: "encryption-key-missing" },
          { status: 503 },
        );
      }

      const context = `ingress:${value.userId}:${envelope.data.id}`;
      const encrypted = await encryptValue(
        JSON.stringify(envelope.data),
        env.RELAY_CREDENTIAL_KEK,
        1,
        context,
      );
      await env.INGRESS_QUEUE.send({
        userId: value.userId,
        envelopeId: envelope.data.id,
        encrypted,
      });
      return Response.json({ accepted: true }, { status: 202 });
    }

    if (request.method === "POST" && url.pathname === "/internal/actions") {
      return Response.json(
        { accepted: false, reason: "action-ledger-not-configured" },
        { status: 501 },
      );
    }

    return new Response("Not found", { status: 404 });
  },

  async queue(batch, env): Promise<void> {
    for (const message of batch.messages) {
      const body = message.body;
      const coordinator = env.TENANT_COORDINATOR.getByName(body.userId);
      const response = await coordinator.fetch("https://coordinator.internal/process", {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        message.retry();
        continue;
      }

      message.ack();
    }
  },

  async scheduled(_controller, env): Promise<void> {
    if (env.SUPABASE_URL === undefined || env.SUPABASE_SERVICE_ROLE_KEY === undefined) {
      if (env.RELAY_ALLOW_LOCAL_DURABILITY === "true") return;
      throw new Error("Retention cleanup requires Supabase configuration");
    }

    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/purge_expired_raw_payloads`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    if (!response.ok)
      throw new Error(`Retention cleanup failed with ${response.status.toString()}`);
  },
} satisfies ExportedHandler<Env, IngressQueueMessage>;
