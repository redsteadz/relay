import { describe, expect, it } from "vitest";

import { decryptValue, encryptValue, generateKek } from "../src/index";

describe("envelope encryption", () => {
  it("round-trips a provider credential", async () => {
    const kek = generateKek();
    const context = "user:connection:credential";
    const encrypted = await encryptValue("sensitive-provider-token", kek, 1, context);

    expect(encrypted.ciphertext).not.toContain("sensitive-provider-token");
    await expect(decryptValue(encrypted, kek, context)).resolves.toBe("sensitive-provider-token");
  });

  it("rejects a different wrapping key", async () => {
    const encrypted = await encryptValue("secret", generateKek(), 1, "user:record:purpose");
    await expect(decryptValue(encrypted, generateKek(), "user:record:purpose")).rejects.toThrow();
  });

  it("rejects ciphertext moved to a different record context", async () => {
    const kek = generateKek();
    const encrypted = await encryptValue("secret", kek, 1, "user-a:record-a:credential");
    await expect(decryptValue(encrypted, kek, "user-a:record-b:credential")).rejects.toThrow();
  });
});
