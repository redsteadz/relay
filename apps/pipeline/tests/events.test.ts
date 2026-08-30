import { describe, expect, it } from "vitest";

import { sourceEventSetSchema } from "@relay/contracts";

import { parseEventPersistenceResponse, persistSourceEventSet } from "../src/events";

const eventSet = sourceEventSetSchema.parse({
  schemaVersion: 1,
  sourceItemId: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
  normalizerVersion: 1,
  extractorVersion: 1,
  events: [
    {
      sourceItemId: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
      normalizerVersion: 1,
      extractorVersion: 1,
      ordinal: 0,
      kind: "fact",
      title: "USD 14.20 at Example Station",
      summary: "Transaction reference available.",
      confidence: 0.95,
      requiresReview: false,
      temporalStatus: "none",
      timeZone: null,
      provenance: [{ factOrdinal: 0, fields: [{ field: "attributes.amount" }] }],
    },
  ],
});

describe("parseEventPersistenceResponse", () => {
  it.each([
    "stored",
    "duplicate",
    "event-integrity-conflict",
    "facts-missing",
    "source-missing",
  ] as const)("accepts fixed result %s", async (result) => {
    await expect(parseEventPersistenceResponse(Response.json(result))).resolves.toBe(result);
  });

  it("keeps database conflict details out of errors", async () => {
    const response = Response.json(
      { details: "synthetic-sensitive-database-detail" },
      { status: 409 },
    );

    await expect(parseEventPersistenceResponse(response)).rejects.toMatchObject({
      message: "Event persistence failed",
      reason: "event_persistence_conflict",
    });
  });

  it("rejects malformed success responses", async () => {
    await expect(
      parseEventPersistenceResponse(Response.json({ result: "stored" })),
    ).rejects.toMatchObject({ reason: "event_persistence_response_invalid" });
  });
});

describe("persistSourceEventSet", () => {
  it("uses local durable storage mode without a network call", async () => {
    await expect(
      persistSourceEventSet(
        { environment: "development", keyring: { activeVersion: 1, keys: {} } },
        "638ce145-a77d-4c32-b798-cb398e881fc9",
        eventSet,
        "a".repeat(64),
        "b".repeat(64),
      ),
    ).resolves.toBe("local");
  });

  it("rejects malformed fingerprints before persistence", async () => {
    await expect(
      persistSourceEventSet(
        { environment: "development", keyring: { activeVersion: 1, keys: {} } },
        "638ce145-a77d-4c32-b798-cb398e881fc9",
        eventSet,
        "not-a-fingerprint",
        "b".repeat(64),
      ),
    ).rejects.toMatchObject({ reason: "event_persistence_response_invalid" });
  });
});
