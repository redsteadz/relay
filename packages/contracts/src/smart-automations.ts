import { z } from "zod";

export const googleServiceSchema = z.enum([
  "gmail",
  "google-tasks",
  "google-sheets",
  "google-calendar",
]);
export type GoogleService = z.infer<typeof googleServiceSchema>;
const id = z.uuid();
const text = z.string().trim().min(1).max(160);
export const smartRuleSchema = z
  .object({
    id,
    filterRuleId: id.optional(),
    name: text,
    service: z.enum(["google-tasks", "google-sheets", "google-calendar"]),
    enabled: z.boolean(),
    sources: z
      .array(z.enum(["gmail", "sms", "notification"]))
      .min(1)
      .max(3),
    senders: z.array(text).max(50),
    exclusions: z.array(text).max(50),
    minimumConfidence: z.number().min(0.8).max(1),
    approval: z.enum(["required", "automatic"]),
    targetId: z.string().min(1).max(512),
    targetLabel: text,
    revision: z.int().min(1),
  })
  .strict();
export type SmartRule = z.infer<typeof smartRuleSchema>;

/** Data only. A captured message cannot select an operation, target, or credential. */
export const smartObservationSchema = z
  .object({
    id,
    source: z.enum(["gmail", "sms", "notification"]),
    sender: text,
    kind: z.enum(["transaction", "meeting", "task"]),
    title: text,
    confidence: z.number().min(0).max(1),
    requiresReview: z.boolean(),
    occurredAt: z.iso.datetime({ offset: true }),
    amount: z
      .string()
      .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/u)
      .max(128)
      .optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/u)
      .optional(),
    merchant: text.optional(),
    reference: text.optional(),
    startsAt: z.iso.datetime({ offset: true }).optional(),
    endsAt: z.iso.datetime({ offset: true }).optional(),
    dueAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
export type SmartObservation = z.infer<typeof smartObservationSchema>;
export const smartReceiptSchema = z
  .object({
    id,
    ruleId: id,
    observationId: id,
    service: googleServiceSchema,
    title: text,
    targetLabel: text,
    status: z.enum([
      "awaiting-approval",
      "approved",
      "running",
      "succeeded",
      "failed",
      "cancelled",
      "blocked",
      "duplicate",
    ]),
    reason: z.enum([
      "approval-required",
      "completed",
      "paused",
      "disconnected",
      "permission-required",
      "duplicate",
      "needs-review",
      "rate-limit",
      "provider-unavailable",
      "outcome-unknown",
      "cancelled",
    ]),
    createdAt: z.iso.datetime({ offset: true }),
    providerReference: z.string().max(512).optional(),
    preview: z
      .array(z.object({ label: z.string().max(80), value: z.string().max(512) }).strict())
      .max(8)
      .optional(),
  })
  .strict();
export type SmartReceipt = z.infer<typeof smartReceiptSchema>;
export const smartServiceStateSchema = z
  .object({
    service: googleServiceSchema,
    connected: z.boolean(),
    enabled: z.boolean(),
    permissionRequired: z.boolean(),
    targetId: z.string().max(512),
    targetLabel: z.string().max(160),
  })
  .strict();
export const smartOverviewSchema = z
  .object({
    paused: z.boolean(),
    services: z.array(smartServiceStateSchema),
    rules: z.array(smartRuleSchema),
    receipts: z.array(smartReceiptSchema).max(200),
  })
  .strict();
export type SmartOverview = z.infer<typeof smartOverviewSchema>;
export const smartCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pause"), paused: z.boolean() }).strict(),
  z
    .object({ type: z.literal("service"), service: googleServiceSchema, enabled: z.boolean() })
    .strict(),
  z.object({ type: z.literal("disconnect"), service: googleServiceSchema }).strict(),
  z
    .object({
      type: z.literal("destination"),
      service: z.enum(["google-tasks", "google-sheets", "google-calendar"]),
      targetId: z.string().min(1).max(512),
    })
    .strict(),
  z.object({ type: z.literal("create-sheet") }).strict(),
  z.object({ type: z.literal("save-rule"), rule: smartRuleSchema }).strict(),
  z.object({ type: z.literal("approve"), receiptId: id }).strict(),
  z.object({ type: z.literal("cancel"), receiptId: id }).strict(),
  z.object({ type: z.literal("retry"), receiptId: id }).strict(),
]);
export type SmartCommand = z.infer<typeof smartCommandSchema>;
export const googleConnectSchema = z.object({ service: googleServiceSchema }).strict();
export const smartResourcesSchema = z
  .object({
    resources: z
      .array(z.object({ id: z.string().min(1).max(512), label: text }).strict())
      .max(1000),
  })
  .strict();

export const smartTaskInputSchema = z
  .object({
    title: text,
    taskListId: z.string().min(1).max(512),
    due: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
export const smartCalendarInputSchema = z
  .object({
    summary: text,
    calendarId: z.string().min(1).max(512),
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine((value) => Date.parse(value.end) > Date.parse(value.start));
export const smartSheetInputSchema = z
  .object({
    spreadsheetId: z.string().min(1).max(512),
    range: z.string().regex(/^'Relay Expenses'!A(?:[2-9]|[1-9]\d+):G(?:[2-9]|[1-9]\d+)$/u),
    values: z.tuple([
      z.string(),
      z.string(),
      z.string(),
      z.string(),
      z.string(),
      z.string(),
      z.string(),
    ]),
  })
  .strict();
