/**
 * The Relay API, answered locally.
 *
 * Only the routes the app actually calls are implemented, and each one returns the response its
 * contract describes so the caller's `safeParse` is doing real work rather than waving a fixture
 * through. The compile route is the important one: it runs the shipped `compileFilterPlan` and
 * appends a revision, so writing a rule in demo mode exercises the same compiler, the same plan
 * shape and the same versioning as the hosted pipeline.
 *
 * Responses are returned as a status and a body rather than thrown, so the transport keeps sole
 * ownership of turning a failure into a `RelayApiError`.
 */

import { filterCompileRequestSchema, type FilterCompileRequest } from "@relay/contracts";
import { compileFilterPlan } from "@relay/domain";

import { DEMO_USER_ID } from "./account";
import { demoRandomUuid } from "./ids";
import { demoDatabase } from "./store";
import { DEMO_TABLES, type DemoRow } from "./types";

export type DemoApiResponse = { body: unknown; status: number };

function failure(status: number, code: string, message: string): DemoApiResponse {
  return { body: { error: { code, message } }, status };
}

function nowIso(): string {
  return new Date().toISOString();
}

function retentionStatus(): DemoApiResponse["body"] {
  const now = nowIso();
  const retained = demoDatabase
    .rows("source_items")
    .map((row) => row.raw_expires_at)
    .filter((value): value is string => typeof value === "string" && value > now)
    .sort();
  return {
    earliestExpiresAt: retained[0] ?? null,
    latestExpiresAt: retained[retained.length - 1] ?? null,
    retainedCount: retained.length,
    retentionDays: 7,
  };
}

function deletionStatus(): DemoRow | undefined {
  return demoDatabase.rows("account_deletions")[0];
}

function appendAudit(action: string, metadata: Record<string, string>): void {
  const rows = demoDatabase.rows("audit_log");
  const highest = rows.reduce(
    (largest, row) => (typeof row.id === "number" && row.id > largest ? row.id : largest),
    0,
  );
  rows.unshift({
    action,
    created_at: nowIso(),
    id: highest + 1,
    metadata,
    user_id: DEMO_USER_ID,
  });
}

function openAiStatus(): DemoApiResponse["body"] {
  const stored = demoDatabase.rows("openai_credentials")[0];
  if (stored?.configured !== true) return { configured: false, provider: "openai" };
  const endpoint = stored.endpoint;
  return {
    configured: true,
    ...(typeof endpoint === "object" && endpoint !== null ? { endpoint } : {}),
    ...(typeof stored.last_validated_at === "string"
      ? { lastValidatedAt: stored.last_validated_at }
      : {}),
    provider: "openai",
    serverEvaluation: stored.server_evaluation === true,
    validated: stored.validated === true,
  };
}

/** The server-path switch, which touches no key and so needs no demo credential handling. */
function setServerEvaluation(body: unknown): DemoApiResponse {
  const stored = demoDatabase.rows("openai_credentials")[0];
  if (stored?.configured !== true) {
    return failure(404, "openai_not_found", "No OpenAI key is configured");
  }
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { enabled?: unknown }).enabled !== "boolean"
  ) {
    return failure(400, "invalid_request", "Server evaluation request is invalid");
  }
  stored.server_evaluation = (body as { enabled: boolean }).enabled;
  return { body: openAiStatus(), status: 200 };
}

function storeOpenAiKey(body: unknown): DemoApiResponse {
  if (typeof body !== "object" || body === null) {
    return failure(400, "invalid_request", "Credential request is invalid");
  }
  const request = body as { apiKey?: unknown; endpoint?: unknown };
  if (typeof request.apiKey !== "string" || request.apiKey.trim().length === 0) {
    return failure(400, "invalid_request", "Credential request is invalid");
  }
  // The key itself is never stored, here or anywhere else in demo mode. Only the fact that one was
  // provided, and the endpoint metadata the status response is allowed to carry, are kept.
  demoDatabase.replace("openai_credentials", [
    {
      configured: true,
      ...(typeof request.endpoint === "object" && request.endpoint !== null
        ? { endpoint: request.endpoint }
        : {}),
      last_validated_at: nowIso(),
      user_id: DEMO_USER_ID,
      validated: true,
    },
  ]);
  demoDatabase.touch();
  return { body: openAiStatus(), status: 200 };
}

function revokeOpenAiKey(): DemoApiResponse {
  demoDatabase.replace("openai_credentials", []);
  demoDatabase.touch();
  appendAudit("connector.revoked", { provider: "openai" });
  return { body: { configured: false, provider: "openai" }, status: 200 };
}

function purgeRawPayloads(): DemoApiResponse {
  const now = nowIso();
  let purged = 0;
  for (const row of demoDatabase.rows("source_items")) {
    if (typeof row.raw_expires_at === "string" && row.raw_expires_at > now) {
      row.raw_expires_at = now;
      purged += 1;
    }
  }
  demoDatabase.touch();
  appendAudit("privacy.raw_payloads_purged", { purgedCount: String(purged) });
  return { body: { purged: true, purgedCount: purged }, status: 200 };
}

/**
 * Deletes the demo account.
 *
 * Everything the account held is actually removed rather than flagged, because a deletion that left
 * the inbox intact would demonstrate the opposite of what the control claims. Only the deletion
 * record and its audit lines survive, which is what makes the timeline able to say it happened.
 * The Demo studio's reset brings the seeded account back.
 */
function deleteAccount(body: unknown): DemoApiResponse {
  const confirmation =
    typeof body === "object" && body !== null ? (body as { confirm?: unknown }).confirm : undefined;
  if (confirmation !== "delete my account") {
    return failure(400, "confirmation_required", "Account deletion requires confirmation");
  }
  const requestedAt = nowIso();
  const deletion = {
    attemptCount: 1,
    completedAt: requestedAt,
    connectorsRevokedAt: requestedAt,
    requestedAt,
    state: "completed",
  };
  for (const table of DEMO_TABLES) demoDatabase.replace(table, []);
  demoDatabase.replace("account_deletions", [{ ...deletion, user_id: DEMO_USER_ID }]);
  appendAudit("privacy.account_deletion_requested", {});
  appendAudit("privacy.account_deletion_finalized", {});
  demoDatabase.touch();
  return {
    body: { deleted: true, deletion, failedRevocations: 0, revokedCredentials: 1 },
    status: 200,
  };
}

function disclosures(limit: number): DemoApiResponse {
  return {
    body: {
      disclosures: demoDatabase
        .rows("disclosures")
        .slice(0, limit)
        .map((row) => ({
          createdAt: row.created_at,
          disclosedFields: row.disclosed_fields,
          id: row.id,
          model: row.model,
          provider: row.provider,
          purpose: row.purpose,
        })),
    },
    status: 200,
  };
}

function ruleResponse(row: DemoRow): Record<string, unknown> {
  return {
    ...(typeof row.category_id === "string" ? { categoryId: row.category_id } : {}),
    createdAt: row.created_at,
    enabled: row.enabled,
    id: row.id,
    intent: row.intent,
    name: row.name,
    plan: row.plan,
    seriesId: row.series_id,
    userId: row.user_id,
    version: row.version,
  };
}

/**
 * Compiles and appends one revision.
 *
 * A rule is a series: an edit adds a version and the earlier one stays readable, and an edit that
 * names a stale `expectedVersion` is refused rather than silently overwriting whatever is current.
 * That is the hosted route's own contract, and the rules screen depends on it to show history.
 */
function compileFilter(body: unknown): DemoApiResponse {
  const parsed = filterCompileRequestSchema.safeParse(body);
  if (!parsed.success) return failure(400, "invalid_request", "Filter request is invalid");
  const request: FilterCompileRequest = parsed.data;

  const categories = demoDatabase
    .rows("categories")
    .filter((row) => (row.archived_at ?? null) === null)
    .map((row) => ({ name: row.name as string, slug: row.slug as string }));

  let compilation;
  try {
    compilation = compileFilterPlan(request.intent, categories);
  } catch {
    return failure(400, "filter_intent_invalid", "Filter intent could not be compiled");
  }

  const rows = demoDatabase.rows("filter_rules");
  const seriesId = request.seriesId ?? demoRandomUuid();
  const existing = rows.filter((row) => row.series_id === seriesId);
  const current = existing.reduce<DemoRow | undefined>(
    (newest, row) =>
      newest === undefined || (row.version as number) > (newest.version as number) ? row : newest,
    undefined,
  );
  if (request.seriesId !== undefined && current === undefined) {
    return failure(404, "filter_rule_not_found", "Filter rule is unavailable");
  }
  if (current !== undefined && request.expectedVersion !== current.version) {
    return failure(409, "filter_rule_version_conflict", "Filter rule changed since it was read");
  }

  // An absent `categoryId` means unchanged, and an explicit null clears it. The two are different
  // statements, so the request's own key is what decides which happened.
  const categoryId =
    request.categoryId === undefined
      ? (current?.category_id ?? null)
      : (request.categoryId ?? null);

  const row: DemoRow = {
    category_id: categoryId,
    created_at: nowIso(),
    enabled: request.enabled ?? true,
    id: demoRandomUuid(),
    intent: request.intent,
    name: request.name,
    plan: compilation.plan,
    series_id: seriesId,
    user_id: DEMO_USER_ID,
    version: current === undefined ? 1 : (current.version as number) + 1,
  };
  rows.unshift(row);
  demoDatabase.touch();
  appendAudit("filter.revision_compiled", { version: String(row.version) });

  return {
    body: {
      rule: ruleResponse(row),
      supportedPredicates: compilation.supportedPredicates,
      unsupportedClauses: compilation.unsupportedClauses,
    },
    status: 200,
  };
}

export async function demoRelayApi(
  path: string,
  init: { body?: unknown; method?: "DELETE" | "GET" | "PATCH" | "POST" | "PUT" },
): Promise<DemoApiResponse> {
  await demoDatabase.ready();
  const method = init.method ?? "GET";
  const [route = path, query = ""] = path.split("?", 2);

  if (route === "/api/privacy" && method === "GET") {
    const deletion = deletionStatus();
    return {
      body: {
        deletion:
          deletion === undefined
            ? null
            : {
                attemptCount: deletion.attemptCount,
                completedAt: deletion.completedAt,
                connectorsRevokedAt: deletion.connectorsRevokedAt,
                requestedAt: deletion.requestedAt,
                state: deletion.state,
              },
        retention: retentionStatus(),
      },
      status: 200,
    };
  }
  if (route === "/api/privacy/raw-payloads" && method === "DELETE") return purgeRawPayloads();
  if (route === "/api/privacy/account" && method === "DELETE") return deleteAccount(init.body);
  if (route === "/api/privacy/disclosures" && method === "GET") {
    const requested = Number.parseInt(new URLSearchParams(query).get("limit") ?? "100", 10);
    return disclosures(Number.isFinite(requested) && requested > 0 ? requested : 100);
  }
  if (route === "/api/connectors/openai/server-evaluation" && method === "PUT") {
    return setServerEvaluation(init.body);
  }
  if (route === "/api/connectors/openai") {
    if (method === "GET") return { body: openAiStatus(), status: 200 };
    if (method === "POST" || method === "PATCH") return storeOpenAiKey(init.body);
    if (method === "DELETE") return revokeOpenAiKey();
  }
  if (route === "/api/filters/compile" && method === "POST") return compileFilter(init.body);

  return failure(404, "route_not_found", "Route is unavailable in demo mode");
}
