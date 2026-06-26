// Shared admin-auth guard for privileged edge functions.
// Returns null on success, or a Response (401/403/500) to return immediately.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function requireAdmin(
  req: Request,
  corsHeaders: Record<string, string>
): Promise<Response | null> {
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return json({ error: "Server is not configured" }, 500);

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return json({ error: "Unauthorized" }, 401);

  // Internal trusted calls (bot, edge-to-edge) use service_role — allow bypass.
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceRoleKey && token === serviceRoleKey) return null;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

  const { data: isAdmin, error: roleErr } = await userClient.rpc("is_admin");
  if (roleErr || isAdmin !== true) return json({ error: "Forbidden: admin only" }, 403);

  return null;
}
