/**
 * The captures the demo can generate.
 *
 * Each one is an envelope, not a screenshot: it goes through the shipped fact normalizer, the
 * shipped event extractor and the shipped classifier, so what appears in the inbox is what those
 * would produce for a real notification of that shape. The set is chosen to reach every outcome the
 * inbox can show -- something waiting on a decision, something Relay could not resolve, something
 * filed quietly, something no rule claims, and something this device cannot read for itself.
 */

import type { DemoCaptureInput } from "./ingest";

export type DemoScenario = {
  /** What this capture is meant to demonstrate, shown under the button. */
  detail: string;
  icon: string;
  id: string;
  label: string;
  /** `sequence` varies the details between sends so a burst reads as several distinct captures. */
  build: (now: number, sequence: number) => DemoCaptureInput;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function isoAt(now: number, offsetMs: number): string {
  return new Date(now + offsetMs).toISOString();
}

const CARD_PAYMENTS = [
  { amount: "42.30", display: "£42.30", merchant: "Tesco Express" },
  { amount: "8.95", display: "£8.95", merchant: "Pret A Manger" },
  { amount: "19.40", display: "£19.40", merchant: "Uber" },
  { amount: "11.99", display: "£11.99", merchant: "Spotify" },
] as const;

const WORK_MESSAGES = [
  "Could you take a look at the latest revision before the review?",
  "Pushed the fix, tests are green on my machine.",
  "Moving standup half an hour later this week.",
] as const;

export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  {
    build: (now, sequence) => {
      const payment = CARD_PAYMENTS[sequence % CARD_PAYMENTS.length];
      return {
        applicationId: "com.revolut.revolut",
        attributes: {
          amount: payment.amount,
          currency: "GBP",
          merchant: payment.merchant,
          reference: [{ kind: "transaction", value: `TXN-${String(4800 + sequence)}` }],
        },
        body: `You spent ${payment.display} at ${payment.merchant}.`,
        capturedAt: isoAt(now, 0),
        sender: "Revolut",
        sourceKind: "notification",
        subject: "Card payment",
      };
    },
    detail:
      "Amount, currency and merchant become facts. The Money rule files it under Transactions.",
    icon: "credit-card-outline",
    id: "card-payment",
    label: "Card payment",
  },
  {
    build: (now, sequence) => ({
      applicationId: "com.amazon.mShop.android.shopping",
      attributes: {
        dates: [{ instant: isoAt(now, 3 * HOUR), role: "due" }],
        reference: [{ kind: "tracking", value: `TBA30492740${String(sequence % 10)}` }],
      },
      body: "Your parcel is out for delivery and arrives this afternoon.",
      capturedAt: isoAt(now, 0),
      sender: "Amazon",
      sourceKind: "notification",
      subject: "Out for delivery",
    }),
    detail:
      "A deadline makes it a reminder, so it lands in Needs you and the task rule proposes an action.",
    icon: "package-variant-closed",
    id: "parcel-delivery",
    label: "Parcel out for delivery",
  },
  {
    build: (now, sequence) => ({
      body: `Your verification code is ${String(400000 + ((sequence * 7919) % 500000))}. Never share it.`,
      capturedAt: isoAt(now, 0),
      sender: "HSBC",
      sourceKind: "sms",
    }),
    detail: "An SMS with no application. Filed under Security by a rule that reads the body.",
    icon: "shield-key-outline",
    id: "verification-code",
    label: "Verification code",
  },
  {
    build: (now) => ({
      applicationId: "com.google.android.calendar",
      attributes: {
        dates: [{ instant: isoAt(now, 2 * HOUR), role: "start" }],
        location: [{ label: "Studio B", role: "event" }],
      },
      body: "Design review in Studio B.",
      capturedAt: isoAt(now, 0),
      sender: "Google Calendar",
      sourceKind: "notification",
      subject: "Design review",
    }),
    detail:
      "A start time makes it a calendar event, sorted by when it happens rather than arrival.",
    icon: "calendar-clock",
    id: "calendar-invite",
    label: "Calendar reminder",
  },
  {
    build: (now) => ({
      applicationId: "com.ubercab.eats",
      body: "Half price on your next two orders until midnight.",
      capturedAt: isoAt(now, 0),
      sender: "Uber Eats",
      sourceKind: "notification",
      subject: "Half price tonight",
    }),
    detail: "Nothing to decide. Filed quietly under Promotions and searchable, never surfaced.",
    icon: "sale",
    id: "promotion",
    label: "Promotion",
  },
  {
    build: (now, sequence) => ({
      applicationId: "com.Slack",
      body: WORK_MESSAGES[sequence % WORK_MESSAGES.length],
      capturedAt: isoAt(now, 0),
      sender: "Priya Raman",
      sourceKind: "notification",
      subject: "#design-review",
    }),
    detail:
      "Repeat sends collapse into one conversation, because sender and app identify a thread.",
    icon: "message-text-outline",
    id: "work-message",
    label: "Work chat message",
  },
  {
    build: (now, sequence) => ({
      applicationId: "com.britishairways.bamobile",
      attributes: {
        dates: [{ instant: isoAt(now, 20 * HOUR), role: "start" }],
        location: [{ label: "Heathrow Terminal 5", role: "origin" }],
        reference: [
          { kind: "booking", value: `QK2P7${String.fromCodePoint(76 + (sequence % 6))}` },
        ],
      },
      body: "Departs 11:20 from Heathrow Terminal 5.",
      capturedAt: isoAt(now, 0),
      sender: "British Airways",
      sourceKind: "notification",
      subject: "Boarding pass BA0286",
    }),
    detail: "No rule claims this one, so it stays unfiled and says so rather than guessing.",
    icon: "airplane",
    id: "boarding-pass",
    label: "Boarding pass",
  },
  {
    build: (now) => ({
      applicationId: "com.microsoft.office.outlook",
      attributes: {
        dates: [
          { instant: isoAt(now, 26 * HOUR), role: "due" },
          { instant: isoAt(now, 50 * HOUR), role: "due" },
        ],
      },
      body: "Renew your access badge before the deadline.",
      capturedAt: isoAt(now, 0),
      sender: "Facilities",
      sourceKind: "notification",
      subject: "Access badge renewal",
    }),
    detail: "Two deadlines that disagree. Relay refuses to pick one and asks you to look.",
    icon: "alert-decagram-outline",
    id: "conflicting-dates",
    label: "Contradictory deadline",
  },
  {
    build: (now, sequence) => ({
      body: "Thanks for your payment. Your receipt is attached.",
      capturedAt: isoAt(now, 0),
      retainContent: false,
      sender: "receipts@acme.example",
      sourceKind: "gmail",
      subject: "Your receipt from Acme",
      threadId: `demo-thread-${String(sequence % 4)}`,
    }),
    detail:
      "Captured by Relay rather than this phone, so the body is unreadable here and the rule that needs it says so.",
    icon: "email-outline",
    id: "gmail-receipt",
    label: "Gmail receipt",
  },
];

/** A mixed handful, for showing the inbox fill up in one tap. */
export const DEMO_BURST_SCENARIO_IDS: readonly string[] = [
  "card-payment",
  "parcel-delivery",
  "verification-code",
  "promotion",
  "work-message",
];

export function demoScenario(id: string): DemoScenario | undefined {
  return DEMO_SCENARIOS.find((scenario) => scenario.id === id);
}

/** The composer's own capture: whatever a person typed, sent through the same path. */
export function customScenarioInput(input: {
  applicationId: string;
  body: string;
  sender: string;
  subject: string;
}): DemoCaptureInput {
  const trimmed = {
    applicationId: input.applicationId.trim(),
    body: input.body.trim(),
    sender: input.sender.trim(),
    subject: input.subject.trim(),
  };
  return {
    ...(trimmed.applicationId === "" ? {} : { applicationId: trimmed.applicationId }),
    ...(trimmed.body === "" ? {} : { body: trimmed.body }),
    capturedAt: new Date().toISOString(),
    ...(trimmed.sender === "" ? {} : { sender: trimmed.sender }),
    sourceKind: "notification",
    ...(trimmed.subject === "" ? {} : { subject: trimmed.subject }),
  };
}
