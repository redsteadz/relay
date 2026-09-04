import { describe, expect, it } from "vitest";

import type { ActionIntent } from "@relay/contracts";

import {
  createGoogleTask,
  findTaskByMarker,
  GoogleTasksProviderError,
  googleTaskInsertRequest,
  isRetryableGoogleTasksFailure,
  readGoogleTaskInput,
  refreshGoogleTasksAccessToken,
  relayTaskMarker,
  taskNotesWithMarker,
} from "../src/google-tasks-provider";

const ACTION_RUN_ID = "6f98ad81-f071-418b-a426-8c8c9f627161";

function intent(input: Record<string, unknown>): ActionIntent {
  return {
    id: ACTION_RUN_ID,
    eventId: "cbf55db3-fabe-460d-af9e-68f49cfcaa78",
    ruleId: "23868f8c-0639-42ad-9499-04d98e986380",
    provider: "google-tasks",
    approval: "approved",
    operation: "create-task",
    input,
    createdAt: "2026-09-04T12:41:00Z",
  };
}

function validIntent(overrides: Record<string, unknown> = {}): ActionIntent {
  return intent({
    taskListId: "MTIzNDU2",
    title: "Review North Station charge",
    ...overrides,
  });
}

/** Fetchers here never await, so they resolve directly rather than being declared async. */
function respond(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

function requestUrl(input: string | URL | Request): string {
  return input instanceof Request ? input.url : String(input);
}

/** Reads a request body as an object, which is what every assertion below needs it to be. */
async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json();
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("expected a JSON object body");
  }
  return body as Record<string, unknown>;
}

describe("relayTaskMarker", () => {
  it("derives the marker from the action run alone", () => {
    expect(relayTaskMarker(ACTION_RUN_ID)).toBe(`[relay:${ACTION_RUN_ID}]`);
  });

  it("is stable across attempts, which is what reconciliation depends on", () => {
    expect(relayTaskMarker(ACTION_RUN_ID)).toBe(relayTaskMarker(ACTION_RUN_ID));
  });

  it("carries no source content into the notes", () => {
    expect(taskNotesWithMarker("Statement from the bank", ACTION_RUN_ID)).toBe(
      `Statement from the bank\n\n[relay:${ACTION_RUN_ID}]`,
    );
    expect(taskNotesWithMarker(undefined, ACTION_RUN_ID)).toBe(`[relay:${ACTION_RUN_ID}]`);
    expect(taskNotesWithMarker("   ", ACTION_RUN_ID)).toBe(`[relay:${ACTION_RUN_ID}]`);
  });
});

describe("readGoogleTaskInput", () => {
  it("accepts a fully specified task", () => {
    const input = readGoogleTaskInput(
      validIntent({ due: "2026-09-05T09:00:00Z", notes: "Check the statement" }),
    );

    expect(input).toEqual({
      due: "2026-09-05T09:00:00Z",
      notes: "Check the statement",
      taskListId: "MTIzNDU2",
      title: "Review North Station charge",
    });
  });

  it("refuses a run that names no task list rather than filing somewhere arbitrary", () => {
    expect(() => readGoogleTaskInput(intent({ title: "Review charge" }))).toThrow(
      GoogleTasksProviderError,
    );
  });

  it("refuses a title that is missing or only whitespace", () => {
    expect(() => readGoogleTaskInput(validIntent({ title: "   " }))).toThrow(
      GoogleTasksProviderError,
    );
    expect(() => readGoogleTaskInput(intent({ taskListId: "MTIzNDU2" }))).toThrow(
      GoogleTasksProviderError,
    );
  });

  it("refuses an unparseable due date before it becomes a permanent 400", () => {
    expect(() => readGoogleTaskInput(validIntent({ due: "next friday" }))).toThrow(
      GoogleTasksProviderError,
    );
  });

  it("refuses a field the task resource does not carry", () => {
    expect(() => readGoogleTaskInput(validIntent({ assignee: "someone" }))).toThrow(
      GoogleTasksProviderError,
    );
  });

  it("classifies invalid input as permanent", () => {
    try {
      readGoogleTaskInput(validIntent({ title: "" }));
      expect.unreachable("invalid input must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(GoogleTasksProviderError);
      expect(isRetryableGoogleTasksFailure((error as GoogleTasksProviderError).code)).toBe(false);
    }
  });
});

describe("googleTaskInsertRequest", () => {
  it("targets the named list and carries the marker in notes", async () => {
    const request = googleTaskInsertRequest(
      "access-token",
      readGoogleTaskInput(validIntent({ notes: "Check the statement" })),
      ACTION_RUN_ID,
    );
    const body = await jsonBody(request);

    expect(request.url).toBe("https://tasks.googleapis.com/tasks/v1/lists/MTIzNDU2/tasks");
    expect(request.method).toBe("POST");
    expect(request.headers.get("authorization")).toBe("Bearer access-token");
    expect(body.title).toBe("Review North Station charge");
    expect(body.notes).toContain(relayTaskMarker(ACTION_RUN_ID));
  });

  it("escapes a task list id rather than letting it shape the path", () => {
    const request = googleTaskInsertRequest(
      "access-token",
      readGoogleTaskInput(validIntent({ taskListId: "a/../b" })),
      ACTION_RUN_ID,
    );

    expect(request.url).toBe("https://tasks.googleapis.com/tasks/v1/lists/a%2F..%2Fb/tasks");
  });

  it("omits due entirely when the action carries none", async () => {
    const request = googleTaskInsertRequest(
      "access-token",
      readGoogleTaskInput(validIntent()),
      ACTION_RUN_ID,
    );
    const body = await jsonBody(request);

    expect("due" in body).toBe(false);
  });
});

describe("createGoogleTask", () => {
  it("inserts directly on a first attempt without sweeping the list", async () => {
    const calls: string[] = [];
    const fetcher = (input: string | URL | Request) => {
      calls.push(input instanceof Request ? input.method : "GET");
      return respond({ id: "task-1" });
    };

    const result = await createGoogleTask("token", validIntent(), 1, fetcher);

    expect(result).toEqual({ reconciled: false, taskId: "task-1" });
    expect(calls).toEqual(["POST"]);
  });

  // The case the whole marker scheme exists for: an earlier attempt's insert committed but its
  // response was lost, so the run is retried against a list that already contains the task.
  it("recovers a committed task after a lost response instead of creating a second", async () => {
    const methods: string[] = [];
    const fetcher = (input: string | URL | Request) => {
      if (input instanceof Request) {
        methods.push("POST");
        return respond({ id: "task-duplicate" });
      }
      methods.push("GET");
      return respond({
        items: [
          { id: "task-unrelated", notes: "someone else's task" },
          { id: "task-1", notes: `Check the statement\n\n${relayTaskMarker(ACTION_RUN_ID)}` },
        ],
      });
    };

    const result = await createGoogleTask("token", validIntent(), 2, fetcher);

    expect(result).toEqual({ reconciled: true, taskId: "task-1" });
    expect(methods).toEqual(["GET"]);
  });

  it("inserts on a retry when the sweep proves nothing was created", async () => {
    const methods: string[] = [];
    const fetcher = (input: string | URL | Request) => {
      if (input instanceof Request) {
        methods.push("POST");
        return respond({ id: "task-2" });
      }
      methods.push("GET");
      return respond({ items: [] });
    };

    const result = await createGoogleTask("token", validIntent(), 3, fetcher);

    expect(result).toEqual({ reconciled: false, taskId: "task-2" });
    expect(methods).toEqual(["GET", "POST"]);
  });

  it("produces exactly one task across a lost response and its retry", async () => {
    const inserts: string[] = [];
    let dropNextResponse = true;

    const fetcher = (input: string | URL | Request) => {
      if (input instanceof Request) {
        inserts.push("task-1");
        if (dropNextResponse) {
          dropNextResponse = false;
          return Promise.reject(new Error("connection reset after the insert committed"));
        }
        return respond({ id: "task-1" });
      }
      return respond({
        items: inserts.map(() => ({ id: "task-1", notes: relayTaskMarker(ACTION_RUN_ID) })),
      });
    };

    await expect(createGoogleTask("token", validIntent(), 1, fetcher)).rejects.toThrow();
    const retried = await createGoogleTask("token", validIntent(), 2, fetcher);

    expect(retried).toEqual({ reconciled: true, taskId: "task-1" });
    expect(inserts).toEqual(["task-1"]);
  });

  it("does not miss a task the user already completed", async () => {
    const fetcher = (input: string | URL | Request) => {
      if (input instanceof Request) return respond({ id: "task-duplicate" });
      expect(requestUrl(input)).toContain("showCompleted=true");
      expect(requestUrl(input)).toContain("showHidden=true");
      return respond({
        items: [{ id: "task-1", notes: relayTaskMarker(ACTION_RUN_ID), status: "completed" }],
      });
    };

    await expect(createGoogleTask("token", validIntent(), 2, fetcher)).resolves.toEqual({
      reconciled: true,
      taskId: "task-1",
    });
  });
});

describe("failure classification", () => {
  const cases: { code: GoogleTasksProviderError["code"]; status: number }[] = [
    { code: "grant-revoked", status: 401 },
    { code: "rate-limited", status: 429 },
    { code: "unavailable", status: 503 },
    { code: "request-rejected", status: 400 },
  ];

  for (const testCase of cases) {
    it(`maps ${testCase.status.toString()} to ${testCase.code}`, async () => {
      const fetcher = () => respond({}, testCase.status);

      await expect(createGoogleTask("token", validIntent(), 1, fetcher)).rejects.toMatchObject({
        code: testCase.code,
      });
    });
  }

  it("separates a quota 403 from a revoked-grant 403", async () => {
    const quota = () => respond({ error: { errors: [{ reason: "quotaExceeded" }] } }, 403);
    const revoked = () =>
      respond({ error: { errors: [{ reason: "insufficientPermissions" }] } }, 403);

    await expect(createGoogleTask("token", validIntent(), 1, quota)).rejects.toMatchObject({
      code: "quota-exhausted",
    });
    await expect(createGoogleTask("token", validIntent(), 1, revoked)).rejects.toMatchObject({
      code: "grant-revoked",
    });
  });

  it("treats an unreadable 403 as permanent rather than retrying an authorization failure", async () => {
    const fetcher = () => Promise.resolve(new Response("not json", { status: 403 }));

    await expect(createGoogleTask("token", validIntent(), 1, fetcher)).rejects.toMatchObject({
      code: "grant-revoked",
    });
  });

  it("only permits a retry for transient classifications", () => {
    expect(isRetryableGoogleTasksFailure("rate-limited")).toBe(true);
    expect(isRetryableGoogleTasksFailure("quota-exhausted")).toBe(true);
    expect(isRetryableGoogleTasksFailure("unavailable")).toBe(true);
    expect(isRetryableGoogleTasksFailure("grant-revoked")).toBe(false);
    expect(isRetryableGoogleTasksFailure("request-rejected")).toBe(false);
    expect(isRetryableGoogleTasksFailure("invalid-input")).toBe(false);
    expect(isRetryableGoogleTasksFailure("invalid-response")).toBe(false);
    expect(isRetryableGoogleTasksFailure("response-too-large")).toBe(false);
  });

  it("rejects a response that names no task id", async () => {
    const fetcher = () => respond({ title: "Review charge" });

    await expect(createGoogleTask("token", validIntent(), 1, fetcher)).rejects.toMatchObject({
      code: "invalid-response",
    });
  });
});

describe("findTaskByMarker", () => {
  it("follows pages until the marker is found", async () => {
    const tokens: (string | null)[] = [];
    const fetcher = (input: string | URL | Request) => {
      const url = new URL(requestUrl(input));
      tokens.push(url.searchParams.get("pageToken"));
      if (url.searchParams.get("pageToken") === null) {
        return respond({ items: [{ id: "other", notes: "" }], nextPageToken: "page-2" });
      }
      return respond({ items: [{ id: "task-1", notes: relayTaskMarker(ACTION_RUN_ID) }] });
    };

    await expect(findTaskByMarker("token", "MTIzNDU2", ACTION_RUN_ID, fetcher)).resolves.toBe(
      "task-1",
    );
    expect(tokens).toEqual([null, "page-2"]);
  });

  it("stops rather than sweeping an unbounded list forever", async () => {
    let pages = 0;
    const fetcher = () => {
      pages += 1;
      return respond({ items: [{ id: "other", notes: "" }], nextPageToken: "more" });
    };

    await expect(
      findTaskByMarker("token", "MTIzNDU2", ACTION_RUN_ID, fetcher),
    ).resolves.toBeUndefined();
    expect(pages).toBe(10);
  });

  it("reports nothing found for an empty list", async () => {
    const fetcher = () => respond({});

    await expect(
      findTaskByMarker("token", "MTIzNDU2", ACTION_RUN_ID, fetcher),
    ).resolves.toBeUndefined();
  });
});

describe("refreshGoogleTasksAccessToken", () => {
  const configuration = { clientId: "client", clientSecret: "secret" };

  it("returns the access token", async () => {
    const fetcher = () => respond({ access_token: "access-1" });

    await expect(refreshGoogleTasksAccessToken("refresh", configuration, fetcher)).resolves.toBe(
      "access-1",
    );
  });

  it("reports a revoked grant as permanent", async () => {
    const fetcher = () => respond({ error: "invalid_grant" }, 400);

    await expect(
      refreshGoogleTasksAccessToken("refresh", configuration, fetcher),
    ).rejects.toMatchObject({ code: "grant-revoked" });
  });

  it("rejects a token response that carries no token", async () => {
    const fetcher = () => respond({ token_type: "Bearer" });

    await expect(
      refreshGoogleTasksAccessToken("refresh", configuration, fetcher),
    ).rejects.toMatchObject({ code: "invalid-response" });
  });
});
