/**
 * Google Tasks action provider.
 *
 * Creates exactly one task per approved Relay action, despite Queue redelivery, Workflow step
 * retries, and lost HTTP responses.
 *
 * The Google Tasks insert offers no caller-supplied idempotency key — unlike Nextcloud Budget,
 * which accepts the Relay action id directly — so uniqueness cannot be delegated to the provider.
 * Instead every task Relay creates carries a stable marker derived from the action run id, and a
 * retry searches the target list for that marker before inserting again. A response lost after the
 * insert committed is therefore recognised on the next attempt rather than duplicated.
 *
 * See `docs/integrations/google-tasks.md` and `docs/architecture/action-model.md`.
 */

import { googleTaskInputSchema, type ActionIntent, type GoogleTaskInput } from "@relay/contracts";

import { BoundedJsonError, readBoundedJson } from "./bounded-json";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_TASKS_API_ROOT = "https://tasks.googleapis.com/tasks/v1";
const MAX_TOKEN_RESPONSE_BYTES = 32_768;
const MAX_TASK_RESPONSE_BYTES = 64_000;
const MAX_TASK_PAGE_RESPONSE_BYTES = 512_000;

/** One page of a reconciliation sweep, and the most pages a sweep will read. */
const RECONCILE_PAGE_SIZE = 100;
const MAX_RECONCILE_PAGES = 10;

export const GOOGLE_TASKS_OPERATION_TIMEOUT_MS = 15_000;

/**
 * Failures a caller has to tell apart.
 *
 * Split by what the caller must do next rather than by HTTP status: `grant-revoked`,
 * `request-rejected`, and `invalid-input` are permanent and end the run, while `rate-limited`,
 * `quota-exhausted`, and `unavailable` are transient and leave it retryable.
 */
export class GoogleTasksProviderError extends Error {
  constructor(
    readonly code:
      | "grant-revoked"
      | "invalid-input"
      | "invalid-response"
      | "quota-exhausted"
      | "rate-limited"
      | "request-rejected"
      | "response-too-large"
      | "unavailable",
    cause?: unknown,
  ) {
    super("Google Tasks provider operation failed", cause === undefined ? undefined : { cause });
    this.name = "GoogleTasksProviderError";
  }
}

/** Whether another attempt may be made, which is what the ledger records. */
export function isRetryableGoogleTasksFailure(code: GoogleTasksProviderError["code"]): boolean {
  return code === "rate-limited" || code === "quota-exhausted" || code === "unavailable";
}

export type GoogleTasksConfiguration = {
  clientId: string;
  clientSecret: string;
};

/**
 * The marker written into a created task's notes.
 *
 * Derived from the action run id alone. The run id is Relay's own identifier, already deterministic
 * from the rule and event pair, so the marker carries nothing about the source that produced the
 * action — no sender, subject, or body — while still being unique per approved action and stable
 * across attempts. That is the whole property reconciliation needs.
 */
export function relayTaskMarker(actionRunId: string): string {
  return `[relay:${actionRunId}]`;
}

/** Notes as stored on the task: the rendered note, if any, then the marker on its own line. */
export function taskNotesWithMarker(notes: string | undefined, actionRunId: string): string {
  const marker = relayTaskMarker(actionRunId);
  const body = notes?.trim() ?? "";
  return body === "" ? marker : `${body}\n\n${marker}`;
}

/**
 * Validates the rendered input before anything is sent.
 *
 * The input reaches here from a rule template and an event, so it is structurally untrusted even
 * though no model chose it. Refusing a bad title or an unparseable due date locally turns what would
 * be a permanent 400 into a validation failure that never spends a request or an attempt.
 */
export function readGoogleTaskInput(intent: ActionIntent): GoogleTaskInput {
  const parsed = googleTaskInputSchema.safeParse(intent.input);
  if (!parsed.success) throw new GoogleTasksProviderError("invalid-input", parsed.error);
  return parsed.data;
}

function responseError(error: unknown): GoogleTasksProviderError {
  if (error instanceof GoogleTasksProviderError) return error;
  if (error instanceof BoundedJsonError) {
    if (error.code === "response-too-large") {
      return new GoogleTasksProviderError("response-too-large", error);
    }
    if (error.code === "response-unavailable") {
      return new GoogleTasksProviderError("unavailable", error);
    }
  }
  return new GoogleTasksProviderError("invalid-response", error);
}

function providerJson(
  response: Response,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<unknown> {
  return readBoundedJson(response, maximumBytes, {
    ...(signal === undefined ? {} : { signal }),
    timeoutMs: GOOGLE_TASKS_OPERATION_TIMEOUT_MS,
  });
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GoogleTasksProviderError("invalid-response");
  }
  return value as Record<string, unknown>;
}

/**
 * Maps a refused response onto the vocabulary above.
 *
 * 403 is the ambiguous one: Google uses it both for a revoked or insufficient grant and for quota
 * exhaustion, which differ in whether retrying can ever succeed. The reason string decides, and an
 * unrecognised 403 is treated as permanent, because retrying an authorization failure forever is
 * worse than ending a run that might have recovered.
 */
async function refusalError(
  response: Response,
  signal?: AbortSignal,
): Promise<GoogleTasksProviderError> {
  if (response.status === 401) return new GoogleTasksProviderError("grant-revoked");
  if (response.status === 429) return new GoogleTasksProviderError("rate-limited");
  if (response.status >= 500) return new GoogleTasksProviderError("unavailable");

  if (response.status === 403) {
    let reason = "";
    try {
      const body = objectValue(await providerJson(response, MAX_TASK_RESPONSE_BYTES, signal));
      const error = typeof body.error === "object" && body.error !== null ? body.error : {};
      const errors = (error as { errors?: unknown }).errors;
      const first = Array.isArray(errors) && errors.length > 0 ? objectValue(errors[0]) : {};
      reason = typeof first.reason === "string" ? first.reason : "";
    } catch {
      reason = "";
    }
    if (reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") {
      return new GoogleTasksProviderError("rate-limited");
    }
    if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
      return new GoogleTasksProviderError("quota-exhausted");
    }
    return new GoogleTasksProviderError("grant-revoked");
  }

  return new GoogleTasksProviderError("request-rejected");
}

/**
 * Exchanges the stored refresh token for an access token.
 *
 * `invalid_grant` is the only 400 worth distinguishing: it means the user revoked Relay's access,
 * which no retry recovers, and the run must end rather than spin.
 */
export async function refreshGoogleTasksAccessToken(
  refreshToken: string,
  configuration: GoogleTasksConfiguration,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetcher(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: configuration.clientId,
      client_secret: configuration.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    ...(signal === undefined ? {} : { signal }),
  });

  if (!response.ok) {
    if (response.status === 400) {
      try {
        const error = objectValue(await providerJson(response, MAX_TOKEN_RESPONSE_BYTES, signal));
        if (error.error === "invalid_grant") throw new GoogleTasksProviderError("grant-revoked");
      } catch (error) {
        if (error instanceof GoogleTasksProviderError && error.code === "grant-revoked")
          throw error;
      }
    }
    throw await refusalError(response, signal);
  }

  let data: Record<string, unknown>;
  try {
    data = objectValue(await providerJson(response, MAX_TOKEN_RESPONSE_BYTES, signal));
  } catch (error) {
    throw responseError(error);
  }
  if (
    typeof data.access_token !== "string" ||
    data.access_token.length === 0 ||
    data.access_token.length > 8192
  ) {
    throw new GoogleTasksProviderError("invalid-response");
  }
  return data.access_token;
}

/** Builds the insert request, kept separate so its shape is assertable without a network call. */
export function googleTaskInsertRequest(
  accessToken: string,
  input: GoogleTaskInput,
  actionRunId: string,
): Request {
  const body: Record<string, string> = {
    notes: taskNotesWithMarker(input.notes, actionRunId),
    title: input.title,
  };
  if (input.due !== undefined) body.due = input.due;

  return new Request(
    `${GOOGLE_TASKS_API_ROOT}/lists/${encodeURIComponent(input.taskListId)}/tasks`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

function taskId(value: unknown): string {
  const id = objectValue(value).id;
  if (typeof id !== "string" || id.length === 0 || id.length > 512) {
    throw new GoogleTasksProviderError("invalid-response");
  }
  return id;
}

/**
 * Looks for a task this run already created.
 *
 * Completed and hidden tasks are included, because a task created by an earlier attempt may already
 * have been dealt with by the user, and treating that as absent would create a second copy. The
 * sweep is bounded: a list large enough to exhaust the page budget returns `undefined`, which makes
 * the caller insert. Duplicating a task in a pathologically large list is the lesser failure against
 * reading it forever, and the marker still records which run produced each copy.
 */
export async function findTaskByMarker(
  accessToken: string,
  taskListId: string,
  actionRunId: string,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const marker = relayTaskMarker(actionRunId);
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_RECONCILE_PAGES; page += 1) {
    const url = new URL(`${GOOGLE_TASKS_API_ROOT}/lists/${encodeURIComponent(taskListId)}/tasks`);
    url.searchParams.set("maxResults", String(RECONCILE_PAGE_SIZE));
    url.searchParams.set("showCompleted", "true");
    url.searchParams.set("showHidden", "true");
    if (pageToken !== undefined) url.searchParams.set("pageToken", pageToken);

    const response = await fetcher(url.toString(), {
      method: "GET",
      headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) throw await refusalError(response, signal);

    let payload: Record<string, unknown>;
    try {
      payload = objectValue(await providerJson(response, MAX_TASK_PAGE_RESPONSE_BYTES, signal));
    } catch (error) {
      throw responseError(error);
    }

    const items = Array.isArray(payload.items) ? payload.items : [];
    for (const item of items) {
      const task = objectValue(item);
      const notes = typeof task.notes === "string" ? task.notes : "";
      if (notes.includes(marker)) return taskId(task);
    }

    const next = payload.nextPageToken;
    if (typeof next !== "string" || next.length === 0) return undefined;
    pageToken = next;
  }

  return undefined;
}

export type GoogleTaskCreation = {
  /** True when the task already existed, so an earlier attempt had in fact committed. */
  reconciled: boolean;
  taskId: string;
};

/**
 * Creates the task for one approved run, or recovers the one an earlier attempt created.
 *
 * `attempt` is the run's attempt count. A first attempt inserts directly: there is nothing to
 * reconcile against, and a sweep would cost a request per action for no benefit. Every later attempt
 * searches first, because the only reason a second attempt exists is that the first one's outcome is
 * unknown — and an unknown outcome after a committed insert is exactly the case that produces
 * duplicates.
 */
export async function createGoogleTask(
  accessToken: string,
  intent: ActionIntent,
  attempt: number,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<GoogleTaskCreation> {
  const input = readGoogleTaskInput(intent);

  if (attempt > 1) {
    const existing = await findTaskByMarker(
      accessToken,
      input.taskListId,
      intent.id,
      fetcher,
      signal,
    );
    if (existing !== undefined) return { reconciled: true, taskId: existing };
  }

  const request = googleTaskInsertRequest(accessToken, input, intent.id);
  const response = await fetcher(request, signal === undefined ? undefined : { signal });
  if (!response.ok) throw await refusalError(response, signal);

  let payload: unknown;
  try {
    payload = await providerJson(response, MAX_TASK_RESPONSE_BYTES, signal);
  } catch (error) {
    throw responseError(error);
  }
  return { reconciled: false, taskId: taskId(payload) };
}
