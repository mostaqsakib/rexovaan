import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEW_SUPABASE_URL ?? "https://eygkdpfjrjwwbiackfpr.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = process.env.NEW_SUPABASE_ANON_KEY;

if (!SUPABASE_PUBLISHABLE_KEY) {
  throw new Error("NEW_SUPABASE_ANON_KEY is not set");
}

/**
 * Validates the request bearer token and injects an authenticated supabase client.
 * Use on any createServerFn that should act as the signed-in user (RLS applies).
 */
export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const authHeader = getRequestHeader("authorization");
    if (!authHeader) {
      throw new Response("Unauthorized: No authorization header provided", {
        status: 401,
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      throw new Response("Unauthorized: Invalid token", { status: 401 });
    }

    return next({
      context: {
        supabase,
        userId: data.user.id,
        claims: data.user,
      },
    });
  },
);
