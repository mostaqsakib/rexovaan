// Shared admin audit-log writer.
// Best-effort: failures are logged but never break the calling function.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function logAdminAction(
  supabase: SupabaseClient,
  req: Request,
  entry: {
    action: string;
    target_table?: string | null;
    target_id?: string | null;
    before?: unknown;
    after?: unknown;
    note?: string | null;
  },
): Promise<void> {
  try {
    let adminUserId: string | null = null;
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (token) {
      const url = Deno.env.get("SUPABASE_URL")!;
      const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      const userClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
      const { data } = await userClient.auth.getUser();
      adminUserId = data?.user?.id ?? null;
    }
    await supabase.from("admin_action_log").insert({
      admin_user_id: adminUserId,
      action: entry.action,
      target_table: entry.target_table ?? null,
      target_id: entry.target_id != null ? String(entry.target_id) : null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      note: entry.note ?? null,
    });
  } catch (e) {
    console.error("[audit-log] failed", e);
  }
}
