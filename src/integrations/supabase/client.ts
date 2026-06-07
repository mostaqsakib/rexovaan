import { createClient } from "@supabase/supabase-js";

// Public values — safe to ship in the client bundle.
const SUPABASE_URL = "https://eygkdpfjrjwwbiackfpr.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5Z2tkcGZqcmp3d2JpYWNrZnByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1NjkyMzEsImV4cCI6MjA5NjE0NTIzMX0.KQQkvoNmrXROOEHzSsePcyvpDEmbrueNEmtnvJlZ-dU";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
  },
});

export const SUPABASE_PUBLIC_URL = SUPABASE_URL;
export const SUPABASE_PUBLIC_KEY = SUPABASE_PUBLISHABLE_KEY;
