import { z } from "zod";

export const sourceKindSchema = z.enum(["gmail", "notification", "sms", "email"]);
export type SourceKind = z.infer<typeof sourceKindSchema>;
export const rawUuidSchema = z.uuid();
export const canonicalUuidSchema = rawUuidSchema.transform((value) => value.toLowerCase());
export const relayUserIdSchema = canonicalUuidSchema;
export const deviceIdSchema = canonicalUuidSchema;
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
  id: canonicalUuidSchema,
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
    id: canonicalUuidSchema,
  })
  .strict();
export type DeviceIngressAcknowledgement = z.infer<typeof deviceIngressAcknowledgementSchema>;

const postgresIntegerSchema = z.int().min(1).max(2_147_483_647);
export const sha256FingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/u);
export const contentFingerprintSchema = sha256FingerprintSchema;

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
  "fact_integrity_conflict",
  "persistence_response_invalid",
  "coordinator_unavailable",
  "retry_exhausted_unknown",
]);
export type DeadLetterFailureCode = z.infer<typeof deadLetterFailureCodeSchema>;

export const ingressQueueMessageSchema = z
  .object({
    schemaVersion: z.literal(1),
    userId: rawUuidSchema,
    envelopeId: rawUuidSchema,
    acceptedAt: z.iso.datetime({ offset: true }),
    rawExpiresAt: z.iso.datetime({ offset: true }),
    encryptionEnvironment: z.enum(["development", "production"]),
    recoveryId: rawUuidSchema,
    replayRequestId: rawUuidSchema.optional(),
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

export const factKindSchema = z.enum([
  "sender",
  "date",
  "amount",
  "currency",
  "merchant",
  "location",
  "reference",
]);
export type FactKind = z.infer<typeof factKindSchema>;

export const exactDecimalStringSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u, "Amount must be a plain decimal string");

export const factDateRoleSchema = z.enum([
  "occurred",
  "captured",
  "sent",
  "received",
  "transaction",
  "due",
  "start",
  "end",
]);
export type FactDateRole = z.infer<typeof factDateRoleSchema>;

export const factLocationRoleSchema = z.enum([
  "merchant",
  "origin",
  "destination",
  "event",
  "other",
]);

export const factReferenceKindSchema = z.enum([
  "transaction",
  "order",
  "tracking",
  "booking",
  "invoice",
  "other",
]);

export const factProvenanceFieldSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(
    /^(?:sender|occurredAt|capturedAt|attributes\.(?:sender|dates|amount|currency|merchant|location|reference)(?:\[\d+\])?)$/u,
    "Unsupported fact provenance field",
  );

export const factProvenanceSchema = z
  .object({
    field: factProvenanceFieldSchema,
    start: z.int().min(0).max(1_000_000).optional(),
    end: z.int().min(1).max(1_000_000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.start === undefined) !== (value.end === undefined)) {
      context.addIssue({ code: "custom", message: "Provenance offsets must be paired" });
    } else if (value.start !== undefined && value.end !== undefined && value.end <= value.start) {
      context.addIssue({ code: "custom", message: "Provenance end must follow start" });
    }
  });
export type FactProvenance = z.infer<typeof factProvenanceSchema>;

const factTextValueSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => value === value.trim(), "Fact text must not have surrounding whitespace");

export const senderFactValueSchema = factTextValueSchema;
export const canonicalFactInstantSchema = z
  .string()
  .length(30)
  .regex(/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z$/u)
  .refine((value) => {
    const seconds = `${value.slice(0, 19)}.000Z`;
    const timestamp = Date.parse(seconds);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === seconds;
  }, "Fact instant must be a real UTC instant with nanosecond precision");
export const dateFactValueSchema = z
  .object({ role: factDateRoleSchema, instant: canonicalFactInstantSchema })
  .strict();
export const amountFactValueSchema = exactDecimalStringSchema;
export const currencyFactValueSchema = z.string().regex(/^[A-Z]{3}$/u);
export const merchantFactValueSchema = factTextValueSchema;
export const locationFactValueSchema = z
  .object({ label: factTextValueSchema, role: factLocationRoleSchema.optional() })
  .strict();
export const referenceFactValueSchema = z
  .object({ kind: factReferenceKindSchema, value: factTextValueSchema })
  .strict();

export const normalizationDateCandidateSchema = z
  .object({
    role: factDateRoleSchema,
    instant: z.iso
      .datetime({ offset: true })
      .min(20)
      .max(35)
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u),
  })
  .strict();

const sourceFactIdentityShape = {
  sourceItemId: canonicalUuidSchema,
  normalizerVersion: postgresIntegerSchema,
  ordinal: z.int().min(0).max(63),
  provenance: z.array(factProvenanceSchema).min(1).max(16),
};

export const senderFactSchema = z
  .object({
    ...sourceFactIdentityShape,
    kind: z.literal("sender"),
    certainty: z.literal("certain"),
    value: senderFactValueSchema,
  })
  .strict();
export const dateFactSchema = z
  .object({
    ...sourceFactIdentityShape,
    kind: z.literal("date"),
    certainty: z.literal("certain"),
    value: dateFactValueSchema,
  })
  .strict();
export const amountFactSchema = z
  .object({
    ...sourceFactIdentityShape,
    kind: z.literal("amount"),
    certainty: z.literal("certain"),
    value: amountFactValueSchema,
  })
  .strict();
export const currencyFactSchema = z
  .object({
    ...sourceFactIdentityShape,
    kind: z.literal("currency"),
    certainty: z.literal("certain"),
    value: currencyFactValueSchema,
  })
  .strict();
export const merchantFactSchema = z
  .object({
    ...sourceFactIdentityShape,
    kind: z.literal("merchant"),
    certainty: z.literal("certain"),
    value: merchantFactValueSchema,
  })
  .strict();
export const locationFactSchema = z
  .object({
    ...sourceFactIdentityShape,
    kind: z.literal("location"),
    certainty: z.literal("certain"),
    value: locationFactValueSchema,
  })
  .strict();
export const referenceFactSchema = z
  .object({
    ...sourceFactIdentityShape,
    kind: z.literal("reference"),
    certainty: z.literal("certain"),
    value: referenceFactValueSchema,
  })
  .strict();

export const factUncertaintyReasonSchema = z.enum(["invalid", "contradictory"]);
export const uncertainFactSchema = z
  .object({
    ...sourceFactIdentityShape,
    kind: factKindSchema,
    certainty: z.literal("uncertain"),
    uncertaintyReason: factUncertaintyReasonSchema,
  })
  .strict();

export const sourceFactSchema = z.union([
  senderFactSchema,
  dateFactSchema,
  amountFactSchema,
  currencyFactSchema,
  merchantFactSchema,
  locationFactSchema,
  referenceFactSchema,
  uncertainFactSchema,
]);
export type SourceFact = z.infer<typeof sourceFactSchema>;

export const sourceFactSetSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceItemId: canonicalUuidSchema,
    normalizerVersion: postgresIntegerSchema,
    facts: z.array(sourceFactSchema).min(1).max(64),
  })
  .strict()
  .superRefine((value, context) => {
    value.facts.forEach((fact, index) => {
      if (fact.sourceItemId !== value.sourceItemId) {
        context.addIssue({
          code: "custom",
          message: "Fact source item must match its fact set",
          path: ["facts", index, "sourceItemId"],
        });
      }
      if (fact.normalizerVersion !== value.normalizerVersion) {
        context.addIssue({
          code: "custom",
          message: "Fact normalizer version must match its fact set",
          path: ["facts", index, "normalizerVersion"],
        });
      }
      if (fact.ordinal !== index) {
        context.addIssue({
          code: "custom",
          message: "Fact ordinals must be contiguous and ordered",
          path: ["facts", index, "ordinal"],
        });
      }
    });
  });
export type SourceFactSet = z.infer<typeof sourceFactSetSchema>;

export const deadLetterStatusSchema = z.enum([
  "available",
  "replaying",
  "succeeded",
  "duplicate",
  "expired",
]);

export const deadLetterMetadataSchema = z
  .object({
    id: canonicalUuidSchema,
    envelopeId: canonicalUuidSchema,
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
  .object({ id: canonicalUuidSchema, requestId: canonicalUuidSchema })
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

export const categoryCustomSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "Category slug must be lowercase kebab-case");

/**
 * Category display name. Length matches the database `categories_name_length` constraint, and the
 * blank check mirrors `categories_name_not_blank`. Tenant uniqueness is enforced by the database
 * against the normalized form (see `normalizeCategoryName` in `@relay/domain`), not here.
 */
export const categoryNameSchema = z
  .string()
  .min(1)
  .max(60)
  .refine((value) => value.trim().length > 0, "Category name cannot be blank");

export const categoryCreateRequestSchema = z
  .object({
    slug: categoryCustomSlugSchema,
    name: categoryNameSchema,
    description: z.string().max(280).optional(),
    quietByDefault: z.boolean().optional(),
    sortOrder: z.int().min(0).optional(),
  })
  .strict();
export type CategoryCreateRequest = z.infer<typeof categoryCreateRequestSchema>;

export const categoryUpdateRequestSchema = z
  .object({
    name: categoryNameSchema.optional(),
    description: z.string().max(280).nullable().optional(),
    quietByDefault: z.boolean().optional(),
    sortOrder: z.int().min(0).optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Category update requires at least one field");
export type CategoryUpdateRequest = z.infer<typeof categoryUpdateRequestSchema>;

export const categorySchema = z
  .object({
    id: canonicalUuidSchema,
    slug: z.string().min(1).max(64),
    name: categoryNameSchema,
    description: z.string().max(280).optional(),
    isSystem: z.boolean(),
    quietByDefault: z.boolean(),
    sortOrder: z.int().min(0),
    archivedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
export type Category = z.infer<typeof categorySchema>;

export const eventKindSchema = z.enum(["task", "reminder", "calendar-event", "fact"]);
export const relayEventSchema = z.object({
  id: canonicalUuidSchema,
  sourceItemId: canonicalUuidSchema,
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
  id: canonicalUuidSchema,
  eventId: canonicalUuidSchema,
  ruleId: canonicalUuidSchema,
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
