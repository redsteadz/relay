type PostgresError = { code?: unknown };

async function postgresErrorCode(response: Response): Promise<string | undefined> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const code = (value as PostgresError).code;
  return typeof code === "string" ? code : undefined;
}

export async function classifySourcePersistenceResponse(
  response: Response,
): Promise<"duplicate" | "stored"> {
  if (response.ok) return "stored";
  if (response.status === 409 && (await postgresErrorCode(response)) === "23505") {
    return "duplicate";
  }
  throw new Error(`Source persistence failed with ${response.status.toString()}`);
}
