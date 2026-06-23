import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CreateSchema = z.object({ action: z.literal("create"), name: z.string().trim().min(2).max(100), initial_balance: z.number().min(0).max(1_000_000).default(0) });
const AdjustSchema = z.object({ action: z.literal("adjust_balance"), reseller_id: z.string().uuid(), amount: z.number().refine((v) => v !== 0), note: z.string().trim().min(2).max(300) });
const ToggleSchema = z.object({ action: z.literal("toggle"), reseller_id: z.string().uuid(), is_active: z.boolean() });
const RotateSchema = z.object({ action: z.literal("rotate_key"), reseller_id: z.string().uuid() });
const BodySchema = z.discriminatedUnion("action", [CreateSchema, AdjustSchema, ToggleSchema, RotateSchema]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toHex(new Uint8Array(hashBuffer));
}

function generateApiKey() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `rsk_live_${toHex(bytes)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ error: "Server is not configured" }, 500);
    const supabase = createClient(supabaseUrl, serviceKey);

    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("bot_resellers")
        .select("id,name,balance,api_key_prefix,is_active,created_at,updated_at,customer_id")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = data || [];
      const customerIds = Array.from(new Set(rows.map((r: any) => r.customer_id).filter(Boolean)));
      const customersById: Record<string, any> = {};
      if (customerIds.length > 0) {
        const { data: customers, error: custErr } = await supabase
          .from("bot_customers")
          .select("id,balance,username,first_name,chat_id")
          .in("id", customerIds as string[]);
        if (custErr) throw custErr;
        for (const c of customers || []) customersById[c.id] = c;
      }
      const resellers = rows.map((r: any) => {
        const linked = r.customer_id ? customersById[r.customer_id] || null : null;
        const effective_balance = linked ? Number(linked.balance) : Number(r.balance);
        return {
          id: r.id,
          name: r.name,
          balance: effective_balance,
          reseller_internal_balance: Number(r.balance),
          api_key_prefix: r.api_key_prefix,
          is_active: r.is_active,
          created_at: r.created_at,
          updated_at: r.updated_at,
          customer_id: r.customer_id,
          linked_customer: linked
            ? { id: linked.id, balance: Number(linked.balance), username: linked.username, first_name: linked.first_name, chat_id: linked.chat_id }
            : null,
        };
      });
      return json({ resellers });
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400);

    if (parsed.data.action === "create") {
      const apiKey = generateApiKey();
      const apiKeyHash = await sha256Hex(apiKey);
      const apiKeyPrefix = `${apiKey.slice(0, 13)}...${apiKey.slice(-4)}`;

      const { data: reseller, error } = await supabase
        .from("bot_resellers")
        .insert({ name: parsed.data.name, balance: parsed.data.initial_balance, api_key_hash: apiKeyHash, api_key_prefix: apiKeyPrefix })
        .select("id,name,balance,api_key_prefix,is_active,created_at,updated_at")
        .single();
      if (error) throw error;

      if (parsed.data.initial_balance > 0) {
        await supabase.from("bot_reseller_balance_transactions").insert({ reseller_id: reseller.id, type: "admin_credit", amount: parsed.data.initial_balance, balance_after: parsed.data.initial_balance, note: "Initial reseller balance" });
      }

      return json({ reseller, api_key: apiKey });
    }

    if (parsed.data.action === "adjust_balance") {
      const { data: reseller, error: getError } = await supabase
        .from("bot_resellers")
        .select("id,balance,customer_id,name")
        .eq("id", parsed.data.reseller_id)
        .single();
      if (getError || !reseller) return json({ error: "Reseller not found" }, 404);

      // If linked to a customer, the customer balance is the source of truth.
      if (reseller.customer_id) {
        const { data: cust, error: cErr } = await supabase
          .from("bot_customers")
          .select("id,balance")
          .eq("id", reseller.customer_id)
          .single();
        if (cErr || !cust) return json({ error: "Linked customer not found" }, 404);

        const oldBalance = Number(cust.balance);
        const newBalance = oldBalance + parsed.data.amount;
        if (newBalance < 0) return json({ error: "Balance cannot be negative" }, 400);

        const { error: updErr } = await supabase
          .from("bot_customers")
          .update({ balance: newBalance, updated_at: new Date().toISOString() })
          .eq("id", cust.id);
        if (updErr) throw updErr;

        // Mirror to reseller table so admin UI stays in sync
        await supabase.from("bot_resellers").update({ balance: newBalance, updated_at: new Date().toISOString() }).eq("id", reseller.id);

        // Customer-side audit
        await supabase.from("bot_balance_adjustments").insert({
          customer_id: cust.id,
          old_balance: oldBalance,
          new_balance: newBalance,
          diff: parsed.data.amount,
          note: `[reseller:${reseller.name}] ${parsed.data.note}`,
          source: "admin_reseller_adjust",
        });

        // Reseller-side audit
        await supabase.from("bot_reseller_balance_transactions").insert({
          reseller_id: reseller.id,
          type: parsed.data.amount > 0 ? "admin_credit" : "admin_debit",
          amount: parsed.data.amount,
          balance_after: newBalance,
          note: parsed.data.note,
        });

        return json({ success: true, balance: newBalance });
      }

      // Unlinked reseller: legacy path (rare)
      const newBalance = Number(reseller.balance) + parsed.data.amount;
      if (newBalance < 0) return json({ error: "Balance cannot be negative" }, 400);
      const { error: updateError } = await supabase.from("bot_resellers").update({ balance: newBalance, updated_at: new Date().toISOString() }).eq("id", parsed.data.reseller_id);
      if (updateError) throw updateError;
      await supabase.from("bot_reseller_balance_transactions").insert({ reseller_id: parsed.data.reseller_id, type: parsed.data.amount > 0 ? "admin_credit" : "admin_debit", amount: parsed.data.amount, balance_after: newBalance, note: parsed.data.note });
      return json({ success: true, balance: newBalance });
    }

    if (parsed.data.action === "toggle") {
      const { error } = await supabase.from("bot_resellers").update({ is_active: parsed.data.is_active }).eq("id", parsed.data.reseller_id);
      if (error) throw error;
      return json({ success: true });
    }

    if (parsed.data.action === "rotate_key") {
      const apiKey = generateApiKey();
      const apiKeyHash = await sha256Hex(apiKey);
      const apiKeyPrefix = `${apiKey.slice(0, 13)}...${apiKey.slice(-4)}`;
      const { error } = await supabase.from("bot_resellers").update({ api_key_hash: apiKeyHash, api_key_prefix: apiKeyPrefix }).eq("id", parsed.data.reseller_id);
      if (error) throw error;
      return json({ success: true, api_key: apiKey, api_key_prefix: apiKeyPrefix });
    }

    return json({ error: "Unsupported action" }, 400);
  } catch (error) {
    console.error("admin_resellers_error", error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
