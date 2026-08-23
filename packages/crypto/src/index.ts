export type EncryptedValue = {
  algorithm: "AES-GCM-256";
  ciphertext: string;
  keyVersion: number;
  nonce: string;
  wrappedKey: string;
  wrapNonce: string;
};

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

async function importKek(base64Kek: string): Promise<CryptoKey> {
  const bytes = base64ToBytes(base64Kek);
  if (bytes.byteLength !== 32) throw new Error("Credential KEK must contain exactly 32 bytes");
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export function generateKek(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
}

export async function encryptValue(
  plaintext: string,
  base64Kek: string,
  keyVersion: number,
  context: string,
): Promise<EncryptedValue> {
  const kek = await importKek(base64Kek);
  const dataKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const dataKey = await crypto.subtle.importKey("raw", dataKeyBytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const wrapNonce = crypto.getRandomValues(new Uint8Array(12));
  const payloadAad = new TextEncoder().encode(`${context}:payload:v${keyVersion.toString()}`);
  const keyAad = new TextEncoder().encode(`${context}:data-key:v${keyVersion.toString()}`);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: payloadAad },
    dataKey,
    new TextEncoder().encode(plaintext),
  );
  const wrappedKey = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: wrapNonce, additionalData: keyAad },
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
  base64Kek: string,
  context: string,
): Promise<string> {
  if (value.algorithm !== "AES-GCM-256") throw new Error("Unsupported encryption algorithm");
  const kek = await importKek(base64Kek);
  const payloadAad = new TextEncoder().encode(`${context}:payload:v${value.keyVersion.toString()}`);
  const keyAad = new TextEncoder().encode(`${context}:data-key:v${value.keyVersion.toString()}`);
  const dataKeyBytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(value.wrapNonce), additionalData: keyAad },
    kek,
    base64ToBytes(value.wrappedKey),
  );
  const dataKey = await crypto.subtle.importKey("raw", dataKeyBytes, { name: "AES-GCM" }, false, [
    "decrypt",
  ]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(value.nonce), additionalData: payloadAad },
    dataKey,
    base64ToBytes(value.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}
