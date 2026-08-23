import { createClient } from "@supabase/supabase-js";

type AuthResult = { userId: string } | { error: Response };

export async function authenticateRequest(request: Request): Promise<AuthResult> {
  const developmentUser = request.headers.get("x-relay-development-user");
  if (process.env.NODE_ENV !== "production" && developmentUser !== null) {
    return { userId: developmentUser };
  }

  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (token === undefined || url === undefined || anonKey === undefined) {
    return {
      error: Response.json(
        { error: { code: "unauthorized", message: "Authentication required" } },
        { status: 401 },
      ),
    };
  }

  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error !== null || data.user === null) {
    return {
      error: Response.json(
        { error: { code: "invalid_token", message: "Authentication failed" } },
        { status: 401 },
      ),
    };
  }

  return { userId: data.user.id };
}
