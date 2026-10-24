import { smartResourcesSchema } from "@relay/contracts";
import { smartGoogleAccessToken, type SmartAutomationRepository } from "./smart-automations";
import { responseObject } from "./smart-google-provider";

const expenseHeader = [
  "Relay action",
  "Occurred at",
  "Merchant",
  "Amount",
  "Currency",
  "Reference",
  "Source",
];

export async function validateSmartExpenseSheet(
  repository: SmartAutomationRepository,
  userId: string,
  spreadsheetId: string,
): Promise<void> {
  const token = await smartGoogleAccessToken(repository, userId, "google-sheets");
  const response = await repository.fetcher(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent("'Relay Expenses'!A1:G1")}`,
    { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) },
  );
  const body = await responseObject(response);
  if (
    !Array.isArray(body.values) ||
    !Array.isArray(body.values[0]) ||
    JSON.stringify(body.values[0]) !== JSON.stringify(expenseHeader)
  )
    throw new Error("Select a spreadsheet with the Relay Expenses tab and expected header");
}

export async function smartGoogleResources(
  repository: SmartAutomationRepository,
  userId: string,
  service: string,
): Promise<{ id: string; label: string }[]> {
  const token = await smartGoogleAccessToken(repository, userId, service);
  const root =
    service === "google-tasks"
      ? "https://tasks.googleapis.com/tasks/v1/users/@me/lists"
      : service === "google-calendar"
        ? "https://www.googleapis.com/calendar/v3/users/me/calendarList"
        : service === "google-sheets"
          ? "https://www.googleapis.com/drive/v3/files"
          : undefined;
  if (root === undefined) throw new Error("Resource type unavailable");
  const result: { id: string; label: string }[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const url = new URL(root);
    url.searchParams.set("maxResults", "100");
    if (service === "google-sheets") {
      url.searchParams.delete("maxResults");
      url.searchParams.set("pageSize", "100");
      url.searchParams.set(
        "q",
        "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      );
      url.searchParams.set("fields", "files(id,name),nextPageToken");
    }
    if (pageToken !== undefined) url.searchParams.set("pageToken", pageToken);
    const response = await repository.fetcher(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("Resource discovery failed");
    const body = await responseObject(response);
    const items = body.items ?? body.files ?? [];
    if (!Array.isArray(items)) throw new Error("Resource response invalid");
    for (const candidate of items) {
      if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate))
        throw new Error("Resource response invalid");
      const item = candidate as Record<string, unknown>;
      if (service === "google-calendar" && item.accessRole !== "owner") continue;
      const label = item.title ?? item.summary ?? item.name;
      if (typeof item.id !== "string" || typeof label !== "string")
        throw new Error("Resource response invalid");
      result.push({ id: item.id, label });
    }
    if (typeof body.nextPageToken !== "string" || body.nextPageToken.length === 0)
      return smartResourcesSchema.parse({ resources: result }).resources;
    pageToken = body.nextPageToken;
  }
  throw new Error("Resource list exceeds review limit");
}

/** Explicit setup action. A lost create response locks further creates until manually reconciled. */
export async function createSmartExpenseSheet(
  repository: SmartAutomationRepository,
  userId: string,
): Promise<void> {
  const token = await smartGoogleAccessToken(repository, userId, "google-sheets");
  const claimed = await repository.db(
    `smart_google_services?user_id=eq.${userId}&service=eq.google-sheets&setup_started=eq.false`,
    "PATCH",
    { setup_started: true },
  );
  if (!Array.isArray(claimed) || claimed.length !== 1)
    throw new Error("Sheet setup already started; select the existing file instead");
  const response = await repository.fetcher("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      properties: { title: "Relay Expenses" },
      sheets: [{ properties: { title: "Relay Expenses" } }],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Sheet creation failed");
  const sheet = await responseObject(response);
  if (typeof sheet.spreadsheetId !== "string" || sheet.spreadsheetId.length > 512)
    throw new Error("Sheet creation response invalid");
  const header = await repository.fetcher(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheet.spreadsheetId)}/values/${encodeURIComponent("'Relay Expenses'!A1:G1")}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        values: [expenseHeader],
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!header.ok) throw new Error("Sheet header setup failed; file retained");
  await repository.db(
    `smart_google_services?user_id=eq.${userId}&service=eq.google-sheets`,
    "PATCH",
    {
      target_id: sheet.spreadsheetId,
      target_label: "Relay Expenses · Relay Expenses",
      enabled: true,
    },
  );
}
