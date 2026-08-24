import { DurableObject } from "cloudflare:workers";

import { ingressEnvelopeSchema, ingressQueueMessageSchema } from "@relay/contracts";
import { decryptValue, parseKekKeyring } from "@relay/crypto";
import { contentFingerprint, sourceIdentity } from "@relay/domain";

import type { Env, IngressQueueMessage } from "./env";

type LocalSourceRecord = {
  encrypted: IngressQueueMessage["encrypted"];
  expiresAt: number;
};

const RAW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function base64ToBytea(value: string): string {
  const binary = atob(value);
  let hex = "";
  for (let index = 0; index < binary.length; index += 1) {
    hex += binary.charCodeAt(index).toString(16).padStart(2, "0");
  }
  return `\\x${hex}`;
}

export class TenantCoordinator extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const candidate = ingressQueueMessageSchema.safeParse(await request.json<unknown>());
    if (!candidate.success) {
      return Response.json({ accepted: false, reason: "invalid" }, { status: 400 });
    }
    const message: IngressQueueMessage = candidate.data;
    const context = `ingress:${message.userId}:${message.envelopeId}`;
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
        raw_ciphertext: base64ToBytea(message.encrypted.ciphertext),
        raw_nonce: base64ToBytea(message.encrypted.nonce),
        wrapped_data_key: base64ToBytea(message.encrypted.wrappedKey),
        wrap_nonce: base64ToBytea(message.encrypted.wrapNonce),
        key_version: message.encrypted.keyVersion,
      }),
    });

    if (response.status === 409) return "duplicate";
    if (!response.ok) {
      throw new Error(`Source persistence failed with ${response.status.toString()}`);
    }
    return "stored";
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
