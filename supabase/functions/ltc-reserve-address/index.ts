// LTC reserve endpoint — mirrors bep20-reserve-address flow.
// Body: { customer_id: uuid, expected_amount: number (USD) }
// Returns: { address, amount_ltc, expected_amount_usd, expires_at, deposit_id, qr }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { deriveLtcAddress, detectScriptType, type ScriptType } from "../_ltc/derive.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const RESERVATION_MINUTES = 30;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

async function fetchLtcUsd(): Promise<number> {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=usd");
    const j = await r.json();
    const p = Number(j?.litecoin?.usd);
    if (p > 0) return p;
  } catch (_) { /* fall through */ }
  const r2 = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=LTCUSDT");
  const j2 = await r2.json();
  return Number(j2.price);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const customer_id: string | undefined = body.customer_id;
    const expected_amount_usd = Number(body.expected_amount ?? body.expected_usd);
    const pending_product_id: string | null = body.pending_product_id || null;
    const pending_quantity: number | null = body.pending_quantity || null;
    if (!customer_id || !(expected_amount_usd > 0)) {
      return json({ error: "customer_id and positive expected_amount required" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Reuse existing pending reservation for same customer+amount (within 5 min old)
    const { data: existing } = await admin
      .from("ltc_reserved_addresses")
      .select("*")
      .eq("customer_telegram_id", null)
      .eq("status", "pending")
      .eq("expected_amount_usd", expected_amount_usd)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    // (skip reuse — LTC price moves; always create fresh)

    const { data: settings } = await admin.from("ltc_settings").select("*").eq("singleton", true).single();
    const xpub = (settings?.xpub as string | null) || Deno.env.get("LTC_XPUB");
    if (!xpub) return json({ error: "LTC_XPUB not configured" }, 500);
    const scriptType: ScriptType = (settings?.script_type as ScriptType) || detectScriptType(xpub);

    const { data: idxRow, error: idxErr } = await admin.rpc("ltc_next_index");
    if (idxErr) return json({ error: "index alloc failed: " + idxErr.message }, 500);
    const index = Number(idxRow);
    const address = deriveLtcAddress(xpub, index, scriptType);

    const rate = await fetchLtcUsd();
    const amount_ltc = Number((expected_amount_usd / rate).toFixed(8));
    const expires_at = new Date(Date.now() + RESERVATION_MINUTES * 60 * 1000).toISOString();

    // Create pending deposit
    const { data: dep, error: depErr } = await admin
      .from("bot_deposits")
      .insert({
        customer_id,
        amount: expected_amount_usd,
        payment_method: "LTC",
        status: "pending",
        ltc_address: address,
        pending_product_id,
        pending_quantity,
      } as any)
      .select("id")
      .single();
    if (depErr) return json({ error: "deposit create failed: " + depErr.message }, 500);

    const { error: resErr } = await admin.from("ltc_reserved_addresses").insert({
      deposit_id: dep.id,
      address,
      derivation_index: index,
      expected_amount_ltc: amount_ltc,
      expected_amount_usd,
      ltc_usd_rate: rate,
      expires_at,
    });
    if (resErr) return json({ error: "reserve failed: " + resErr.message }, 500);

    return json({
      ok: true,
      address,
      amount_ltc,
      expected_amount_usd,
      rate,
      expires_at,
      qr: `litecoin:${address}?amount=${amount_ltc}`,
      deposit_id: dep.id,
    });
  } catch (err) {
    console.error("ltc-reserve error:", err);
    return json({ error: String((err as Error).message ?? err) }, 500);
  }
});
