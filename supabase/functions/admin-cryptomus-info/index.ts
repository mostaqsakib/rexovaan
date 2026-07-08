// Admin-only endpoint: look up a Cryptomus payment by order_id / deposit_id,
// return the full payment info from Cryptomus, and optionally trigger manual
// verification (same logic as the webhook) if the payment is paid but the
// deposit is still pending.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdmin } from "../_shared/require-admin.ts";
import { applyDepositCredit } from "../_shared/apply-deposit-credit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CRYPTOMUS_INFO_URL = "https://api.cryptomus.com/v1/payment/info";

function md5(input: string): string {
  function add32(a: number, b: number) { return (a + b) & 0xffffffff; }
  function cmn(q: number, a: number, b: number, x: number, s: number, t: number) {
    a = add32(add32(a, q), add32(x, t));
    return add32((a << s) | (a >>> (32 - s)), b);
  }
  function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
  function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn(c ^ (b | ~d), a, b, x, s, t); }
  const bytes = Array.from(new TextEncoder().encode(input));
  const bitLenLow = (bytes.length * 8) >>> 0;
  const bitLenHigh = Math.floor((bytes.length * 8) / 0x100000000) >>> 0;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 0; i < 4; i++) bytes.push((bitLenLow >>> (8 * i)) & 0xff);
  for (let i = 0; i < 4; i++) bytes.push((bitLenHigh >>> (8 * i)) & 0xff);
  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (let i = 0; i < bytes.length; i += 64) {
    const x = Array.from({ length: 16 }, (_, j) => bytes[i + j * 4] | (bytes[i + j * 4 + 1] << 8) | (bytes[i + j * 4 + 2] << 16) | (bytes[i + j * 4 + 3] << 24));
    const oa = a, ob = b, oc = c, od = d;
    a = ff(a, b, c, d, x[0], 7, -680876936); d = ff(d, a, b, c, x[1], 12, -389564586); c = ff(c, d, a, b, x[2], 17, 606105819); b = ff(b, c, d, a, x[3], 22, -1044525330);
    a = ff(a, b, c, d, x[4], 7, -176418897); d = ff(d, a, b, c, x[5], 12, 1200080426); c = ff(c, d, a, b, x[6], 17, -1473231341); b = ff(b, c, d, a, x[7], 22, -45705983);
    a = ff(a, b, c, d, x[8], 7, 1770035416); d = ff(d, a, b, c, x[9], 12, -1958414417); c = ff(c, d, a, b, x[10], 17, -42063); b = ff(b, c, d, a, x[11], 22, -1990404162);
    a = ff(a, b, c, d, x[12], 7, 1804603682); d = ff(d, a, b, c, x[13], 12, -40341101); c = ff(c, d, a, b, x[14], 17, -1502002290); b = ff(b, c, d, a, x[15], 22, 1236535329);
    a = gg(a, b, c, d, x[1], 5, -165796510); d = gg(d, a, b, c, x[6], 9, -1069501632); c = gg(c, d, a, b, x[11], 14, 643717713); b = gg(b, c, d, a, x[0], 20, -373897302);
    a = gg(a, b, c, d, x[5], 5, -701558691); d = gg(d, a, b, c, x[10], 9, 38016083); c = gg(c, d, a, b, x[15], 14, -660478335); b = gg(b, c, d, a, x[4], 20, -405537848);
    a = gg(a, b, c, d, x[9], 5, 568446438); d = gg(d, a, b, c, x[14], 9, -1019803690); c = gg(c, d, a, b, x[3], 14, -187363961); b = gg(b, c, d, a, x[8], 20, 1163531501);
    a = gg(a, b, c, d, x[13], 5, -1444681467); d = gg(d, a, b, c, x[2], 9, -51403784); c = gg(c, d, a, b, x[7], 14, 1735328473); b = gg(b, c, d, a, x[12], 20, -1926607734);
    a = hh(a, b, c, d, x[5], 4, -378558); d = hh(d, a, b, c, x[8], 11, -2022574463); c = hh(c, d, a, b, x[11], 16, 1839030562); b = hh(b, c, d, a, x[14], 23, -35309556);
    a = hh(a, b, c, d, x[1], 4, -1530992060); d = hh(d, a, b, c, x[4], 11, 1272893353); c = hh(c, d, a, b, x[7], 16, -155497632); b = hh(b, c, d, a, x[10], 23, -1094730640);
    a = hh(a, b, c, d, x[13], 4, 681279174); d = hh(d, a, b, c, x[0], 11, -358537222); c = hh(c, d, a, b, x[3], 16, -722521979); b = hh(b, c, d, a, x[6], 23, 76029189);
    a = hh(a, b, c, d, x[9], 4, -640364487); d = hh(d, a, b, c, x[12], 11, -421815835); c = hh(c, d, a, b, x[15], 16, 530742520); b = hh(b, c, d, a, x[2], 23, -995338651);
    a = ii(a, b, c, d, x[0], 6, -198630844); d = ii(d, a, b, c, x[7], 10, 1126891415); c = ii(c, d, a, b, x[14], 15, -1416354905); b = ii(b, c, d, a, x[5], 21, -57434055);
    a = ii(a, b, c, d, x[12], 6, 1700485571); d = ii(d, a, b, c, x[3], 10, -1894986606); c = ii(c, d, a, b, x[10], 15, -1051523); b = ii(b, c, d, a, x[1], 21, -2054922799);
    a = ii(a, b, c, d, x[8], 6, 1873313359); d = ii(d, a, b, c, x[15], 10, -30611744); c = ii(c, d, a, b, x[6], 15, -1560198380); b = ii(b, c, d, a, x[13], 21, 1309151649);
    a = ii(a, b, c, d, x[4], 6, -145523070); d = ii(d, a, b, c, x[11], 10, -1120210379); c = ii(c, d, a, b, x[2], 15, 718787259); b = ii(b, c, d, a, x[9], 21, -343485551);
    a = add32(a, oa); b = add32(b, ob); c = add32(c, oc); d = add32(d, od);
  }
  return [a, b, c, d].map((n) => Array.from({ length: 4 }, (_, i) => ((n >>> (i * 8)) & 255).toString(16).padStart(2, "0")).join("")).join("");
}

function sign(bodyJson: string, apiKey: string): string {
  return md5(btoa(bodyJson) + apiKey);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireAdmin(req, corsHeaders);
  if (guard) return guard;

  try {
    const body = await req.json().catch(() => ({}));
    const orderIdInput = String(body?.order_id || "").trim();
    const depositId = String(body?.deposit_id || "").trim();
    const action = String(body?.action || "info");

    if (!orderIdInput && !depositId) {
      return new Response(JSON.stringify({ error: "order_id or deposit_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const MERCHANT = Deno.env.get("CRYPTOMUS_MERCHANT_ID");
    const API_KEY = Deno.env.get("CRYPTOMUS_PAYMENT_API_KEY");
    if (!MERCHANT || !API_KEY) {
      return new Response(JSON.stringify({ error: "Cryptomus not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve deposit
    let depositQuery = supabase.from("bot_deposits").select("*");
    if (depositId) depositQuery = depositQuery.eq("id", depositId);
    else depositQuery = depositQuery.eq("txn_hash", `cryptomus_${orderIdInput}`);
    const { data: deposit } = await depositQuery.maybeSingle();
    const orderId = orderIdInput || (deposit?.txn_hash?.startsWith("cryptomus_") ? deposit.txn_hash.slice("cryptomus_".length) : "");

    if (!orderId) {
      return new Response(JSON.stringify({ error: "Deposit not found and no order_id provided" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Call Cryptomus payment info
    const payload = { order_id: orderId };
    const bodyJson = JSON.stringify(payload);
    const signature = sign(bodyJson, API_KEY);

    const res = await fetch(CRYPTOMUS_INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", merchant: MERCHANT, sign: signature },
      body: bodyJson,
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return new Response(JSON.stringify({ error: "Cryptomus API error", cryptomus: data, status: res.status }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cmResult = data?.result || {};
    const cmStatus = String(cmResult?.status || "");
    const paidUsd = Number(cmResult?.payment_amount_usd ?? cmResult?.merchant_amount ?? cmResult?.amount ?? 0);

    // Info mode — return everything
    if (action !== "verify") {
      return new Response(JSON.stringify({
        ok: true,
        deposit: deposit || null,
        cryptomus: cmResult,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Verify mode — apply if paid and not yet verified
    if (!deposit) {
      return new Response(JSON.stringify({ error: "Deposit not found for verify" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (deposit.status === "verified") {
      return new Response(JSON.stringify({ ok: true, already_verified: true, deposit, cryptomus: cmResult }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!["paid", "paid_over"].includes(cmStatus)) {
      return new Response(JSON.stringify({
        error: `Cannot verify — Cryptomus status is "${cmStatus}"`,
        deposit, cryptomus: cmResult,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!Number.isFinite(paidUsd) || paidUsd <= 0) {
      return new Response(JSON.stringify({ error: "Invalid paid amount from Cryptomus", cryptomus: cmResult }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Delegate to admin-verify-deposit so pending-product delivery path is reused
    const authHeader = req.headers.get("Authorization") || `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`;
    if (deposit.pending_product_id && deposit.pending_quantity) {
      const verifyRes = await fetch(`${Deno.env.get("SUPABASE_URL")!}/functions/v1/admin-verify-deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authHeader },
        body: JSON.stringify({ deposit_id: deposit.id, amount: paidUsd }),
      });
      const verifyBody = await verifyRes.json().catch(() => ({}));
      return new Response(JSON.stringify({
        ok: verifyRes.ok, verified: verifyRes.ok, action: "delivered_via_admin_verify",
        amount_credited: paidUsd, verify_response: verifyBody, cryptomus: cmResult,
      }), {
        status: verifyRes.ok ? 200 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Simple deposit credit
    const { data: updated } = await supabase.from("bot_deposits")
      .update({
        status: "verified", amount: paidUsd,
        verified_at: new Date().toISOString(),
        via: deposit.via || "Cryptomus (manual)",
      })
      .eq("id", deposit.id).neq("status", "verified").select("id").maybeSingle();
    if (!updated) {
      return new Response(JSON.stringify({ ok: true, already_verified: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const applied = await applyDepositCredit(supabase, deposit.customer_id, paidUsd);
    await supabase.from("bot_customers")
      .update({ pending_action: null, updated_at: new Date().toISOString() })
      .eq("id", deposit.customer_id);

    return new Response(JSON.stringify({
      ok: true, verified: true, action: "balance_credited",
      amount_credited: paidUsd, applied, cryptomus: cmResult,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("admin-cryptomus-info error:", e);
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
