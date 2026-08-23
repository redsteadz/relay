import type { ActionIntent } from "@relay/contracts";

export type ProviderResult = {
  providerReference?: string;
  status: "delivered" | "not-configured";
};

function scalar(value: unknown, fallback = ""): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}

function assertPublicHttpsUrl(value: string): URL {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const ipv4 = hostname.split(".").map(Number);
  const privateIpv4 =
    ipv4.length === 4 &&
    ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    (ipv4[0] === 0 ||
      ipv4[0] === 10 ||
      ipv4[0] === 127 ||
      ((ipv4[0] ?? 0) >= 224 && (ipv4[0] ?? 0) <= 255) ||
      (ipv4[0] === 100 && (ipv4[1] ?? 0) >= 64 && (ipv4[1] ?? 0) <= 127) ||
      (ipv4[0] === 169 && ipv4[1] === 254) ||
      (ipv4[0] === 172 && (ipv4[1] ?? 0) >= 16 && (ipv4[1] ?? 0) <= 31) ||
      (ipv4[0] === 192 && (ipv4[1] === 0 || ipv4[1] === 168)) ||
      (ipv4[0] === 198 && ((ipv4[1] ?? 0) === 18 || (ipv4[1] ?? 0) === 19 || ipv4[1] === 51)) ||
      (ipv4[0] === 203 && ipv4[1] === 0));
  const localName =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.includes(":");

  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    privateIpv4 ||
    localName
  ) {
    throw new Error("Nextcloud URL must be a public HTTPS origin without embedded credentials");
  }
  return url;
}

function requireBudgetInput(data: ActionIntent["input"]) {
  const accountId = scalar(data.accountId);
  const amount = typeof data.amount === "string" ? data.amount : "";
  const date = typeof data.date === "string" ? data.date : "";
  const merchant = typeof data.merchant === "string" ? data.merchant.trim() : "";
  const type = data.type === "credit" ? "credit" : data.type === "debit" ? "debit" : "";
  if (!/^[1-9]\d*$/.test(accountId)) throw new Error("Budget accountId must be a positive integer");
  if (!/^(?:0|[1-9]\d*)\.\d{2}$/.test(amount) || BigInt(amount.replace(".", "")) <= 0n) {
    throw new Error("Budget amount must be a positive decimal string with two fractional digits");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Budget date must use YYYY-MM-DD");
  if (merchant.length === 0) throw new Error("Budget merchant is required");
  if (type === "") throw new Error("Budget type must be debit or credit");
  return { accountId, amount, date, merchant, type };
}

export function nextcloudBudgetTransactionRequest(
  baseUrl: string,
  username: string,
  appPassword: string,
  intent: ActionIntent,
): Request {
  const data = intent.input;
  const input = requireBudgetInput(data);
  const form = new URLSearchParams({
    account_id: input.accountId,
    amount: input.amount,
    date: input.date,
    idempotency_key: intent.id,
    merchant: input.merchant,
    type: input.type,
  });

  if (typeof data.categoryId === "string" || typeof data.categoryId === "number") {
    form.set("category_id", String(data.categoryId));
  }

  const origin = assertPublicHttpsUrl(baseUrl).origin;
  return new Request(`${origin}/ocs/v2.php/apps/budget/api/v1/transactions`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Basic ${btoa(`${username}:${appPassword}`)}`,
      "content-type": "application/x-www-form-urlencoded",
      "ocs-apirequest": "true",
    },
    body: form,
  });
}

export function dispatchProvider(intent: ActionIntent): ProviderResult {
  // Credential retrieval and live provider calls land in provider-specific issues.
  // Keeping this result explicit prevents a scaffold from pretending side effects occurred.
  return { status: "not-configured", providerReference: `${intent.provider}:${intent.id}` };
}
