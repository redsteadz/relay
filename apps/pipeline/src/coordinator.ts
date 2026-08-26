import { DurableObject } from "cloudflare:workers";

import {
  ingressQueueMessageSchema,
  relayUserIdSchema,
  type DeadLetterFailureCode,
  type IngressEnvelope,
} from "@relay/contracts";
import { decryptValue } from "@relay/crypto";
import { contentFingerprint, sourceIdentity } from "@relay/domain";

import {
  readPersistenceConfiguration,
  supabaseBackendHeaders,
  type PersistenceConfiguration,
} from "./configuration";
import { base64ToPostgresBytea, sourceItemEncryptionContext } from "./encryption";
import type { Env, IngressQueueMessage } from "./env";
import { recordPipelineMetric } from "./metrics";
import {
  parseDecryptedIngressEnvelope,
  parseSourcePersistenceResponse,
  SourcePersistenceError,
} from "./persistence";
import { SerialExecutor } from "./serialization";

type LocalSourceRecord = {
  encrypted: IngressQueueMessage["encrypted"];
  expiresAt: number;
};

const E2E_RESULT_PREFIX = "e2e-result:";

function failureResponse(failureCode: DeadLetterFailureCode): Response {
  return Response.json({ accepted: false, failureCode }, { status: 503 });
}

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
  private readonly processing = new SerialExecutor();

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
        const message = ingressQueueMessageSchema.safeParse(
          await request.json<unknown>().catch(() => undefined),
        );
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

    const candidate = ingressQueueMessageSchema.safeParse(
      await request.json<unknown>().catch(() => undefined),
    );
    if (!candidate.success) {
      return Response.json({ accepted: false, reason: "invalid" }, { status: 400 });
    }
    return this.processing.run(() => this.process(candidate.data));
  }

  private async process(message: IngressQueueMessage): Promise<Response> {
    const startedAt = performance.now();
    let configuration: PersistenceConfiguration;
    try {
      configuration = readPersistenceConfiguration(this.env);
    } catch {
      return failureResponse("configuration_invalid");
    }
    if (message.encryptionEnvironment !== configuration.environment) {
      return failureResponse("configuration_invalid");
    }
    if (configuration.keyring.keys[message.encrypted.keyVersion] === undefined) {
      return failureResponse("key_version_unavailable");
    }
    const context = sourceItemEncryptionContext(message.userId, message.envelopeId);
    let plaintext: string;
    try {
      plaintext = await decryptValue(message.encrypted, configuration.keyring, context);
    } catch {
      return failureResponse("ciphertext_invalid");
    }
    const envelope = parseDecryptedIngressEnvelope(plaintext, message);
    if (envelope === undefined) {
      return failureResponse("envelope_invalid");
    }
    if (Date.parse(message.rawExpiresAt) <= Date.now()) {
      return Response.json({ accepted: false, reason: "expired" }, { status: 410 });
    }

    const identity = sourceIdentity(envelope);
    const fingerprint = await contentFingerprint(envelope);
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
      recordPipelineMetric(
        this.env.PIPELINE_METRICS,
        "source_item_duplicate",
        1,
        performance.now() - startedAt,
      );
      return Response.json({ accepted: false, reason: "duplicate" });
    }

    let persistence: "stored" | "duplicate" | "local";
    try {
      persistence = await this.persist(configuration, message, envelope, fingerprint);
    } catch (error) {
      recordPipelineMetric(
        this.env.PIPELINE_METRICS,
        "source_item_failed",
        1,
        performance.now() - startedAt,
      );
      return failureResponse(
        error instanceof SourcePersistenceError ? error.reason : "persistence_unavailable",
      );
    }
    recordPipelineMetric(
      this.env.PIPELINE_METRICS,
      persistence === "duplicate" ? "source_item_duplicate" : "source_item_persisted",
      1,
      performance.now() - startedAt,
    );
    const now = Date.now();
    const records: Record<string, unknown> = {};
    if (persistence !== "duplicate") {
      records[identityKey] = now;
      records[fingerprintKey] = now;
    }
    if (persistence === "local") {
      const expiresAt = Date.parse(message.rawExpiresAt);
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
    if (Object.keys(records).length > 0) await this.ctx.storage.put(records);

    return Response.json({
      accepted: persistence !== "duplicate",
      reason: persistence === "duplicate" ? "duplicate" : "persisted",
    });
  }

  private async persist(
    configuration: PersistenceConfiguration,
    message: IngressQueueMessage,
    envelope: IngressEnvelope,
    fingerprint: string,
  ): Promise<"stored" | "duplicate" | "local"> {
    if (configuration.supabase === undefined) return "local";

    const response = await fetch(
      `${configuration.supabase.url}/rest/v1/rpc/persist_encrypted_source_item_v2`,
      {
        method: "POST",
        headers: supabaseBackendHeaders(configuration.supabase.serviceRoleKey),
        body: JSON.stringify({
          p_application_id: envelope.source.applicationId ?? null,
          p_accepted_at: message.acceptedAt,
          p_captured_at: envelope.capturedAt,
          p_content_fingerprint: fingerprint,
          p_encryption_environment: configuration.environment,
          p_external_id: envelope.source.externalId,
          p_id: envelope.id,
          p_key_version: message.encrypted.keyVersion,
          p_occurred_at: envelope.occurredAt,
          p_raw_ciphertext: base64ToPostgresBytea(message.encrypted.ciphertext),
          p_raw_expires_at: message.rawExpiresAt,
          p_raw_nonce: base64ToPostgresBytea(message.encrypted.nonce),
          p_source: envelope.source.kind,
          p_source_account_id: envelope.source.accountId ?? null,
          p_user_id: message.userId,
          p_wrap_nonce: base64ToPostgresBytea(message.encrypted.wrapNonce),
          p_wrapped_data_key: base64ToPostgresBytea(message.encrypted.wrappedKey),
        }),
      },
    );

    return parseSourcePersistenceResponse(response);
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
