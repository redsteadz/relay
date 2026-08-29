import {
  filterCompileInternalRequestSchema,
  filterCompilerCategorySchema,
  filterCompileResponseSchema,
  type FilterCompileInternalRequest,
  type FilterCompileResponse,
} from "@relay/contracts";
import { compileFilterPlan } from "@relay/domain";

import { supabaseBackendHeaders, type PersistenceConfiguration } from "./configuration";

export class FilterCompilationError extends Error {
  constructor(
    readonly reason:
      | "filter_compilation_response_invalid"
      | "filter_compilation_unavailable"
      | "filter_revision_conflict",
  ) {
    super("Filter compilation failed");
  }
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function revisionRecord(value: unknown): Record<string, unknown> | undefined {
  const candidate: unknown = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "object" && candidate !== null
    ? (candidate as Record<string, unknown>)
    : undefined;
}

export async function compileAndPersistFilter(
  configuration: PersistenceConfiguration,
  candidate: FilterCompileInternalRequest,
  fetcher: Fetcher = fetch,
): Promise<FilterCompileResponse> {
  const request = filterCompileInternalRequestSchema.safeParse(candidate);
  if (!request.success || configuration.supabase === undefined) {
    throw new FilterCompilationError("filter_compilation_unavailable");
  }

  const headers = supabaseBackendHeaders(configuration.supabase.serviceRoleKey);
  const categoriesUrl = new URL("/rest/v1/categories", configuration.supabase.url);
  categoriesUrl.searchParams.set("select", "slug,name");
  categoriesUrl.searchParams.set("user_id", `eq.${request.data.userId}`);
  categoriesUrl.searchParams.set("archived_at", "is.null");
  categoriesUrl.searchParams.set("order", "sort_order.asc,id.asc");
  const categoriesResponse = await fetcher(categoriesUrl, { headers });
  if (!categoriesResponse.ok) {
    throw new FilterCompilationError("filter_compilation_unavailable");
  }
  const categories = filterCompilerCategorySchema
    .array()
    .safeParse(await categoriesResponse.json().catch(() => undefined));
  if (!categories.success) {
    throw new FilterCompilationError("filter_compilation_response_invalid");
  }

  const compilation = compileFilterPlan(request.data.intent, categories.data);
  const persistenceResponse = await fetcher(
    `${configuration.supabase.url}/rest/v1/rpc/create_filter_rule_revision`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        p_user_id: request.data.userId,
        p_name: request.data.name,
        p_intent: request.data.intent,
        p_plan: compilation.plan,
        p_supported_predicates: compilation.supportedPredicates,
        p_unsupported_clauses: compilation.unsupportedClauses,
        p_enabled: request.data.enabled ?? true,
        p_series_id: request.data.seriesId ?? null,
        p_expected_version: request.data.expectedVersion ?? null,
      }),
    },
  );
  if (!persistenceResponse.ok) {
    throw new FilterCompilationError(
      persistenceResponse.status === 409
        ? "filter_revision_conflict"
        : "filter_compilation_unavailable",
    );
  }

  const row = revisionRecord(await persistenceResponse.json().catch(() => undefined));
  const response = filterCompileResponseSchema.safeParse({
    rule: {
      id: row?.id,
      userId: row?.user_id,
      seriesId: row?.series_id,
      version: row?.version,
      name: row?.name,
      intent: row?.intent,
      plan: row?.plan,
      enabled: row?.enabled,
      createdAt: row?.created_at,
    },
    supportedPredicates: row?.supported_predicates,
    unsupportedClauses: row?.unsupported_clauses,
  });
  if (!response.success) {
    throw new FilterCompilationError("filter_compilation_response_invalid");
  }
  return response.data;
}
