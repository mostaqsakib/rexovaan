// Loads a Telegram HTML template from `bot_settings.value` for the given key,
// falls back to `defaults` if not set, and substitutes {placeholder} tokens.
//
// Usage:
//   const text = await renderTemplate(supabase, "notif_deposit_verified", DEFAULT_TEXT, {
//     amount: "10.00", currency: "USDT", new_balance: "42.00", note: "Thanks!"
//   });

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Very small in-memory cache so hot edge-function containers don't hit the DB
// on every invocation. TTL = 30s (short — templates change from admin UI).
const cache = new Map<string, { value: string; expires: number }>();
const TTL_MS = 30_000;

export async function loadTemplate(
  supabase: SupabaseClient,
  key: string,
  fallback: string,
): Promise<string> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.value;

  try {
    const { data } = await supabase
      .from("bot_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    const value = (data?.value as string | null | undefined)?.trim() || fallback;
    cache.set(key, { value, expires: now + TTL_MS });
    return value;
  } catch (_e) {
    return fallback;
  }
}

export function interpolate(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => {
    const v = vars[name];
    return v === null || v === undefined ? "" : String(v);
  });
}

export async function renderTemplate(
  supabase: SupabaseClient,
  key: string,
  fallback: string,
  vars: Record<string, string | number | null | undefined> = {},
): Promise<string> {
  const tpl = await loadTemplate(supabase, key, fallback);
  return interpolate(tpl, vars);
}
