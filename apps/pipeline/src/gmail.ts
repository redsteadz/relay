import {
  canonicalUuidSchema,
  gmailDisconnectRequestSchema,
  gmailHistoryIdSchema,
  verifiedGmailCursorSchema,
  type VerifiedGmailCursor,
} from "@relay/contracts";
import { decryptValue } from "@relay/crypto";

import { scheduleEarlierAlarm } from "./alarms";
import { readBoundedJson } from "./bounded-json";
import {
  readPersistenceConfiguration,
  supabaseBackendHeaders,
  type PersistenceConfiguration,
} from "./configuration";
import { connectionCredentialEncryptionContext, postgresByteaToBase64 } from "./encryption";
import type { Env } from "./env";
import { deadlineFetcher, withOperationDeadline } from "./deadline";
import {
  createGmailWatch,
  fetchCanonicalGmailEnvelope,
  GMAIL_EXTERNAL_OPERATION_TIMEOUT_MS,
  GMAIL_WATCH_EXPIRATION_TOLERANCE_MS,
  GMAIL_WATCH_MAX_LIFETIME_MS,
  GmailProviderError,
  listGmailHistoryPage,
  readGmailProviderConfiguration,
  refreshGmailAccessToken,
  revokeGoogleRefreshToken,
  stopGmailWatch,
} from "./gmail-provider";
import { publishEncryptedIngress } from "./ingress";

const IDENTITY_KEY = "gmail:identity";
const HISTORY_WORK_KEY = "gmail:history-work";
const DISCONNECT_WORK_KEY = "gmail:disconnect-work";
const DISCONNECT_INTENT_PREFIX = "gmail:disconnect-intent:";
const REVOCATION_WORK_KEY = "gmail:revocation-work";
const REMOVED_MARKER_KEY = "gmail:removed";
const INITIALIZATION_KEY = "gmail:initialization";
const PENDING_HISTORY_KEY = "gmail:pending-history-id";
const RECONCILE_KEY = "gmail:reconcile";
const RENEW_WATCH_KEY = "gmail:renew-watch";
const HISTORY_SEEN_PREFIX = "gmail:history-seen:";
const HISTORY_PAGE_PREFIX = "gmail:history-page:";
const HISTORY_CHUNK_PREFIX = "gmail:history-chunk:";
const ALARM_RETRY_KEY = "gmail:alarm-retry";
const MAX_HISTORY_PAGES = 10_000;
const MAX_MESSAGES_PER_ALARM = 10;
const HISTORY_MESSAGE_CHUNK_SIZE = 100;
const MAX_HISTORY_MESSAGE_CHUNKS = 250;
const HISTORY_CHUNK_WRITE_BATCH = 128;
const MARKER_CLEANUP_BATCH = 42;
const DISCONNECT_INTENT_BATCH = 42;
const MAX_SUPABASE_RESPONSE_BYTES = 128_000;
const MAX_ALARM_RETRY_ATTEMPTS = 16;
const MAX_ALARM_RETRY_DELAY_MS = 5 * 60 * 1000;
const INITIAL_ALARM_RETRY_DELAY_MS = 2_000;
export const GMAIL_ALARM_DEADLINE_MS = 4 * 60 * 1000;
const GMAIL_REMOVAL_NAMESPACE = "05084003-a92c-5bc1-8a8b-5f9935080d24";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export type GmailIdentity = {
  schemaVersion: 1;
  connectionId: string;
  userId: string;
};

export type GmailMaintenanceRequest = GmailIdentity & {
  reconcile: boolean;
  renewWatch: boolean;
};

type ResolvedGmailConnection = Omit<GmailIdentity, "schemaVersion"> & {
  targetStatus: "active" | "tombstone";
};

type LoadedGmailConnection = {
  historyCursor?: string;
  refreshToken: string;
  syncStatus: "active" | "stale";
};

export type DueGmailConnection = Omit<GmailIdentity, "schemaVersion"> & {
  reconcile: boolean;
  renewWatch: boolean;
};

type HistoryWorkPhase = "advance" | "cleanup" | "fetch-page" | "messages";

type GmailHistoryWork = GmailIdentity & {
  chunkCount: number;
  chunkIndex: number;
  latestHistoryId: string;
  messageIndex: number;
  nextPageToken: string | null;
  pageCount: number;
  pageToken: string | null;
  phase: HistoryWorkPhase;
  startHistoryId: string;
  targetHistoryId: string;
};

type GmailDisconnectWork = GmailIdentity & {
  phase: "delete" | "done" | "revoke" | "stop";
  providerAlreadyRevoked: boolean;
  tokenRevoked: boolean;
  watchStopped: boolean;
};

type GmailAlarmRetry = {
  attempts: number;
  nextAttemptAt: number;
};

type GmailRemovalReason = "provider-grant-revoked" | "user-disconnect";

type GmailAutomaticRevocationWork = GmailIdentity & {
  actionId: string;
  reason: "provider-grant-revoked";
};

type GmailRemovedMarker = GmailAutomaticRevocationWork & {
  expiresAt: number;
  phase: "completed" | "pending";
};

type GmailTerminalMessageReason =
  | "provider-message-missing"
  | "provider-response-invalid"
  | "provider-response-too-large"
  | "queue-budget-exceeded";

type GmailInitialization = GmailIdentity & {
  baselineHistoryId: string | null;
  expiration: string | null;
  phase: "baseline-ready" | "stale" | "watch-call-in-flight";
  reason: "continuation-invalid" | "initialization-ambiguous" | "stale-history" | null;
};

function identityCandidate(value: unknown): GmailIdentity | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).length !== 3 ||
    candidate.schemaVersion !== 1 ||
    !canonicalUuidSchema.safeParse(candidate.connectionId).success ||
    !canonicalUuidSchema.safeParse(candidate.userId).success
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    connectionId: canonicalUuidSchema.parse(candidate.connectionId),
    userId: canonicalUuidSchema.parse(candidate.userId),
  };
}

function continuationTokenCandidate(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return false;
  return ![...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return /\s/u.test(character) || codePoint <= 31 || codePoint === 127;
  });
}

function providerMessageIdCandidate(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/u.test(value);
}

function messageChunkCandidate(value: unknown): string[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > HISTORY_MESSAGE_CHUNK_SIZE ||
    !value.every(providerMessageIdCandidate) ||
    new Set(value).size !== value.length
  ) {
    return undefined;
  }
  return value;
}

function canonicalInstantCandidate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function historyWorkCandidate(value: unknown): GmailHistoryWork | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const identity = identityCandidate({
    schemaVersion: candidate.schemaVersion,
    connectionId: candidate.connectionId,
    userId: candidate.userId,
  });
  const startHistoryId = gmailHistoryIdSchema.safeParse(candidate.startHistoryId);
  const targetHistoryId = gmailHistoryIdSchema.safeParse(candidate.targetHistoryId);
  const latestHistoryId = gmailHistoryIdSchema.safeParse(candidate.latestHistoryId);
  if (
    Object.keys(candidate).length !== 13 ||
    identity === undefined ||
    !startHistoryId.success ||
    !targetHistoryId.success ||
    !latestHistoryId.success ||
    (candidate.phase !== "fetch-page" &&
      candidate.phase !== "messages" &&
      candidate.phase !== "advance" &&
      candidate.phase !== "cleanup") ||
    (candidate.pageToken !== null && !continuationTokenCandidate(candidate.pageToken)) ||
    (candidate.nextPageToken !== null && !continuationTokenCandidate(candidate.nextPageToken)) ||
    typeof candidate.chunkCount !== "number" ||
    !Number.isInteger(candidate.chunkCount) ||
    candidate.chunkCount < 0 ||
    candidate.chunkCount > MAX_HISTORY_MESSAGE_CHUNKS ||
    typeof candidate.chunkIndex !== "number" ||
    !Number.isInteger(candidate.chunkIndex) ||
    candidate.chunkIndex < 0 ||
    typeof candidate.messageIndex !== "number" ||
    !Number.isInteger(candidate.messageIndex) ||
    candidate.messageIndex < 0 ||
    candidate.messageIndex > HISTORY_MESSAGE_CHUNK_SIZE ||
    typeof candidate.pageCount !== "number" ||
    !Number.isInteger(candidate.pageCount) ||
    candidate.pageCount < 0 ||
    candidate.pageCount > MAX_HISTORY_PAGES ||
    compareHistoryIds(latestHistoryId.data, startHistoryId.data) < 0 ||
    compareHistoryIds(targetHistoryId.data, startHistoryId.data) < 0 ||
    (candidate.phase === "fetch-page" &&
      (candidate.chunkCount !== 0 ||
        candidate.chunkIndex !== 0 ||
        candidate.messageIndex !== 0 ||
        candidate.nextPageToken !== null)) ||
    (candidate.phase === "messages" &&
      (candidate.chunkCount === 0 || candidate.chunkIndex >= candidate.chunkCount)) ||
    ((candidate.phase === "advance" || candidate.phase === "cleanup") &&
      (candidate.pageCount === 0 ||
        candidate.pageToken !== null ||
        candidate.nextPageToken !== null ||
        candidate.chunkCount !== 0 ||
        candidate.chunkIndex !== 0 ||
        candidate.messageIndex !== 0))
  ) {
    return undefined;
  }
  return {
    ...identity,
    chunkCount: candidate.chunkCount,
    chunkIndex: candidate.chunkIndex,
    latestHistoryId: latestHistoryId.data,
    messageIndex: candidate.messageIndex,
    nextPageToken: candidate.nextPageToken,
    pageCount: candidate.pageCount,
    pageToken: candidate.pageToken,
    phase: candidate.phase,
    startHistoryId: startHistoryId.data,
    targetHistoryId: targetHistoryId.data,
  };
}

function disconnectWorkCandidate(value: unknown): GmailDisconnectWork | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const identity = identityCandidate({
    schemaVersion: candidate.schemaVersion,
    connectionId: candidate.connectionId,
    userId: candidate.userId,
  });
  if (
    Object.keys(candidate).length !== 7 ||
    identity === undefined ||
    (candidate.phase !== "stop" &&
      candidate.phase !== "revoke" &&
      candidate.phase !== "delete" &&
      candidate.phase !== "done") ||
    typeof candidate.providerAlreadyRevoked !== "boolean" ||
    typeof candidate.tokenRevoked !== "boolean" ||
    typeof candidate.watchStopped !== "boolean" ||
    (candidate.phase === "stop" &&
      (candidate.providerAlreadyRevoked || candidate.tokenRevoked || candidate.watchStopped)) ||
    (candidate.phase === "revoke" &&
      (candidate.providerAlreadyRevoked || candidate.tokenRevoked || !candidate.watchStopped)) ||
    ((candidate.phase === "delete" || candidate.phase === "done") &&
      !(
        (!candidate.providerAlreadyRevoked && candidate.tokenRevoked && candidate.watchStopped) ||
        (candidate.providerAlreadyRevoked && candidate.tokenRevoked && !candidate.watchStopped)
      ))
  ) {
    return undefined;
  }
  return {
    ...identity,
    phase: candidate.phase,
    providerAlreadyRevoked: candidate.providerAlreadyRevoked,
    tokenRevoked: candidate.tokenRevoked,
    watchStopped: candidate.watchStopped,
  };
}

function alarmRetryCandidate(value: unknown): GmailAlarmRetry | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).length !== 2 ||
    typeof candidate.attempts !== "number" ||
    !Number.isInteger(candidate.attempts) ||
    candidate.attempts < 1 ||
    candidate.attempts > MAX_ALARM_RETRY_ATTEMPTS ||
    typeof candidate.nextAttemptAt !== "number" ||
    !Number.isSafeInteger(candidate.nextAttemptAt) ||
    candidate.nextAttemptAt < 0
  ) {
    return undefined;
  }
  return { attempts: candidate.attempts, nextAttemptAt: candidate.nextAttemptAt };
}

function initializationCandidate(value: unknown): GmailInitialization | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const identity = identityCandidate({
    schemaVersion: candidate.schemaVersion,
    connectionId: candidate.connectionId,
    userId: candidate.userId,
  });
  const baseline =
    candidate.baselineHistoryId === null
      ? null
      : gmailHistoryIdSchema.safeParse(candidate.baselineHistoryId);
  const validExpiration =
    candidate.expiration === null || canonicalInstantCandidate(candidate.expiration);
  if (
    Object.keys(candidate).length !== 7 ||
    identity === undefined ||
    (candidate.phase !== "baseline-ready" &&
      candidate.phase !== "stale" &&
      candidate.phase !== "watch-call-in-flight") ||
    (baseline !== null && !baseline.success) ||
    !validExpiration ||
    (candidate.reason !== null &&
      candidate.reason !== "continuation-invalid" &&
      candidate.reason !== "initialization-ambiguous" &&
      candidate.reason !== "stale-history") ||
    (candidate.phase === "baseline-ready" &&
      (baseline === null || candidate.expiration === null || candidate.reason !== null)) ||
    (candidate.phase === "watch-call-in-flight" &&
      (candidate.baselineHistoryId !== null ||
        candidate.expiration !== null ||
        candidate.reason !== null)) ||
    (candidate.phase === "stale" && candidate.reason === null)
  ) {
    return undefined;
  }
  return {
    ...identity,
    baselineHistoryId: baseline === null ? null : baseline.data,
    expiration: candidate.expiration as string | null,
    phase: candidate.phase,
    reason: candidate.reason,
  };
}

function automaticRevocationCandidate(value: unknown): GmailAutomaticRevocationWork | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const identity = identityCandidate({
    schemaVersion: candidate.schemaVersion,
    connectionId: candidate.connectionId,
    userId: candidate.userId,
  });
  const actionId = canonicalUuidSchema.safeParse(candidate.actionId);
  if (
    Object.keys(candidate).length !== 5 ||
    identity === undefined ||
    !actionId.success ||
    candidate.reason !== "provider-grant-revoked"
  ) {
    return undefined;
  }
  return { ...identity, actionId: actionId.data, reason: candidate.reason };
}

function removedMarkerCandidate(value: unknown): GmailRemovedMarker | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const revocation = automaticRevocationCandidate({
    schemaVersion: candidate.schemaVersion,
    actionId: candidate.actionId,
    connectionId: candidate.connectionId,
    reason: candidate.reason,
    userId: candidate.userId,
  });
  if (
    Object.keys(candidate).length !== 7 ||
    revocation === undefined ||
    typeof candidate.expiresAt !== "number" ||
    !Number.isSafeInteger(candidate.expiresAt) ||
    candidate.expiresAt < 0 ||
    (candidate.phase !== "completed" && candidate.phase !== "pending")
  ) {
    return undefined;
  }
  return { ...revocation, expiresAt: candidate.expiresAt, phase: candidate.phase };
}

export function compareHistoryIds(left: string, right: string): -1 | 0 | 1 {
  const parsedLeft = gmailHistoryIdSchema.parse(left);
  const parsedRight = gmailHistoryIdSchema.parse(right);
  const leftValue = BigInt(parsedLeft);
  const rightValue = BigInt(parsedRight);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function highestHistoryId(left: string | undefined, right: string): string {
  return left === undefined || compareHistoryIds(left, right) < 0 ? right : left;
}

function supabaseConfiguration(env: Env): PersistenceConfiguration & {
  supabase: NonNullable<PersistenceConfiguration["supabase"]>;
} {
  const configuration = readPersistenceConfiguration(env);
  if (configuration.supabase === undefined) throw new Error("Gmail persistence is unavailable");
  return { ...configuration, supabase: configuration.supabase };
}

async function rpc(
  configuration: ReturnType<typeof supabaseConfiguration>,
  name: string,
  body: Record<string, unknown>,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetcher(`${configuration.supabase.url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: supabaseBackendHeaders(configuration.supabase.serviceRoleKey),
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error("Gmail persistence is unavailable");
  try {
    return await readBoundedJson(response, MAX_SUPABASE_RESPONSE_BYTES, {
      ...(signal === undefined ? {} : { signal }),
      timeoutMs: GMAIL_EXTERNAL_OPERATION_TIMEOUT_MS,
    });
  } catch {
    throw new Error("Gmail persistence response is invalid");
  }
}

function exactObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\u0000") !== [...keys].sort().join("\u0000")
  ) {
    throw new Error("Gmail persistence response is invalid");
  }
  return value as Record<string, unknown>;
}

export async function resolveGmailConnection(
  env: Env,
  cursor: VerifiedGmailCursor,
  fetcher: Fetcher = fetch,
): Promise<ResolvedGmailConnection[]> {
  const configuration = supabaseConfiguration(env);
  const value = await rpc(
    configuration,
    "resolve_gmail_connection_v1",
    { p_normalized_email: cursor.emailAddress },
    fetcher,
  );
  if (!Array.isArray(value) || value.length > 2) {
    throw new Error("Gmail persistence response is invalid");
  }
  return value.map((candidate) => {
    const row = exactObject(candidate, ["connection_id", "target_status", "user_id"]);
    const connectionId = canonicalUuidSchema.safeParse(row.connection_id);
    const userId = canonicalUuidSchema.safeParse(row.user_id);
    if (
      !connectionId.success ||
      !userId.success ||
      (row.target_status !== "active" && row.target_status !== "tombstone")
    ) {
      throw new Error("Gmail persistence response is invalid");
    }
    return {
      connectionId: connectionId.data,
      targetStatus: row.target_status,
      userId: userId.data,
    };
  });
}

export async function handleVerifiedGmailCursor(
  env: Env,
  cursorCandidate: unknown,
  fetcher: Fetcher = fetch,
): Promise<Response> {
  const cursor = verifiedGmailCursorSchema.safeParse(cursorCandidate);
  if (!cursor.success)
    return Response.json({ accepted: false, reason: "invalid" }, { status: 400 });
  try {
    readGmailProviderConfiguration(env);
    supabaseConfiguration(env);
  } catch {
    return Response.json({ accepted: false, reason: "configuration-invalid" }, { status: 503 });
  }

  let matches: ResolvedGmailConnection[];
  try {
    matches = await resolveGmailConnection(env, cursor.data, fetcher);
  } catch {
    return Response.json({ accepted: false, reason: "ownership-unavailable" }, { status: 503 });
  }
  if (matches.length === 0) {
    return Response.json({ accepted: false, reason: "ownership-unresolved" }, { status: 404 });
  }
  if (matches.length !== 1) {
    return Response.json({ accepted: false, reason: "ownership-ambiguous" }, { status: 409 });
  }
  if (matches[0]!.targetStatus === "tombstone") {
    return Response.json({ accepted: true, durable: true, tombstone: true }, { status: 202 });
  }

  const identity: GmailIdentity = {
    schemaVersion: 1,
    connectionId: matches[0]!.connectionId,
    userId: matches[0]!.userId,
  };
  try {
    const coordinator = env.TENANT_COORDINATOR.getByName(`gmail:${identity.connectionId}`);
    const response = await coordinator.fetch("https://coordinator.internal/gmail/cursor", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...identity, historyId: cursor.data.historyId }),
    });
    return response.ok
      ? Response.json({ accepted: true, durable: true }, { status: 202 })
      : Response.json(
          {
            accepted: false,
            reason: response.status === 409 ? "identity-conflict" : "durability-failed",
          },
          { status: response.status === 409 ? 409 : 503 },
        );
  } catch {
    return Response.json({ accepted: false, reason: "durability-failed" }, { status: 503 });
  }
}

export async function handleGmailDisconnect(env: Env, candidate: unknown): Promise<Response> {
  const request = gmailDisconnectRequestSchema.safeParse(candidate);
  if (!request.success) {
    return Response.json({ disconnected: false, reason: "invalid" }, { status: 400 });
  }
  try {
    const coordinator = env.TENANT_COORDINATOR.getByName(`gmail:${request.data.connectionId}`);
    return await coordinator.fetch("https://coordinator.internal/gmail/disconnect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request.data),
    });
  } catch {
    return Response.json({ disconnected: false, reason: "unavailable" }, { status: 503 });
  }
}

export async function acceptGmailCursor(
  storage: DurableObjectStorage,
  identity: GmailIdentity,
  historyId: string,
): Promise<Response> {
  const parsedIdentity = identityCandidate(identity);
  const parsedHistoryId = gmailHistoryIdSchema.safeParse(historyId);
  if (parsedIdentity === undefined || !parsedHistoryId.success) {
    return Response.json({ accepted: false, reason: "invalid" }, { status: 400 });
  }
  const removed = await removedMarkerStatus(storage, parsedIdentity);
  if (removed === "completed") {
    return Response.json({ accepted: true, durable: true, removed: true }, { status: 202 });
  }
  if (removed === "pending") {
    return Response.json({ accepted: false, reason: "removal-pending" }, { status: 503 });
  }
  if (removed === "conflict") {
    return Response.json({ accepted: false, reason: "identity-conflict" }, { status: 409 });
  }
  const [storedIdentityValue, pendingValue] = await Promise.all([
    storage.get(IDENTITY_KEY),
    storage.get(PENDING_HISTORY_KEY),
  ]);
  const storedIdentity =
    storedIdentityValue === undefined ? undefined : identityCandidate(storedIdentityValue);
  if (
    storedIdentityValue !== undefined &&
    (storedIdentity === undefined ||
      storedIdentity.userId !== parsedIdentity.userId ||
      storedIdentity.connectionId !== parsedIdentity.connectionId)
  ) {
    return Response.json({ accepted: false, reason: "identity-conflict" }, { status: 409 });
  }
  const pending = gmailHistoryIdSchema.safeParse(pendingValue);
  const highest = highestHistoryId(
    pending.success ? pending.data : undefined,
    parsedHistoryId.data,
  );
  await storage.put({ [IDENTITY_KEY]: parsedIdentity, [PENDING_HISTORY_KEY]: highest });
  await scheduleEarlierAlarm(storage, Date.now());
  return Response.json({ accepted: true, durable: true }, { status: 202 });
}

export async function acceptGmailMaintenance(
  storage: DurableObjectStorage,
  request: GmailMaintenanceRequest,
): Promise<Response> {
  const { reconcile, renewWatch, ...identityValue } = request;
  const identity = identityCandidate(identityValue);
  if (identity === undefined || typeof reconcile !== "boolean" || typeof renewWatch !== "boolean") {
    return Response.json({ accepted: false, reason: "invalid" }, { status: 400 });
  }
  const removed = await removedMarkerStatus(storage, identity);
  if (removed === "completed") {
    return Response.json({ accepted: true, durable: true, removed: true }, { status: 202 });
  }
  if (removed === "pending") {
    return Response.json({ accepted: false, reason: "removal-pending" }, { status: 503 });
  }
  if (removed === "conflict") {
    return Response.json({ accepted: false, reason: "identity-conflict" }, { status: 409 });
  }
  const storedValue = await storage.get(IDENTITY_KEY);
  const stored = storedValue === undefined ? undefined : identityCandidate(storedValue);
  if (
    storedValue !== undefined &&
    (stored === undefined ||
      stored.userId !== identity.userId ||
      stored.connectionId !== identity.connectionId)
  ) {
    return Response.json({ accepted: false, reason: "identity-conflict" }, { status: 409 });
  }
  const entries: Record<string, unknown> = { [IDENTITY_KEY]: identity };
  if (reconcile) entries[RECONCILE_KEY] = true;
  if (renewWatch) entries[RENEW_WATCH_KEY] = true;
  await storage.put(entries);
  await scheduleEarlierAlarm(storage, Date.now());
  return Response.json({ accepted: true, durable: true }, { status: 202 });
}

export async function acceptGmailDisconnect(
  storage: DurableObjectStorage,
  identityValue: GmailIdentity,
): Promise<Response> {
  const identity = identityCandidate(identityValue);
  if (identity === undefined) {
    return Response.json({ accepted: false, reason: "invalid" }, { status: 400 });
  }
  const removed = await removedMarkerStatus(storage, identity);
  if (removed === "completed") {
    return Response.json({ accepted: true, durable: true, removed: true }, { status: 202 });
  }
  if (removed === "pending") {
    return Response.json({ accepted: false, reason: "removal-pending" }, { status: 503 });
  }
  if (removed === "conflict") {
    return Response.json({ accepted: false, reason: "identity-conflict" }, { status: 409 });
  }
  const [storedIdentityValue, disconnectValue] = await Promise.all([
    storage.get(IDENTITY_KEY),
    storage.get(DISCONNECT_WORK_KEY),
  ]);
  const storedIdentity =
    storedIdentityValue === undefined ? undefined : identityCandidate(storedIdentityValue);
  const disconnect =
    disconnectValue === undefined ? undefined : disconnectWorkCandidate(disconnectValue);
  if (
    (storedIdentityValue !== undefined &&
      (storedIdentity === undefined || !identitiesMatch(storedIdentity, identity))) ||
    (disconnectValue !== undefined &&
      (disconnect === undefined || !identitiesMatch(disconnect, identity)))
  ) {
    return Response.json({ accepted: false, reason: "identity-conflict" }, { status: 409 });
  }
  const work: GmailDisconnectWork = disconnect ?? {
    ...identity,
    phase: "stop",
    providerAlreadyRevoked: false,
    tokenRevoked: false,
    watchStopped: false,
  };
  await storage.put({ [DISCONNECT_WORK_KEY]: work, [IDENTITY_KEY]: identity });
  await scheduleEarlierAlarm(storage, Date.now());
  return Response.json({ accepted: true, durable: true }, { status: 202 });
}

class GmailConnectionNotFoundError extends Error {
  constructor() {
    super("Gmail connection is unavailable");
  }
}

export async function readGmailConnectionOwnership(
  env: Env,
  identityValue: GmailIdentity,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<"absent" | "active" | "completed"> {
  const identity = identityCandidate(identityValue);
  if (identity === undefined) throw new Error("Gmail connection is unavailable");
  const value = await rpc(
    supabaseConfiguration(env),
    "gmail_connection_ownership_v1",
    { p_connection_id: identity.connectionId, p_user_id: identity.userId },
    fetcher,
    signal,
  );
  if (value !== "absent" && value !== "active" && value !== "completed") {
    throw new Error("Gmail persistence response is invalid");
  }
  return value;
}

async function runPendingGmailDisconnectIntent(
  storage: DurableObjectStorage,
  env: Env,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<boolean> {
  const intents = await storage.list({
    prefix: DISCONNECT_INTENT_PREFIX,
    limit: DISCONNECT_INTENT_BATCH,
  });
  const first = intents.entries().next();
  if (first.done) return false;
  const [key, value] = first.value;
  const identity = identityCandidate(value);
  if (identity === undefined || key !== disconnectIntentKey(identity)) {
    await discardGmailDisconnectIntent(storage, key);
    return true;
  }

  const removed = await removedMarkerStatus(storage, identity);
  if (removed === "pending") return true;
  if (removed === "completed" || removed === "conflict") {
    await discardGmailDisconnectIntent(storage, key);
    return true;
  }

  const [storedIdentityValue, disconnectValue] = await Promise.all([
    storage.get(IDENTITY_KEY),
    storage.get(DISCONNECT_WORK_KEY),
  ]);
  const storedIdentity = identityCandidate(storedIdentityValue);
  const disconnect = disconnectWorkCandidate(disconnectValue);
  if (
    (storedIdentityValue !== undefined &&
      (storedIdentity === undefined || !identitiesMatch(storedIdentity, identity))) ||
    (disconnectValue !== undefined &&
      (disconnect === undefined || !identitiesMatch(disconnect, identity)))
  ) {
    await discardGmailDisconnectIntent(storage, key);
    return true;
  }
  if (
    storedIdentity !== undefined &&
    disconnect !== undefined &&
    identitiesMatch(storedIdentity, identity) &&
    identitiesMatch(disconnect, identity)
  ) {
    const result = await runGmailDisconnect(storage, env, fetcher, signal);
    if (result !== "completed") throw new Error("Gmail disconnect intent did not complete");
    return true;
  }

  const ownership = await readGmailConnectionOwnership(env, identity, fetcher, signal);
  if (ownership !== "active") {
    await discardGmailDisconnectIntent(storage, key);
    return true;
  }

  const accepted = await acceptGmailDisconnect(storage, identity);
  if (!accepted.ok) throw new Error("Gmail disconnect intent is invalid");
  if (intents.size > 1) await scheduleEarlierAlarm(storage, Date.now());
  const result = await runGmailDisconnect(storage, env, fetcher, signal);
  if (result !== "completed") throw new Error("Gmail disconnect intent did not complete");
  return true;
}

export async function loadGmailConnectionCredential(
  env: Env,
  identity: GmailIdentity,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<LoadedGmailConnection> {
  const configuration = supabaseConfiguration(env);
  const value = await rpc(
    configuration,
    "load_gmail_connection_v1",
    { p_connection_id: identity.connectionId, p_user_id: identity.userId },
    fetcher,
    signal,
  );
  if (!Array.isArray(value) || value.length > 1) {
    throw new Error("Gmail connection is unavailable");
  }
  if (value.length === 0) throw new GmailConnectionNotFoundError();
  const row = exactObject(value[0], [
    "credential_ciphertext",
    "credential_nonce",
    "encryption_environment",
    "history_cursor",
    "key_version",
    "sync_status",
    "wrap_nonce",
    "wrapped_data_key",
  ]);
  if (
    row.encryption_environment !== configuration.environment ||
    (row.sync_status !== "active" && row.sync_status !== "stale") ||
    typeof row.key_version !== "number" ||
    !Number.isInteger(row.key_version) ||
    row.key_version < 1 ||
    (row.history_cursor !== null && !gmailHistoryIdSchema.safeParse(row.history_cursor).success)
  ) {
    throw new Error("Gmail persistence response is invalid");
  }
  let refreshToken: string;
  try {
    refreshToken = await decryptValue(
      {
        algorithm: "AES-GCM-256",
        ciphertext: postgresByteaToBase64(row.credential_ciphertext),
        nonce: postgresByteaToBase64(row.credential_nonce, 12),
        wrappedKey: postgresByteaToBase64(row.wrapped_data_key, 48),
        wrapNonce: postgresByteaToBase64(row.wrap_nonce, 12),
        keyVersion: row.key_version,
      },
      configuration.keyring,
      connectionCredentialEncryptionContext(identity.userId, identity.connectionId),
    );
  } catch {
    throw new Error("Gmail credential is unavailable");
  }
  if (refreshToken.length === 0 || refreshToken.length > 8192) {
    throw new Error("Gmail credential is unavailable");
  }
  return {
    ...(typeof row.history_cursor === "string" ? { historyCursor: row.history_cursor } : {}),
    refreshToken,
    syncStatus: row.sync_status,
  };
}

async function booleanRpc(
  env: Env,
  name: string,
  body: Record<string, unknown>,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<void> {
  const value = await rpc(supabaseConfiguration(env), name, body, fetcher, signal);
  if (value !== true) throw new Error("Gmail persistence update failed");
}

async function markResyncRequired(
  env: Env,
  identity: GmailIdentity,
  reason: NonNullable<GmailInitialization["reason"]>,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<void> {
  await booleanRpc(
    env,
    "mark_gmail_resync_required_v1",
    {
      p_connection_id: identity.connectionId,
      p_error_code: reason,
      p_user_id: identity.userId,
    },
    fetcher,
    signal,
  );
}

function identitiesMatch(left: GmailIdentity, right: GmailIdentity): boolean {
  return left.connectionId === right.connectionId && left.userId === right.userId;
}

async function removedMarkerStatus(
  storage: DurableObjectStorage,
  identity: GmailIdentity,
): Promise<"absent" | "completed" | "conflict" | "pending"> {
  const value = await storage.get(REMOVED_MARKER_KEY);
  if (value === undefined) return "absent";
  const marker = removedMarkerCandidate(value);
  if (marker === undefined || !identitiesMatch(marker, identity)) return "conflict";
  await scheduleEarlierAlarm(
    storage,
    marker.phase === "pending" ? Date.now() : Math.max(Date.now(), marker.expiresAt),
  );
  return marker.phase;
}

function disconnectIntentKey(identity: GmailIdentity): string {
  return `${DISCONNECT_INTENT_PREFIX}${identity.userId}`;
}

async function persistGmailDisconnectIntent(
  storage: DurableObjectStorage,
  identity: GmailIdentity,
): Promise<void> {
  await storage.put(disconnectIntentKey(identity), identity);
  await scheduleEarlierAlarm(storage, Date.now());
}

async function discardGmailDisconnectIntent(
  storage: DurableObjectStorage,
  key: string,
): Promise<void> {
  await storage.delete(key);
  await scheduleEarlierAlarm(storage, Date.now());
}

function uuidBytes(value: string): Uint8Array {
  return Uint8Array.from(value.replace(/-/gu, "").match(/.{2}/gu) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
}

async function gmailRemovalActionId(
  connectionId: string,
  reason: GmailRemovalReason,
): Promise<string> {
  const namespace = uuidBytes(GMAIL_REMOVAL_NAMESPACE);
  const name = new TextEncoder().encode(`${connectionId}\u0000${reason}`);
  const input = new Uint8Array(namespace.byteLength + name.byteLength);
  input.set(namespace);
  input.set(name, namespace.byteLength);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", input));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function initialHistoryWork(
  identity: GmailIdentity,
  cursor: string,
  target: string,
): GmailHistoryWork {
  return {
    ...identity,
    chunkCount: 0,
    chunkIndex: 0,
    latestHistoryId: cursor,
    messageIndex: 0,
    nextPageToken: null,
    pageCount: 0,
    pageToken: null,
    phase: "fetch-page",
    startHistoryId: cursor,
    targetHistoryId: target,
  };
}

function nextHistoryPhase(work: GmailHistoryWork): GmailHistoryWork {
  return work.nextPageToken === null
    ? {
        ...work,
        chunkCount: 0,
        chunkIndex: 0,
        messageIndex: 0,
        nextPageToken: null,
        pageToken: null,
        phase: "advance",
      }
    : {
        ...work,
        chunkCount: 0,
        chunkIndex: 0,
        messageIndex: 0,
        nextPageToken: null,
        pageToken: work.nextPageToken,
        phase: "fetch-page",
      };
}

async function digestMarker(prefix: string, value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return `${prefix}${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function pageMarker(pageToken: string | null): Promise<string> {
  return digestMarker(HISTORY_PAGE_PREFIX, pageToken === null ? "root:" : `token:${pageToken}`);
}

async function messageMarker(messageId: string): Promise<string> {
  return digestMarker(HISTORY_SEEN_PREFIX, messageId);
}

function terminalMessageReason(error: unknown): GmailTerminalMessageReason | undefined {
  if (!(error instanceof GmailProviderError)) return undefined;
  if (error.code === "invalid-response") return "provider-response-invalid";
  if (error.code === "response-too-large") return "provider-response-too-large";
  return undefined;
}

async function recordTerminalGmailMessage(
  env: Env,
  identity: GmailIdentity,
  messageId: string,
  reason: GmailTerminalMessageReason,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<void> {
  const marker = await messageMarker(messageId);
  await booleanRpc(
    env,
    "record_gmail_terminal_message_v1",
    {
      p_connection_id: identity.connectionId,
      p_message_digest: marker.slice(HISTORY_SEEN_PREFIX.length),
      p_reason: reason,
      p_user_id: identity.userId,
    },
    fetcher,
    signal,
  );
}

function historyChunkKey(continuationMarker: string, chunkIndex: number): string {
  const continuationDigest = continuationMarker.slice(HISTORY_PAGE_PREFIX.length);
  return `${HISTORY_CHUNK_PREFIX}${continuationDigest}:${chunkIndex.toString().padStart(3, "0")}`;
}

function messageChunks(messageIds: string[]): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < messageIds.length; index += HISTORY_MESSAGE_CHUNK_SIZE) {
    chunks.push(messageIds.slice(index, index + HISTORY_MESSAGE_CHUNK_SIZE));
  }
  if (chunks.length > MAX_HISTORY_MESSAGE_CHUNKS) {
    throw new GmailProviderError("invalid-response");
  }
  return chunks;
}

async function persistMessageChunks(
  storage: DurableObjectStorage,
  continuationMarker: string,
  chunks: string[][],
): Promise<void> {
  for (let offset = 0; offset < chunks.length; offset += HISTORY_CHUNK_WRITE_BATCH) {
    const entries: Record<string, unknown> = {};
    for (
      let chunkIndex = offset;
      chunkIndex < Math.min(offset + HISTORY_CHUNK_WRITE_BATCH, chunks.length);
      chunkIndex += 1
    ) {
      entries[historyChunkKey(continuationMarker, chunkIndex)] = chunks[chunkIndex]!;
    }
    await storage.put(entries);
  }
}

async function commitHistoryProgress(
  storage: DurableObjectStorage,
  work: GmailHistoryWork,
  deletedKeys: string[],
): Promise<void> {
  await storage.transaction(async (transaction) => {
    await transaction.put(HISTORY_WORK_KEY, work);
    if (deletedKeys.length > 0) await transaction.delete(deletedKeys);
  });
}

async function clearHistoryMarkers(storage: DurableObjectStorage): Promise<boolean> {
  const [pageMarkers, messageMarkers, messageChunks] = await Promise.all([
    storage.list({ prefix: HISTORY_PAGE_PREFIX, limit: MARKER_CLEANUP_BATCH }),
    storage.list({ prefix: HISTORY_SEEN_PREFIX, limit: MARKER_CLEANUP_BATCH }),
    storage.list({ prefix: HISTORY_CHUNK_PREFIX, limit: MARKER_CLEANUP_BATCH }),
  ]);
  const keys = [...pageMarkers.keys(), ...messageMarkers.keys(), ...messageChunks.keys()];
  if (keys.length === 0) return true;
  await storage.delete(keys);
  return false;
}

async function clearDisconnectIntents(storage: DurableObjectStorage): Promise<boolean> {
  const intents = await storage.list({
    prefix: DISCONNECT_INTENT_PREFIX,
    limit: DISCONNECT_INTENT_BATCH,
  });
  if (intents.size === 0) return true;
  await storage.delete([...intents.keys()]);
  return intents.size < DISCONNECT_INTENT_BATCH;
}

async function enterResyncRequired(
  storage: DurableObjectStorage,
  env: Env,
  identity: GmailIdentity,
  reason: NonNullable<GmailInitialization["reason"]>,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<void> {
  const initialization: GmailInitialization = {
    ...identity,
    baselineHistoryId: null,
    expiration: null,
    phase: "stale",
    reason,
  };
  await storage.put(INITIALIZATION_KEY, initialization);
  await markResyncRequired(env, identity, reason, fetcher, signal);
  await storage.delete([HISTORY_WORK_KEY, PENDING_HISTORY_KEY, RECONCILE_KEY, RENEW_WATCH_KEY]);
  if (await clearHistoryMarkers(storage)) {
    await storage.delete(INITIALIZATION_KEY);
  } else {
    await scheduleEarlierAlarm(storage, Date.now());
  }
}

async function clearStaleCoordinator(
  storage: DurableObjectStorage,
  identity: GmailIdentity,
): Promise<void> {
  const cleanupState: GmailInitialization = {
    ...identity,
    baselineHistoryId: null,
    expiration: null,
    phase: "stale",
    reason: "continuation-invalid",
  };
  await storage.put(INITIALIZATION_KEY, cleanupState);
  await storage.delete([HISTORY_WORK_KEY, PENDING_HISTORY_KEY, RECONCILE_KEY, RENEW_WATCH_KEY]);
  if (await clearHistoryMarkers(storage)) {
    await storage.delete(INITIALIZATION_KEY);
  } else {
    await scheduleEarlierAlarm(storage, Date.now());
  }
}

async function gmailAccessToken(
  connection: LoadedGmailConnection,
  env: Env,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<string> {
  return refreshGmailAccessToken(
    connection.refreshToken,
    readGmailProviderConfiguration(env),
    fetcher,
    signal,
  );
}

async function clearDisconnectedHistory(storage: DurableObjectStorage): Promise<void> {
  await storage.delete([
    HISTORY_WORK_KEY,
    INITIALIZATION_KEY,
    PENDING_HISTORY_KEY,
    RECONCILE_KEY,
    RENEW_WATCH_KEY,
  ]);
  const [historyCleared, intentsCleared] = await Promise.all([
    clearHistoryMarkers(storage),
    clearDisconnectIntents(storage),
  ]);
  if (!historyCleared || !intentsCleared) await scheduleEarlierAlarm(storage, Date.now());
}

function automaticRemovalExpiresAt(env: Env): number {
  const retentionMs = readGmailProviderConfiguration(env).pubsubRetentionSeconds * 1000;
  return (
    Date.now() + GMAIL_WATCH_MAX_LIFETIME_MS + GMAIL_WATCH_EXPIRATION_TOLERANCE_MS + retentionMs
  );
}

function automaticRemovalMarker(
  env: Env,
  work: GmailAutomaticRevocationWork,
  existing?: GmailRemovedMarker,
  phase: GmailRemovedMarker["phase"] = existing?.phase ?? "pending",
): GmailRemovedMarker {
  return {
    ...work,
    expiresAt: Math.max(existing?.expiresAt ?? 0, automaticRemovalExpiresAt(env)),
    phase,
  };
}

async function ensureAutomaticRemovalMarker(
  storage: DurableObjectStorage,
  env: Env,
  work: GmailAutomaticRevocationWork,
): Promise<GmailRemovedMarker> {
  const value = await storage.get(REMOVED_MARKER_KEY);
  const existing = value === undefined ? undefined : removedMarkerCandidate(value);
  if (
    value !== undefined &&
    (existing === undefined ||
      !identitiesMatch(existing, work) ||
      existing.actionId !== work.actionId)
  ) {
    throw new Error("Gmail removal state is invalid");
  }
  const marker = automaticRemovalMarker(env, work, existing);
  await storage.put(REMOVED_MARKER_KEY, marker);
  return marker;
}

async function maintainRemovedCoordinator(
  storage: DurableObjectStorage,
  marker: GmailRemovedMarker,
): Promise<void> {
  if (marker.phase !== "completed") throw new Error("Gmail removal is incomplete");
  await storage.delete([
    DISCONNECT_WORK_KEY,
    HISTORY_WORK_KEY,
    INITIALIZATION_KEY,
    PENDING_HISTORY_KEY,
    RECONCILE_KEY,
    RENEW_WATCH_KEY,
    REVOCATION_WORK_KEY,
  ]);
  const [historyCleared, intentsCleared] = await Promise.all([
    clearHistoryMarkers(storage),
    clearDisconnectIntents(storage),
  ]);
  if (!historyCleared || !intentsCleared) {
    await scheduleEarlierAlarm(storage, Date.now());
    return;
  }
  if (Date.now() < marker.expiresAt) {
    await scheduleEarlierAlarm(storage, marker.expiresAt);
    return;
  }
  await storage.delete([ALARM_RETRY_KEY, IDENTITY_KEY, REMOVED_MARKER_KEY]);
}

async function completeAutomaticGmailRevocation(
  storage: DurableObjectStorage,
  env: Env,
  work: GmailAutomaticRevocationWork,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<void> {
  const marker = await ensureAutomaticRemovalMarker(storage, env, work);
  await booleanRpc(
    env,
    "disconnect_gmail_connection_v1",
    {
      p_action_id: work.actionId,
      p_connection_id: work.connectionId,
      p_provider_already_revoked: true,
      p_pubsub_retention_seconds: readGmailProviderConfiguration(env).pubsubRetentionSeconds,
      p_reason: work.reason,
      p_token_revoked: true,
      p_user_id: work.userId,
      p_watch_stopped: false,
    },
    fetcher,
    signal,
  );
  const completed = automaticRemovalMarker(env, work, marker, "completed");
  await storage.put(REMOVED_MARKER_KEY, completed);
  await maintainRemovedCoordinator(storage, completed);
}

async function beginAutomaticGmailRevocation(
  storage: DurableObjectStorage,
  env: Env,
  identity: GmailIdentity,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<void> {
  const work: GmailAutomaticRevocationWork = {
    ...identity,
    actionId: await gmailRemovalActionId(identity.connectionId, "provider-grant-revoked"),
    reason: "provider-grant-revoked",
  };
  const marker = automaticRemovalMarker(env, work);
  await storage.put({ [REMOVED_MARKER_KEY]: marker, [REVOCATION_WORK_KEY]: work });
  await completeAutomaticGmailRevocation(storage, env, work, fetcher, signal);
}

export async function runGmailDisconnect(
  storage: DurableObjectStorage,
  env: Env,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<"absent" | "completed" | "not-found"> {
  const [identityValue, disconnectValue] = await Promise.all([
    storage.get(IDENTITY_KEY),
    storage.get(DISCONNECT_WORK_KEY),
  ]);
  if (disconnectValue === undefined) return "absent";
  const identity = identityCandidate(identityValue);
  let work = disconnectWorkCandidate(disconnectValue);
  if (identity === undefined || work === undefined || !identitiesMatch(identity, work)) {
    throw new Error("Gmail disconnect state is invalid");
  }
  if (work.phase === "done") {
    await clearDisconnectedHistory(storage);
    return "completed";
  }

  let connection: LoadedGmailConnection | undefined;
  if (work.phase === "stop" || work.phase === "revoke") {
    try {
      connection = await loadGmailConnectionCredential(env, identity, fetcher, signal);
    } catch (error) {
      if (error instanceof GmailConnectionNotFoundError && work.phase === "stop") {
        await storage.delete(DISCONNECT_WORK_KEY);
        return "not-found";
      }
      throw error;
    }
  }

  if (work.phase === "stop") {
    if (connection === undefined) throw new Error("Gmail disconnect state is invalid");
    try {
      const accessToken = await gmailAccessToken(connection, env, fetcher, signal);
      await stopGmailWatch(accessToken, fetcher, signal);
      work = { ...work, phase: "revoke", watchStopped: true };
    } catch (error) {
      if (!(error instanceof GmailProviderError) || error.code !== "grant-revoked") throw error;
      work = {
        ...work,
        phase: "delete",
        providerAlreadyRevoked: true,
        tokenRevoked: true,
        watchStopped: false,
      };
    }
    await storage.put(DISCONNECT_WORK_KEY, work);
  }
  if (work.phase === "revoke") {
    if (connection === undefined) throw new Error("Gmail disconnect state is invalid");
    await revokeGoogleRefreshToken(connection.refreshToken, fetcher, signal);
    work = { ...work, phase: "delete", tokenRevoked: true };
    await storage.put(DISCONNECT_WORK_KEY, work);
  }
  if (work.phase === "delete") {
    const pubsubRetentionSeconds = readGmailProviderConfiguration(env).pubsubRetentionSeconds;
    const actionId = await gmailRemovalActionId(identity.connectionId, "user-disconnect");
    await booleanRpc(
      env,
      "disconnect_gmail_connection_v1",
      {
        p_action_id: actionId,
        p_connection_id: identity.connectionId,
        p_provider_already_revoked: work.providerAlreadyRevoked,
        p_pubsub_retention_seconds: pubsubRetentionSeconds,
        p_reason: "user-disconnect",
        p_token_revoked: work.tokenRevoked,
        p_user_id: identity.userId,
        p_watch_stopped: work.watchStopped,
      },
      fetcher,
      signal,
    );
    work = { ...work, phase: "done" };
    await storage.put(DISCONNECT_WORK_KEY, work);
  }
  await clearDisconnectedHistory(storage);
  return "completed";
}

export async function coordinateGmailDisconnect(
  storage: DurableObjectStorage,
  env: Env,
  identity: GmailIdentity,
  fetcher: Fetcher = fetch,
): Promise<Response> {
  try {
    const parsedIdentity = identityCandidate(identity);
    if (parsedIdentity === undefined) {
      return Response.json({ disconnected: false, reason: "invalid" }, { status: 400 });
    }
    const removed = await removedMarkerStatus(storage, parsedIdentity);
    if (removed === "completed") return Response.json({ disconnected: true });
    if (removed === "pending") {
      return Response.json({ disconnected: false, reason: "removal-pending" }, { status: 503 });
    }
    if (removed === "conflict") {
      return Response.json({ disconnected: false, reason: "not-found" }, { status: 404 });
    }
    await persistGmailDisconnectIntent(storage, parsedIdentity);

    return await withOperationDeadline(async (signal) => {
      const boundedFetcher = deadlineFetcher(fetcher, signal, GMAIL_EXTERNAL_OPERATION_TIMEOUT_MS);
      const ownership = await readGmailConnectionOwnership(
        env,
        parsedIdentity,
        boundedFetcher,
        signal,
      );
      if (ownership === "completed") {
        await storage.delete(disconnectIntentKey(parsedIdentity));
        return Response.json({ disconnected: true });
      }
      if (ownership === "absent") {
        await storage.delete(disconnectIntentKey(parsedIdentity));
        return Response.json({ disconnected: false, reason: "not-found" }, { status: 404 });
      }

      const accepted = await acceptGmailDisconnect(storage, parsedIdentity);
      if (!accepted.ok) return accepted;
      const result = await runGmailDisconnect(storage, env, boundedFetcher, signal);
      return result === "completed"
        ? Response.json({ disconnected: true })
        : Response.json({ disconnected: false, reason: "not-found" }, { status: 404 });
    }, GMAIL_ALARM_DEADLINE_MS);
  } catch {
    return Response.json({ disconnected: false, reason: "unavailable" }, { status: 503 });
  }
}

export async function runGmailAlarm(
  storage: DurableObjectStorage,
  env: Env,
  fetcher: Fetcher = fetch,
  publisher: typeof publishEncryptedIngress = publishEncryptedIngress,
  signal?: AbortSignal,
): Promise<boolean> {
  const [identityValue, revocationValue, removedValue] = await Promise.all([
    storage.get(IDENTITY_KEY),
    storage.get(REVOCATION_WORK_KEY),
    storage.get(REMOVED_MARKER_KEY),
  ]);
  const identity = identityValue === undefined ? undefined : identityCandidate(identityValue);
  if (identityValue !== undefined && identity === undefined) {
    throw new Error("Gmail coordinator identity is invalid");
  }
  const removed = removedValue === undefined ? undefined : removedMarkerCandidate(removedValue);
  if (
    removedValue !== undefined &&
    (removed === undefined || identity === undefined || !identitiesMatch(removed, identity))
  ) {
    throw new Error("Gmail removal state is invalid");
  }
  if (revocationValue !== undefined) {
    const revocation = automaticRevocationCandidate(revocationValue);
    if (
      revocation === undefined ||
      identity === undefined ||
      !identitiesMatch(revocation, identity) ||
      (removed !== undefined && removed.actionId !== revocation.actionId)
    ) {
      throw new Error("Gmail revocation state is invalid");
    }
    await completeAutomaticGmailRevocation(storage, env, revocation, fetcher, signal);
    return true;
  }
  if (removed !== undefined) {
    if (removed.phase === "pending") {
      await completeAutomaticGmailRevocation(storage, env, removed, fetcher, signal);
    } else {
      await maintainRemovedCoordinator(storage, removed);
    }
    return true;
  }
  if (await runPendingGmailDisconnectIntent(storage, env, fetcher, signal)) return true;
  if (identity === undefined) return false;
  if ((await runGmailDisconnect(storage, env, fetcher, signal)) !== "absent") return true;
  const [pendingValue, reconcileValue, renewWatchValue, workValue, initializationValue] =
    await Promise.all([
      storage.get(PENDING_HISTORY_KEY),
      storage.get(RECONCILE_KEY),
      storage.get(RENEW_WATCH_KEY),
      storage.get(HISTORY_WORK_KEY),
      storage.get(INITIALIZATION_KEY),
    ]);
  let pending = gmailHistoryIdSchema.safeParse(pendingValue).success
    ? gmailHistoryIdSchema.parse(pendingValue)
    : undefined;
  const reconcile = reconcileValue === true;
  const renewWatch = renewWatchValue === true;
  let work = workValue === undefined ? undefined : historyWorkCandidate(workValue);
  const initialization =
    initializationValue === undefined ? undefined : initializationCandidate(initializationValue);
  if (
    pendingValue === undefined &&
    reconcileValue === undefined &&
    renewWatchValue === undefined &&
    workValue === undefined &&
    initializationValue === undefined
  ) {
    return true;
  }

  const connection = await loadGmailConnectionCredential(env, identity, fetcher, signal);
  if (connection.syncStatus === "stale") {
    await clearStaleCoordinator(storage, identity);
    return true;
  }

  if (
    (pendingValue !== undefined && pending === undefined) ||
    (reconcileValue !== undefined && !reconcile) ||
    (renewWatchValue !== undefined && !renewWatch) ||
    (workValue !== undefined && work === undefined) ||
    (initializationValue !== undefined && initialization === undefined) ||
    (work !== undefined && !identitiesMatch(work, identity)) ||
    (initialization !== undefined && !identitiesMatch(initialization, identity))
  ) {
    await enterResyncRequired(storage, env, identity, "continuation-invalid", fetcher, signal);
    return true;
  }

  if (initialization?.phase === "stale") {
    await enterResyncRequired(
      storage,
      env,
      identity,
      initialization.reason ?? "continuation-invalid",
      fetcher,
      signal,
    );
    return true;
  }

  if (connection.historyCursor === undefined) {
    if (initialization?.phase === "baseline-ready") {
      if (work !== undefined) {
        await enterResyncRequired(storage, env, identity, "continuation-invalid", fetcher, signal);
        return true;
      }
      await booleanRpc(
        env,
        "record_gmail_watch_v1",
        {
          p_connection_id: identity.connectionId,
          p_expiration: initialization.expiration,
          p_history_id: initialization.baselineHistoryId,
          p_user_id: identity.userId,
        },
        fetcher,
        signal,
      );
      await booleanRpc(
        env,
        "set_gmail_history_baseline_v1",
        {
          p_connection_id: identity.connectionId,
          p_history_id: initialization.baselineHistoryId,
          p_user_id: identity.userId,
        },
        fetcher,
        signal,
      );
      await storage.delete([INITIALIZATION_KEY, RENEW_WATCH_KEY]);
      await scheduleEarlierAlarm(storage, Date.now());
      return true;
    }
    if (work !== undefined || pending !== undefined) {
      await enterResyncRequired(storage, env, identity, "continuation-invalid", fetcher, signal);
      return true;
    }
    if (initialization?.phase === "watch-call-in-flight") {
      await enterResyncRequired(
        storage,
        env,
        identity,
        "initialization-ambiguous",
        fetcher,
        signal,
      );
      return true;
    }
    if (!renewWatch) {
      await enterResyncRequired(storage, env, identity, "continuation-invalid", fetcher, signal);
      return true;
    }

    const accessToken = await gmailAccessToken(connection, env, fetcher, signal);
    const inFlight: GmailInitialization = {
      ...identity,
      baselineHistoryId: null,
      expiration: null,
      phase: "watch-call-in-flight",
      reason: null,
    };
    await storage.put(INITIALIZATION_KEY, inFlight);
    let watch;
    try {
      watch = await createGmailWatch(
        accessToken,
        readGmailProviderConfiguration(env),
        fetcher,
        signal,
      );
    } catch (error) {
      if (error instanceof GmailProviderError && error.code === "request-rejected") {
        await storage.delete(INITIALIZATION_KEY);
        throw error;
      }
      await enterResyncRequired(
        storage,
        env,
        identity,
        "initialization-ambiguous",
        fetcher,
        signal,
      );
      return true;
    }
    const baselineReady: GmailInitialization = {
      ...identity,
      baselineHistoryId: watch.historyId,
      expiration: watch.expiration,
      phase: "baseline-ready",
      reason: null,
    };
    await storage.put(INITIALIZATION_KEY, baselineReady);
    await scheduleEarlierAlarm(storage, Date.now());
    return true;
  }

  if (initialization !== undefined) {
    if (
      initialization.phase === "baseline-ready" &&
      initialization.baselineHistoryId === connection.historyCursor
    ) {
      await storage.delete([INITIALIZATION_KEY, RENEW_WATCH_KEY]);
    } else {
      await enterResyncRequired(
        storage,
        env,
        identity,
        "initialization-ambiguous",
        fetcher,
        signal,
      );
      return true;
    }
  }

  if (renewWatch) {
    const accessToken = await gmailAccessToken(connection, env, fetcher, signal);
    const watch = await createGmailWatch(
      accessToken,
      readGmailProviderConfiguration(env),
      fetcher,
      signal,
    );
    await booleanRpc(
      env,
      "record_gmail_watch_v1",
      {
        p_connection_id: identity.connectionId,
        p_expiration: watch.expiration,
        p_history_id: watch.historyId,
        p_user_id: identity.userId,
      },
      fetcher,
      signal,
    );
    const newestPendingValue = await storage.get(PENDING_HISTORY_KEY);
    const newestPending = gmailHistoryIdSchema.safeParse(newestPendingValue);
    if (newestPendingValue !== undefined && !newestPending.success) {
      await enterResyncRequired(storage, env, identity, "continuation-invalid", fetcher, signal);
      return true;
    }
    pending = highestHistoryId(
      newestPending.success ? newestPending.data : undefined,
      watch.historyId,
    );
    await Promise.all([storage.put(PENDING_HISTORY_KEY, pending), storage.delete(RENEW_WATCH_KEY)]);
    await scheduleEarlierAlarm(storage, Date.now());
    return true;
  }

  const cursor = connection.historyCursor;
  if (pending !== undefined && compareHistoryIds(pending, cursor) <= 0) {
    await storage.delete(PENDING_HISTORY_KEY);
    pending = undefined;
  }
  if (work === undefined) {
    if (pending === undefined && !reconcile) return true;
    work = initialHistoryWork(identity, cursor, pending ?? cursor);
    await storage.put(HISTORY_WORK_KEY, work);
    await scheduleEarlierAlarm(storage, Date.now());
    return true;
  }

  if (cursor !== work.startHistoryId) {
    if (cursor === work.latestHistoryId && (work.phase === "advance" || work.phase === "cleanup")) {
      work = { ...work, phase: "cleanup" };
      await storage.put(HISTORY_WORK_KEY, work);
    } else {
      await enterResyncRequired(storage, env, identity, "continuation-invalid", fetcher, signal);
      return true;
    }
  }

  if (work.phase === "fetch-page") {
    if (work.pageCount >= MAX_HISTORY_PAGES) {
      await enterResyncRequired(storage, env, identity, "continuation-invalid", fetcher, signal);
      return true;
    }
    const continuationMarker = await pageMarker(work.pageToken);
    if ((await storage.get(continuationMarker)) !== undefined) {
      await enterResyncRequired(storage, env, identity, "continuation-invalid", fetcher, signal);
      return true;
    }
    const accessToken = await gmailAccessToken(connection, env, fetcher, signal);
    let page;
    try {
      page = await listGmailHistoryPage(
        accessToken,
        work.startHistoryId,
        work.pageToken ?? undefined,
        fetcher,
        signal,
      );
    } catch (error) {
      if (error instanceof GmailProviderError && error.code === "stale-history") {
        await enterResyncRequired(storage, env, identity, "stale-history", fetcher, signal);
        return true;
      }
      if (error instanceof GmailProviderError && error.code === "invalid-history") {
        await enterResyncRequired(storage, env, identity, "continuation-invalid", fetcher, signal);
        return true;
      }
      throw error;
    }
    const chunks = messageChunks(page.messageIds);
    if (page.nextPageToken !== undefined && page.nextPageToken === work.pageToken) {
      await enterResyncRequired(storage, env, identity, "continuation-invalid", fetcher, signal);
      return true;
    }
    await persistMessageChunks(storage, continuationMarker, chunks);
    const fetchedWork: GmailHistoryWork = {
      ...work,
      chunkCount: chunks.length,
      chunkIndex: 0,
      latestHistoryId: highestHistoryId(work.latestHistoryId, page.latestHistoryId),
      messageIndex: 0,
      nextPageToken: page.nextPageToken ?? null,
      pageCount: work.pageCount + 1,
      phase: "messages",
    };
    const nextWork = chunks.length === 0 ? nextHistoryPhase(fetchedWork) : fetchedWork;
    await storage.put(
      chunks.length === 0
        ? { [HISTORY_WORK_KEY]: nextWork }
        : { [continuationMarker]: true, [HISTORY_WORK_KEY]: nextWork },
    );
    await scheduleEarlierAlarm(storage, Date.now());
    return true;
  }

  if (work.phase === "messages") {
    const continuationMarker = await pageMarker(work.pageToken);
    const chunkKey = historyChunkKey(continuationMarker, work.chunkIndex);
    const chunk = messageChunkCandidate(await storage.get(chunkKey));
    if (chunk === undefined || work.messageIndex > chunk.length) {
      await enterResyncRequired(storage, env, identity, "continuation-invalid", fetcher, signal);
      return true;
    }
    const accessToken = await gmailAccessToken(connection, env, fetcher, signal);
    const markerKeys = await Promise.all(chunk.map(messageMarker));
    const storedMarkers = await storage.get(markerKeys);
    let processed = 0;
    while (work.messageIndex < chunk.length && processed < MAX_MESSAGES_PER_ALARM) {
      const messageId = chunk[work.messageIndex]!;
      const markerKey = markerKeys[work.messageIndex]!;
      if (!storedMarkers.has(markerKey)) {
        let envelope: Awaited<ReturnType<typeof fetchCanonicalGmailEnvelope>> = undefined;
        let terminalRecorded = false;
        try {
          envelope = await fetchCanonicalGmailEnvelope(
            accessToken,
            identity.connectionId,
            messageId,
            fetcher,
            signal,
          );
        } catch (error) {
          const reason = terminalMessageReason(error);
          if (reason === undefined) throw error;
          await recordTerminalGmailMessage(env, identity, messageId, reason, fetcher, signal);
          terminalRecorded = true;
        }
        if (envelope === undefined) {
          if (!terminalRecorded) {
            await recordTerminalGmailMessage(
              env,
              identity,
              messageId,
              "provider-message-missing",
              fetcher,
              signal,
            );
          }
        } else {
          const publication = await publisher(env, identity.userId, envelope, "gmail-provider", {
            ...(signal === undefined ? {} : { signal }),
            timeoutMs: GMAIL_EXTERNAL_OPERATION_TIMEOUT_MS,
          });
          if (!publication.accepted) {
            if (publication.reason !== "queue-message-too-large") {
              throw new Error("Gmail ingress publication failed");
            }
            await recordTerminalGmailMessage(
              env,
              identity,
              messageId,
              "queue-budget-exceeded",
              fetcher,
              signal,
            );
          }
        }
      }
      work = { ...work, messageIndex: work.messageIndex + 1 };
      if (storedMarkers.has(markerKey)) {
        await storage.put(HISTORY_WORK_KEY, work);
      } else {
        await storage.put({ [markerKey]: true, [HISTORY_WORK_KEY]: work });
      }
      processed += 1;
    }
    if (work.messageIndex === chunk.length) {
      const completedPage = work.chunkIndex + 1 >= work.chunkCount;
      work = !completedPage
        ? { ...work, chunkIndex: work.chunkIndex + 1, messageIndex: 0 }
        : nextHistoryPhase(work);
      await commitHistoryProgress(storage, work, [
        chunkKey,
        ...markerKeys,
        ...(completedPage ? [continuationMarker] : []),
      ]);
    }
    await scheduleEarlierAlarm(storage, Date.now());
    return true;
  }

  if (work.phase === "advance") {
    if (compareHistoryIds(work.latestHistoryId, work.targetHistoryId) < 0) {
      await enterResyncRequired(storage, env, identity, "continuation-invalid", fetcher, signal);
      return true;
    }
    await booleanRpc(
      env,
      "advance_gmail_history_cursor_v1",
      {
        p_connection_id: identity.connectionId,
        p_expected_history_id: work.startHistoryId,
        p_new_history_id: work.latestHistoryId,
        p_user_id: identity.userId,
      },
      fetcher,
      signal,
    );
    work = { ...work, phase: "cleanup" };
    await storage.put(HISTORY_WORK_KEY, work);
    await scheduleEarlierAlarm(storage, Date.now());
    return true;
  }

  if (!(await clearHistoryMarkers(storage))) {
    await scheduleEarlierAlarm(storage, Date.now());
    return true;
  }
  const newestPendingValue = await storage.get(PENDING_HISTORY_KEY);
  const newestPending = gmailHistoryIdSchema.safeParse(newestPendingValue);
  const completedKeys = [HISTORY_WORK_KEY, RECONCILE_KEY];
  if (newestPending.success && compareHistoryIds(newestPending.data, work.latestHistoryId) <= 0) {
    completedKeys.push(PENDING_HISTORY_KEY);
  }
  await storage.delete(completedKeys);
  if (newestPending.success && compareHistoryIds(newestPending.data, work.latestHistoryId) > 0) {
    await scheduleEarlierAlarm(storage, Date.now());
  }
  return true;
}

export async function runGmailAlarmReliably(
  storage: DurableObjectStorage,
  env: Env,
  fetcher: Fetcher = fetch,
  publisher: typeof publishEncryptedIngress = publishEncryptedIngress,
): Promise<boolean> {
  let retry: GmailAlarmRetry | undefined;

  try {
    const handled = await withOperationDeadline(async (signal) => {
      const retryValue = await storage.get(ALARM_RETRY_KEY);
      retry = retryValue === undefined ? undefined : alarmRetryCandidate(retryValue);
      if (retryValue !== undefined && retry === undefined) await storage.delete(ALARM_RETRY_KEY);
      if (retry !== undefined && retry.nextAttemptAt > Date.now()) {
        await scheduleEarlierAlarm(storage, retry.nextAttemptAt);
        return false;
      }

      const boundedFetcher = deadlineFetcher(fetcher, signal, GMAIL_EXTERNAL_OPERATION_TIMEOUT_MS);
      let alarmHandled: boolean;
      try {
        alarmHandled = await runGmailAlarm(storage, env, boundedFetcher, publisher, signal);
      } catch (error) {
        if (!(error instanceof GmailProviderError) || error.code !== "grant-revoked") throw error;
        const identityValue = await storage.get(IDENTITY_KEY);
        const identity = identityCandidate(identityValue);
        if (identity === undefined) throw new Error("Gmail coordinator identity is invalid");
        await beginAutomaticGmailRevocation(storage, env, identity, boundedFetcher, signal);
        alarmHandled = true;
      }
      if (retryValue !== undefined) await storage.delete(ALARM_RETRY_KEY);
      return alarmHandled;
    }, GMAIL_ALARM_DEADLINE_MS);
    return handled;
  } catch {
    const attempts = Math.min((retry?.attempts ?? 0) + 1, MAX_ALARM_RETRY_ATTEMPTS);
    const delay = Math.min(
      INITIAL_ALARM_RETRY_DELAY_MS * 2 ** (attempts - 1),
      MAX_ALARM_RETRY_DELAY_MS,
    );
    const nextAttemptAt = Date.now() + delay;
    await storage.put(ALARM_RETRY_KEY, { attempts, nextAttemptAt } satisfies GmailAlarmRetry);
    await scheduleEarlierAlarm(storage, nextAttemptAt);
    return true;
  }
}

export async function listDueGmailConnections(
  env: Env,
  fetcher: Fetcher = fetch,
): Promise<DueGmailConnection[]> {
  const value = await rpc(
    supabaseConfiguration(env),
    "list_due_gmail_connections_v1",
    { p_limit: 50 },
    fetcher,
  );
  if (!Array.isArray(value) || value.length > 50) {
    throw new Error("Gmail persistence response is invalid");
  }
  return value.map((candidate) => {
    const row = exactObject(candidate, [
      "connection_id",
      "reconcile_history",
      "renew_watch",
      "user_id",
    ]);
    const connectionId = canonicalUuidSchema.safeParse(row.connection_id);
    const userId = canonicalUuidSchema.safeParse(row.user_id);
    if (
      !connectionId.success ||
      !userId.success ||
      typeof row.reconcile_history !== "boolean" ||
      typeof row.renew_watch !== "boolean"
    ) {
      throw new Error("Gmail persistence response is invalid");
    }
    return {
      connectionId: connectionId.data,
      reconcile: row.reconcile_history,
      renewWatch: row.renew_watch,
      userId: userId.data,
    };
  });
}

export async function scheduleGmailMaintenance(
  env: Env,
  connection: DueGmailConnection,
  signal?: AbortSignal,
): Promise<void> {
  const coordinator = env.TENANT_COORDINATOR.getByName(`gmail:${connection.connectionId}`);
  const response = await coordinator.fetch("https://coordinator.internal/gmail/maintenance", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ schemaVersion: 1, ...connection }),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error("Gmail maintenance scheduling failed");
}

export function parseGmailCursorCoordinatorRequest(
  value: unknown,
): (GmailIdentity & { historyId: string }) | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const identity = identityCandidate({
    schemaVersion: candidate.schemaVersion,
    connectionId: candidate.connectionId,
    userId: candidate.userId,
  });
  const historyId = gmailHistoryIdSchema.safeParse(candidate.historyId);
  return Object.keys(candidate).length === 4 && identity !== undefined && historyId.success
    ? { ...identity, historyId: historyId.data }
    : undefined;
}

export function parseGmailMaintenanceCoordinatorRequest(
  value: unknown,
): GmailMaintenanceRequest | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const identity = identityCandidate({
    schemaVersion: candidate.schemaVersion,
    connectionId: candidate.connectionId,
    userId: candidate.userId,
  });
  return Object.keys(candidate).length === 5 &&
    identity !== undefined &&
    typeof candidate.reconcile === "boolean" &&
    typeof candidate.renewWatch === "boolean"
    ? {
        ...identity,
        reconcile: candidate.reconcile,
        renewWatch: candidate.renewWatch,
      }
    : undefined;
}

export function parseGmailDisconnectCoordinatorRequest(value: unknown): GmailIdentity | undefined {
  const parsed = gmailDisconnectRequestSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
