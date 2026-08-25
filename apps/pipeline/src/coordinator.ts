import { DurableObject } from "cloudflare:workers";

import {
  ingressEnvelopeSchema,
  ingressQueueMessageSchema,
  relayUserIdSchema,
} from "@relay/contracts";
import { decryptValue, parseKekKeyring } from "@relay/crypto";
import { contentFingerprint, sourceIdentity } from "@relay/domain";

import {
  base64ToPostgresBytea,
  parseRelayEnvironment,
  sourceItemEncryptionContext,
} from "./encryption";
import type { Env, IngressQueueMessage } from "./env";
import { classifySourcePersistenceResponse } from "./persistence";

type LocalSourceRecord = {
  encrypted: IngressQueueMessage["encrypted"];
  expiresAt: number;
};

const RAW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const E2E_RESULT_PREFIX = "e2e-result:";

type E2EResult = {
  keyVersion: number;
  status:
    | "dead-letter"
    | "duplicate-database"
    | "duplicate-fingerprint"
    | "duplicate-source"
    | "persisted";
};

export class TenantCoordinator extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (this.env.RELAY_E2E_MODE === "true" && url.pathname === "/e2e/result") {
      if (request.method === "GET") {
        const envelopeId = relayUserIdSchema.safeParse(url.searchParams.get("envelopeId"));
        if (!envelopeId.success) return new Response("Invalid", { status: 400 });
        const result = await this.ctx.storage.get<E2EResult>(
          `${E2E_RESULT_PREFIX}${envelopeId.data}`,
        );
        return result === undefined
          ? new Response("Not found", { status: 404 })
          : Response.json(result);
      }
      if (request.method === "POST") {
        const message = ingressQueueMessageSchema.safeParse(await request.json<unknown>());
        if (!message.success) return new Response("Invalid", { status: 400 });
        await this.ctx.storage.put(`${E2E_RESULT_PREFIX}${message.data.envelopeId}`, {
          keyVersion: message.data.encrypted.keyVersion,
          status: "dead-letter",
        } satisfies E2EResult);
        return new Response(null, { status: 204 });
      }
      return new Response("Method not allowed", { status: 405 });
    }

    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const candidate = ingressQueueMessageSchema.safeParse(await request.json<unknown>());
    if (!candidate.success) {
      return Response.json({ accepted: false, reason: "invalid" }, { status: 400 });
    }
    const message: IngressQueueMessage = candidate.data;
    const context = sourceItemEncryptionContext(message.userId, message.envelopeId);
    const keyring = parseKekKeyring(this.env.RELAY_CREDENTIAL_KEK_KEYRING);
    const plaintext = await decryptValue(message.encrypted, keyring, context);
    const parsed = ingressEnvelopeSchema.safeParse(JSON.parse(plaintext) as unknown);
    if (!parsed.success || parsed.data.id !== message.envelopeId) {
      return Response.json({ accepted: false, reason: "invalid" }, { status: 400 });
    }

    const identity = sourceIdentity(parsed.data);
    const fingerprint = await contentFingerprint(parsed.data);
    const identityKey = `source:${identity}`;
    const fingerprintKey = `fingerprint:${fingerprint}`;
    const [seenIdentity, seenFingerprint] = await Promise.all([
      this.ctx.storage.get(identityKey),
      this.ctx.storage.get(fingerprintKey),
    ]);
    if (seenIdentity !== undefined || seenFingerprint !== undefined) {
      if (this.env.RELAY_E2E_MODE === "true") {
        await this.ctx.storage.put(`${E2E_RESULT_PREFIX}${message.envelopeId}`, {
          keyVersion: message.encrypted.keyVersion,
          status: seenIdentity !== undefined ? "duplicate-source" : "duplicate-fingerprint",
        } satisfies E2EResult);
      }
      return Response.json({ accepted: false, reason: "duplicate" });
    }

    const persistence = await this.persist(message, parsed.data, fingerprint);
    const now = Date.now();
    const records: Record<string, unknown> = { [identityKey]: now, [fingerprintKey]: now };
    if (persistence === "local") {
      const expiresAt = now + RAW_RETENTION_MS;
      records[`source-item:${message.envelopeId}`] = { encrypted: message.encrypted, expiresAt };
      const alarm = await this.ctx.storage.getAlarm();
      if (alarm === null || alarm > expiresAt) await this.ctx.storage.setAlarm(expiresAt);
    }
    if (this.env.RELAY_E2E_MODE === "true") {
      records[`${E2E_RESULT_PREFIX}${message.envelopeId}`] = {
        keyVersion: message.encrypted.keyVersion,
        status: persistence === "duplicate" ? "duplicate-database" : "persisted",
      } satisfies E2EResult;
    }
    await this.ctx.storage.put(records);

    return Response.json({ accepted: persistence !== "duplicate", identity, fingerprint });
  }

  private async persist(
    message: IngressQueueMessage,
    envelope: ReturnType<typeof ingressEnvelopeSchema.parse>,
    fingerprint: string,
  ): Promise<"stored" | "duplicate" | "local"> {
    if (this.env.SUPABASE_URL === undefined || this.env.SUPABASE_SERVICE_ROLE_KEY === undefined) {
      if (this.env.RELAY_ALLOW_LOCAL_DURABILITY === "true") return "local";
      throw new Error("Source persistence requires Supabase configuration");
    }

    const response = await fetch(`${this.env.SUPABASE_URL}/rest/v1/source_items`, {
      method: "POST",
      headers: {
        apikey: this.env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
        prefer: "return=minimal",
      },
      body: JSON.stringify({
        id: envelope.id,
        user_id: message.userId,
        source: envelope.source.kind,
        source_account_id: envelope.source.accountId,
        external_id: envelope.source.externalId,
        application_id: envelope.source.applicationId,
        occurred_at: envelope.occurredAt,
        captured_at: envelope.capturedAt,
        content_fingerprint: fingerprint,
        encryption_environment: parseRelayEnvironment(this.env.RELAY_ENVIRONMENT),
        raw_ciphertext: base64ToPostgresBytea(message.encrypted.ciphertext),
        raw_nonce: base64ToPostgresBytea(message.encrypted.nonce),
        wrapped_data_key: base64ToPostgresBytea(message.encrypted.wrappedKey),
        wrap_nonce: base64ToPostgresBytea(message.encrypted.wrapNonce),
        key_version: message.encrypted.keyVersion,
      }),
    });

    return classifySourcePersistenceResponse(response);
  }

  override async alarm(): Promise<void> {
    const now = Date.now();
    const records = await this.ctx.storage.list<LocalSourceRecord>({ prefix: "source-item:" });
    const expired: string[] = [];
    let nextExpiry: number | undefined;
    for (const [key, record] of records) {
      if (record.expiresAt <= now) expired.push(key);
      else nextExpiry = Math.min(nextExpiry ?? record.expiresAt, record.expiresAt);
    }
    if (expired.length > 0) await this.ctx.storage.delete(expired);
    if (nextExpiry !== undefined) await this.ctx.storage.setAlarm(nextExpiry);
  }
}
