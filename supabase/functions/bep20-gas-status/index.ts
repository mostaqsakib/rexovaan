// Returns master wallet address + native gas balance for every enabled EVM chain.
// Used by admin panel to see at a glance which gas tanks are low.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { ethers } from "https://esm.sh/ethers@6.13.2";
import { deriveAddressWithXprv } from "../_bep20/derive.ts";
import { enabledChains, getRpcUrl } from "../_bep20/chains.ts";

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

    const results = await Promise.all(chains.map(async (c) => {
      const rpc = getRpcUrl(c);
      if (!rpc) return { chain: c.id, name: c.name, native: c.nativeSymbol, error: "no rpc" };
      try {
        const provider = new ethers.JsonRpcProvider(rpc, { chainId: c.chainId, name: c.name });
        const bal: bigint = await provider.getBalance(master.address);
        const minWei = c.minGasNativeWei;
        return {
          chain: c.id,
          name: c.name,
          native: c.nativeSymbol,
          balance: ethers.formatEther(bal),
          min: ethers.formatEther(minWei),
          ok: bal >= minWei,
        };
      } catch (e) {
        return { chain: c.id, name: c.name, native: c.nativeSymbol, error: (e as Error).message };
      }
    }));

    return json({ ok: true, master: master.address, destination, chains: results });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
