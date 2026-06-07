import { createClient } from "@supabase/supabase-js";

// Server-only admin client. BYPASSES RLS. Never import from client code.
const SUPABASE_URL =
  process.env.NEW_SUPABASE_URL ?? "https://eygkdpfjrjwwbiackfpr.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.NEW_SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("NEW_SUPABASE_SERVICE_ROLE_KEY is not set");
}

export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
