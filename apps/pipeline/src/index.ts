import { healthResponseSchema, ingressEnvelopeSchema, relayUserIdSchema } from "@relay/contracts";
import { encryptValue, parseKekKeyring } from "@relay/crypto";

import { TenantCoordinator } from "./coordinator";
import type { Env, IngressQueueMessage } from "./env";
import { processIngressQueue, publishIngressQueueMessage } from "./queue";
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
      const userId = relayUserIdSchema.safeParse(value.userId);
      const envelope = ingressEnvelopeSchema.safeParse(value.envelope);
      if (!userId.success || !envelope.success) {
        return Response.json({ accepted: false, reason: "invalid" }, { status: 400 });
      }

      let keyring;
      try {
        keyring = parseKekKeyring(env.RELAY_CREDENTIAL_KEK_KEYRING);
      } catch {
        return Response.json(
          { accepted: false, reason: "encryption-keyring-invalid" },
          { status: 503 },
        );
      }

      const context = `ingress:${userId.data}:${envelope.data.id}`;
      const encrypted = await encryptValue(JSON.stringify(envelope.data), keyring, context);
      const published = await publishIngressQueueMessage(env.INGRESS_QUEUE, {
        userId: userId.data,
        envelopeId: envelope.data.id,
        encrypted,
      });
      if (!published) {
        return Response.json(
          { accepted: false, reason: "queue-message-too-large" },
          { status: 413 },
        );
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
  },

  async queue(batch, env): Promise<void> {
    await processIngressQueue(batch, env);
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
