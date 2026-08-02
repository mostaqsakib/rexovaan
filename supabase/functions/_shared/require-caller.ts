// Shared caller-authorization helpers for edge functions that must not be
// invocable by anonymous clients holding only the public anon key.
//
// Two helpers:
//   requireServiceRoleOrAdmin(req) — for privileged operations (sweeps, etc).
//     Accepts either the service-role JWT/key, or an authenticated user who has
//     the 'admin' role in public.user_roles.
//   requireCustomerAuth(req)       — for per-customer operations. Accepts the
//     service-role JWT/key (for internal/bot callers), or an authenticated user;
//     when a user token is presented, returns the resolved auth_user_id so the
//     caller can enforce ownership on the target customer_id.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timingSafeEqual } from "./timing-safe.ts";

type Ok<T> = { ok: true } & T;
type Err = { ok: false; status: number; error: string };

function bearer(req: Request): string | null {
  const h = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return null;
  return h.slice(7).trim();
}

async function isServiceRoleToken(token: string): Promise<boolean> {
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  // Only an exact match with the real service-role secret, or a JWT whose
  // signature is verified by Supabase AND whose role claim is service_role.
  // NEVER trust an unverified/decoded payload — a forged token would grant
  // full privileged access to sweeps and other admin-only functions.
  if (svc && timingSafeEqual(token, svc)) return true;

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return false;
  try {
    const client = createClient(url, anon);
    const { data, error } = await client.auth.getClaims(token);
    if (error || !data?.claims) return false;
    return (data.claims as Record<string, unknown>)?.role === "service_role";
  } catch {
    return false;
  }
}


export async function requireServiceRoleOrAdmin(
  req: Request,
): Promise<Ok<{ mode: "service" | "admin"; authUserId?: string }> | Err> {
  const token = bearer(req);
  if (!token) return { ok: false, status: 401, error: "Missing bearer token" };

  if (await isServiceRoleToken(token)) return { ok: true, mode: "service" };

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !svc) return { ok: false, status: 500, error: "Server misconfigured" };

  const userClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return { ok: false, status: 401, error: "Unauthorized" };

  const admin = createClient(url, svc);
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userData.user.id, _role: "admin" });
  if (!isAdmin) return { ok: false, status: 403, error: "Admin role required" };

  return { ok: true, mode: "admin", authUserId: userData.user.id };
}

export async function requireCustomerAuth(
  req: Request,
): Promise<Ok<{ mode: "service" | "user"; authUserId?: string; email?: string }> | Err> {
  const token = bearer(req);
  if (!token) return { ok: false, status: 401, error: "Missing bearer token" };

  if (await isServiceRoleToken(token)) return { ok: true, mode: "service" };

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return { ok: false, status: 500, error: "Server misconfigured" };

  const userClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return { ok: false, status: 401, error: "Unauthorized" };

  return { ok: true, mode: "user", authUserId: userData.user.id, email: userData.user.email ?? undefined };
}
