import { describe, expect, it, vi } from "vitest";

import {
  decryptValue,
  encryptValue,
  generateKek,
  parseKekKeyring,
  type EncryptedValue,
} from "@relay/crypto";

import {
  base64ToPostgresBytea,
  connectionCredentialEncryptionContext,
  postgresByteaToBase64,
  sourceItemEncryptionContext,
} from "../src/encryption";
import type { Env } from "../src/env";
import { executeKekRotationBatch } from "../src/key-rotation";

const userId = "638ce145-a77d-4c32-b798-cb398e881fc9";
const recordId = "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8";

function response(value: unknown): Response {
  return Response.json(value);
}

function requestBody(init?: RequestInit): Record<string, unknown> {
  if (typeof init?.body !== "string") throw new Error("Synthetic request body is missing");
  return JSON.parse(init.body) as Record<string, unknown>;
}

function environment(serializedKeyring: string): Env {
  return {
    RELAY_CREDENTIAL_KEK_KEYRING: serializedKeyring,
    RELAY_ENVIRONMENT: "development",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_synthetic_backend_key_12345",
    SUPABASE_URL: "https://supabase.example.test",
  } as unknown as Env;
}

function keyrings() {
  const first = generateKek();
  const second = generateKek();
  return {
    first: parseKekKeyring(JSON.stringify({ activeVersion: 1, keys: { 1: first } })),
    rotating: parseKekKeyring(JSON.stringify({ activeVersion: 2, keys: { 1: first, 2: second } })),
    serialized: JSON.stringify({ activeVersion: 2, keys: { 1: first, 2: second } }),
  };
}

function databaseRow(
  encrypted: EncryptedValue,
  store: "connections" | "dead_letter_items" | "source_items",
): Record<string, unknown> {
  const ciphertextField =
    store === "connections"
      ? "credential_ciphertext"
      : store === "source_items"
        ? "raw_ciphertext"
        : "ciphertext";
  const nonceField =
    store === "connections" ? "credential_nonce" : store === "source_items" ? "raw_nonce" : "nonce";
  return {
    [ciphertextField]: base64ToPostgresBytea(encrypted.ciphertext),
    [nonceField]: base64ToPostgresBytea(encrypted.nonce),
    ...(store === "dead_letter_items" ? { envelope_id: recordId } : {}),
    id: recordId,
    key_version: encrypted.keyVersion,
    user_id: userId,
    wrapped_data_key: base64ToPostgresBytea(encrypted.wrappedKey),
    wrap_nonce: base64ToPostgresBytea(encrypted.wrapNonce),
  };
}

describe("executeKekRotationBatch", () => {
  it.each([
    {
      context: sourceItemEncryptionContext,
      rpc: "cas_rewrap_source_item_data_key",
      store: "source_items" as const,
    },
    {
      context: connectionCredentialEncryptionContext,
      rpc: "cas_rewrap_connection_data_key",
      store: "connections" as const,
    },
    {
      context: sourceItemEncryptionContext,
      rpc: "cas_rewrap_dead_letter_data_key",
      store: "dead_letter_items" as const,
    },
  ])("rewraps only data-key fields for $store", async ({ context, rpc, store }) => {
    const keys = keyrings();
    const encrypted = await encryptValue("synthetic-secret", keys.first, context(userId, recordId));
    const row = databaseRow(encrypted, store);
    let casBody: Record<string, unknown> | undefined;
    const fetcher = vi.fn((input: string, init?: RequestInit): Promise<Response> => {
      const url = new URL(input);
      if (url.pathname.endsWith("/kek_encryption_inventory")) {
        return Promise.resolve(response([{ key_version: 1, row_count: 1, store }]));
      }
      if (url.pathname === `/rest/v1/${store}`) return Promise.resolve(response([row]));
      if (url.pathname.endsWith(`/${rpc}`)) {
        casBody = requestBody(init);
        return Promise.resolve(response(true));
      }
      throw new Error("Unexpected synthetic request");
    });

    await expect(executeKekRotationBatch(environment(keys.serialized), fetcher)).resolves.toEqual({
      activeVersion: 2,
      conflicts: 0,
      rewrapped: 1,
      scanned: 1,
    });

    expect(casBody).toMatchObject({
      p_environment: "development",
      p_expected_ciphertext:
        row[
          store === "connections"
            ? "credential_ciphertext"
            : store === "source_items"
              ? "raw_ciphertext"
              : "ciphertext"
        ],
      p_expected_key_version: 1,
      p_expected_payload_nonce:
        row[
          store === "connections"
            ? "credential_nonce"
            : store === "source_items"
              ? "raw_nonce"
              : "nonce"
        ],
      p_expected_wrapped_data_key: row.wrapped_data_key,
      p_expected_wrap_nonce: row.wrap_nonce,
      p_id: recordId,
      p_new_key_version: 2,
      p_user_id: userId,
    });
    expect(Object.keys(casBody ?? {}).sort()).toEqual(
      [
        "p_environment",
        "p_expected_ciphertext",
        "p_expected_key_version",
        "p_expected_payload_nonce",
        "p_expected_wrapped_data_key",
        "p_expected_wrap_nonce",
        "p_id",
        "p_new_key_version",
        "p_new_wrapped_data_key",
        "p_new_wrap_nonce",
        "p_user_id",
      ].sort(),
    );

    const rewrapped = {
      ...encrypted,
      keyVersion: 2,
      wrappedKey: postgresByteaToBase64(casBody?.p_new_wrapped_data_key, 48),
      wrapNonce: postgresByteaToBase64(casBody?.p_new_wrap_nonce, 12),
    };
    await expect(decryptValue(rewrapped, keys.rotating, context(userId, recordId))).resolves.toBe(
      "synthetic-secret",
    );
    expect(rewrapped.ciphertext).toBe(encrypted.ciphertext);
    expect(rewrapped.nonce).toBe(encrypted.nonce);
  });

  it("rereads a concurrent credential refresh before retrying CAS", async () => {
    const keys = keyrings();
    const context = connectionCredentialEncryptionContext(userId, recordId);
    const stale = databaseRow(await encryptValue("stale", keys.first, context), "connections");
    const refreshed = databaseRow(
      await encryptValue("refreshed", keys.first, context),
      "connections",
    );
    const casBodies: Record<string, unknown>[] = [];
    let reads = 0;
    const fetcher = vi.fn((input: string, init?: RequestInit): Promise<Response> => {
      const url = new URL(input);
      if (url.pathname.endsWith("/kek_encryption_inventory")) {
        return Promise.resolve(response([{ key_version: 1, row_count: 1, store: "connections" }]));
      }
      if (url.pathname === "/rest/v1/connections") {
        reads += 1;
        return Promise.resolve(response([reads === 1 ? stale : refreshed]));
      }
      if (url.pathname.endsWith("/cas_rewrap_connection_data_key")) {
        casBodies.push(requestBody(init));
        return Promise.resolve(response(casBodies.length === 2));
      }
      throw new Error("Unexpected synthetic request");
    });

    await expect(executeKekRotationBatch(environment(keys.serialized), fetcher)).resolves.toEqual({
      activeVersion: 2,
      conflicts: 0,
      rewrapped: 1,
      scanned: 1,
    });
    expect(casBodies).toHaveLength(2);
    expect(casBodies[0]?.p_expected_ciphertext).toBe(stale.credential_ciphertext);
    expect(casBodies[1]?.p_expected_ciphertext).toBe(refreshed.credential_ciphertext);
    expect(casBodies[1]?.p_expected_wrapped_data_key).toBe(refreshed.wrapped_data_key);
  });

  it("stops after a second compare-and-set conflict", async () => {
    const keys = keyrings();
    const context = sourceItemEncryptionContext(userId, recordId);
    const first = databaseRow(await encryptValue("first", keys.first, context), "source_items");
    const second = databaseRow(await encryptValue("second", keys.first, context), "source_items");
    let reads = 0;
    const fetcher = vi.fn((input: string): Promise<Response> => {
      const url = new URL(input);
      if (url.pathname.endsWith("/kek_encryption_inventory")) {
        return Promise.resolve(response([{ key_version: 1, row_count: 1, store: "source_items" }]));
      }
      if (url.pathname === "/rest/v1/source_items") {
        reads += 1;
        return Promise.resolve(response([reads === 1 ? first : second]));
      }
      if (url.pathname.endsWith("/cas_rewrap_source_item_data_key")) {
        return Promise.resolve(response(false));
      }
      throw new Error("Unexpected synthetic request");
    });

    await expect(executeKekRotationBatch(environment(keys.serialized), fetcher)).resolves.toEqual({
      activeVersion: 2,
      conflicts: 1,
      rewrapped: 0,
      scanned: 1,
    });
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("treats a retention purge after failed CAS as a stale no-op", async () => {
    const keys = keyrings();
    const context = sourceItemEncryptionContext(userId, recordId);
    const row = databaseRow(await encryptValue("expired", keys.first, context), "source_items");
    let reads = 0;
    const fetcher = vi.fn((input: string): Promise<Response> => {
      const url = new URL(input);
      if (url.pathname.endsWith("/kek_encryption_inventory")) {
        return Promise.resolve(response([{ key_version: 1, row_count: 1, store: "source_items" }]));
      }
      if (url.pathname === "/rest/v1/source_items") {
        reads += 1;
        return Promise.resolve(response(reads === 1 ? [row] : []));
      }
      if (url.pathname.endsWith("/cas_rewrap_source_item_data_key")) {
        return Promise.resolve(response(false));
      }
      throw new Error("Unexpected synthetic request");
    });

    await expect(executeKekRotationBatch(environment(keys.serialized), fetcher)).resolves.toEqual({
      activeVersion: 2,
      conflicts: 0,
      rewrapped: 0,
      scanned: 1,
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("fails before row reads when an old key is lost", async () => {
    const serialized = JSON.stringify({ activeVersion: 2, keys: { 2: generateKek() } });
    const fetcher = vi.fn(() =>
      Promise.resolve(response([{ key_version: 1, row_count: 1, store: "source_items" }])),
    );

    await expect(executeKekRotationBatch(environment(serialized), fetcher)).rejects.toThrow(
      "Credential KEK version 1 is unavailable",
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("fails before writes when storage contains a future key version", async () => {
    const serialized = JSON.stringify({ activeVersion: 2, keys: { 2: generateKek() } });
    const fetcher = vi.fn(() =>
      Promise.resolve(response([{ key_version: 3, row_count: 1, store: "connections" }])),
    );

    await expect(executeKekRotationBatch(environment(serialized), fetcher)).rejects.toThrow(
      "Stored KEK version exceeds active keyring",
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects malformed encrypted rows without reflecting them", async () => {
    const keys = keyrings();
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/kek_encryption_inventory")) {
        return response([{ key_version: 1, row_count: 1, store: "connections" }]);
      }
      return response([
        {
          ...databaseRow(
            await encryptValue(
              "synthetic",
              keys.first,
              connectionCredentialEncryptionContext(userId, recordId),
            ),
            "connections",
          ),
          wrapped_data_key: "not-database-ciphertext",
        },
      ]);
    });

    await expect(executeKekRotationBatch(environment(keys.serialized), fetcher)).rejects.toThrow(
      "Encrypted database value is invalid",
    );
  });
});
