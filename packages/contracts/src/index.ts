import { z } from "zod";

export const sourceKindSchema = z.enum(["gmail", "notification", "sms", "email"]);
export type SourceKind = z.infer<typeof sourceKindSchema>;

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
