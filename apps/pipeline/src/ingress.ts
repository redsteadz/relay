import {
  encryptedIngressPayloadSchema,
  ingressEnvelopeSchema,
  RAW_PAYLOAD_RETENTION_MS,
  relayUserIdSchema,
  type IngressEnvelope,
  type IngressProducer,
} from "@relay/contracts";
import { encryptValue } from "@relay/crypto";

import { PersistenceConfigurationError, readPersistenceConfiguration } from "./configuration";
import { withOperationDeadline } from "./deadline";
import { sourceItemEncryptionContext } from "./encryption";
import type { Env } from "./env";
import { publishIngressQueueMessage } from "./queue";

export type IngressPublicationResult =
  | { accepted: true }
  | {
      accepted: false;
      reason:
        | "encryption-keyring-invalid"
        | "invalid"
        | "persistence-configuration-invalid"
        | "queue-message-too-large";
    };

export type IngressPublicationOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export async function publishEncryptedIngress(
  env: Env,
  userIdCandidate: string,
  envelopeCandidate: IngressEnvelope,
  producer: IngressProducer,
  options: IngressPublicationOptions = {},
): Promise<IngressPublicationResult> {
  const userId = relayUserIdSchema.safeParse(userIdCandidate);
  const envelope = ingressEnvelopeSchema.safeParse(envelopeCandidate);
  if (!userId.success || !envelope.success) return { accepted: false, reason: "invalid" };

  let configuration;
  try {
    configuration = readPersistenceConfiguration(env);
  } catch (error) {
    return {
      accepted: false,
      reason:
        error instanceof PersistenceConfigurationError
          ? error.reason
          : "persistence-configuration-invalid",
    };
  }

  const acceptedAt = new Date().toISOString();
  const rawExpiresAt = new Date(Date.parse(acceptedAt) + RAW_PAYLOAD_RETENTION_MS).toISOString();
  const payload = encryptedIngressPayloadSchema.parse({
    schemaVersion: 2,
    acceptedAt,
    rawExpiresAt,
    producer,
    envelope: envelope.data,
  });
  const context = sourceItemEncryptionContext(userId.data, envelope.data.id);
  const encrypted = await encryptValue(JSON.stringify(payload), configuration.keyring, context);
  const publish = (): Promise<boolean> =>
    publishIngressQueueMessage(env.INGRESS_QUEUE, {
      schemaVersion: 1,
      userId: userId.data,
      envelopeId: envelope.data.id,
      recoveryId: envelope.data.id,
      acceptedAt,
      rawExpiresAt,
      encryptionEnvironment: configuration.environment,
      encrypted,
    });
  const published =
    options.timeoutMs === undefined
      ? await publish()
      : await withOperationDeadline(publish, options.timeoutMs, options.signal);
  return published ? { accepted: true } : { accepted: false, reason: "queue-message-too-large" };
}
