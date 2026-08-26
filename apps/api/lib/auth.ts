import { createClient } from "@supabase/supabase-js";

import { relayUserIdSchema } from "@relay/contracts";

type AuthResult = { userId: string; accessToken?: string } | { error: Response };

function unauthorized(code: "invalid_token" | "unauthorized", message: string): AuthResult {
  return { error: Response.json({ error: { code, message } }, { status: 401 }) };
}

export async function authenticateRequest(request: Request): Promise<AuthResult> {
  const developmentUser = request.headers.get("x-relay-development-user");
  if (process.env.NODE_ENV !== "production" && developmentUser !== null) {
    const parsed = relayUserIdSchema.safeParse(developmentUser);
    if (parsed.success) return { userId: parsed.data };
    return {
      error: Response.json(
        { error: { code: "invalid_development_user", message: "Development user must be a UUID" } },
        { status: 401 },
      ),
    };
  }

  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (token === undefined || url === undefined || anonKey === undefined) {
    return unauthorized("unauthorized", "Authentication required");
  }

  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  const userId = relayUserIdSchema.safeParse(data.user?.id);
  if (error !== null || !userId.success)
    return unauthorized("invalid_token", "Authentication failed");

  return { accessToken: token, userId: userId.data };
}
