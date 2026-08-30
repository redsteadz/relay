export type RelayApiFailure =
  "confirmation-required" | "not-configured" | "not-found" | "unauthorized" | "unavailable";

export class RelayApiError extends Error {
  constructor(readonly reason: RelayApiFailure) {
    super("Relay API request failed");
  }
}

function failureFor(status: number, code: string | undefined): RelayApiFailure {
  if (status === 401) return "unauthorized";
  if (status === 404) return "not-found";
  if (code === "confirmation_required") return "confirmation-required";
  if (code?.endsWith("_not_configured") === true) return "not-configured";
  return "unavailable";
}

function errorCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("error" in value)) return undefined;
  const error = value.error;
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function configuredBaseUrl(): string {
  const candidate = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (candidate === undefined || candidate.length === 0) {
    throw new RelayApiError("not-configured");
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Unsupported Relay API protocol");
    }
  } catch {
    throw new RelayApiError("not-configured");
  }

  return candidate.replace(/\/+$/u, "");
}

export async function requestRelayApi(
  accessToken: string,
  path: string,
  init: { body?: unknown; method?: "DELETE" | "GET" } = {},
): Promise<unknown> {
  const baseUrl = configuredBaseUrl();
  const hasBody = init.body !== undefined;
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(hasBody ? { "content-type": "application/json" } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch {
    throw new RelayApiError("unavailable");
  }

  const value: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw new RelayApiError(failureFor(response.status, errorCode(value)));
  if (value === undefined) throw new RelayApiError("unavailable");
  return value;
}
