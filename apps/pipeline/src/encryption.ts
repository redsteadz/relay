export type RelayEnvironment = "development" | "production";

export function parseRelayEnvironment(value: string): RelayEnvironment {
  if (value === "development" || value === "production") return value;
  throw new Error("Relay environment is invalid");
}

export function sourceItemEncryptionContext(userId: string, sourceItemId: string): string {
  return `ingress:${userId}:${sourceItemId}`;
}

export function connectionCredentialEncryptionContext(
  userId: string,
  connectionId: string,
): string {
  return `connection:${userId}:${connectionId}:credential`;
}

export function base64ToPostgresBytea(value: string): string {
  const binary = atob(value);
  let hex = "";
  for (let index = 0; index < binary.length; index += 1) {
    hex += binary.charCodeAt(index).toString(16).padStart(2, "0");
  }
  return `\\x${hex}`;
}

export function postgresByteaToBase64(value: unknown, expectedBytes?: number): string {
  if (typeof value !== "string" || !/^\\x(?:[0-9a-f]{2})+$/iu.test(value)) {
    throw new Error("Encrypted database value is invalid");
  }
  const hex = value.slice(2);
  if (expectedBytes !== undefined && hex.length / 2 !== expectedBytes) {
    throw new Error("Encrypted database value is invalid");
  }
  let binary = "";
  for (let index = 0; index < hex.length; index += 2) {
    binary += String.fromCharCode(Number.parseInt(hex.slice(index, index + 2), 16));
  }
  return btoa(binary);
}
