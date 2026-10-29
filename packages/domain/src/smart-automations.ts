import {
  smartObservationSchema,
  smartRuleSchema,
  smartTaskInputSchema,
  smartCalendarInputSchema,
  smartSheetInputSchema,
  type SmartObservation,
  type SmartRule,
  type SmartOverview,
} from "@relay/contracts";
import { sha256Hex } from "./digest.js";

export const GOOGLE_SERVICE_SCOPES = {
  gmail: ["https://www.googleapis.com/auth/gmail.readonly"],
  "google-tasks": ["https://www.googleapis.com/auth/tasks"],
  "google-sheets": ["https://www.googleapis.com/auth/drive.file"],
  "google-calendar": [
    "https://www.googleapis.com/auth/calendar.events.owned",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  ],
} as const;

export type SmartDecision =
  | {
      eligible: false;
      reason: "unmatched" | "paused" | "disconnected" | "permission-required" | "needs-review";
    }
  | { eligible: true; approval: "required" | "automatic" };

/** Score is never authority. Every gate is checked again at dispatch. */
export function evaluateSmartRule(
  ruleValue: unknown,
  observationValue: unknown,
  state: Pick<SmartOverview, "paused" | "services">,
): SmartDecision {
  const rule = smartRuleSchema.parse(ruleValue);
  const observation = smartObservationSchema.parse(observationValue);
  const kind =
    rule.service === "google-sheets"
      ? "transaction"
      : rule.service === "google-calendar"
        ? "meeting"
        : "task";
  const sender = observation.sender.normalize("NFKC").trim().toLowerCase();
  const hasSender = (values: string[]) =>
    values.some((value) => value.normalize("NFKC").trim().toLowerCase() === sender);
  if (
    !rule.enabled ||
    observation.kind !== kind ||
    !rule.sources.includes(observation.source) ||
    hasSender(rule.exclusions) ||
    (rule.senders.length > 0 && !hasSender(rule.senders))
  )
    return { eligible: false, reason: "unmatched" };
  if (state.paused) return { eligible: false, reason: "paused" };
  const service = state.services.find((item) => item.service === rule.service);
  if (service === undefined || !service.connected || !service.enabled)
    return { eligible: false, reason: "disconnected" };
  if (service.permissionRequired) return { eligible: false, reason: "permission-required" };
  if (service.targetId !== rule.targetId) return { eligible: false, reason: "needs-review" };
  if (
    observation.requiresReview ||
    observation.confidence < rule.minimumConfidence ||
    (kind === "transaction" &&
      (observation.amount === undefined ||
        /^0(?:\.0+)?$/u.test(observation.amount) ||
        observation.currency === undefined ||
        observation.reference === undefined)) ||
    (kind === "meeting" &&
      (observation.startsAt === undefined ||
        observation.endsAt === undefined ||
        Date.parse(observation.endsAt) <= Date.parse(observation.startsAt)))
  )
    return { eligible: false, reason: "needs-review" };
  return { eligible: true, approval: rule.approval };
}

/** No amount/day-only merging: a strong reference is required for financial cross-source identity. */
export async function smartEffectKey(
  tenant: string,
  rule: SmartRule,
  observation: SmartObservation,
): Promise<string> {
  const identity =
    observation.kind === "transaction" && observation.reference !== undefined
      ? ["transaction", rule.id, observation.reference, observation.amount, observation.currency]
      : [observation.kind, observation.id];
  return sha256Hex(
    new TextEncoder().encode(
      JSON.stringify(["relay-smart-v1", tenant, rule.service, rule.targetId, identity]),
    ),
  );
}

export function renderSmartInput(
  rule: SmartRule,
  observation: SmartObservation,
  actionId: string,
  row = 2,
): Record<string, unknown> {
  if (rule.service === "google-tasks")
    return {
      title: observation.title,
      taskListId: rule.targetId,
      ...(observation.dueAt === undefined ? {} : { due: observation.dueAt }),
    };
  if (rule.service === "google-calendar")
    return {
      summary: observation.title,
      calendarId: rule.targetId,
      start: observation.startsAt,
      end: observation.endsAt,
    };
  return {
    spreadsheetId: rule.targetId,
    range: `'Relay Expenses'!A${String(row)}:G${String(row)}`,
    values: [
      actionId,
      observation.occurredAt,
      observation.merchant ?? observation.title,
      observation.amount ?? "",
      observation.currency ?? "",
      observation.reference ?? "",
      observation.source,
    ],
  };
}

export function smartActionPreview(
  service: string,
  input: unknown,
): { label: string; value: string }[] {
  if (service === "google-tasks") {
    const parsed = smartTaskInputSchema.safeParse(input);
    return parsed.success
      ? [
          { label: "Task", value: parsed.data.title },
          ...(parsed.data.due === undefined
            ? []
            : [{ label: "Due date (Google stores a date only)", value: parsed.data.due }]),
        ]
      : [];
  }
  if (service === "google-calendar") {
    const parsed = smartCalendarInputSchema.safeParse(input);
    return parsed.success
      ? [
          { label: "Event", value: parsed.data.summary },
          { label: "Starts", value: parsed.data.start },
          { label: "Ends", value: parsed.data.end },
          { label: "Guests", value: "None — no invitations" },
        ]
      : [];
  }
  const parsed = smartSheetInputSchema.safeParse(input);
  return parsed.success
    ? [
        { label: "Merchant", value: parsed.data.values[2] },
        { label: "Amount", value: `${parsed.data.values[3]} ${parsed.data.values[4]}` },
        { label: "Reference", value: parsed.data.values[5] },
        { label: "Occurred", value: parsed.data.values[1] },
      ]
    : [];
}
