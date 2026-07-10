// Returns LTC master wallet balance + USD estimate and approximate sweeps remaining.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const MIN_LTC = 0.001;      // reserve for fees
const SWEEP_FEE_LTC = 0.0001; // approx per sweep

async function fetchLtcPrice(): Promise<number | null> {
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=usd",
      { signal: AbortSignal.timeout(5000) },
    );
    if (!r.ok) return null;
    const d = await r.json();
    return d?.litecoin?.usd ?? null;
  } catch { return null; }
}

async function fetchLtcBalance(address: string): Promise<number> {
  const r = await fetch(`https://litecoinspace.org/api/address/${address}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`litecoinspace ${r.status}`);
  const d = await r.json();
  const funded = d?.chain_stats?.funded_txo_sum ?? 0;
  const spent = d?.chain_stats?.spent_txo_sum ?? 0;
  const mfunded = d?.mempool_stats?.funded_txo_sum ?? 0;
  const mspent = d?.mempool_stats?.spent_txo_sum ?? 0;
  const sats = (funded - spent) + (mfunded - mspent);
  return sats / 1e8;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const master = Deno.env.get("LTC_MASTER_ADDRESS");
    if (!master) return json({ error: "LTC_MASTER_ADDRESS not configured" }, 500);

    const [balance, price] = await Promise.all([
      fetchLtcBalance(master).catch(() => null),
      fetchLtcPrice(),
    ]);

    if (balance === null) return json({ ok: false, master, error: "balance fetch failed" });

    const usable = Math.max(0, balance - MIN_LTC);
    const sweepsRemaining = SWEEP_FEE_LTC > 0 ? Math.floor(usable / SWEEP_FEE_LTC) : 0;
    let status: "ok" | "warn" | "critical" = "ok";
    if (balance < MIN_LTC) status = "critical";
    else if (balance < MIN_LTC * 2) status = "warn";

    return json({
      ok: true,
      master,
      chain: "litecoin",
      name: "Litecoin",
      native: "LTC",
      balance: balance.toString(),
      min: MIN_LTC.toString(),
      topUp: SWEEP_FEE_LTC.toString(),
      usdPrice: price,
      balanceUsd: price !== null ? balance * price : null,
      minUsd: price !== null ? MIN_LTC * price : null,
      sweepsRemaining,
      status,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
