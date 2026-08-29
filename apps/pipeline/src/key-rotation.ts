import { rawUuidSchema, relayUserIdSchema } from "@relay/contracts";
import { rewrapValue, type EncryptedValue, type KekKeyring } from "@relay/crypto";

import { readPersistenceConfiguration, supabaseBackendHeaders } from "./configuration";
import {
  base64ToPostgresBytea,
  connectionCredentialEncryptionContext,
  postgresByteaToBase64,
  sourceItemEncryptionContext,
  type RelayEnvironment,
} from "./encryption";
import type { Env } from "./env";

const ROWS_PER_STORE = 5;

type RotationStore = "connections" | "dead_letter_items" | "source_items";
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

type StoreSpec = {
  aadContextId?: "encryption_aad_envelope_id";
  aadUserId?: "encryption_aad_user_id";
  ciphertext: "ciphertext" | "credential_ciphertext" | "raw_ciphertext";
  context: (userId: string, id: string) => string;
  contextId: "envelope_id" | "id";
  nonce: "credential_nonce" | "nonce" | "raw_nonce";
  rpc:
    | "cas_rewrap_connection_data_key"
    | "cas_rewrap_dead_letter_data_key"
    | "cas_rewrap_source_item_data_key";
  store: RotationStore;
};

type RotationRow = {
  ciphertext: string;
  contextId: string;
  contextUserId: string;
  encrypted: EncryptedValue;
  id: string;
  nonce: string;
  userId: string;
  wrappedDataKey: string;
  wrapNonce: string;
};

export type KekRotationSummary = {
  activeVersion: number;
  conflicts: number;
  rewrapped: number;
  scanned: number;
};

const STORE_SPECS: readonly StoreSpec[] = [
  {
    ciphertext: "credential_ciphertext",
    context: connectionCredentialEncryptionContext,
    contextId: "id",
    nonce: "credential_nonce",
    rpc: "cas_rewrap_connection_data_key",
    store: "connections",
  },
  {
    ciphertext: "raw_ciphertext",
    context: sourceItemEncryptionContext,
    contextId: "id",
    nonce: "raw_nonce",
    rpc: "cas_rewrap_source_item_data_key",
    store: "source_items",
  },
  {
    aadContextId: "encryption_aad_envelope_id",
    aadUserId: "encryption_aad_user_id",
    ciphertext: "ciphertext",
    context: sourceItemEncryptionContext,
    contextId: "envelope_id",
    nonce: "nonce",
    rpc: "cas_rewrap_dead_letter_data_key",
    store: "dead_letter_items",
  },
];

async function supabaseJson(
  fetcher: Fetcher,
  url: string,
  serviceRoleKey: string,
  operation: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetcher(url, {
    ...init,
    headers: { ...supabaseBackendHeaders(serviceRoleKey), ...init?.headers },
  });
  if (!response.ok) {
    throw new Error(`KEK rotation ${operation} failed with ${response.status.toString()}`);
  }
  return response.json();
}

function parseInventory(value: unknown, keyring: KekKeyring): Set<RotationStore> {
  if (!Array.isArray(value)) throw new Error("KEK inventory response is invalid");
  const stores = new Set<RotationStore>();
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error("KEK inventory response is invalid");
    }
    const candidate = entry as Record<string, unknown>;
    const store = candidate.store;
    const version = candidate.key_version;
    const count = candidate.row_count;
    const validCount =
      (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) ||
      (typeof count === "string" && /^\d+$/u.test(count));
    if (
      (store !== "connections" && store !== "source_items" && store !== "dead_letter_items") ||
      !Number.isSafeInteger(version) ||
      typeof version !== "number" ||
      version <= 0 ||
      !validCount
    ) {
      throw new Error("KEK inventory response is invalid");
    }
    if (version > keyring.activeVersion) {
      throw new Error("Stored KEK version exceeds active keyring");
    }
    if (version < keyring.activeVersion && keyring.keys[version] === undefined) {
      throw new Error(`Credential KEK version ${version.toString()} is unavailable`);
    }
    if (version < keyring.activeVersion && BigInt(count) > 0n) stores.add(store);
  }
  return stores;
}

function parseRotationRow(value: unknown, spec: StoreSpec): RotationRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Encrypted database row is invalid");
  }
  const candidate = value as Record<string, unknown>;
  const id = relayUserIdSchema.safeParse(candidate.id);
  const userId = relayUserIdSchema.safeParse(candidate.user_id);
  const canonicalContextId = relayUserIdSchema.safeParse(candidate[spec.contextId]);
  const keyVersion = candidate.key_version;
  const ciphertext = candidate[spec.ciphertext];
  const nonce = candidate[spec.nonce];
  const wrappedDataKey = candidate.wrapped_data_key;
  const wrapNonce = candidate.wrap_nonce;
  if (
    !id.success ||
    !userId.success ||
    !canonicalContextId.success ||
    typeof keyVersion !== "number" ||
    !Number.isSafeInteger(keyVersion) ||
    keyVersion <= 0 ||
    typeof ciphertext !== "string" ||
    typeof nonce !== "string" ||
    typeof wrappedDataKey !== "string" ||
    typeof wrapNonce !== "string"
  ) {
    throw new Error("Encrypted database row is invalid");
  }
  const encrypted = {
    algorithm: "AES-GCM-256",
    ciphertext: postgresByteaToBase64(ciphertext),
    keyVersion,
    nonce: postgresByteaToBase64(nonce, 12),
    wrappedKey: postgresByteaToBase64(wrappedDataKey, 48),
    wrapNonce: postgresByteaToBase64(wrapNonce, 12),
  } satisfies EncryptedValue;
  let contextId = canonicalContextId.data;
  let contextUserId = userId.data;
  if (spec.aadContextId !== undefined && spec.aadUserId !== undefined) {
    const rawContextId = candidate[spec.aadContextId];
    const rawUserId = candidate[spec.aadUserId];
    if (rawContextId !== null || rawUserId !== null) {
      const parsedContextId = rawUuidSchema.safeParse(rawContextId);
      const parsedUserId = rawUuidSchema.safeParse(rawUserId);
      if (
        !parsedContextId.success ||
        !parsedUserId.success ||
        relayUserIdSchema.parse(parsedContextId.data) !== canonicalContextId.data ||
        relayUserIdSchema.parse(parsedUserId.data) !== userId.data
      ) {
        throw new Error("Encrypted database row is invalid");
      }
      contextId = parsedContextId.data;
      contextUserId = parsedUserId.data;
    }
  }
  return {
    ciphertext,
    contextId,
    contextUserId,
    encrypted,
    id: id.data,
    nonce,
    userId: userId.data,
    wrappedDataKey,
    wrapNonce,
  };
}

function rowsUrl(
  supabaseUrl: string,
  environment: RelayEnvironment,
  spec: StoreSpec,
  activeVersion: number,
  id?: string,
  userId?: string,
): string {
  const url = new URL(`/rest/v1/${spec.store}`, supabaseUrl);
  url.searchParams.set(
    "select",
    `id,user_id${spec.contextId === "id" ? "" : `,${spec.contextId}`}${spec.aadUserId === undefined ? "" : `,${spec.aadUserId},${spec.aadContextId}`},${spec.ciphertext},${spec.nonce},wrapped_data_key,wrap_nonce,key_version`,
  );
  url.searchParams.set("encryption_environment", `eq.${environment}`);
  if (id === undefined) {
    url.searchParams.set("key_version", `lt.${activeVersion.toString()}`);
    url.searchParams.set("order", "key_version.asc,id.asc");
    url.searchParams.set("limit", ROWS_PER_STORE.toString());
  } else {
    url.searchParams.set("id", `eq.${id}`);
    url.searchParams.set("user_id", `eq.${userId ?? ""}`);
    url.searchParams.set("limit", "1");
  }
  return url.toString();
}

async function readRows(
  fetcher: Fetcher,
  supabaseUrl: string,
  serviceRoleKey: string,
  environment: RelayEnvironment,
  spec: StoreSpec,
  activeVersion: number,
  id?: string,
  userId?: string,
): Promise<RotationRow[]> {
  const value = await supabaseJson(
    fetcher,
    rowsUrl(supabaseUrl, environment, spec, activeVersion, id, userId),
    serviceRoleKey,
    "row read",
  );
  if (!Array.isArray(value)) throw new Error("KEK rotation row response is invalid");
  return value.map((entry) => parseRotationRow(entry, spec));
}

async function compareAndSet(
  fetcher: Fetcher,
  supabaseUrl: string,
  serviceRoleKey: string,
  environment: RelayEnvironment,
  spec: StoreSpec,
  row: RotationRow,
  rewrapped: EncryptedValue,
): Promise<boolean> {
  const value = await supabaseJson(
    fetcher,
    new URL(`/rest/v1/rpc/${spec.rpc}`, supabaseUrl).toString(),
    serviceRoleKey,
    "compare-and-set",
    {
      body: JSON.stringify({
        p_environment: environment,
        p_expected_ciphertext: row.ciphertext,
        p_expected_key_version: row.encrypted.keyVersion,
        p_expected_payload_nonce: row.nonce,
        p_expected_wrapped_data_key: row.wrappedDataKey,
        p_expected_wrap_nonce: row.wrapNonce,
        p_id: row.id,
        p_new_key_version: rewrapped.keyVersion,
        p_new_wrapped_data_key: base64ToPostgresBytea(rewrapped.wrappedKey),
        p_new_wrap_nonce: base64ToPostgresBytea(rewrapped.wrapNonce),
        p_user_id: row.userId,
      }),
      method: "POST",
    },
  );
  if (typeof value !== "boolean") throw new Error("KEK rotation CAS response is invalid");
  return value;
}

async function rewrapRow(
  fetcher: Fetcher,
  supabaseUrl: string,
  serviceRoleKey: string,
  environment: RelayEnvironment,
  spec: StoreSpec,
  row: RotationRow,
  keyring: KekKeyring,
): Promise<"conflict" | "rewrapped" | "stale"> {
  const context = spec.context(row.contextUserId, row.contextId);
  const rewrapped = await rewrapValue(row.encrypted, keyring, context);
  if (
    await compareAndSet(fetcher, supabaseUrl, serviceRoleKey, environment, spec, row, rewrapped)
  ) {
    return "rewrapped";
  }

  const refreshed = await readRows(
    fetcher,
    supabaseUrl,
    serviceRoleKey,
    environment,
    spec,
    keyring.activeVersion,
    row.id,
    row.userId,
  );
  if (refreshed.length === 0 || refreshed[0]?.encrypted.keyVersion === keyring.activeVersion) {
    return "stale";
  }
  const current = refreshed[0];
  if (current === undefined || current.encrypted.keyVersion > keyring.activeVersion) {
    throw new Error("Stored KEK version exceeds active keyring");
  }
  const retry = await rewrapValue(
    current.encrypted,
    keyring,
    spec.context(current.contextUserId, current.contextId),
  );
  return (await compareAndSet(
    fetcher,
    supabaseUrl,
    serviceRoleKey,
    environment,
    spec,
    current,
    retry,
  ))
    ? "rewrapped"
    : "conflict";
}

export async function executeKekRotationBatch(
  env: Env,
  fetcher: Fetcher = fetch,
): Promise<KekRotationSummary> {
  const configuration = readPersistenceConfiguration(env);
  if (configuration.supabase === undefined) {
    throw new Error("KEK rotation requires Supabase configuration");
  }
  const { environment, keyring, supabase } = configuration;
  const inventory = await supabaseJson(
    fetcher,
    new URL("/rest/v1/rpc/kek_encryption_inventory", supabase.url).toString(),
    supabase.serviceRoleKey,
    "inventory",
    { body: JSON.stringify({ p_environment: environment }), method: "POST" },
  );
  const stores = parseInventory(inventory, keyring);
  const summary: KekRotationSummary = {
    activeVersion: keyring.activeVersion,
    conflicts: 0,
    rewrapped: 0,
    scanned: 0,
  };

  for (const spec of STORE_SPECS) {
    if (!stores.has(spec.store)) continue;
    const rows = await readRows(
      fetcher,
      supabase.url,
      supabase.serviceRoleKey,
      environment,
      spec,
      keyring.activeVersion,
    );
    for (const row of rows) {
      summary.scanned += 1;
      const result = await rewrapRow(
        fetcher,
        supabase.url,
        supabase.serviceRoleKey,
        environment,
        spec,
        row,
        keyring,
      );
      if (result === "rewrapped") summary.rewrapped += 1;
      if (result === "conflict") summary.conflicts += 1;
    }
  }
  return summary;
}
