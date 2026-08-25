import { healthResponseSchema, ingressEnvelopeSchema, relayUserIdSchema } from "@relay/contracts";
import { encryptValue, parseKekKeyring } from "@relay/crypto";

import { TenantCoordinator } from "./coordinator";
import { sourceItemEncryptionContext } from "./encryption";
import type { Env, IngressQueueMessage } from "./env";
import { runScheduledMaintenance } from "./maintenance";
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

      const context = sourceItemEncryptionContext(userId.data, envelope.data.id);
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
    await runScheduledMaintenance(env);
  },
} satisfies ExportedHandler<Env, IngressQueueMessage>;
