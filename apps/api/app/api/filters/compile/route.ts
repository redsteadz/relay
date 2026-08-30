import { filterCompileRequestSchema, filterCompileResponseSchema } from "@relay/contracts";

import { authenticateRequest } from "../../../../lib/auth";
import { publishFilterCompilation } from "../../../../lib/pipeline";

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  const parsed = filterCompileRequestSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return Response.json({ error: { code: "invalid_filter_intent" } }, { status: 400 });
  }

  const pipelineResponse = await publishFilterCompilation({
    ...parsed.data,
    userId: auth.userId,
  });
  if (pipelineResponse.status === 409) {
    return Response.json({ error: { code: "filter_revision_conflict" } }, { status: 409 });
  }
  if (!pipelineResponse.ok) {
    return Response.json({ error: { code: "filter_compilation_unavailable" } }, { status: 503 });
  }

  const compilation = filterCompileResponseSchema.safeParse(
    await pipelineResponse.json().catch(() => undefined),
  );
  if (!compilation.success) {
    return Response.json({ error: { code: "filter_compilation_unavailable" } }, { status: 503 });
  }
  return Response.json(compilation.data, { status: 201 });
}
