import { describe, expect, it } from "vitest";

import {
  amountFactSchema,
  canonicalFactInstantSchema,
  canonicalUuidSchema,
  deadLetterFailureCodeSchema,
  deviceIngressRequestSchema,
  deviceRegistrationRequestSchema,
  encryptedIngressPayloadSchema,
  exactDecimalStringSchema,
  filterPlanSchema,
  ingressEnvelopeSchema,
  ingressQueueMessageSchema,
  openAiCredentialStatusSchema,
  openAiCredentialSubmitRequestSchema,
  normalizationDateCandidateSchema,
  sourceFactSchema,
  sourceFactSetSchema,
  uncertainFactSchema,
} from "../src/index.js";

describe("canonicalUuidSchema", () => {
  it("parses uppercase UUID input to lowercase string output", () => {
    expect(canonicalUuidSchema.parse("5E106D7A-85AA-4A08-9A1F-CB13B42DF1F8")).toBe(
      "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
    );
  });
});

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
    schemaVersion: 1,
    userId: "638ce145-a77d-4c32-b798-cb398e881fc9",
    envelopeId: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
    acceptedAt: "2026-08-24T10:00:00Z",
    rawExpiresAt: "2026-08-31T10:00:00Z",
    encryptionEnvironment: "production",
    recoveryId: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
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
    expect(ingressQueueMessageSchema.parse(message)).toEqual(message);
  });

  it("validates Queue UUIDs without changing authenticated wire casing", () => {
    const uppercaseMessage = {
      ...message,
      userId: message.userId.toUpperCase(),
      envelopeId: message.envelopeId.toUpperCase(),
      recoveryId: message.recoveryId.toUpperCase(),
      replayRequestId: "06F96F7D-3E1A-4A66-B98E-58BE9766B96E",
    };

    expect(ingressQueueMessageSchema.parse(uppercaseMessage)).toEqual(uppercaseMessage);
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

  it("rejects an expiry that restarts raw retention", () => {
    expect(
      ingressQueueMessageSchema.safeParse({
        ...message,
        rawExpiresAt: "2026-09-01T10:00:00Z",
      }).success,
    ).toBe(false);
  });
});

describe("source fact contracts", () => {
  const identity = {
    sourceItemId: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
    normalizerVersion: 1,
    ordinal: 0,
    provenance: [{ field: "attributes.amount" }],
  };

  it("preserves a large decimal string without numeric coercion", () => {
    const decimal = "123456789012345678901234567890.001200";
    const parsed = amountFactSchema.parse({
      ...identity,
      kind: "amount",
      certainty: "certain",
      value: decimal,
    });

    expect(parsed.value).toBe(decimal);
    expect(exactDecimalStringSchema.safeParse("1e3").success).toBe(false);
    expect(exactDecimalStringSchema.safeParse(12.5).success).toBe(false);
  });

  it("represents invalid extraction without a guessed value", () => {
    expect(
      uncertainFactSchema.safeParse({
        ...identity,
        kind: "currency",
        certainty: "uncertain",
        uncertaintyReason: "invalid",
      }).success,
    ).toBe(true);
    expect(
      uncertainFactSchema.safeParse({
        ...identity,
        kind: "currency",
        certainty: "uncertain",
        uncertaintyReason: "invalid",
        value: "USD",
      }).success,
    ).toBe(false);
  });

  it("runtime-validates every certain fact value shape", () => {
    const facts = [
      { kind: "sender", value: "sender@example.test", provenance: [{ field: "sender" }] },
      {
        kind: "date",
        value: { role: "transaction", instant: "2026-08-29T09:14:30.000000000Z" },
        provenance: [{ field: "attributes.dates" }],
      },
      { kind: "amount", value: "14.20", provenance: [{ field: "attributes.amount" }] },
      { kind: "currency", value: "USD", provenance: [{ field: "attributes.currency" }] },
      { kind: "merchant", value: "Example Shop", provenance: [{ field: "attributes.merchant" }] },
      {
        kind: "location",
        value: { label: "Example City", role: "other" },
        provenance: [{ field: "attributes.location" }],
      },
      {
        kind: "reference",
        value: { kind: "order", value: "ORDER-SYNTHETIC-21" },
        provenance: [{ field: "attributes.reference" }],
      },
    ];

    expect(
      facts.every(
        (fact) =>
          sourceFactSchema.safeParse({
            ...identity,
            ...fact,
            certainty: "certain",
          }).success,
      ),
    ).toBe(true);
    expect(
      sourceFactSchema.safeParse({
        ...identity,
        kind: "reference",
        certainty: "certain",
        value: { kind: "provider-specific", value: "not allowed" },
      }).success,
    ).toBe(false);
  });

  it("separates offset extraction input from canonical persisted UTC dates", () => {
    expect(
      normalizationDateCandidateSchema.safeParse({
        role: "transaction",
        instant: "2026-08-29T10:14:30+01:00",
      }).success,
    ).toBe(true);
    expect(
      normalizationDateCandidateSchema.safeParse({
        role: "transaction",
        instant: "2026-08-29T09:14:30.123456789Z",
      }).success,
    ).toBe(true);
    expect(
      normalizationDateCandidateSchema.safeParse({
        role: "transaction",
        instant: "2026-08-29T09:14:30.1234567890Z",
      }).success,
    ).toBe(false);
    expect(canonicalFactInstantSchema.safeParse("2026-08-29T09:14:30.000000000Z").success).toBe(
      true,
    );
    expect(canonicalFactInstantSchema.safeParse("2026-08-29T09:14:30.000100000Z").success).toBe(
      true,
    );
    expect(canonicalFactInstantSchema.safeParse("2026-08-29T09:14:30.000900000Z").success).toBe(
      true,
    );
    expect(
      canonicalFactInstantSchema.safeParse("2026-08-29T10:14:30.000000000+01:00").success,
    ).toBe(false);
    expect(canonicalFactInstantSchema.safeParse("2026-02-30T09:14:30.000000000Z").success).toBe(
      false,
    );
  });

  it("accepts dedicated fact integrity dead-letter metadata", () => {
    expect(deadLetterFailureCodeSchema.safeParse("fact_integrity_conflict").success).toBe(true);
  });

  it("requires every ordered fact to link to its source item", () => {
    const fact = {
      ...identity,
      kind: "amount",
      certainty: "certain",
      value: "14.20",
    } as const;
    expect(
      sourceFactSetSchema.safeParse({
        schemaVersion: 1,
        sourceItemId: identity.sourceItemId,
        normalizerVersion: 1,
        facts: [fact],
      }).success,
    ).toBe(true);
    expect(
      sourceFactSetSchema.safeParse({
        schemaVersion: 1,
        sourceItemId: "06f96f7d-3e1a-4a66-b98e-58be9766b96e",
        normalizerVersion: 1,
        facts: [fact],
      }).success,
    ).toBe(false);
  });

  it("rejects provenance snippets and unsupported source paths", () => {
    expect(
      amountFactSchema.safeParse({
        ...identity,
        provenance: [{ field: "attributes.amount", snippet: "plaintext must not persist" }],
        kind: "amount",
        certainty: "certain",
        value: "14.20",
      }).success,
    ).toBe(false);
    expect(
      amountFactSchema.safeParse({
        ...identity,
        provenance: [{ field: "attributes.providerSpecificAmount" }],
        kind: "amount",
        certainty: "certain",
        value: "14.20",
      }).success,
    ).toBe(false);
  });
});

describe("openAiCredentialSubmitRequestSchema", () => {
  it("accepts a bounded, whitespace-free key", () => {
    expect(
      openAiCredentialSubmitRequestSchema.safeParse({ apiKey: "sk-synthetic-0123456789" }).success,
    ).toBe(true);
  });

  it("rejects a key that is too short to be real", () => {
    expect(openAiCredentialSubmitRequestSchema.safeParse({ apiKey: "sk-short" }).success).toBe(
      false,
    );
  });

  it("rejects a key containing whitespace", () => {
    expect(
      openAiCredentialSubmitRequestSchema.safeParse({ apiKey: "sk-synthetic 0123456789" }).success,
    ).toBe(false);
  });

  it("rejects unknown fields alongside the key", () => {
    expect(
      openAiCredentialSubmitRequestSchema.safeParse({
        apiKey: "sk-synthetic-0123456789",
        userId: "638ce145-a77d-4c32-b798-cb398e881fc9",
      }).success,
    ).toBe(false);
  });
});

describe("openAiCredentialStatusSchema", () => {
  it("never allows credential material fields to be present", () => {
    expect(
      openAiCredentialStatusSchema.safeParse({
        provider: "openai",
        configured: true,
        apiKey: "sk-leaked",
      }).success,
    ).toBe(false);
  });

  it("accepts unconfigured status without a validation timestamp", () => {
    expect(
      openAiCredentialStatusSchema.safeParse({ provider: "openai", configured: false }).success,
    ).toBe(true);
  });
});

describe("encryptedIngressPayloadSchema", () => {
  it("authenticates the original acceptance and expiry beside the envelope", () => {
    expect(
      encryptedIngressPayloadSchema.safeParse({
        schemaVersion: 1,
        acceptedAt: "2026-08-24T10:00:00Z",
        rawExpiresAt: "2026-08-31T10:00:00Z",
        envelope: {
          schemaVersion: 1,
          id: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
          occurredAt: "2026-08-24T10:00:00Z",
          capturedAt: "2026-08-24T10:00:01Z",
          source: { kind: "notification", externalId: "synthetic" },
          attributes: {},
        },
      }).success,
    ).toBe(true);
  });
});
