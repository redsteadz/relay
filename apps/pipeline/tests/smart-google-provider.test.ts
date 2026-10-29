import { describe, expect, it } from "vitest";
import type { ActionIntent } from "@relay/contracts";
import { executeSmartGoogleAction } from "../src/smart-google-provider";

const id = "6f98ad81-f071-418b-a426-8c8c9f627161";
function intent(
  provider: ActionIntent["provider"],
  operation: string,
  input: Record<string, unknown>,
): ActionIntent {
  return {
    id,
    eventId: id,
    ruleId: id,
    provider,
    operation,
    input,
    approval: "approved",
    createdAt: "2026-10-23T10:00:00Z",
  };
}
function response(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}
describe("Google automation adapters (mocked HTTP)", () => {
  it("writes exact money as RAW to a stable Sheets row and reconciles a lost reply", async () => {
    const values = [
      id,
      "2026-10-23",
      "=IMPORTXML(unsafe)",
      "9007199254740993.01",
      "USD",
      "SYNTHETIC-1042",
      "sms",
    ];
    const action = intent("google-sheets", "record-transaction", {
      spreadsheetId: "synthetic-sheet",
      range: "'Relay Expenses'!A2:G2",
      values,
    });
    let stored: string[] | undefined;
    const methods: string[] = [];
    const fetcher = (_url: string | URL | Request, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      if (init?.method === "PUT") {
        expect(_url instanceof Request ? _url.url : _url.toString()).toContain(
          "valueInputOption=RAW",
        );
        const body = JSON.parse(typeof init.body === "string" ? init.body : "{}") as {
          values: string[][];
        };
        stored = body.values[0];
        return Promise.resolve(response({ updatedCells: 7 }));
      }
      return Promise.resolve(response(stored === undefined ? {} : { values: [stored] }));
    };
    expect(await executeSmartGoogleAction("synthetic-token", action, 1, fetcher)).toContain(
      "A2:G2",
    );
    await executeSmartGoogleAction("synthetic-token", action, 2, fetcher);
    expect(methods).toEqual(["GET", "PUT", "GET"]);
    expect(stored?.[3]).toBe("9007199254740993.01");
  });
  it("never overwrites a conflicting Sheets row", async () => {
    await expect(
      executeSmartGoogleAction(
        "token",
        intent("google-sheets", "record-transaction", {
          spreadsheetId: "sheet",
          range: "'Relay Expenses'!A2:G2",
          values: [id, "", "", "1.00", "USD", "ref", "sms"],
        }),
        1,
        () => Promise.resolve(response({ values: [["other-action"]] })),
      ),
    ).rejects.toMatchObject({ code: "SMART_GOOGLE_IDENTITY_CONFLICT" });
  });
  it("creates a Calendar event with no invitations and stable identity", async () => {
    const action = intent("google-calendar", "create-event", {
      calendarId: "personal",
      summary: "Review",
      start: "2026-10-23T10:00:00Z",
      end: "2026-10-23T11:00:00Z",
    });
    let body: Record<string, unknown> = {};
    const created = await executeSmartGoogleAction("token", action, 1, (_url, init) => {
      body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
        string,
        unknown
      >;
      return Promise.resolve(response({ id: body.id }));
    });
    expect(created).toBe(`r${id.replaceAll("-", "")}`);
    expect(body).not.toHaveProperty("attendees");
    expect(body).not.toHaveProperty("sendUpdates");
    expect(
      await executeSmartGoogleAction("token", action, 2, () =>
        Promise.resolve(response({ ...body })),
      ),
    ).toBe(created);
  });
  it("refuses a calendar reconciliation mismatch", async () => {
    await expect(
      executeSmartGoogleAction(
        "token",
        intent("google-calendar", "create-event", {
          calendarId: "personal",
          summary: "Review",
          start: "2026-10-23T10:00:00Z",
          end: "2026-10-23T11:00:00Z",
        }),
        2,
        () =>
          Promise.resolve(
            response({ extendedProperties: { private: { relayActionId: "other" } } }),
          ),
      ),
    ).rejects.toMatchObject({ code: "SMART_GOOGLE_IDENTITY_CONFLICT" });
  });
  it("refuses an extracted invitation or arbitrary provider operation", async () => {
    await expect(
      executeSmartGoogleAction(
        "token",
        intent("google-calendar", "create-event", {
          calendarId: "personal",
          summary: "Review",
          start: "2026-10-23T10:00:00Z",
          end: "2026-10-23T11:00:00Z",
          attendees: ["stranger@example.invalid"],
        }),
        1,
      ),
    ).rejects.toBeDefined();
    await expect(
      executeSmartGoogleAction("token", intent("google-tasks", "send-email", {}), 1),
    ).rejects.toMatchObject({ code: "SMART_GOOGLE_OPERATION_REFUSED" });
  });
  it("classifies a provider rate limit without returning its body", async () => {
    await expect(
      executeSmartGoogleAction(
        "token",
        intent("google-sheets", "record-transaction", {
          spreadsheetId: "sheet",
          range: "'Relay Expenses'!A2:G2",
          values: [id, "", "", "1.00", "USD", "ref", "sms"],
        }),
        1,
        () => Promise.resolve(response({ secret: "do not expose" }, 429)),
      ),
    ).rejects.toMatchObject({ code: "SMART_GOOGLE_REFUSED", statusCode: 429 });
  });
});
