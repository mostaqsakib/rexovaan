import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { deriveLtcAddress, detectScriptType, type ScriptType } from "../_ltc/derive.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESERVATION_MINUTES = 30;

async function fetchLtcUsd(): Promise<number> {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=usd");
    const j = await r.json();
    const p = Number(j?.litecoin?.usd);
    if (p > 0) return p;
  } catch (_) { /* fall through */ }
  // Fallback: Binance
  const r2 = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=LTCUSDT");
  const j2 = await r2.json();
  return Number(j2.price);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const orderId: string | undefined = body.order_id;
    const depositId: string | undefined = body.deposit_id;
    const customerTelegramId: number | null = body.customer_telegram_id ?? null;
    const expectedUsd = Number(body.expected_usd);
    if (!(expectedUsd > 0)) throw new Error("expected_usd required");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Settings + xpub (env preferred; DB override optional)
    const { data: settings } = await admin.from("ltc_settings").select("*").eq("singleton", true).single();
    const xpub = (settings?.xpub as string | null) || Deno.env.get("LTC_XPUB");
    if (!xpub) throw new Error("LTC_XPUB not configured");
    const scriptType: ScriptType = (settings?.script_type as ScriptType) || detectScriptType(xpub);

    // Atomic index bump
    const { data: idxRow, error: idxErr } = await admin.rpc("ltc_next_index");
    if (idxErr) throw idxErr;
    const index = Number(idxRow);
    const address = deriveLtcAddress(xpub, index, scriptType);

    const rate = await fetchLtcUsd();
    const amountLtc = Number((expectedUsd / rate).toFixed(8));
    const expiresAt = new Date(Date.now() + RESERVATION_MINUTES * 60 * 1000).toISOString();

    const { data: inserted, error: insErr } = await admin
      .from("ltc_reserved_addresses")
      .insert({
        order_id: orderId ?? null,
        deposit_id: depositId ?? null,
        customer_telegram_id: customerTelegramId,
        address,
        derivation_index: index,
        expected_amount_ltc: amountLtc,
        expected_amount_usd: expectedUsd,
        ltc_usd_rate: rate,
        expires_at: expiresAt,
      })
      .select()
      .single();
    if (insErr) throw insErr;

    return new Response(
      JSON.stringify({
        ok: true,
        address,
        amount_ltc: amountLtc,
        amount_usd: expectedUsd,
        rate,
        expires_at: expiresAt,
        qr: `litecoin:${address}?amount=${amountLtc}`,
        reservation_id: inserted.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (err) {
    console.error("ltc-reserve error:", err);
    return new Response(JSON.stringify({ ok: false, error: String((err as Error).message ?? err) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
