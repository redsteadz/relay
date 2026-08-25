import { describe, expect, it } from "vitest";

import { classifySourcePersistenceResponse } from "../src/persistence";

describe("classifySourcePersistenceResponse", () => {
  it("accepts durable persistence", async () => {
    await expect(
      classifySourcePersistenceResponse(new Response(null, { status: 201 })),
    ).resolves.toBe("stored");
  });

  it("classifies only unique violations as duplicates", async () => {
    await expect(
      classifySourcePersistenceResponse(Response.json({ code: "23505" }, { status: 409 })),
    ).resolves.toBe("duplicate");
  });

  it("keeps foreign-key violations retryable without reflecting the response", async () => {
    await expect(
      classifySourcePersistenceResponse(
        Response.json(
          { code: "23503", details: "synthetic-sensitive-database-detail" },
          { status: 409 },
        ),
      ),
    ).rejects.toThrow("Source persistence failed with 409");
  });

  it("rejects malformed conflict responses", async () => {
    await expect(
      classifySourcePersistenceResponse(new Response("not-json", { status: 409 })),
    ).rejects.toThrow("Source persistence failed with 409");
  });
});
