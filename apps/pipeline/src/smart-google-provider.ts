import {
  smartCalendarInputSchema,
  smartSheetInputSchema,
  type ActionIntent,
} from "@relay/contracts";
import { AppError, categoryForHttpStatus } from "@relay/observability";
import { createGoogleTask } from "./google-tasks-provider";
import { readBoundedJson } from "./bounded-json";

export type GoogleFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function providerError(cause: unknown, code: string, statusCode?: number): AppError {
  return new AppError("Google automation request failed", {
    cause,
    code,
    category: statusCode === undefined ? "network" : categoryForHttpStatus(statusCode),
    integration: "google",
    operation: "executeSmartAction",
    statusCode,
  });
}

export async function responseObject(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok)
    throw providerError(
      new Error("Google refused request"),
      "SMART_GOOGLE_REFUSED",
      response.status,
    );
  try {
    const value = await readBoundedJson(response, 65_536, { timeoutMs: 15_000 });
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error("Invalid response shape");
    return value as Record<string, unknown>;
  } catch (error: unknown) {
    throw providerError(error, "SMART_GOOGLE_RESPONSE_INVALID", 502);
  }
}

/** Called only after a durable ledger claim. All URLs and operations are code-owned. */
export async function executeSmartGoogleAction(
  accessToken: string,
  intent: ActionIntent,
  attempt: number,
  fetcher: GoogleFetcher = fetch,
): Promise<string> {
  const headers = { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
  const signal = AbortSignal.timeout(15_000);
  if (intent.provider === "google-tasks" && intent.operation === "create-task") {
    return (await createGoogleTask(accessToken, intent, attempt, fetcher, signal)).taskId;
  }
  if (intent.provider === "google-calendar" && intent.operation === "create-event") {
    const input = smartCalendarInputSchema.parse(intent.input);
    // Calendar IDs use base32hex (0-9, a-v); UUID hex with an r prefix is valid.
    const eventId = `r${intent.id.replaceAll("-", "")}`;
    const root = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`;
    if (attempt > 1) {
      const existing = await fetcher(`${root}/${eventId}`, { headers, signal });
      if (existing.ok) {
        const event = await responseObject(existing);
        const properties = event.extendedProperties as
          { private?: { relayActionId?: unknown } } | undefined;
        if (properties?.private?.relayActionId !== intent.id)
          throw providerError(
            new Error("Event identity conflict"),
            "SMART_GOOGLE_IDENTITY_CONFLICT",
            409,
          );
        return eventId;
      }
      if (existing.status !== 404) await responseObject(existing);
    }
    const created = await fetcher(root, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({
        id: eventId,
        summary: input.summary,
        start: { dateTime: input.start },
        end: { dateTime: input.end },
        extendedProperties: { private: { relayActionId: intent.id } },
      }),
    });
    // No attendees, sharing or sendUpdates: none can be introduced by extraction.
    const event = await responseObject(created);
    if (event.id !== eventId)
      throw providerError(
        new Error("Event identity mismatch"),
        "SMART_GOOGLE_RESPONSE_INVALID",
        502,
      );
    return eventId;
  }
  if (intent.provider === "google-sheets" && intent.operation === "record-transaction") {
    const input = smartSheetInputSchema.parse(intent.input);
    const root = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}/values/${encodeURIComponent(input.range)}`;
    const existing = await responseObject(await fetcher(root, { headers, signal }));
    const rows = existing.values;
    if (Array.isArray(rows) && rows.length > 0 && Array.isArray(rows[0]) && rows[0].length > 0) {
      if (JSON.stringify(rows[0]) === JSON.stringify(input.values))
        return `${input.spreadsheetId}:${input.range}`;
      throw providerError(
        new Error("Destination row changed"),
        "SMART_GOOGLE_IDENTITY_CONFLICT",
        409,
      );
    }
    // Stable allocated row, never append; unknown retries do not move to another row.
    await responseObject(
      await fetcher(`${root}?valueInputOption=RAW`, {
        method: "PUT",
        headers,
        signal,
        body: JSON.stringify({
          range: input.range,
          majorDimension: "ROWS",
          values: [input.values],
        }),
      }),
    );
    return `${input.spreadsheetId}:${input.range}`;
  }
  throw providerError(new Error("Unsupported operation"), "SMART_GOOGLE_OPERATION_REFUSED", 400);
}
