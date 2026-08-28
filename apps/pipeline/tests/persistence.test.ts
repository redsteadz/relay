import { describe, expect, it } from "vitest";

import { parseDecryptedIngressEnvelope, parseSourcePersistenceResponse } from "../src/persistence";

describe("parseSourcePersistenceResponse", () => {
  it("accepts durable persistence", async () => {
    await expect(parseSourcePersistenceResponse(Response.json(true))).resolves.toBe("stored");
  });

  it("accepts atomic duplicate outcomes", async () => {
    await expect(parseSourcePersistenceResponse(Response.json(false))).resolves.toBe("duplicate");
  });

  it("keeps database failures retryable without reflecting the response", async () => {
    await expect(
      parseSourcePersistenceResponse(
        Response.json(
          { code: "23503", details: "synthetic-sensitive-database-detail" },
          { status: 409 },
        ),
      ),
    ).rejects.toMatchObject({ reason: "tenant_id_conflict" });
  });

  it("rejects malformed conflict responses", async () => {
    await expect(
      parseSourcePersistenceResponse(new Response("not-json", { status: 200 })),
    ).rejects.toMatchObject({ reason: "persistence_response_invalid" });
  });
});

describe("parseDecryptedIngressEnvelope", () => {
  it("returns a fixed invalid outcome for malformed sensitive plaintext", () => {
    expect(
      parseDecryptedIngressEnvelope('{"body":"SYNTHETIC SECRET THAT MUST NOT ENTER AN ERROR"', {
        acceptedAt: "2026-08-24T10:00:00.000Z",
        envelopeId: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
        rawExpiresAt: "2026-08-31T10:00:00.000Z",
      }),
    ).toBeUndefined();
  });

  it("rejects Queue metadata that differs from authenticated retention data", () => {
    const plaintext = JSON.stringify({
      schemaVersion: 1,
      acceptedAt: "2026-08-24T10:00:00.000Z",
      rawExpiresAt: "2026-08-31T10:00:00.000Z",
      envelope: {
        schemaVersion: 1,
        id: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
        occurredAt: "2026-08-24T10:00:00Z",
        capturedAt: "2026-08-24T10:00:01Z",
        source: { kind: "notification", externalId: "synthetic" },
        attributes: {},
      },
    });

    expect(
      parseDecryptedIngressEnvelope(plaintext, {
        acceptedAt: "2026-08-24T10:00:00.000Z",
        envelopeId: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
        rawExpiresAt: "2026-09-01T10:00:00.000Z",
      }),
    ).toBeUndefined();
  });
});
