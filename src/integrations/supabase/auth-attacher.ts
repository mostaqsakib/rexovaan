import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "./client";

/**
 * Global function middleware that attaches the current user's bearer token
 * to every serverFn RPC call. Pair with requireSupabaseAuth on the server.
 */
export const attachSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) {
        return next({ headers: { Authorization: `Bearer ${token}` } });
      }
    } catch {
      // ignore — server middleware will reject if auth is required
    }
    return next();
  },
);
