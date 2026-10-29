import {
  smartCommandSchema,
  smartObservationSchema,
  smartOverviewSchema,
  smartRuleSchema,
  type SmartOverview,
  type ActionIntent,
} from "@relay/contracts";
import {
  evaluateSmartRule,
  smartEffectKey,
  renderSmartInput,
  smartActionPreview,
  GOOGLE_SERVICE_SCOPES,
} from "@relay/domain";
import { decryptValue } from "@relay/crypto";
import { AppError } from "@relay/observability";
import { readPersistenceConfiguration, supabaseBackendHeaders } from "./configuration";
import { connectionCredentialEncryptionContext, postgresByteaToBase64 } from "./encryption";
import { claimActionRunForWorkflow, completeActionRun, failActionRun } from "./actions";
import { refreshGoogleTasksAccessToken } from "./google-tasks-provider";
import { dispatchProvider } from "./providers";
import { logPipelineError } from "./observability";
import type { Env } from "./env";
import {
  smartGoogleResources,
  createSmartExpenseSheet,
  validateSmartExpenseSheet,
} from "./smart-google-resources";
import { handleGmailDisconnect } from "./gmail";

type Row = Record<string, unknown>;
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
function records(value: unknown): Row[] {
  if (
    !Array.isArray(value) ||
    value.some((row) => typeof row !== "object" || row === null || Array.isArray(row))
  )
    throw new Error("Invalid database response");
  return value as Row[];
}
export class SmartAutomationRepository {
  constructor(
    readonly env: Env,
    readonly fetcher: Fetcher = fetch,
  ) {}
  async db(path: string, method = "GET", body?: unknown): Promise<unknown> {
    const configuration = readPersistenceConfiguration(this.env);
    if (configuration.supabase === undefined) throw new Error("Database unavailable");
    const response = await this.fetcher(`${configuration.supabase.url}/rest/v1/${path}`, {
      method,
      headers: {
        ...supabaseBackendHeaders(configuration.supabase.serviceRoleKey),
        prefer: "return=representation,resolution=merge-duplicates",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new AppError("Smart automation database operation failed", {
        cause: new Error("Database refused operation"),
        code: "SMART_DATABASE_FAILED",
        category: "database",
        operation: "smartAutomationRepository",
        integration: "supabase",
        statusCode: response.status,
      });
    return response.status === 204 ? null : response.json();
  }
  async read(userId: string): Promise<SmartOverview> {
    const [settings, services, configurations, effects] = await Promise.all([
      this.db(`smart_automation_settings?user_id=eq.${userId}`),
      this.db(`smart_google_services?user_id=eq.${userId}`),
      this.db(`smart_automation_rules?user_id=eq.${userId}`),
      this.db(`smart_action_effects?user_id=eq.${userId}&select=action_run_id&limit=200`),
    ]);
    const rules = records(configurations).map((row) => smartRuleSchema.parse(row.configuration));
    const ids = records(effects).map((row) => String(row.action_run_id));
    const runs =
      ids.length === 0
        ? []
        : records(
            await this.db(
              `action_runs?user_id=eq.${userId}&id=in.(${ids.join(",")})&select=id,action_rule_id,event_id,provider,status,input,created_at,provider_reference,error_code&order=created_at.desc&limit=200`,
            ),
          );
    return smartOverviewSchema.parse({
      paused: records(settings)[0]?.paused !== false,
      services: Object.keys(GOOGLE_SERVICE_SCOPES).map((service) => {
        const row = records(services).find((item) => item.service === service);
        return {
          service,
          connected: row?.connection_id != null,
          enabled: row?.enabled === true,
          permissionRequired: row?.permission_required === true,
          targetId: row?.target_id ?? "",
          targetLabel: row?.target_label ?? "",
        };
      }),
      rules,
      receipts: runs.map((run) => {
        const rule = rules.find((item) => item.id === run.action_rule_id);
        return {
          preview: smartActionPreview(String(run.provider), run.input),
          id: run.id,
          ruleId: run.action_rule_id,
          observationId: run.event_id,
          service: run.provider,
          title: rule?.name ?? "Google action",
          targetLabel: rule?.targetLabel ?? "Configured destination",
          status: run.status,
          reason:
            run.status === "succeeded"
              ? "completed"
              : run.status === "cancelled"
                ? "cancelled"
                : run.status === "awaiting-approval"
                  ? "approval-required"
                  : run.error_code === "outcome-unknown"
                    ? "outcome-unknown"
                    : run.error_code === "permission-required"
                      ? "permission-required"
                      : run.error_code === "rate-limit"
                        ? "rate-limit"
                        : "provider-unavailable",
          createdAt: run.created_at,
          ...(typeof run.provider_reference === "string"
            ? { providerReference: run.provider_reference }
            : {}),
        };
      }),
    });
  }
  async command(userId: string, candidate: unknown): Promise<SmartOverview> {
    const command = smartCommandSchema.parse(candidate);
    if (command.type === "pause")
      await this.db("smart_automation_settings?on_conflict=user_id", "POST", {
        user_id: userId,
        paused: command.paused,
      });
    else if (command.type === "service")
      await this.db(
        `smart_google_services?user_id=eq.${userId}&service=eq.${command.service}`,
        "PATCH",
        { enabled: command.enabled },
      );
    else if (command.type === "create-sheet") {
      await createSmartExpenseSheet(this, userId);
    } else if (command.type === "destination") {
      const resource = (await smartGoogleResources(this, userId, command.service)).find(
        (item) => item.id === command.targetId,
      );
      if (resource === undefined) throw new Error("Destination unavailable");
      if (command.service === "google-sheets")
        await validateSmartExpenseSheet(this, userId, resource.id);
      await this.db(
        `smart_google_services?user_id=eq.${userId}&service=eq.${command.service}`,
        "PATCH",
        { target_id: resource.id, target_label: resource.label, enabled: true },
      );
    } else if (command.type === "save-rule") {
      if (command.rule.filterRuleId === undefined)
        throw new Error("Choose an existing filter rule");
      await this.db("rpc/configure_smart_automation_v1", "POST", {
        p_user_id: userId,
        p_configuration: command.rule,
      });
    } else if (command.type === "disconnect") {
      // Disable first. Gmail uses its existing grant-revoking teardown; other services unlink locally.
      await this.db(
        `smart_google_services?user_id=eq.${userId}&service=eq.${command.service}`,
        "PATCH",
        { enabled: false },
      );
      if (command.service === "gmail") {
        const services = records(
          await this.db(
            `smart_google_services?user_id=eq.${userId}&service=eq.gmail&select=connection_id`,
          ),
        );
        const connectionId = services[0]?.connection_id;
        if (typeof connectionId === "string") {
          const response = await handleGmailDisconnect(this.env, {
            schemaVersion: 1,
            userId,
            connectionId,
          });
          if (!response.ok)
            throw new Error("Gmail teardown pending; capture has not been confirmed stopped");
          await this.db(`smart_google_services?user_id=eq.${userId}&service=neq.gmail`, "PATCH", {
            permission_required: true,
          });
        }
      }
      await this.db("rpc/disconnect_smart_service_v1", "POST", {
        p_user_id: userId,
        p_service: command.service,
      });
    } else {
      // Existing tenant RPC remains the sole approval boundary; API cannot supply an identity.
      throw new Error("Use the authenticated action decision endpoint");
    }
    return this.read(userId);
  }
}

export async function smartGoogleAccessToken(
  repository: SmartAutomationRepository,
  userId: string,
  service: string,
): Promise<string> {
  const configuration = readPersistenceConfiguration(repository.env);
  const services = records(
    await repository.db(
      `smart_google_services?user_id=eq.${userId}&service=eq.${encodeURIComponent(service)}&select=connection_id`,
    ),
  );
  const id = services[0]?.connection_id;
  if (typeof id !== "string") throw new Error("Service disconnected");
  const connections = records(
    await repository.db(
      `connections?user_id=eq.${userId}&id=eq.${id}&provider=eq.${encodeURIComponent(service)}&status=eq.active&select=id,credential_ciphertext,credential_nonce,wrapped_data_key,wrap_nonce,key_version,scopes`,
    ),
  );
  const connection = connections[0];
  if (connection === undefined) throw new Error("Connection unavailable");
  const scopes = GOOGLE_SERVICE_SCOPES[service as keyof typeof GOOGLE_SERVICE_SCOPES];
  if (
    scopes === undefined ||
    !Array.isArray(connection.scopes) ||
    !scopes.every((scope) => (connection.scopes as unknown[]).includes(scope))
  )
    throw new Error("Permissions unavailable");
  const refreshToken = await decryptValue(
    {
      algorithm: "AES-GCM-256",
      ciphertext: postgresByteaToBase64(connection.credential_ciphertext),
      nonce: postgresByteaToBase64(connection.credential_nonce, 12),
      wrappedKey: postgresByteaToBase64(connection.wrapped_data_key, 48),
      wrapNonce: postgresByteaToBase64(connection.wrap_nonce, 12),
      keyVersion: Number(connection.key_version),
    },
    configuration.keyring,
    connectionCredentialEncryptionContext(userId, String(connection.id)),
  );
  return refreshGoogleTasksAccessToken(
    refreshToken,
    {
      clientId: repository.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: repository.env.GOOGLE_CLIENT_SECRET ?? "",
    },
    repository.fetcher,
    AbortSignal.timeout(15000),
  );
}

export async function planSmartObservation(
  repository: SmartAutomationRepository,
  userId: string,
  observationValue: unknown,
  sourceItemId: string,
): Promise<void> {
  const observation = smartObservationSchema.parse(observationValue);
  const state = await repository.read(userId);
  for (const rule of state.rules) {
    if (!evaluateSmartRule(rule, observation, state).eligible) continue;
    // Actions require this exact filter revision's authoritative server match, even without category.
    const classifications = records(
      await repository.db(
        `classifications?user_id=eq.${userId}&source_item_id=eq.${sourceItemId}&filter_rule_id=eq.${rule.filterRuleId}&origin=eq.server&superseded_at=is.null&select=id&limit=1`,
      ),
    );
    if (classifications.length === 0) continue;
    const effectKey = await smartEffectKey(userId, rule, observation);
    await repository.db("rpc/propose_smart_action_v1", "POST", {
      p_user_id: userId,
      p_rule_id: rule.id,
      p_event_id: observation.id,
      p_effect_key: effectKey,
      p_input: renderSmartInput(rule, observation, "pending"),
      p_revision: rule.revision,
    });
  }
}

/** Read only validated, server-derived facts. Raw messages never become provider instructions. */
export async function planSmartSource(
  env: Env,
  userId: string,
  sourceItemId: string,
): Promise<void> {
  if (env.RELAY_SMART_GOOGLE_ENABLED !== "true") return;
  const repository = new SmartAutomationRepository(env);
  const [sources, events, facts] = await Promise.all([
    repository.db(
      `source_items?user_id=eq.${userId}&id=eq.${sourceItemId}&select=source,sender,occurred_at`,
    ),
    repository.db(
      `relay_events?user_id=eq.${userId}&source_item_id=eq.${sourceItemId}&select=id,kind,title,confidence,requires_review,starts_at,ends_at,due_at`,
    ),
    repository.db(
      `source_facts?user_id=eq.${userId}&source_item_id=eq.${sourceItemId}&certainty=eq.certain&select=kind,value`,
    ),
  ]);
  const source = records(sources)[0];
  if (source === undefined) return;
  const observations = records(facts);
  const fact = (kind: string) => observations.find((item) => item.kind === kind)?.value;
  const amount = fact("amount"),
    currency = fact("currency"),
    merchant = fact("merchant");
  const referenceValue = fact("reference") as { kind?: unknown; value?: unknown } | undefined;
  for (const event of records(events)) {
    if (
      !["task", "reminder", "calendar-event"].includes(String(event.kind)) &&
      amount === undefined
    )
      continue;
    const parsed = smartObservationSchema.safeParse({
      id: event.id,
      source: source.source,
      sender: source.sender ?? "unknown",
      kind:
        event.kind === "calendar-event"
          ? "meeting"
          : event.kind === "task"
            ? "task"
            : amount !== undefined
              ? "transaction"
              : "task",
      title: event.title,
      confidence: event.confidence ?? 0,
      requiresReview: event.requires_review,
      occurredAt: source.occurred_at,
      ...(typeof amount === "string" ? { amount } : {}),
      ...(typeof currency === "string" ? { currency } : {}),
      ...(typeof merchant === "string" ? { merchant } : {}),
      ...(referenceValue?.kind === "transaction" && typeof referenceValue.value === "string"
        ? { reference: referenceValue.value }
        : {}),
      ...(typeof event.starts_at === "string" ? { startsAt: event.starts_at } : {}),
      ...(typeof event.ends_at === "string" ? { endsAt: event.ends_at } : {}),
      ...(typeof event.due_at === "string" ? { dueAt: event.due_at } : {}),
    });
    if (parsed.success) await planSmartObservation(repository, userId, parsed.data, sourceItemId);
  }
  await drainSmartActions(env);
}

export async function executeSmartRun(
  repository: SmartAutomationRepository,
  userId: string,
  runId: string,
): Promise<void> {
  if (repository.env.RELAY_SMART_GOOGLE_ENABLED !== "true") return;
  const state = await repository.read(userId);
  const receipt = state.receipts.find((item) => item.id === runId);
  const rule = state.rules.find((item) => item.id === receipt?.ruleId);
  const service = state.services.find((item) => item.service === rule?.service);
  if (
    state.paused ||
    rule?.enabled !== true ||
    service?.enabled !== true ||
    !service.connected ||
    service.permissionRequired ||
    receipt === undefined ||
    !["approved", "running"].includes(receipt.status)
  )
    return;
  if (
    (await repository.db("rpc/claim_smart_outbox_v1", "POST", {
      p_user_id: userId,
      p_run_id: runId,
    })) !== true
  )
    return;
  const config = readPersistenceConfiguration(repository.env);
  const workflowInstanceId = `smart-${runId}`;
  let claimed = false;
  let providerStarted = false;
  try {
    // SQL repeats pause/service/revision checks while claiming under locks.
    await repository.db("rpc/check_smart_dispatch_v1", "POST", {
      p_user_id: userId,
      p_run_id: runId,
    });
    const run = await claimActionRunForWorkflow(
      config,
      { userId, actionRunId: runId, workflowInstanceId },
      repository.fetcher,
    );
    claimed = true;
    const rows = records(
      await repository.db(
        `connections?user_id=eq.${userId}&provider=eq.${rule.service}&status=eq.active&select=id,credential_ciphertext,credential_nonce,wrapped_data_key,wrap_nonce,key_version,scopes&limit=2`,
      ),
    );
    if (rows.length !== 1) throw new Error("Connection unavailable");
    const connection = rows[0]!;
    if (
      !Array.isArray(connection.scopes) ||
      !GOOGLE_SERVICE_SCOPES[rule.service].every((scope) =>
        (connection.scopes as unknown[]).includes(scope),
      )
    )
      throw new Error("Permissions unavailable");
    const refreshToken = await decryptValue(
      {
        algorithm: "AES-GCM-256",
        ciphertext: postgresByteaToBase64(connection.credential_ciphertext),
        nonce: postgresByteaToBase64(connection.credential_nonce, 12),
        wrappedKey: postgresByteaToBase64(connection.wrapped_data_key, 48),
        wrapNonce: postgresByteaToBase64(connection.wrap_nonce, 12),
        keyVersion: Number(connection.key_version),
      },
      config.keyring,
      connectionCredentialEncryptionContext(userId, String(connection.id)),
    );
    const accessToken = await refreshGoogleTasksAccessToken(
      refreshToken,
      {
        clientId: repository.env.GOOGLE_CLIENT_ID ?? "",
        clientSecret: repository.env.GOOGLE_CLIENT_SECRET ?? "",
      },
      repository.fetcher,
      AbortSignal.timeout(15_000),
    );
    await repository.db("rpc/check_smart_dispatch_v1", "POST", {
      p_user_id: userId,
      p_run_id: runId,
    });
    const intent: ActionIntent = {
      id: run.id,
      eventId: run.eventId,
      ruleId: rule.id,
      provider: rule.service,
      operation:
        rule.service === "google-tasks"
          ? "create-task"
          : rule.service === "google-sheets"
            ? "record-transaction"
            : "create-event",
      input: run.input,
      approval: "approved",
      createdAt: run.createdAt,
    };
    providerStarted = true;
    const delivery = await dispatchProvider(intent, {
      accessToken,
      attempt: Math.max(2, run.attemptCount),
      fetcher: repository.fetcher,
    });
    if (delivery.status !== "delivered" || delivery.providerReference === undefined)
      throw new Error("Provider dispatch unavailable");
    const providerReference = delivery.providerReference;
    await completeActionRun(
      config,
      { userId, actionRunId: runId, workflowInstanceId, providerReference },
      repository.fetcher,
    );
    await repository.db(
      `smart_action_outbox?user_id=eq.${userId}&action_run_id=eq.${runId}`,
      "DELETE",
    );
  } catch (error: unknown) {
    logPipelineError(repository.env, "smart.execution_failed", error, {
      code: "SMART_EXECUTION_FAILED",
      integration: "google",
      operation: "executeSmartRun",
    });
    // Unknown outcomes are not declared failed-with-no-effect or blindly retried.
    if (claimed) {
      const code =
        typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      const status = error instanceof AppError ? error.statusCode : undefined;
      const permission = status === 401 || status === 403 || code === "grant-revoked";
      const retryable =
        status === 429 || code === "rate-limited" || (!providerStarted && !permission);
      const unknown = providerStarted && !permission && !retryable;
      if (permission)
        await repository.db(
          `smart_google_services?user_id=eq.${userId}&service=eq.${rule.service}`,
          "PATCH",
          { permission_required: true },
        );
      await repository.db(
        `smart_action_outbox?user_id=eq.${userId}&action_run_id=eq.${runId}`,
        "PATCH",
        {
          outcome_unknown: unknown,
          lease_until: null,
          available_at: new Date(Date.now() + 30_000).toISOString(),
        },
      );
      const settled = await failActionRun(
        config,
        {
          userId,
          actionRunId: runId,
          workflowInstanceId,
          errorCode: unknown
            ? "outcome-unknown"
            : permission
              ? "permission-required"
              : "rate-limit",
          retryable,
        },
        repository.fetcher,
      );
      if (settled.status === "succeeded") {
        await repository.db(
          `smart_action_outbox?user_id=eq.${userId}&action_run_id=eq.${runId}`,
          "DELETE",
        );
        return;
      }
      if (retryable)
        throw new AppError("Action deferred", {
          cause: error,
          code: "SMART_RETRY_DEFERRED",
          category: "unavailable",
          integration: "google",
          operation: "executeSmartRun",
          retryable: true,
        });
    }
  }
}

/** Bounded durable outbox sweep; approved work survives lost requests and process restarts. */
export async function drainSmartActions(env: Env): Promise<void> {
  if (env.RELAY_SMART_GOOGLE_ENABLED !== "true") return;
  const repository = new SmartAutomationRepository(env);
  const now = encodeURIComponent(new Date().toISOString());
  await repository.db(`smart_google_oauth_sessions?expires_at=lt.${now}`, "DELETE");
  const work = records(
    await repository.db(
      `smart_action_outbox?outcome_unknown=eq.false&available_at=lte.${now}&or=(lease_until.is.null,lease_until.lt.${now})&order=available_at.asc&limit=20`,
    ),
  );
  if (env.SMART_ACTION_WORKFLOW === undefined) return;
  for (const item of work) {
    const id = `smart-${String(item.action_run_id)}-${String(item.attempts)}`;
    try {
      await env.SMART_ACTION_WORKFLOW.create({
        id,
        params: { userId: String(item.user_id), runId: String(item.action_run_id) },
      });
    } catch (error: unknown) {
      // A repeated outbox sweep may find an existing workflow. Confirm it exists before ignoring.
      try {
        await (await env.SMART_ACTION_WORKFLOW.get(id)).status();
      } catch (statusError: unknown) {
        throw new AppError("Action scheduling failed", {
          cause: new AggregateError([error, statusError]),
          code: "SMART_SCHEDULING_FAILED",
          category: "unavailable",
          integration: "cloudflare-workflow",
          operation: "scheduleSmartAction",
        });
      }
    }
  }
}
