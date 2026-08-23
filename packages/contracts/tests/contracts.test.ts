import { describe, expect, it } from "vitest";

import { filterPlanSchema, ingressEnvelopeSchema } from "../src/index.js";

describe("ingressEnvelopeSchema", () => {
  it("accepts a versioned notification payload", () => {
    const result = ingressEnvelopeSchema.safeParse({
      schemaVersion: 1,
      id: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
      occurredAt: "2026-08-24T10:00:00Z",
      capturedAt: "2026-08-24T10:00:01Z",
      source: {
        kind: "notification",
        externalId: "notification-key",
        applicationId: "com.example.bank",
      },
      subject: "Card purchase",
      body: "USD 4.25 at Corner Shop",
      attributes: {},
    });

    expect(result.success).toBe(true);
  });
});

describe("filterPlanSchema", () => {
  it("requires at least one evaluation path", () => {
    const result = filterPlanSchema.safeParse({
      schemaVersion: 1,
      intent: "Purchases from transit providers",
    });

    expect(result.success).toBe(false);
  });
});
