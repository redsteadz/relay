import { describe, expect, it } from "vitest";

import {
  decryptValue,
  encryptValue,
  generateKek,
  parseKekKeyring,
  rewrapValue,
  type EncryptedValue,
  type KekKeyring,
} from "../src/index";

function keyring(activeVersion: number, keys: Record<number, string>): KekKeyring {
  return parseKekKeyring(JSON.stringify({ activeVersion, keys }));
}

const legacyV1Value = {
  algorithm: "AES-GCM-256",
  ciphertext: "a7OuKCku7I62r86tKL7yARsAsp/DiKa1UQsl2h8=",
  keyVersion: 1,
  nonce: "AgICAgICAgICAgIC",
  wrappedKey: "mTI1JcsHPZEmNhQXrCbHGL6rnw8/BNB+rKO9/t713wMVZMdiRW+eJdUUPJ3eJaen",
  wrapNonce: "AwMDAwMDAwMDAwMD",
} satisfies EncryptedValue;

describe("envelope encryption", () => {
  it("round-trips a provider credential", async () => {
    const keys = keyring(1, { 1: generateKek() });
    const context = "user:connection:credential";
    const encrypted = await encryptValue("sensitive-provider-token", keys, context);

    expect(encrypted.ciphertext).not.toContain("sensitive-provider-token");
    await expect(decryptValue(encrypted, keys, context)).resolves.toBe("sensitive-provider-token");
  });

  it("rejects a different wrapping key", async () => {
    const context = "user:record:purpose";
    const encrypted = await encryptValue("secret", keyring(1, { 1: generateKek() }), context);
    await expect(
      decryptValue(encrypted, keyring(1, { 1: generateKek() }), context),
    ).rejects.toThrow();
  });

  it.each([
    ["tenant", "ingress:user-b:record-a"],
    ["record", "ingress:user-a:record-b"],
    ["purpose", "credential:user-a:record-a"],
  ])("rejects ciphertext moved to a different %s context", async (_field, changedContext) => {
    const keys = keyring(1, { 1: generateKek() });
    const encrypted = await encryptValue("secret", keys, "ingress:user-a:record-a");
    await expect(decryptValue(encrypted, keys, changedContext)).rejects.toThrow();
  });

  it("rejects a wrapped key moved to a different key version", async () => {
    const keys = keyring(2, { 1: generateKek(), 2: generateKek() });
    const versionOne = keyring(1, { 1: keys.keys[1] ?? "" });
    const encrypted = await encryptValue("secret", versionOne, "ingress:user-a:record-a");
    await expect(
      decryptValue({ ...encrypted, keyVersion: 2 }, keys, "ingress:user-a:record-a"),
    ).rejects.toThrow();
  });

  it("decrypts records written with retained key versions", async () => {
    const firstKey = generateKek();
    const encrypted = await encryptValue(
      "secret",
      keyring(1, { 1: firstKey }),
      "user:record:purpose",
    );
    const rotatingKeys = keyring(2, { 1: firstKey, 2: generateKek() });

    await expect(decryptValue(encrypted, rotatingKeys, "user:record:purpose")).resolves.toBe(
      "secret",
    );
  });

  it("decrypts a legacy v1 bundle after keyring migration", async () => {
    const migratedKeys = keyring(2, {
      1: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      2: generateKek(),
    });

    await expect(
      decryptValue(legacyV1Value, migratedKeys, "user:legacy-record:credential"),
    ).resolves.toBe("legacy-secret");
  });

  it("rewraps only the data key under the active KEK", async () => {
    const firstKey = generateKek();
    const context = "user:record:purpose";
    const encrypted = await encryptValue("secret", keyring(1, { 1: firstKey }), context);
    const rotatingKeys = keyring(2, { 1: firstKey, 2: generateKek() });
    const rewrapped = await rewrapValue(encrypted, rotatingKeys, context);

    expect(rewrapped.keyVersion).toBe(2);
    expect(rewrapped.ciphertext).toBe(encrypted.ciphertext);
    expect(rewrapped.nonce).toBe(encrypted.nonce);
    expect(rewrapped.wrappedKey).not.toBe(encrypted.wrappedKey);
    expect(rewrapped.wrapNonce).not.toBe(encrypted.wrapNonce);
    await expect(decryptValue(rewrapped, rotatingKeys, context)).resolves.toBe("secret");
  });

  it("supports retiring a compromised KEK after rewrap", async () => {
    const firstKey = generateKek();
    const secondKey = generateKek();
    const context = "user:record:purpose";
    const encrypted = await encryptValue("secret", keyring(1, { 1: firstKey }), context);
    const rewrapped = await rewrapValue(
      encrypted,
      keyring(2, { 1: firstKey, 2: secondKey }),
      context,
    );
    const retiredKeys = keyring(2, { 2: secondKey });

    await expect(decryptValue(rewrapped, retiredKeys, context)).resolves.toBe("secret");
    await expect(decryptValue(encrypted, retiredKeys, context)).rejects.toThrow(
      "Credential KEK version 1 is unavailable",
    );
  });

  it("does not inspect payload plaintext while rewrapping", async () => {
    const firstKey = generateKek();
    const context = "user:record:purpose";
    const encrypted = await encryptValue("secret", keyring(1, { 1: firstKey }), context);
    const rotatingKeys = keyring(2, { 1: firstKey, 2: generateKek() });
    const unreadablePayload = { ...encrypted, ciphertext: "not-payload-ciphertext" };

    await expect(rewrapValue(unreadablePayload, rotatingKeys, context)).resolves.toMatchObject({
      ciphertext: "not-payload-ciphertext",
      keyVersion: 2,
    });
  });

  it("fails closed when an old key version is lost", async () => {
    const encrypted = await encryptValue(
      "secret",
      keyring(1, { 1: generateKek() }),
      "user:record:purpose",
    );
    const lostKeyring = keyring(2, { 2: generateKek() });

    await expect(decryptValue(encrypted, lostKeyring, "user:record:purpose")).rejects.toThrow(
      "Credential KEK version 1 is unavailable",
    );
    await expect(rewrapValue(encrypted, lostKeyring, "user:record:purpose")).rejects.toThrow(
      "Credential KEK version 1 is unavailable",
    );
  });

  it("rejects malformed keyring secrets without reflecting their contents", () => {
    expect(() => parseKekKeyring('{"activeVersion":2,"keys":{"1":"secret"}}')).toThrow(
      "Credential KEK keyring is invalid",
    );
    expect(() => parseKekKeyring("not-json-secret")).toThrow("Credential KEK keyring is invalid");
  });

  it("rejects duplicate KEK material under different versions", () => {
    const repeatedKey = generateKek();

    expect(() => keyring(2, { 1: repeatedKey, 2: repeatedKey })).toThrow(
      "Credential KEK keyring is invalid",
    );
  });
});
