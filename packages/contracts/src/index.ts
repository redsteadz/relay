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

export const gmailHistoryIdSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^(?:0|[1-9][0-9]*)$/u, "Gmail History ID must be a decimal string");

function hasForbiddenMailboxCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return /\s/u.test(character) || codePoint <= 31 || codePoint === 127;
  });
}

export const normalizedGmailMailboxSchema = z
  .string()
  .min(3)
  .max(320)
  .refine(
    (value) =>
      value === value.trim().toLowerCase() &&
      value.includes("@") &&
      !hasForbiddenMailboxCharacter(value),
    "Gmail mailbox must be normalized",
  );

export const gmailPushCursorPayloadSchema = z
  .object({
    emailAddress: z.string().min(3).max(320),
    historyId: gmailHistoryIdSchema,
  })
  .strict();

export const verifiedGmailCursorSchema = z
  .object({
    schemaVersion: z.literal(1),
    emailAddress: normalizedGmailMailboxSchema,
    historyId: gmailHistoryIdSchema,
  })
  .strict();
export type VerifiedGmailCursor = z.infer<typeof verifiedGmailCursorSchema>;

export const gmailDisconnectRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    connectionId: canonicalUuidSchema,
    userId: relayUserIdSchema,
  })
  .strict();
export type GmailDisconnectRequest = z.infer<typeof gmailDisconnectRequestSchema>;

const pubSubAttributesSchema = z
  .record(z.string().min(1).max(256), z.string().max(1024))
  .refine((value) => Object.keys(value).length <= 32, "Too many Pub/Sub attributes");

const pubSubMessageIdSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^(?:0|[1-9][0-9]*)$/u);
const pubSubPublishTimeSchema = z.iso.datetime({ offset: true });

const gmailPubSubMessageSchema = z
  .object({
    attributes: pubSubAttributesSchema.optional(),
    data: z
      .string()
      .min(1)
      .max(4096)
      .regex(/^[A-Za-z0-9_-]+={0,2}$/u),
    messageId: pubSubMessageIdSchema,
    message_id: pubSubMessageIdSchema.optional(),
    orderingKey: z.string().max(1024).optional(),
    publishTime: pubSubPublishTimeSchema,
    publish_time: pubSubPublishTimeSchema.optional(),
  })
  .strict()
  .superRefine((message, context) => {
    if (message.message_id !== undefined && message.message_id !== message.messageId) {
      context.addIssue({ code: "custom", message: "Pub/Sub message ID aliases must match" });
    }
    if (message.publish_time !== undefined && message.publish_time !== message.publishTime) {
      context.addIssue({ code: "custom", message: "Pub/Sub publish time aliases must match" });
    }
  })
  .transform((message) => ({
    ...(message.attributes === undefined ? {} : { attributes: message.attributes }),
    data: message.data,
    messageId: message.messageId,
    ...(message.orderingKey === undefined ? {} : { orderingKey: message.orderingKey }),
    publishTime: message.publishTime,
  }));

export const gmailPubSubPushSchema = z
  .object({
    message: gmailPubSubMessageSchema,
    subscription: z
      .string()
      .min(1)
      .max(512)
      .regex(/^projects\/[A-Za-z0-9._~+%-]+\/subscriptions\/[A-Za-z0-9._~+%-]+$/u),
    deliveryAttempt: z.int().min(1).max(2_147_483_647).optional(),
  })
  .strict();

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

export const ingressProducerSchema = z.enum(["device", "gmail-provider"]);
export type IngressProducer = z.infer<typeof ingressProducerSchema>;

const encryptedIngressPayloadV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    acceptedAt: z.iso.datetime({ offset: true }),
    rawExpiresAt: z.iso.datetime({ offset: true }),
    producer: ingressProducerSchema,
    envelope: ingressEnvelopeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.envelope.source.kind === "gmail") !== (value.producer === "gmail-provider")) {
      context.addIssue({
        code: "custom",
        message: "Ingress producer does not own source kind",
        path: ["producer"],
      });
    }
  })
  .refine(
    (value) =>
      Date.parse(value.rawExpiresAt) - Date.parse(value.acceptedAt) === RAW_PAYLOAD_RETENTION_MS,
    { message: "Raw payload expiry must be exactly seven days after acceptance" },
  );

const encryptedIngressPayloadV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    acceptedAt: z.iso.datetime({ offset: true }),
    rawExpiresAt: z.iso.datetime({ offset: true }),
    envelope: ingressEnvelopeSchema,
  })
  .strict()
  .refine((value) => value.envelope.source.kind !== "gmail", {
    message: "Legacy ingress cannot claim reserved Gmail source",
    path: ["envelope", "source", "kind"],
  })
  .refine(
    (value) =>
      Date.parse(value.rawExpiresAt) - Date.parse(value.acceptedAt) === RAW_PAYLOAD_RETENTION_MS,
    { message: "Raw payload expiry must be exactly seven days after acceptance" },
  )
  .transform((value) => ({ ...value, producer: "device" as const }));

export const encryptedIngressPayloadSchema = z.union([
  encryptedIngressPayloadV2Schema,
  encryptedIngressPayloadV1Schema,
]);
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
  "event_integrity_conflict",
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

export const EVENT_TITLE_MAX_LENGTH = 160;
export const EVENT_SUMMARY_MAX_LENGTH = 280;
export const EVENT_AUTOMATION_MIN_CONFIDENCE = 0.8;

export const eventKindSchema = z.enum(["task", "reminder", "calendar-event", "fact"]);
export type EventKind = z.infer<typeof eventKindSchema>;
export const eventTemporalStatusSchema = z.enum(["none", "resolved", "ambiguous"]);
export const eventDateAmbiguitySchema = z.enum(["invalid", "contradictory", "inconsistent-range"]);

export const eventProvenanceSchema = z
  .object({
    factOrdinal: z.int().min(0).max(63),
    fields: z.array(factProvenanceSchema).min(1).max(16),
  })
  .strict();
export type EventProvenance = z.infer<typeof eventProvenanceSchema>;

const sourceEventIdentityShape = {
  sourceItemId: canonicalUuidSchema,
  normalizerVersion: postgresIntegerSchema,
  extractorVersion: postgresIntegerSchema,
  ordinal: z.int().min(0).max(15),
  title: z
    .string()
    .min(1)
    .max(EVENT_TITLE_MAX_LENGTH)
    .refine((value) => value === value.trim(), "Event title must not have surrounding whitespace"),
  summary: z
    .string()
    .min(1)
    .max(EVENT_SUMMARY_MAX_LENGTH)
    .refine(
      (value) => value === value.trim(),
      "Event summary must not have surrounding whitespace",
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .refine(
      (value) => Number.isInteger(value * 1000),
      "Event confidence supports at most three decimal places",
    ),
  requiresReview: z.boolean(),
  temporalStatus: eventTemporalStatusSchema,
  timeZone: z.literal("UTC").nullable(),
  startsAt: canonicalFactInstantSchema.optional(),
  endsAt: canonicalFactInstantSchema.optional(),
  dueAt: canonicalFactInstantSchema.optional(),
  dateAmbiguity: eventDateAmbiguitySchema.optional(),
  provenance: z.array(eventProvenanceSchema).min(1).max(16),
};

function validateEventTemporalShape(
  value: {
    kind: EventKind;
    confidence: number;
    requiresReview: boolean;
    temporalStatus: z.infer<typeof eventTemporalStatusSchema>;
    timeZone: "UTC" | null;
    startsAt?: string | undefined;
    endsAt?: string | undefined;
    dueAt?: string | undefined;
    dateAmbiguity?: z.infer<typeof eventDateAmbiguitySchema> | undefined;
    provenance: EventProvenance[];
  },
  context: z.RefinementCtx,
): void {
  const hasTemporalValue =
    value.startsAt !== undefined || value.endsAt !== undefined || value.dueAt !== undefined;
  if (value.temporalStatus === "resolved") {
    if (value.timeZone !== "UTC" || !hasTemporalValue || value.dateAmbiguity !== undefined) {
      context.addIssue({ code: "custom", message: "Resolved event time must be explicit UTC" });
    }
  } else if (
    value.timeZone !== null ||
    hasTemporalValue ||
    (value.temporalStatus === "ambiguous") !== (value.dateAmbiguity !== undefined)
  ) {
    context.addIssue({
      code: "custom",
      message: "Unresolved event time cannot contain a guessed instant or time zone",
    });
  }

  if (value.kind === "calendar-event") {
    if (value.temporalStatus === "none") {
      context.addIssue({ code: "custom", message: "Calendar event requires temporal evidence" });
    } else if (
      value.temporalStatus === "resolved" &&
      (value.startsAt === undefined || value.dueAt !== undefined)
    ) {
      context.addIssue({ code: "custom", message: "Calendar event requires a start time" });
    }
  } else if (value.kind === "reminder") {
    if (
      value.temporalStatus === "none" ||
      (value.temporalStatus === "resolved" &&
        (value.dueAt === undefined || value.startsAt !== undefined || value.endsAt !== undefined))
    ) {
      context.addIssue({ code: "custom", message: "Reminder requires a due time" });
    }
  } else if (
    value.kind === "task" &&
    (value.startsAt !== undefined || value.endsAt !== undefined)
  ) {
    context.addIssue({ code: "custom", message: "Task cannot contain calendar times" });
  } else if (value.kind === "fact" && value.temporalStatus === "resolved") {
    context.addIssue({ code: "custom", message: "Fact cannot contain resolved action time" });
  }
  if (
    value.startsAt !== undefined &&
    value.endsAt !== undefined &&
    value.endsAt <= value.startsAt
  ) {
    context.addIssue({ code: "custom", message: "Event end must follow start" });
  }

  const mustReview =
    value.confidence < EVENT_AUTOMATION_MIN_CONFIDENCE || value.temporalStatus === "ambiguous";
  if (value.requiresReview !== mustReview) {
    context.addIssue({
      code: "custom",
      message: "Event review state must match confidence and time",
    });
  }

  if (
    new Set(value.provenance.map((entry) => entry.factOrdinal)).size !== value.provenance.length
  ) {
    context.addIssue({ code: "custom", message: "Event fact provenance must be unique" });
  }
}

function sourceEventVariant(kind: EventKind) {
  return z
    .object({ ...sourceEventIdentityShape, kind: z.literal(kind) })
    .strict()
    .superRefine(validateEventTemporalShape);
}

export const taskEventSchema = sourceEventVariant("task");
export const reminderEventSchema = sourceEventVariant("reminder");
export const calendarEventSchema = sourceEventVariant("calendar-event");
export const factEventSchema = sourceEventVariant("fact");
export const sourceEventSchema = z.union([
  taskEventSchema,
  reminderEventSchema,
  calendarEventSchema,
  factEventSchema,
]);
export type SourceEvent = z.infer<typeof sourceEventSchema>;

export const sourceEventSetSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceItemId: canonicalUuidSchema,
    normalizerVersion: postgresIntegerSchema,
    extractorVersion: postgresIntegerSchema,
    events: z.array(sourceEventSchema).min(1).max(16),
  })
  .strict()
  .superRefine((value, context) => {
    value.events.forEach((event, index) => {
      if (event.sourceItemId !== value.sourceItemId) {
        context.addIssue({
          code: "custom",
          message: "Event source item must match its event set",
          path: ["events", index, "sourceItemId"],
        });
      }
      if (event.normalizerVersion !== value.normalizerVersion) {
        context.addIssue({
          code: "custom",
          message: "Event normalizer version must match its event set",
          path: ["events", index, "normalizerVersion"],
        });
      }
      if (event.extractorVersion !== value.extractorVersion) {
        context.addIssue({
          code: "custom",
          message: "Event extractor version must match its event set",
          path: ["events", index, "extractorVersion"],
        });
      }
      if (event.ordinal !== index) {
        context.addIssue({
          code: "custom",
          message: "Event ordinals must be contiguous and ordered",
          path: ["events", index, "ordinal"],
        });
      }
    });
  });
export type SourceEventSet = z.infer<typeof sourceEventSetSchema>;

export const canonicalRelayEventSchema = z
  .object({ id: canonicalUuidSchema, ...sourceEventIdentityShape, kind: eventKindSchema })
  .strict()
  .superRefine(validateEventTemporalShape);

// Rows created before versioned extraction have no extractor metadata and historically accepted
// arbitrary JSON provenance. Keep them explicit so canonical writes cannot omit current invariants.
export const legacyRelayEventSchema = z
  .object({
    id: canonicalUuidSchema,
    sourceItemId: canonicalUuidSchema,
    kind: eventKindSchema,
    title: z.string().min(1).max(512),
    summary: z.string().max(4096),
    startsAt: z.iso.datetime({ offset: true }).optional(),
    dueAt: z.iso.datetime({ offset: true }).optional(),
    confidence: z.number().min(0).max(1),
    provenance: z.json(),
  })
  .strict();
export const relayEventSchema = z.union([canonicalRelayEventSchema, legacyRelayEventSchema]);
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

export type FilterField = z.infer<typeof filterFieldSchema>;

export const filterValueOperatorSchema = z.enum(["equals", "contains", "starts-with"]);
export const filterOperatorSchema = z.enum([...filterValueOperatorSchema.options, "exists", "in"]);

const filterScalarValueSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => value === value.trim(), "Filter values must not have surrounding whitespace");

const filterTextFieldSchema = z.enum([
  "source.applicationId",
  "sender",
  "subject",
  "body",
  "attributes.merchant",
]);
const filterExistsFieldSchema = z.enum([
  ...filterTextFieldSchema.options,
  "attributes.currency",
  "attributes.amount",
]);

export const filterPredicateSchema = z
  .union([
    z
      .object({
        field: filterFieldSchema,
        operator: z.literal("equals"),
        value: filterScalarValueSchema,
      })
      .strict(),
    z
      .object({
        field: filterTextFieldSchema,
        operator: z.enum(["contains", "starts-with"]),
        value: filterScalarValueSchema,
      })
      .strict(),
    z
      .object({
        field: filterExistsFieldSchema,
        operator: z.literal("exists"),
      })
      .strict(),
    z
      .object({
        field: filterFieldSchema,
        operator: z.literal("in"),
        value: z.array(filterScalarValueSchema).min(1).max(32),
      })
      .strict(),
  ])
  .superRefine((predicate, context) => {
    if (predicate.operator === "exists") return;
    const values = Array.isArray(predicate.value) ? predicate.value : [predicate.value];
    const valid = values.every((value) => {
      if (predicate.field === "source.kind") return sourceKindSchema.safeParse(value).success;
      if (predicate.field === "category") return categoryCustomSlugSchema.safeParse(value).success;
      if (predicate.field === "attributes.currency") return /^[A-Z]{3}$/u.test(value);
      if (predicate.field === "attributes.amount") {
        return exactDecimalStringSchema.safeParse(value).success;
      }
      return true;
    });
    if (!valid) {
      context.addIssue({ code: "custom", message: "Filter value is invalid for its field" });
    }
  });

export type FilterPredicate = z.infer<typeof filterPredicateSchema>;

export type FilterExpression =
  | FilterPredicate
  | { never: true }
  | { all: FilterExpression[] }
  | { any: FilterExpression[] }
  | { not: FilterExpression };

const filterExpressionNodeSchema: z.ZodType<FilterExpression> = z.lazy(() =>
  z.union([
    filterPredicateSchema,
    z.object({ never: z.literal(true) }).strict(),
    z.object({ all: z.array(filterExpressionNodeSchema).min(1).max(16) }).strict(),
    z.object({ any: z.array(filterExpressionNodeSchema).min(1).max(16) }).strict(),
    z.object({ not: filterExpressionNodeSchema }).strict(),
  ]),
);

const boundedFilterExpressionSchema = z.unknown().superRefine((expression, context) => {
  const pending: { depth: number; value: unknown }[] = [{ depth: 1, value: expression }];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    nodes += 1;
    if (current.depth > 8) {
      context.addIssue({ code: "custom", message: "Filter expression exceeds maximum depth" });
      return;
    }
    if (nodes > 64) {
      context.addIssue({ code: "custom", message: "Filter expression exceeds maximum size" });
      return;
    }
    if (typeof current.value !== "object" || current.value === null) continue;
    const record = current.value as Record<string, unknown>;
    if (Array.isArray(record.all)) {
      if (record.all.length > 16) {
        context.addIssue({ code: "custom", message: "Filter expression has too many children" });
        return;
      }
      for (const child of record.all) pending.push({ depth: current.depth + 1, value: child });
    }
    if (Array.isArray(record.any)) {
      if (record.any.length > 16) {
        context.addIssue({ code: "custom", message: "Filter expression has too many children" });
        return;
      }
      for (const child of record.any) pending.push({ depth: current.depth + 1, value: child });
    }
    if ("not" in record) pending.push({ depth: current.depth + 1, value: record.not });
  }
});

export const filterExpressionSchema = boundedFilterExpressionSchema.pipe(
  filterExpressionNodeSchema,
);

export const filterIntentSchema = z
  .string()
  .min(1)
  .max(4000)
  .refine((value) => value === value.trim(), "Filter intent must not have surrounding whitespace");

export const filterPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    compilerVersion: z.literal(1),
    intent: filterIntentSchema,
    deterministic: filterExpressionSchema.optional(),
    semantic: z
      .object({
        question: z.string().min(1).max(2000),
        minimumConfidence: z.number().min(0).max(1).default(0.8),
        allowedFields: z.array(filterFieldSchema).min(1).max(filterFieldSchema.options.length),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((plan) => plan.deterministic !== undefined || plan.semantic !== undefined, {
    message: "A filter needs deterministic or semantic evaluation",
  });
export type FilterPlan = z.infer<typeof filterPlanSchema>;

const filterRuleNameSchema = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => value === value.trim(), "Filter name must not have surrounding whitespace");

const filterCompileRevisionShape = {
  name: filterRuleNameSchema,
  intent: filterIntentSchema,
  enabled: z.boolean().optional(),
  seriesId: canonicalUuidSchema.optional(),
  expectedVersion: postgresIntegerSchema.optional(),
};

function validateFilterRevisionPair(
  value: { expectedVersion?: number | undefined; seriesId?: string | undefined },
  context: z.RefinementCtx,
) {
  if ((value.seriesId === undefined) !== (value.expectedVersion === undefined)) {
    context.addIssue({
      code: "custom",
      message: "Filter edits require both seriesId and expectedVersion",
    });
  }
}

export const filterCompileRequestSchema = z
  .object(filterCompileRevisionShape)
  .strict()
  .superRefine(validateFilterRevisionPair);
export type FilterCompileRequest = z.infer<typeof filterCompileRequestSchema>;

export const filterCompileInternalRequestSchema = z
  .object({ userId: canonicalUuidSchema, ...filterCompileRevisionShape })
  .strict()
  .superRefine(validateFilterRevisionPair);
export type FilterCompileInternalRequest = z.infer<typeof filterCompileInternalRequestSchema>;

export const filterCompilerCategorySchema = z
  .object({
    slug: categoryCustomSlugSchema,
    name: categoryNameSchema,
  })
  .strict();
export type FilterCompilerCategory = z.infer<typeof filterCompilerCategorySchema>;

export const filterUnsupportedReasonSchema = z.enum([
  "action-intent-not-allowed",
  "invalid-value",
  "semantic-required",
]);

export const filterUnsupportedClauseSchema = z
  .object({
    text: z.string().min(1).max(1000),
    reason: filterUnsupportedReasonSchema,
  })
  .strict();
export type FilterUnsupportedClause = z.infer<typeof filterUnsupportedClauseSchema>;

export const filterSupportedPredicateSchema = z
  .object({
    field: filterFieldSchema,
    operators: z.array(filterOperatorSchema).min(1).max(filterOperatorSchema.options.length),
  })
  .strict();
export type FilterSupportedPredicate = z.infer<typeof filterSupportedPredicateSchema>;

export const filterCompilationSchema = z
  .object({
    plan: filterPlanSchema,
    supportedPredicates: z
      .array(filterSupportedPredicateSchema)
      .min(1)
      .max(filterFieldSchema.options.length),
    unsupportedClauses: z.array(filterUnsupportedClauseSchema).max(16),
  })
  .strict();
export type FilterCompilation = z.infer<typeof filterCompilationSchema>;

export const filterRuleVersionSchema = z
  .object({
    id: canonicalUuidSchema,
    userId: canonicalUuidSchema,
    seriesId: canonicalUuidSchema,
    name: filterRuleNameSchema,
    intent: filterIntentSchema,
    plan: filterPlanSchema,
    version: postgresIntegerSchema,
    enabled: z.boolean(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type FilterRuleVersion = z.infer<typeof filterRuleVersionSchema>;

export const filterCompileResponseSchema = z
  .object({
    rule: filterRuleVersionSchema,
    supportedPredicates: z
      .array(filterSupportedPredicateSchema)
      .min(1)
      .max(filterFieldSchema.options.length),
    unsupportedClauses: z.array(filterUnsupportedClauseSchema).max(16),
  })
  .strict();
export type FilterCompileResponse = z.infer<typeof filterCompileResponseSchema>;

/**
 * Semantic clause evaluation.
 *
 * A plan whose deterministic expression passes but that carries a semantic clause is `undecided`
 * until the clause is resolved through the user's own OpenAI key. Everything below describes that
 * exchange: what may leave Relay, what shape the model must answer in, and what is recorded.
 *
 * Source content is never an instruction. The question comes from compiled user intent; the item
 * fields travel as delimited data. See `docs/architecture/filter-model.md`.
 */

/** Classes of value stripped from a disclosed field. Only the class and a count are ever recorded. */
export const semanticRedactionKindSchema = z.enum([
  "api-key",
  "email-address",
  "long-digit-sequence",
  "payment-card",
  "phone-number",
  "url",
]);
export type SemanticRedactionKind = z.infer<typeof semanticRedactionKindSchema>;

/**
 * One redaction class applied to one field, with how many times it fired.
 *
 * Deliberately carries no value and no offset: a disclosure record explains what class of thing was
 * removed, never what was removed. The database enforces the same shape so the rule cannot drift.
 */
export const semanticRedactionSchema = z
  .object({
    field: filterFieldSchema,
    kind: semanticRedactionKindSchema,
    count: z.int().min(1).max(10_000),
  })
  .strict();
export type SemanticRedaction = z.infer<typeof semanticRedactionSchema>;

/** Largest disclosed value per field. Bounds one clause's disclosure regardless of body size. */
export const MAX_SEMANTIC_FIELD_CHARACTERS = 2000;
/** Largest total disclosure across every allowlisted field in one evaluation. */
export const MAX_SEMANTIC_DISCLOSURE_CHARACTERS = 6000;

export const semanticDisclosedFieldSchema = z
  .object({
    field: filterFieldSchema,
    value: z.string().min(1).max(MAX_SEMANTIC_FIELD_CHARACTERS),
    truncated: z.boolean(),
  })
  .strict();
export type SemanticDisclosedField = z.infer<typeof semanticDisclosedFieldSchema>;

/**
 * The minimized payload for one semantic clause, plus the metadata that describes it.
 *
 * `fields` holds values and never leaves the runtime that built it. `disclosedFields` and
 * `redactions` are the metadata-only projection that is persisted and shown to the user.
 */
export const semanticDisclosureSchema = z
  .object({
    fields: z.array(semanticDisclosedFieldSchema).max(filterFieldSchema.options.length),
    disclosedFields: z.array(filterFieldSchema).max(filterFieldSchema.options.length),
    redactions: z.array(semanticRedactionSchema).max(64),
  })
  .strict();
export type SemanticDisclosure = z.infer<typeof semanticDisclosureSchema>;

/**
 * The only answer shape Relay accepts from the model.
 *
 * `.strict()` is load-bearing: a response that also names a provider, endpoint, credential,
 * operation, or action is rejected outright rather than having the extra keys quietly dropped. The
 * model reports a judgement about content; it never selects an effect.
 */
export const semanticEvaluationSchema = z
  .object({
    decision: z.enum(["match", "no-match"]),
    confidence: z.number().min(0).max(1),
    rationale: z.string().min(1).max(500),
  })
  .strict();
export type SemanticEvaluation = z.infer<typeof semanticEvaluationSchema>;

/**
 * Why an evaluation produced no usable answer. Every reason resolves to `undecided`, so none of
 * them can trigger an automatic effect.
 */
export const semanticFailureReasonSchema = z.enum([
  "credential-missing",
  "credential-revoked",
  "endpoint-invalid",
  "invalid-response",
  "no-disclosable-fields",
  "quota-exhausted",
  "rate-limited",
  "response-too-large",
  "timed-out",
  "unavailable",
]);
export type SemanticFailureReason = z.infer<typeof semanticFailureReasonSchema>;

/** Fixed purpose recorded on every semantic-clause disclosure. */
export const SEMANTIC_DISCLOSURE_PURPOSE = "filter-semantic-clause";

/**
 * Model identifier for a semantic clause.
 *
 * Bounded and restricted to the characters real identifiers use, which covers a bare OpenAI name
 * (`gpt-4.1-mini`, `o3`) and the namespaced form gateways use (`anthropic/claude-sonnet-4`,
 * `meta-llama/Llama-3.3-70B-Instruct-Turbo`). It is recorded verbatim on every disclosure, so it has
 * to be something a person can read back later.
 */
export const semanticModelSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u, "Model identifier contains unsupported characters");

/** Default model when neither the tenant nor the operator names one. */
export const DEFAULT_SEMANTIC_MODEL = "gpt-4.1-mini";

/**
 * How much of the answer shape the provider itself is asked to enforce.
 *
 * Relay always validates the answer against `semanticEvaluationSchema`, which is `.strict()`, so the
 * guarantee that a reply carries exactly `decision`, `confidence`, and `rationale` never depends on
 * the provider. This setting only chooses how much the provider is asked to enforce on its side:
 *
 * - `json-schema` sends OpenAI structured outputs with `strict` set, so a non-conforming answer is
 *   refused before it is billed or returned. The default, and what api.openai.com supports.
 * - `json-object` asks only for valid JSON. Gateways and local servers that implement the older
 *   `json_object` mode use this.
 * - `none` sends no response-format hint at all, for endpoints that reject the field outright. The
 *   instruction block still states the exact answer shape.
 *
 * Relaxing this never relaxes what Relay accepts; it only changes how often a bad answer costs a
 * round trip instead of being refused at the provider.
 */
export const semanticResponseFormatSchema = z.enum(["json-schema", "json-object", "none"]);
export type SemanticResponseFormat = z.infer<typeof semanticResponseFormatSchema>;

/**
 * Host that a semantic request was sent to, recorded on the disclosure.
 *
 * Once the endpoint is configurable, "OpenAI received this" stops being true by construction, so the
 * disclosure history has to say where the data actually went. Only the host is kept: no path, no
 * query, no credential.
 */
export const semanticEndpointHostSchema = z.string().min(1).max(255);

/**
 * The outcome of resolving one semantic clause, whether or not the provider answered.
 *
 * `decision` is Relay's, not the model's: an answer below the clause's minimum confidence is
 * `undecided` even when the model reported certainty. `disclosed` records whether the request
 * actually reached OpenAI, which is what makes the difference between a disclosure that happened
 * and one that was never attempted.
 */
export const semanticOutcomeSchema = z
  .object({
    decision: z.enum(["match", "no-match", "undecided"]),
    provider: z.literal("openai"),
    model: semanticModelSchema,
    endpointHost: semanticEndpointHostSchema.optional(),
    purpose: z.literal(SEMANTIC_DISCLOSURE_PURPOSE),
    disclosedFields: z.array(filterFieldSchema).max(filterFieldSchema.options.length),
    redactions: z.array(semanticRedactionSchema).max(64),
    disclosed: z.boolean(),
    confidence: z.number().min(0).max(1).optional(),
    rationale: z.string().min(1).max(500).optional(),
    failureReason: semanticFailureReasonSchema.optional(),
  })
  .strict()
  .refine((outcome) => outcome.failureReason === undefined || outcome.decision === "undecided", {
    message: "A failed semantic evaluation cannot decide a filter",
  })
  .refine((outcome) => outcome.failureReason === undefined || outcome.confidence === undefined, {
    message: "A failed semantic evaluation has no confidence",
  })
  .refine(
    (outcome) =>
      outcome.disclosed ||
      (outcome.disclosedFields.length === 0 && outcome.redactions.length === 0),
    { message: "An undisclosed evaluation cannot report disclosed fields or redactions" },
  )
  // Present exactly when something was sent. An evaluation that reached an endpoint must say which
  // one; an evaluation that never left must not name a host it did not contact.
  .refine((outcome) => (outcome.endpointHost !== undefined) === outcome.disclosed, {
    message: "An endpoint host is recorded exactly when a request left the runtime",
  });
export type SemanticOutcome = z.infer<typeof semanticOutcomeSchema>;

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

/**
 * Action approval ledger.
 *
 * A run is the durable record that a rule proposed one provider action for one event, and what the
 * tenant decided about it. Provider, operation, connection, and approval mode all come from the
 * owning rule; nothing here lets a caller or a model supply them. See
 * `docs/architecture/action-model.md`.
 */

export const actionRunStatusSchema = z.enum([
  "proposed",
  "awaiting-approval",
  "approved",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export type ActionRunStatus = z.infer<typeof actionRunStatusSchema>;

export const actionApprovalModeSchema = z.enum(["required", "automatic"]);
export type ActionApprovalMode = z.infer<typeof actionApprovalModeSchema>;

/** The only decisions a tenant can make about a pending run. */
export const actionDecisionSchema = z.enum(["approve", "cancel"]);
export type ActionDecision = z.infer<typeof actionDecisionSchema>;

/**
 * Keys an action input may never carry.
 *
 * Input is rendered upstream from a rule template and an event. Mirrors the database's
 * `filter_plan_has_forbidden_keys`, which rejects the same names at any depth and remains the
 * authority; this exists so a caller fails before a round trip rather than after one.
 */
export const FORBIDDEN_ACTION_INPUT_KEYS: readonly string[] = [
  "action",
  "credential",
  "credentials",
  "endpoint",
  "operation",
  "provider",
];

function hasForbiddenActionInputKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenActionInputKey);
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      FORBIDDEN_ACTION_INPUT_KEYS.includes(key) || hasForbiddenActionInputKey(nested),
  );
}

export const actionRunInputSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => !hasForbiddenActionInputKey(value), {
    message: "Action input cannot select providers, operations, endpoints, or credentials",
  });

/** One row of the ledger, as returned by the proposal and claim routines. */
export const actionRunSchema = z
  .object({
    id: canonicalUuidSchema,
    userId: canonicalUuidSchema,
    actionRuleId: canonicalUuidSchema,
    eventId: canonicalUuidSchema,
    provider: actionProviderSchema,
    status: actionRunStatusSchema,
    approvalMode: actionApprovalModeSchema,
    input: z.record(z.string(), z.unknown()),
    attemptCount: z.int().min(0),
    providerReference: z.string().max(512).nullable(),
    workflowInstanceId: z.string().max(256).nullable(),
    approvedAt: z.iso.datetime({ offset: true }).nullable(),
    completedAt: z.iso.datetime({ offset: true }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine(
    (run) => run.approvedAt === null || !["proposed", "awaiting-approval"].includes(run.status),
    {
      message: "A run still awaiting a decision cannot carry an approval time",
    },
  )
  .refine((run) => run.workflowInstanceId === null || run.status !== "proposed", {
    message: "An undecided run cannot name a workflow",
  });
export type ActionRun = z.infer<typeof actionRunSchema>;

/**
 * A proposal carries identity and rendered input only.
 *
 * There is deliberately no provider, operation, connection, status, or approval-mode field: those
 * are read from the persisted rule inside the database routine, so no caller can ask for a
 * different provider or for automatic approval.
 */
export const actionProposalRequestSchema = z
  .object({
    userId: canonicalUuidSchema,
    actionRuleId: canonicalUuidSchema,
    eventId: canonicalUuidSchema,
    input: actionRunInputSchema,
  })
  .strict();
export type ActionProposalRequest = z.infer<typeof actionProposalRequestSchema>;

/** Identifies a Workflow attempt against one approved run. */
export const actionWorkflowClaimSchema = z
  .object({
    userId: canonicalUuidSchema,
    actionRunId: canonicalUuidSchema,
    workflowInstanceId: z
      .string()
      .min(1)
      .max(256)
      .refine((value) => value.trim() === value && value.trim().length > 0, {
        message: "Workflow instance must not be blank or padded",
      }),
  })
  .strict();
export type ActionWorkflowClaim = z.infer<typeof actionWorkflowClaimSchema>;

/**
 * A bearer key for the configured semantic endpoint.
 *
 * Length is provider-defined now that the endpoint is configurable -- an OpenAI key is long, a
 * gateway key may be shorter, and a local server often accepts any non-empty placeholder -- so no
 * floor beyond non-empty is meaningful. The rule that matters is the absence of whitespace: the key
 * is interpolated into an `authorization` header, and a newline in it would be header injection.
 */
export const openAiApiKeySchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^\S+$/u, "Key must not contain whitespace");

/**
 * Where a tenant's key should be used.
 *
 * Stored beside the credential because a key issued by a gateway is only valid at that gateway. All
 * three are optional; an absent field falls back to the operator default and then to OpenAI.
 */
export const semanticEndpointOverrideSchema = z
  .object({
    baseUrl: z.string().min(1).max(2048).optional(),
    model: semanticModelSchema.optional(),
    responseFormat: semanticResponseFormatSchema.optional(),
  })
  .strict();
export type SemanticEndpointOverride = z.infer<typeof semanticEndpointOverrideSchema>;

export const openAiCredentialSubmitRequestSchema = z
  .object({ apiKey: openAiApiKeySchema, endpoint: semanticEndpointOverrideSchema.optional() })
  .strict();
export type OpenAiCredentialSubmitRequest = z.infer<typeof openAiCredentialSubmitRequestSchema>;

export const openAiCredentialStatusSchema = z
  .object({
    provider: z.literal("openai"),
    configured: z.boolean(),
    lastValidatedAt: z.iso.datetime({ offset: true }).optional(),
    /**
     * The endpoint this key is for, when it is not the default. Never includes the key itself, and
     * the base URL is the normalized form, which cannot carry a query string.
     */
    endpoint: semanticEndpointOverrideSchema.optional(),
    /**
     * False when the endpoint accepted the key but exposes no way to check it, so the key was
     * stored without confirmation rather than silently treated as verified.
     */
    validated: z.boolean().optional(),
  })
  .strict();
export type OpenAiCredentialStatus = z.infer<typeof openAiCredentialStatusSchema>;

export const privacyRetentionStatusSchema = z
  .object({
    earliestExpiresAt: z.iso.datetime({ offset: true }).nullable(),
    latestExpiresAt: z.iso.datetime({ offset: true }).nullable(),
    retainedCount: z.int().min(0),
    retentionDays: z.literal(7),
  })
  .strict();
export type PrivacyRetentionStatus = z.infer<typeof privacyRetentionStatusSchema>;

export const accountDeletionStateSchema = z.enum(["requested", "connectors_revoked", "completed"]);
export const accountDeletionStatusSchema = z
  .object({
    attemptCount: z.int().min(0),
    completedAt: z.iso.datetime({ offset: true }).nullable(),
    connectorsRevokedAt: z.iso.datetime({ offset: true }).nullable(),
    requestedAt: z.iso.datetime({ offset: true }),
    state: accountDeletionStateSchema,
  })
  .strict();
export type AccountDeletionStatus = z.infer<typeof accountDeletionStatusSchema>;

export const accountDeletionStatusResponseSchema = z
  .object({ deletion: accountDeletionStatusSchema.nullable() })
  .strict();

export const privacyOverviewResponseSchema = z
  .object({
    deletion: accountDeletionStatusSchema.nullable(),
    retention: privacyRetentionStatusSchema,
  })
  .strict();
export type PrivacyOverviewResponse = z.infer<typeof privacyOverviewResponseSchema>;

export const privacyDisclosureSchema = z
  .object({
    createdAt: z.iso.datetime({ offset: true }),
    disclosedFields: z.array(z.string().min(1)),
    id: canonicalUuidSchema,
    model: z.string().min(1),
    provider: z.string().min(1),
    purpose: z.string().min(1),
  })
  .strict();
export type PrivacyDisclosure = z.infer<typeof privacyDisclosureSchema>;

export const privacyDisclosuresResponseSchema = z
  .object({ disclosures: z.array(privacyDisclosureSchema) })
  .strict();

export const privacyPurgeResponseSchema = z
  .object({ purged: z.literal(true), purgedCount: z.int().min(0) })
  .strict();
export type PrivacyPurgeResponse = z.infer<typeof privacyPurgeResponseSchema>;

export const accountDeletionRequestSchema = z
  .object({ confirm: z.literal("delete my account") })
  .strict();

export const accountDeletionResponseSchema = z
  .object({
    deleted: z.literal(true),
    deletion: accountDeletionStatusSchema,
    failedRevocations: z.int().min(0),
    revokedCredentials: z.int().min(0),
  })
  .strict();
export type AccountDeletionResponse = z.infer<typeof accountDeletionResponseSchema>;

export const openAiCredentialRevocationResultSchema = z
  .object({
    revoked: z.boolean(),
    connectionId: canonicalUuidSchema.optional(),
    disabledRuleCount: z.int().min(0),
  })
  .strict()
  .refine((result) => result.revoked === (result.connectionId !== undefined), {
    message: "Revoked credentials require a connection ID",
  });

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
