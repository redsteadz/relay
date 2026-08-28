import type { FilterExpression, FilterPlan, IngressEnvelope } from "@relay/contracts";

export type FilterDecision = "match" | "no-match" | "undecided";

function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function readField(item: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (typeof current !== "object" || current === null || !(segment in current)) {
      return undefined;
    }

    return (current as Record<string, unknown>)[segment];
  }, item);
}

function evaluateExpression(expression: FilterExpression, item: Record<string, unknown>): boolean {
  if ("all" in expression) {
    return expression.all.every((child) => evaluateExpression(child, item));
  }

  if ("any" in expression) {
    return expression.any.some((child) => evaluateExpression(child, item));
  }

  if ("not" in expression) {
    return !evaluateExpression(expression.not, item);
  }

  const actual = readField(item, expression.field);
  if (expression.operator === "exists") {
    return actual !== undefined && actual !== null && actual !== "";
  }

  if (typeof actual !== "string") {
    return false;
  }

  const normalizedActual = normalizeText(actual);
  if (expression.operator === "in") {
    return (
      Array.isArray(expression.value) &&
      expression.value.some((value) => normalizeText(value) === normalizedActual)
    );
  }

  if (typeof expression.value !== "string") {
    return false;
  }

  const normalizedExpected = normalizeText(expression.value);
  switch (expression.operator) {
    case "equals":
      return normalizedActual === normalizedExpected;
    case "contains":
      return normalizedActual.includes(normalizedExpected);
    case "starts-with":
      return normalizedActual.startsWith(normalizedExpected);
    default:
      return false;
  }
}

export function evaluateFilter(plan: FilterPlan, item: Record<string, unknown>): FilterDecision {
  if (plan.deterministic !== undefined && !evaluateExpression(plan.deterministic, item)) {
    return "no-match";
  }

  if (plan.semantic !== undefined) {
    return "undecided";
  }

  return "match";
}

export function sourceIdentity(item: IngressEnvelope): string {
  return JSON.stringify([item.source.kind, item.source.accountId ?? null, item.source.externalId]);
}

export async function contentFingerprint(item: IngressEnvelope): Promise<string> {
  const canonical = [
    item.source.kind,
    item.source.applicationId ?? "",
    normalizeText(item.sender ?? ""),
    normalizeText(item.subject ?? ""),
    normalizeText(item.body ?? ""),
  ].join("\u001f");
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
