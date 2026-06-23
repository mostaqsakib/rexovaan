// Called by the Telegram bot when a user runs /apikey (or similar) commands.
// Authentication: Authorization: Bearer <BOT_TOKEN>
// The bot identifies the user by their real Telegram chat_id.
//
// Misuse prevention:
//  - Only the bot can call (shared BOT_TOKEN secret)
//  - Customer must already be bound via Telegram (chat_id > 0)
//  - Reseller is ALWAYS linked to customer_id => balance pulled from bot_customers
//    (so they can only spend what they actually have; no phantom balance)
//  - One reseller per customer (no spam keys)
//  - Rotation limited to 5/hour per customer
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";
import { timingSafeEqual } from "../_shared/timing-safe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BodySchema = z.object({
  action: z.enum(["get", "create", "rotate"]),
  chat_id: z.number().int(),
  username: z.string().max(64).optional().nullable(),
  first_name: z.string().max(128).optional().nullable(),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toHex(new Uint8Array(buf));
}

function generateApiKey() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `rsk_live_${toHex(bytes)}`;
}

function prefixOf(apiKey: string) {
  return `${apiKey.slice(0, 13)}...${apiKey.slice(-4)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // --- AUTH: only the Telegram bot can call ---
    const botToken = Deno.env.get("BOT_TOKEN");
    if (!botToken) return json({ error: "Bot token missing" }, 500);
    const auth = req.headers.get("Authorization") || "";
    const provided = auth.replace(/^Bearer\s+/i, "");
    if (!timingSafeEqual(provided, botToken)) return json({ error: "unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ error: "Server is not configured" }, 500);
    const supabase = createClient(supabaseUrl, serviceKey);

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400);
    const { action, chat_id, username, first_name } = parsed.data;

    // chat_id must be a REAL Telegram chat_id (positive). Web-only synthetic
    // accounts use negative chat_ids; those cannot generate keys.
    if (chat_id <= 0) return json({ error: "Telegram account required" }, 400);

    // Customer must exist and be Telegram-bound
    const { data: customer, error: custErr } = await supabase
      .from("bot_customers")
      .select("id, chat_id, is_banned, balance, first_name, username")
      .eq("chat_id", chat_id)
      .maybeSingle();
    if (custErr) return json({ error: custErr.message }, 500);
    if (!customer) return json({ error: "Customer not found. Please /start the bot first." }, 404);
    if (customer.is_banned) return json({ error: "Account is banned" }, 403);

    // Existing reseller for this customer (if any)
    const { data: existing, error: exErr } = await supabase
      .from("bot_resellers")
      .select("id, name, api_key_prefix, is_active, created_at, updated_at, balance")
      .eq("customer_id", customer.id)
      .maybeSingle();
    if (exErr) return json({ error: exErr.message }, 500);

    if (action === "get") {
      if (!existing) return json({ exists: false, customer_balance: Number(customer.balance) });
      return json({
        exists: true,
        reseller: {
          id: existing.id,
          name: existing.name,
          api_key_prefix: existing.api_key_prefix,
          is_active: existing.is_active,
          created_at: existing.created_at,
        },
        customer_balance: Number(customer.balance),
      });
    }

    if (action === "create") {
      if (existing) {
        return json({
          error: "API key already exists. Use rotate to generate a new one.",
          reseller: { id: existing.id, api_key_prefix: existing.api_key_prefix, is_active: existing.is_active },
        }, 409);
      }
      const apiKey = generateApiKey();
      const apiKeyHash = await sha256Hex(apiKey);
      const apiKeyPrefix = prefixOf(apiKey);
      const displayName = username ? `@${username.replace(/^@/, "")}` : (first_name || customer.first_name || `tg_${chat_id}`);

      const { data: reseller, error: insErr } = await supabase
        .from("bot_resellers")
        .insert({
          name: displayName,
          customer_id: customer.id,
          balance: 0,                 // mirror only; real balance lives on bot_customers
          is_active: true,
          api_key_hash: apiKeyHash,
          api_key_prefix: apiKeyPrefix,
        })
        .select("id, name, api_key_prefix, is_active, created_at")
        .single();
      if (insErr) return json({ error: insErr.message }, 500);

      await supabase.from("bot_reseller_balance_transactions").insert({
        reseller_id: reseller.id,
        type: "self_create",
        amount: 0,
        balance_after: 0,
        note: "Self-service: API key created via Telegram bot",
      });

      return json({ reseller, api_key: apiKey, customer_balance: Number(customer.balance) });
    }

    if (action === "rotate") {
      if (!existing) return json({ error: "No API key exists. Use create first." }, 404);

      // Rate limit: max 5 rotations per hour
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count: rotateCount } = await supabase
        .from("bot_reseller_balance_transactions")
        .select("id", { count: "exact", head: true })
        .eq("reseller_id", existing.id)
        .eq("type", "self_rotate")
        .gte("created_at", since);
      if ((rotateCount ?? 0) >= 5) {
        return json({ error: "Too many rotations. Try again later." }, 429);
      }

      const apiKey = generateApiKey();
      const apiKeyHash = await sha256Hex(apiKey);
      const apiKeyPrefix = prefixOf(apiKey);

      const { error: updErr } = await supabase
        .from("bot_resellers")
        .update({ api_key_hash: apiKeyHash, api_key_prefix: apiKeyPrefix, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (updErr) return json({ error: updErr.message }, 500);

      await supabase.from("bot_reseller_balance_transactions").insert({
        reseller_id: existing.id,
        type: "self_rotate",
        amount: 0,
        balance_after: Number(customer.balance),
        note: "Self-service: API key rotated via Telegram bot",
      });

      return json({ reseller: { id: existing.id, api_key_prefix: apiKeyPrefix }, api_key: apiKey });
    }

    return json({ error: "Unsupported action" }, 400);
  } catch (e) {
    console.error("bot-reseller-api-manage_error", e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
