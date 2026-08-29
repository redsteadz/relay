import { describe, expect, it } from "vitest";

import { sourceFactSetSchema } from "@relay/contracts";

import { parseFactPersistenceResponse, persistSourceFactSet } from "../src/facts";

const factSet = sourceFactSetSchema.parse({
  schemaVersion: 1,
  sourceItemId: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
  normalizerVersion: 1,
  facts: [
    {
      sourceItemId: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
      normalizerVersion: 1,
      ordinal: 0,
      kind: "amount",
      certainty: "certain",
      value: "12345678901234567890.001200",
      provenance: [{ field: "attributes.amount" }],
    },
  ],
});

describe("parseFactPersistenceResponse", () => {
  it.each(["stored", "duplicate", "fact-integrity-conflict", "source-missing"] as const)(
    "accepts fixed result %s",
    async (result) => {
      await expect(parseFactPersistenceResponse(Response.json(result))).resolves.toBe(result);
    },
  );

  it("keeps database conflict details out of errors", async () => {
    const response = Response.json(
      { details: "synthetic-sensitive-database-detail" },
      { status: 409 },
    );

    await expect(parseFactPersistenceResponse(response)).rejects.toMatchObject({
      message: "Fact persistence failed",
      reason: "fact_persistence_conflict",
    });
  });

  it("rejects malformed success responses", async () => {
    await expect(
      parseFactPersistenceResponse(Response.json({ result: "stored" })),
    ).rejects.toMatchObject({ reason: "fact_persistence_response_invalid" });
  });
});

describe("persistSourceFactSet", () => {
  it("uses local durable storage mode without a network call", async () => {
    await expect(
      persistSourceFactSet(
        {
          environment: "development",
          keyring: { activeVersion: 1, keys: {} },
        },
        "638ce145-a77d-4c32-b798-cb398e881fc9",
        factSet,
        "a".repeat(64),
      ),
    ).resolves.toBe("local");
  });

  it("rejects a malformed source fingerprint before persistence", async () => {
    await expect(
      persistSourceFactSet(
        {
          environment: "development",
          keyring: { activeVersion: 1, keys: {} },
        },
        "638ce145-a77d-4c32-b798-cb398e881fc9",
        factSet,
        "not-a-fingerprint",
      ),
    ).rejects.toMatchObject({ reason: "fact_persistence_response_invalid" });
  });
});
