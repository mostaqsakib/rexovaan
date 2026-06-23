import { createHmac } from "node:crypto";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const apiKey = Deno.env.get("BYBIT_API_KEY")!;
  const apiSecret = Deno.env.get("BYBIT_API_SECRET")!;
  const recvWindow = "20000";
  const sign = (qs: string) => { const ts = String(Date.now()); const pre = `${ts}${apiKey}${recvWindow}${qs}`; return { ts, sig: createHmac("sha256", apiSecret).update(pre).digest("hex") }; };
  async function call(label: string, url: string, qs: string) {
    const { ts, sig } = sign(qs);
    const r = await fetch(`${url}?${qs}`, { headers: { "X-BAPI-API-KEY": apiKey, "X-BAPI-TIMESTAMP": ts, "X-BAPI-RECV-WINDOW": recvWindow, "X-BAPI-SIGN": sig }});
    return { label, status: r.status, body: await r.json() };
  }
  const since = Date.now() - 48 * 3600 * 1000;
  const out = await Promise.all([
    call("internal-48h", "https://api.bybit.com/v5/asset/deposit/query-internal-record", `coin=USDT&limit=50&startTime=${since}`),
    call("inter-48h", "https://api.bybit.com/v5/asset/transfer/query-inter-transfer-list", `coin=USDT&limit=50&startTime=${since}`),
    // Bybit Pay / Withdrawable history alt endpoints
    call("exch-coin", "https://api.bybit.com/v5/asset/exchange/order-record", `limit=50`),
    call("acct-info", "https://api.bybit.com/v5/user/query-api", ``),
  ]);
  return new Response(JSON.stringify(out, null, 2), { headers: { ...cors, "Content-Type": "application/json" }});
});
