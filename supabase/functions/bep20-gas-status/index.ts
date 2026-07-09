// Returns master wallet address + native gas balance for every enabled EVM chain,
// including USD estimate and approximate remaining sweeps before the tank runs dry.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { ethers } from "https://esm.sh/ethers@6.13.2";
import { deriveAddressWithXprv } from "../_bep20/derive.ts";
import { enabledChains, getRpcUrl } from "../_bep20/chains.ts";

// CoinGecko IDs for each native token
const COINGECKO_IDS: Record<string, string> = {
  BNB: "binancecoin",
  MATIC: "matic-network",
  POL: "matic-network",
  ETH: "ethereum",
  AVAX: "avalanche-2",
};

async function fetchPrices(symbols: string[]): Promise<Record<string, number>> {
  try {
    const ids = Array.from(new Set(symbols.map((s) => COINGECKO_IDS[s]).filter(Boolean)));
    if (!ids.length) return {};
    const r = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!r.ok) return {};
    const data = await r.json();
    const out: Record<string, number> = {};
    for (const [sym, id] of Object.entries(COINGECKO_IDS)) {
      const p = data?.[id]?.usd;
      if (typeof p === "number") out[sym] = p;
    }
    return out;
  } catch {
    return {};
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const xprv = Deno.env.get("BSC_SWEEP_XPRV") || Deno.env.get("BSC_XPRV");
    const destination = Deno.env.get("BSC_SWEEP_DESTINATION") || null;
    if (!xprv) return json({ error: "BSC_SWEEP_XPRV not configured" }, 500);

    const master = deriveAddressWithXprv(xprv, 0);
    const chains = enabledChains();

    const prices = await fetchPrices(chains.map((c) => c.nativeSymbol));

    const results = await Promise.all(chains.map(async (c) => {
      const rpc = getRpcUrl(c);
      if (!rpc) return { chain: c.id, name: c.name, native: c.nativeSymbol, error: "no rpc" };
      try {
        const provider = new ethers.JsonRpcProvider(rpc, { chainId: c.chainId, name: c.name });
        const bal: bigint = await provider.getBalance(master.address);
        const minWei = c.minGasNativeWei;
        const topUpWei = c.gasTopUpWei;
        const balNum = Number(ethers.formatEther(bal));
        const minNum = Number(ethers.formatEther(minWei));
        const topUpNum = Number(ethers.formatEther(topUpWei));
        const price = prices[c.nativeSymbol] ?? null;
        // Approximate sweeps remaining: how many gas top-ups can we fund before hitting min
        const usable = Math.max(0, balNum - minNum);
        const sweepsRemaining = topUpNum > 0 ? Math.floor(usable / topUpNum) : 0;
        // Status tiers
        let status: "ok" | "warn" | "critical" = "ok";
        if (bal < minWei) status = "critical";
        else if (bal < minWei * 2n) status = "warn";
        return {
          chain: c.id,
          name: c.name,
          native: c.nativeSymbol,
          balance: balNum.toString(),
          min: minNum.toString(),
          topUp: topUpNum.toString(),
          usdPrice: price,
          balanceUsd: price !== null ? balNum * price : null,
          minUsd: price !== null ? minNum * price : null,
          sweepsRemaining,
          ok: bal >= minWei,
          status,
        };
      } catch (e) {
        return { chain: c.id, name: c.name, native: c.nativeSymbol, error: (e as Error).message };
      }
    }));

    return json({
      ok: true,
      master: master.address,
      destination,
      chains: results,
      criticalCount: results.filter((r: any) => r.status === "critical").length,
      warnCount: results.filter((r: any) => r.status === "warn").length,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
