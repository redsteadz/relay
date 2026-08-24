import type { EncryptedValueContract } from "@relay/contracts";

export type EncryptedValue = EncryptedValueContract;

export type KekKeyring = {
  activeVersion: number;
  keys: Readonly<Record<number, string>>;
};

const INVALID_KEYRING = "Credential KEK keyring is invalid";
const MAX_KEY_VERSION = 2_147_483_647;
// Immutable for AES-GCM-256 bundles; a new payload format requires a new algorithm identifier.
const PAYLOAD_FORMAT_VERSION = 1;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function validateKek(base64Kek: string): void {
  const bytes = base64ToBytes(base64Kek);
  if (bytes.byteLength !== 32) throw new Error("Credential KEK must contain exactly 32 bytes");
}

function validateKeyVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version <= 0 || version > MAX_KEY_VERSION) {
    throw new Error("Credential KEK version is invalid");
  }
}

function validateDataKey(dataKey: ArrayBuffer): void {
  if (dataKey.byteLength !== 32) throw new Error("Encrypted data key is invalid");
}

async function importKek(base64Kek: string): Promise<CryptoKey> {
  validateKek(base64Kek);
  const bytes = base64ToBytes(base64Kek);
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function keyForVersion(keyring: KekKeyring, version: number): string {
  validateKeyVersion(version);
  const key = keyring.keys[version];
  if (key === undefined) {
    throw new Error(`Credential KEK version ${version.toString()} is unavailable`);
  }
  return key;
}

function payloadAad(context: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${context}:payload:v${PAYLOAD_FORMAT_VERSION.toString()}`);
}

function keyAad(context: string, keyVersion: number): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${context}:data-key:v${keyVersion.toString()}`);
}

export function parseKekKeyring(serialized: string): KekKeyring {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error(INVALID_KEYRING);
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(INVALID_KEYRING);
  }

  const candidate = value as { activeVersion?: unknown; keys?: unknown };
  if (
    typeof candidate.activeVersion !== "number" ||
    !Number.isSafeInteger(candidate.activeVersion) ||
    candidate.activeVersion <= 0 ||
    candidate.activeVersion > MAX_KEY_VERSION ||
    typeof candidate.keys !== "object" ||
    candidate.keys === null ||
    Array.isArray(candidate.keys)
  ) {
    throw new Error(INVALID_KEYRING);
  }

  const keys: Record<number, string> = {};
  const uniqueKeys = new Set<string>();
  try {
    for (const [versionText, key] of Object.entries(candidate.keys)) {
      const version = Number(versionText);
      if (
        !Number.isSafeInteger(version) ||
        version <= 0 ||
        version > MAX_KEY_VERSION ||
        version.toString() !== versionText ||
        typeof key !== "string"
      ) {
        throw new Error(INVALID_KEYRING);
      }
      validateKek(key);
      const canonicalKey = bytesToBase64(base64ToBytes(key));
      if (uniqueKeys.has(canonicalKey)) throw new Error(INVALID_KEYRING);
      uniqueKeys.add(canonicalKey);
      keys[version] = key;
    }
  } catch {
    throw new Error(INVALID_KEYRING);
  }

  const activeVersion = candidate.activeVersion;
  if (keys[activeVersion] === undefined) throw new Error(INVALID_KEYRING);
  return { activeVersion, keys: Object.freeze(keys) };
}

export function generateKek(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
}

export async function encryptValue(
  plaintext: string,
  keyring: KekKeyring,
  context: string,
): Promise<EncryptedValue> {
  const keyVersion = keyring.activeVersion;
  const kek = await importKek(keyForVersion(keyring, keyVersion));
  const dataKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const dataKey = await crypto.subtle.importKey("raw", dataKeyBytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const wrapNonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: payloadAad(context) },
    dataKey,
    new TextEncoder().encode(plaintext),
  );
  const wrappedKey = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: wrapNonce, additionalData: keyAad(context, keyVersion) },
    kek,
    dataKeyBytes,
  );

  return {
    algorithm: "AES-GCM-256",
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    keyVersion,
    nonce: bytesToBase64(nonce),
    wrappedKey: bytesToBase64(new Uint8Array(wrappedKey)),
    wrapNonce: bytesToBase64(wrapNonce),
  };
}

export async function decryptValue(
  value: EncryptedValue,
  keyring: KekKeyring,
  context: string,
): Promise<string> {
  if (value.algorithm !== "AES-GCM-256") throw new Error("Unsupported encryption algorithm");
  const kek = await importKek(keyForVersion(keyring, value.keyVersion));
  const dataKeyBytes = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(value.wrapNonce),
      additionalData: keyAad(context, value.keyVersion),
    },
    kek,
    base64ToBytes(value.wrappedKey),
  );
  validateDataKey(dataKeyBytes);
  const dataKey = await crypto.subtle.importKey("raw", dataKeyBytes, { name: "AES-GCM" }, false, [
    "decrypt",
  ]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(value.nonce), additionalData: payloadAad(context) },
    dataKey,
    base64ToBytes(value.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

export async function rewrapValue(
  value: EncryptedValue,
  keyring: KekKeyring,
  context: string,
): Promise<EncryptedValue> {
  if (value.algorithm !== "AES-GCM-256") throw new Error("Unsupported encryption algorithm");
  const previousKey = keyForVersion(keyring, value.keyVersion);
  if (value.keyVersion === keyring.activeVersion) return value;
  if (keyring.activeVersion < value.keyVersion) {
    throw new Error("Credential KEK rotation must increase the active version");
  }

  const previousKek = await importKek(previousKey);
  const dataKeyBytes = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(value.wrapNonce),
      additionalData: keyAad(context, value.keyVersion),
    },
    previousKek,
    base64ToBytes(value.wrappedKey),
  );
  validateDataKey(dataKeyBytes);
  const nextKek = await importKek(keyForVersion(keyring, keyring.activeVersion));
  const wrapNonce = crypto.getRandomValues(new Uint8Array(12));
  const wrappedKey = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: wrapNonce,
      additionalData: keyAad(context, keyring.activeVersion),
    },
    nextKek,
    dataKeyBytes,
  );

  return {
    ...value,
    keyVersion: keyring.activeVersion,
    wrappedKey: bytesToBase64(new Uint8Array(wrappedKey)),
    wrapNonce: bytesToBase64(wrapNonce),
  };
}
