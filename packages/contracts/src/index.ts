import { z } from "zod";

export const sourceKindSchema = z.enum(["gmail", "notification", "sms", "email"]);
export type SourceKind = z.infer<typeof sourceKindSchema>;
export const relayUserIdSchema = z.uuid();
export const deviceIdSchema = z.uuid();
export const devicePlatformSchema = z.enum(["android", "ios", "web"]);
export const MAX_INGRESS_QUEUE_MESSAGE_BYTES = 120_000;
export const RAW_PAYLOAD_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const deviceRegistrationRequestSchema = z
  .object({ id: deviceIdSchema, platform: devicePlatformSchema })
  .strict();
export const deviceMutationRequestSchema = z.object({ id: deviceIdSchema }).strict();
export const deviceRegistrationResponseSchema = z
  .object({ id: deviceIdSchema, name: z.string().min(1).max(80), platform: devicePlatformSchema })
  .strict();
export type DeviceRegistrationResponse = z.infer<typeof deviceRegistrationResponseSchema>;

export const sourceReferenceSchema = z.object({
  kind: sourceKindSchema,
  externalId: z.string().min(1).max(512),
  accountId: z.string().min(1).max(256).optional(),
  applicationId: z.string().min(1).max(256).optional(),
});

export const ingressEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  occurredAt: z.iso.datetime({ offset: true }),
  capturedAt: z.iso.datetime({ offset: true }),
  source: sourceReferenceSchema,
  sender: z.string().max(1024).optional(),
  subject: z.string().max(4096).optional(),
  body: z.string().max(1_000_000).optional(),
  attributes: z.record(z.string(), z.unknown()).default({}),
});
export type IngressEnvelope = z.infer<typeof ingressEnvelopeSchema>;

export const encryptedIngressPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    acceptedAt: z.iso.datetime({ offset: true }),
    rawExpiresAt: z.iso.datetime({ offset: true }),
    envelope: ingressEnvelopeSchema,
  })
  .strict()
  .refine(
    (value) =>
      Date.parse(value.rawExpiresAt) - Date.parse(value.acceptedAt) === RAW_PAYLOAD_RETENTION_MS,
    { message: "Raw payload expiry must be exactly seven days after acceptance" },
  );
export type EncryptedIngressPayload = z.infer<typeof encryptedIngressPayloadSchema>;

export const deviceIngressRequestSchema = z
  .object({ deviceId: deviceIdSchema, envelope: ingressEnvelopeSchema })
  .strict();

export const deviceIngressAcknowledgementSchema = z
  .object({
    accepted: z.literal(true),
    durable: z.literal(true),
    id: z.uuid(),
  })
  .strict();
export type DeviceIngressAcknowledgement = z.infer<typeof deviceIngressAcknowledgementSchema>;

const postgresIntegerSchema = z.int().min(1).max(2_147_483_647);

function decodedBase64ByteLength(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

const aesGcmNonceSchema = z.base64().refine((value) => decodedBase64ByteLength(value) === 12);

export const encryptedValueSchema = z
  .object({
    algorithm: z.literal("AES-GCM-256"),
    ciphertext: z
      .base64()
      .max(119_900)
      .refine((value) => decodedBase64ByteLength(value) >= 16),
    keyVersion: postgresIntegerSchema,
    nonce: aesGcmNonceSchema,
    wrappedKey: z.base64().refine((value) => decodedBase64ByteLength(value) === 48),
    wrapNonce: aesGcmNonceSchema,
  })
  .strict();
export type EncryptedValueContract = z.infer<typeof encryptedValueSchema>;

export const deadLetterFailureCodeSchema = z.enum([
  "configuration_invalid",
  "key_version_unavailable",
  "ciphertext_invalid",
  "envelope_invalid",
  "persistence_unavailable",
  "tenant_id_conflict",
  "persistence_response_invalid",
  "coordinator_unavailable",
  "retry_exhausted_unknown",
]);
export type DeadLetterFailureCode = z.infer<typeof deadLetterFailureCodeSchema>;

export const ingressQueueMessageSchema = z
  .object({
    schemaVersion: z.literal(1),
    userId: relayUserIdSchema,
    envelopeId: z.uuid(),
    acceptedAt: z.iso.datetime({ offset: true }),
    rawExpiresAt: z.iso.datetime({ offset: true }),
    encryptionEnvironment: z.enum(["development", "production"]),
    recoveryId: z.uuid(),
    replayRequestId: z.uuid().optional(),
    failureCode: deadLetterFailureCodeSchema.optional(),
    encrypted: encryptedValueSchema,
  })
  .strict()
  .refine(
    (value) =>
      Date.parse(value.rawExpiresAt) - Date.parse(value.acceptedAt) === RAW_PAYLOAD_RETENTION_MS,
    { message: "Queue expiry must be exactly seven days after acceptance" },
  );
export type IngressQueueMessage = z.infer<typeof ingressQueueMessageSchema>;

export const deadLetterStatusSchema = z.enum([
  "available",
  "replaying",
  "succeeded",
  "duplicate",
  "expired",
]);

export const deadLetterMetadataSchema = z
  .object({
    id: z.uuid(),
    envelopeId: z.uuid(),
    failureCode: deadLetterFailureCodeSchema,
    status: deadLetterStatusSchema,
    acceptedAt: z.iso.datetime({ offset: true }),
    rawExpiresAt: z.iso.datetime({ offset: true }),
    keyVersion: postgresIntegerSchema.nullable(),
    replayCount: z.int().min(0),
    firstFailedAt: z.iso.datetime({ offset: true }),
    lastFailedAt: z.iso.datetime({ offset: true }),
    lastReplayedAt: z.iso.datetime({ offset: true }).nullable(),
    completedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();
export type DeadLetterMetadata = z.infer<typeof deadLetterMetadataSchema>;

export const deadLetterReplayRequestSchema = z
  .object({ id: z.uuid(), requestId: z.uuid() })
  .strict();

export const categorySlugSchema = z.enum([
  "transaction",
  "task",
  "event",
  "reminder",
  "delivery",
  "travel",
  "security",
  "communication",
  "promotion",
  "other",
]);
export type CategorySlug = z.infer<typeof categorySlugSchema>;

export const eventKindSchema = z.enum(["task", "reminder", "calendar-event", "fact"]);
export const relayEventSchema = z.object({
  id: z.uuid(),
  sourceItemId: z.uuid(),
  kind: eventKindSchema,
  title: z.string().min(1).max(512),
  summary: z.string().max(4096),
  startsAt: z.iso.datetime({ offset: true }).optional(),
  dueAt: z.iso.datetime({ offset: true }).optional(),
  confidence: z.number().min(0).max(1),
  provenance: z.array(z.string().min(1)).min(1),
});
export type RelayEvent = z.infer<typeof relayEventSchema>;

export const filterFieldSchema = z.enum([
  "source.kind",
  "source.applicationId",
  "sender",
  "subject",
  "body",
  "category",
  "attributes.currency",
  "attributes.merchant",
  "attributes.amount",
]);

export const filterPredicateSchema = z.object({
  field: filterFieldSchema,
  operator: z.enum(["equals", "contains", "starts-with", "exists", "in"]),
  value: z.union([z.string(), z.array(z.string())]).optional(),
});

export type FilterExpression =
  | z.infer<typeof filterPredicateSchema>
  | { all: FilterExpression[] }
  | { any: FilterExpression[] }
  | { not: FilterExpression };

export const filterExpressionSchema: z.ZodType<FilterExpression> = z.lazy(() =>
  z.union([
    filterPredicateSchema,
    z.object({ all: z.array(filterExpressionSchema).min(1) }),
    z.object({ any: z.array(filterExpressionSchema).min(1) }),
    z.object({ not: filterExpressionSchema }),
  ]),
);

export const filterPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    intent: z.string().min(1).max(4000),
    deterministic: filterExpressionSchema.optional(),
    semantic: z
      .object({
        question: z.string().min(1).max(2000),
        minimumConfidence: z.number().min(0).max(1).default(0.8),
        allowedFields: z.array(filterFieldSchema).min(1),
      })
      .optional(),
  })
  .refine((plan) => plan.deterministic !== undefined || plan.semantic !== undefined, {
    message: "A filter needs deterministic or semantic evaluation",
  });
export type FilterPlan = z.infer<typeof filterPlanSchema>;

export const actionProviderSchema = z.enum(["google-tasks", "nextcloud-budget", "webhook"]);
export const actionIntentSchema = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  ruleId: z.uuid(),
  provider: actionProviderSchema,
  approval: z.enum(["required", "approved", "automatic"]),
  operation: z.string().min(1).max(128),
  input: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime({ offset: true }),
});
export type ActionIntent = z.infer<typeof actionIntentSchema>;

export const openAiApiKeySchema = z
  .string()
  .min(20)
  .max(256)
  .regex(/^\S+$/, "Key must not contain whitespace");

export const openAiCredentialSubmitRequestSchema = z
  .object({ apiKey: openAiApiKeySchema })
  .strict();

export const openAiCredentialStatusSchema = z
  .object({
    provider: z.literal("openai"),
    configured: z.boolean(),
    lastValidatedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
export type OpenAiCredentialStatus = z.infer<typeof openAiCredentialStatusSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});

export const healthResponseSchema = z.object({
  service: z.string(),
  status: z.literal("ok"),
  version: z.string(),
});
