import { describe, expect, it } from "vitest";

import {
  deviceIngressRequestSchema,
  deviceRegistrationRequestSchema,
  filterPlanSchema,
  ingressEnvelopeSchema,
  ingressQueueMessageSchema,
} from "../src/index.js";

describe("device contracts", () => {
  it("accepts only client-owned registration fields", () => {
    expect(
      deviceRegistrationRequestSchema.safeParse({
        id: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
        platform: "android",
      }).success,
    ).toBe(true);
    expect(
      deviceRegistrationRequestSchema.safeParse({
        id: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
        platform: "android",
        userId: "638ce145-a77d-4c32-b798-cb398e881fc9",
      }).success,
    ).toBe(false);
  });

  it("requires device identity outside the source envelope", () => {
    expect(
      deviceIngressRequestSchema.safeParse({
        deviceId: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
        envelope: {
          schemaVersion: 1,
          id: "638ce145-a77d-4c32-b798-cb398e881fc9",
          occurredAt: "2026-08-24T10:00:00Z",
          capturedAt: "2026-08-24T10:00:01Z",
          source: { kind: "notification", externalId: "synthetic" },
          attributes: {},
        },
      }).success,
    ).toBe(true);
  });
});

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

describe("ingressQueueMessageSchema", () => {
  const message = {
    userId: "638ce145-a77d-4c32-b798-cb398e881fc9",
    envelopeId: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
    encrypted: {
      algorithm: "AES-GCM-256",
      ciphertext: "AAAAAAAAAAAAAAAAAAAAAA==",
      keyVersion: 1,
      nonce: "AAAAAAAAAAAAAAAA",
      wrappedKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      wrapNonce: "AAAAAAAAAAAAAAAA",
    },
  };

  it("accepts bounded encrypted queue metadata", () => {
    expect(ingressQueueMessageSchema.safeParse(message).success).toBe(true);
  });

  it.each(["body", "sender", "envelope"])("rejects plaintext field %s", (field) => {
    expect(
      ingressQueueMessageSchema.safeParse({ ...message, [field]: "synthetic-sensitive-value" })
        .success,
    ).toBe(false);
  });

  it("rejects key versions outside PostgreSQL integer range", () => {
    const result = ingressQueueMessageSchema.safeParse({
      ...message,
      encrypted: { ...message.encrypted, keyVersion: 2_147_483_648 },
    });

    expect(result.success).toBe(false);
  });

  it("rejects malformed nonce and wrapped-key lengths", () => {
    const result = ingressQueueMessageSchema.safeParse({
      ...message,
      encrypted: { ...message.encrypted, nonce: "AA==", wrappedKey: "AA==" },
    });

    expect(result.success).toBe(false);
  });

  it("rejects padded base64 with incorrect decoded lengths", () => {
    const result = ingressQueueMessageSchema.safeParse({
      ...message,
      encrypted: {
        ...message.encrypted,
        nonce: btoa("\0".repeat(10)),
        wrappedKey: btoa("\0".repeat(46)),
      },
    });

    expect(result.success).toBe(false);
  });
});
