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
    ).rejects.toThrow("Source persistence failed with 409");
  });

  it("rejects malformed conflict responses", async () => {
    await expect(
      parseSourcePersistenceResponse(new Response("not-json", { status: 200 })),
    ).rejects.toThrow("Source persistence response is invalid");
  });
});

describe("parseDecryptedIngressEnvelope", () => {
  it("returns a fixed invalid outcome for malformed sensitive plaintext", () => {
    expect(
      parseDecryptedIngressEnvelope(
        '{"body":"SYNTHETIC SECRET THAT MUST NOT ENTER AN ERROR"',
        "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
      ),
    ).toBeUndefined();
  });
});
