import { filterCompileRequestSchema, filterCompileResponseSchema } from "@relay/contracts";

import { authenticateRequest } from "../../../../lib/auth";
import { apiRequestId, loggedErrorResponse } from "../../../../lib/observability";
import { publishFilterCompilation } from "../../../../lib/pipeline";

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  const parsed = filterCompileRequestSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return Response.json({ error: { code: "invalid_filter_intent" } }, { status: 400 });
  }

  const pipelineResponse = await publishFilterCompilation(
    {
      ...parsed.data,
      userId: auth.userId,
    },
    apiRequestId(request),
  );
  if (pipelineResponse.status === 409) {
    return Response.json({ error: { code: "filter_revision_conflict" } }, { status: 409 });
  }
  if (!pipelineResponse.ok) {
    return Response.json({ error: { code: "filter_compilation_unavailable" } }, { status: 503 });
  }

  let responseValue: unknown;
  try {
    responseValue = await pipelineResponse.json();
  } catch (error: unknown) {
    return loggedErrorResponse(
      request,
      error,
      {
        category: "malformed-response",
        code: "FILTER_COMPILATION_RESPONSE_INVALID",
        event: "integration.pipeline_response_invalid",
        integration: "relay-pipeline",
        operation: "publishFilterCompilation",
        statusCode: pipelineResponse.status,
      },
      Response.json({ error: { code: "filter_compilation_unavailable" } }, { status: 503 }),
    );
  }
  const compilation = filterCompileResponseSchema.safeParse(responseValue);
  if (!compilation.success) {
    return loggedErrorResponse(
      request,
      compilation.error,
      {
        category: "malformed-response",
        code: "FILTER_COMPILATION_RESPONSE_INVALID",
        event: "integration.pipeline_response_invalid",
        integration: "relay-pipeline",
        operation: "publishFilterCompilation",
        statusCode: pipelineResponse.status,
      },
      Response.json({ error: { code: "filter_compilation_unavailable" } }, { status: 503 }),
    );
  }
  return Response.json(compilation.data, { status: 201 });
}
