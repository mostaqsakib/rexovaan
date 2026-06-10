import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendTelegramMessage(chatId: number, text: string) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const TELEGRAM_API_KEY = Deno.env.get("TELEGRAM_API_KEY_1") || Deno.env.get("TELEGRAM_API_KEY");
  if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY) return;
  try {
    await fetch(`${GATEWAY_URL}/sendMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": TELEGRAM_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
  } catch (e) { console.error("tg send error", e); }
}

async function sendDepositEmail(
  supabase: any,
  recipientEmail: string | undefined | null,
  templateName: 'deposit-verified' | 'deposit-pending',
  templateData: Record<string, any>,
  idempotencyKey: string,
) {
  if (!recipientEmail) return;
  try {
    const { error } = await supabase.functions.invoke('send-transactional-email', {
      body: { templateName, recipientEmail, idempotencyKey, templateData },
    });
    if (error) console.error('email send err', templateName, error);
  } catch (e) {
    console.error('email send exception', templateName, e);
  }
}

async function fetchWithTimeout(url: string, opts: RequestInit = {}, timeoutMs = 12000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally { clearTimeout(t); }
}

// ── Normalization ──
function normalizeTxnInput(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const cleaned = raw.replace(/[<>`"']/g, " ").replace(/\s+/g, " ").trim();
  const hexMatch = cleaned.match(/0x[a-fA-F0-9]{20,}/);
  if (hexMatch) return hexMatch[0];
  const tronHashMatch = cleaned.match(/\b[a-fA-F0-9]{32,128}\b/);
  if (tronHashMatch) return tronHashMatch[0];
  const uuidMatch = cleaned.match(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/i);
  if (uuidMatch) return uuidMatch[0];
  const hyphenatedOrderMatch = cleaned.match(/\b[A-Za-z0-9]{6,}(?:-[A-Za-z0-9]{3,}){2,}\b/);
  if (hyphenatedOrderMatch && hyphenatedOrderMatch[0].length >= 20 && /\d/.test(hyphenatedOrderMatch[0])) return hyphenatedOrderMatch[0];
  const tonHashMatch = cleaned.match(/\b[a-zA-Z0-9_-]{40,128}\b/);
  if (tonHashMatch && /[0-9]/.test(tonHashMatch[0])) return tonHashMatch[0];
  const numericMatch = cleaned.match(/\b\d{8,}\b/);
  if (numericMatch) return numericMatch[0];
  return cleaned;
}

function isBybitOrderLikeId(value: string): boolean {
  const txn = String(value || "").trim();
  return txn.length >= 20 && /\d/.test(txn) && /^[A-Za-z0-9]{6,}(?:-[A-Za-z0-9]{3,}){2,}$/.test(txn);
}

interface VerifyTargets {
  binance: boolean; bybit: boolean; bep20: boolean; trc20: boolean; ton: boolean; ltc: boolean;
}

function inferVerificationTargets(_normalizedTxn: string, paymentMethodName = ""): VerifyTargets {
  // Bybit Pay → Bybit API. Everything else (BEP20, TRC20, TON, LTC, Binance Pay) → Binance API only.
  const isBybit = paymentMethodName.toLowerCase().includes("bybit");
  return { binance: !isBybit, bybit: isBybit, bep20: false, trc20: false, ton: false, ltc: false };
}



const STABLECOINS = new Set(["USDT","USDC","FDUSD","BUSD","DAI","TUSD","USDP"]);
async function coinToUsdt(coin: string, amount: number | string): Promise<number> {
  const c = String(coin || "").toUpperCase();
  const amt = parseFloat(String(amount)) || 0;
  if (!c || amt <= 0) return amt;
  if (STABLECOINS.has(c)) return amt;
  try {
    const r = await fetchWithTimeout(`https://api.binance.com/api/v3/ticker/price?symbol=${c}USDT`);
    if (r.ok) { const d = await r.json(); const p = parseFloat(d?.price); if (p > 0) return amt * p; }
  } catch {}
  return amt;
}

async function convertLtcToUsdt(ltcAmount: number): Promise<number> {
  try {
    const res = await fetchWithTimeout("https://api.binance.com/api/v3/ticker/price?symbol=LTCUSDT");
    if (res.ok) { const d = await res.json(); const p = parseFloat(d.price); if (p > 0) return ltcAmount * p; }
  } catch {}
  try {
    const res = await fetchWithTimeout("https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=usd");
    if (res.ok) { const d = await res.json(); if (d.litecoin?.usd) return ltcAmount * d.litecoin.usd; }
  } catch {}
  return 0;
}

interface VerifyResult { verified: boolean; amount: number; via?: string; ltcAmount?: number; }

// ── Binance ──
async function verifyBinance(orderId: string, apiKey: string, apiSecret: string): Promise<VerifyResult> {
  const normalizedOrderId = orderId.trim();
  const timestamp = Date.now();
  const recvWindow = 20000;
  const startTime = timestamp - 2 * 60 * 60 * 1000;
  const sign = (qs: string) => createHmac("sha256", apiSecret).update(qs).digest("hex");
  const matchesId = (...values: any[]) => values.some((v) => {
    const s = String(v ?? "").trim(); if (!s) return false;
    if (s === normalizedOrderId) return true;
    const trailing = s.match(/(\d{6,})\s*$/);
    if (trailing && trailing[1] === normalizedOrderId) return true;
    return new RegExp(`(^|\\D)${normalizedOrderId}(\\D|$)`).test(s);
  });

  // Deposit history
  try {
    const q1 = `startTime=${startTime}&recvWindow=${recvWindow}&timestamp=${timestamp}`;
    const res = await fetchWithTimeout(`https://api.binance.com/sapi/v1/capital/deposit/hisrec?${q1}&signature=${sign(q1)}`, { headers: { "X-MBX-APIKEY": apiKey } });
    if (res.ok) {
      const deps = await res.json();
      if (Array.isArray(deps)) for (const d of deps) {
        if (d?.status !== 1) continue;
        if (!matchesId(d.id, d.txId)) continue;
        const coin = String(d.coin || "USDT").toUpperCase();
        const usdt = await coinToUsdt(coin, d.amount);
        return { verified: true, amount: usdt, via: `${coin} Binance` };
      }
    }
  } catch (e) { console.error("Binance dep err", e); }

  // Pay transactions
  try {
    const q2 = `startTimestamp=${startTime}&recvWindow=${recvWindow}&timestamp=${timestamp}`;
    const res = await fetchWithTimeout(`https://api.binance.com/sapi/v1/pay/transactions?${q2}&signature=${sign(q2)}`, { headers: { "X-MBX-APIKEY": apiKey } });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.data)) for (const t of data.data) {
        const matched = [t.orderId, t.orderNo, t.transactionId, t.bizId].some((v) => matchesId(v));
        if (!matched) continue;
        const coin = String(t.currency || "USDT").toUpperCase();
        const rawAmt = Math.abs(parseFloat(t.amount));
        const usdt = await coinToUsdt(coin, rawAmt);
        return { verified: true, amount: usdt, via: `${coin} Binance Pay` };
      }
    }
  } catch (e) { console.error("Binance pay err", e); }

  return { verified: false, amount: 0 };
}

// ── Bybit ──
async function verifyBybit(orderId: string, apiKey: string, apiSecret: string): Promise<VerifyResult> {
  const normalizedOrderId = orderId.trim();
  const recvWindow = "20000";
  const freshSign = (qs: string) => {
    const ts = String(Date.now());
    const pre = `${ts}${apiKey}${recvWindow}${qs}`;
    const sign = createHmac("sha256", apiSecret).update(pre).digest("hex");
    return { ts, sign };
  };
  const ok = (v: any) => { const s = String(v ?? "").toUpperCase(); return s === "SUCCESS" || s === "2" || s === "3" || s === "4" || s === "COMPLETED"; };
  const match = (...values: any[]) => values.some((v) => String(v ?? "").trim() === normalizedOrderId);

  try {
    const qs = `coin=USDT&limit=50&transferId=${encodeURIComponent(normalizedOrderId)}`;
    const { ts, sign } = freshSign(qs);
    const res = await fetchWithTimeout(`https://api.bybit.com/v5/asset/transfer/query-inter-transfer-list?${qs}`, {
      headers: { "X-BAPI-API-KEY": apiKey, "X-BAPI-TIMESTAMP": ts, "X-BAPI-RECV-WINDOW": recvWindow, "X-BAPI-SIGN": sign },
    });
    if (res.ok) {
      const d = await res.json();
      if (d.retCode === 0) for (const t of (d.result?.list || [])) {
        if (match(t.transferId, t.transferID, t.id) && ok(t.status)) {
          return { verified: true, amount: parseFloat(t.amount), via: `USDT Bybit Transfer` };
        }
      }
    }
  } catch (e) { console.error("Bybit inter err", e); }

  try {
    const qs = `coin=USDT&limit=50&txID=${encodeURIComponent(normalizedOrderId)}`;
    const { ts, sign } = freshSign(qs);
    const res = await fetchWithTimeout(`https://api.bybit.com/v5/asset/deposit/query-record?${qs}`, {
      headers: { "X-BAPI-API-KEY": apiKey, "X-BAPI-TIMESTAMP": ts, "X-BAPI-RECV-WINDOW": recvWindow, "X-BAPI-SIGN": sign },
    });
    if (res.ok) {
      const d = await res.json();
      if (d.retCode === 0) for (const x of (d.result?.rows || [])) {
        if (match(x.txID, x.txId, x.id, x.orderId, x.orderLinkId, x.transferId) && ok(x.status)) {
          return { verified: true, amount: parseFloat(x.amount), via: `USDT ${x.chain || x.network || "Bybit Deposit"}` };
        }
      }
    }
  } catch (e) { console.error("Bybit dep err", e); }

  try {
    const twoH = Date.now() - 2 * 60 * 60 * 1000;
    const qs = `coin=USDT&limit=50&startTime=${twoH}`;
    const { ts, sign } = freshSign(qs);
    const res = await fetchWithTimeout(`https://api.bybit.com/v5/asset/deposit/query-internal-record?${qs}`, {
      headers: { "X-BAPI-API-KEY": apiKey, "X-BAPI-TIMESTAMP": ts, "X-BAPI-RECV-WINDOW": recvWindow, "X-BAPI-SIGN": sign },
    });
    if (res.ok) {
      const d = await res.json();
      if (d.retCode === 0) for (const x of (d.result?.rows || [])) {
        if (match(x.id, x.txID, x.txId, x.transferId, x.orderId) && ok(x.status)) {
          return { verified: true, amount: parseFloat(x.amount), via: `USDT Bybit Internal Deposit` };
        }
      }
    }
  } catch (e) { console.error("Bybit internal err", e); }

  return { verified: false, amount: 0 };
}

// ── BEP20 ──
async function verifyBep20(txnHash: string): Promise<VerifyResult> {
  const walletAddress = Deno.env.get("USDT_WALLET_ADDRESS")?.trim().toLowerCase();
  if (!walletAddress) return { verified: false, amount: 0 };
  const normalized = txnHash.trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) return { verified: false, amount: 0 };
  const usdtContract = "0x55d398326f99059ff775485246999027b3197955";
  const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const rpcs = ["https://bsc-dataseed.binance.org/", "https://bsc-rpc.publicnode.com"];
  for (const rpc of rpcs) {
    try {
      const res = await fetchWithTimeout(rpc, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_getTransactionReceipt", params: [normalized], id: 1 }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const receipt = data?.result;
      if (!receipt || receipt.status !== "0x1" || !Array.isArray(receipt.logs)) continue;
      for (const log of receipt.logs) {
        if (log.address?.toLowerCase() !== usdtContract) continue;
        if (log.topics?.[0] !== transferTopic || !log.topics?.[2]) continue;
        const to = `0x${String(log.topics[2]).slice(-40).toLowerCase()}`;
        if (to !== walletAddress) continue;
        const amt = Number(BigInt(log.data || "0x0")) / 1e18;
        if (amt > 0) return { verified: true, amount: amt, via: "USDT BEP20" };
      }
    } catch (e) { console.error("BEP20 err", rpc, e); }
  }
  return { verified: false, amount: 0 };
}

// ── TRC20 ──
async function verifyTrc20(txnHash: string): Promise<VerifyResult> {
  const walletAddress = Deno.env.get("USDT_TRC20_ADDRESS")?.trim();
  if (!walletAddress) return { verified: false, amount: 0 };
  const usdtContract = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
  try {
    const res = await fetchWithTimeout(`https://apilist.tronscanapi.com/api/transaction-info?hash=${txnHash}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.trc20TransferInfo)) for (const t of data.trc20TransferInfo) {
        if (t.contract_address === usdtContract && t.to_address?.toLowerCase() === walletAddress.toLowerCase() && data.confirmed) {
          const amt = parseFloat(t.amount_str) / 1e6;
          if (amt > 0) return { verified: true, amount: amt, via: "USDT TRC20" };
        }
      }
    }
  } catch (e) { console.error("TRC20 err", e); }
  return { verified: false, amount: 0 };
}

// ── TON ──
async function verifyTon(txnHash: string): Promise<VerifyResult> {
  const walletAddress = Deno.env.get("USDT_TON_ADDRESS")?.trim();
  if (!walletAddress) return { verified: false, amount: 0 };
  const walletLower = walletAddress.toLowerCase();
  const addressMatch = (addr?: string) => {
    if (!addr) return false;
    const a = addr.toLowerCase();
    return a === walletLower || a.endsWith(walletLower.slice(-48)) || walletLower.endsWith(a.slice(-48));
  };
  try {
    const res = await fetchWithTimeout(`https://tonapi.io/v2/blockchain/transactions/${txnHash}`);
    if (res.ok) {
      const tx = await res.json();
      if (Array.isArray(tx.out_msgs)) for (const msg of tx.out_msgs) {
        if (["jetton_transfer", "transfer", "internal_transfer"].includes(msg.decoded_op_name)) {
          if (addressMatch(msg.destination?.address) && msg.decoded_body?.amount) {
            const amt = parseInt(msg.decoded_body.amount) / 1e6;
            if (amt > 0) return { verified: true, amount: amt, via: "USDT TON" };
          }
        }
      }
      if (Array.isArray(tx.actions)) for (const a of tx.actions) {
        if (a.type === "JettonTransfer" && a.JettonTransfer && addressMatch(a.JettonTransfer.recipient?.address)) {
          const amt = parseInt(a.JettonTransfer.amount || "0") / 1e6;
          if (amt > 0) return { verified: true, amount: amt, via: "USDT TON" };
        }
      }
    }
  } catch (e) { console.error("TON err", e); }
  return { verified: false, amount: 0 };
}

// ── LTC ──
async function verifyLtc(txnHash: string): Promise<VerifyResult> {
  const walletAddress = Deno.env.get("LTC_ADDRESS")?.trim();
  if (!walletAddress) return { verified: false, amount: 0, ltcAmount: 0 };
  try {
    const res = await fetchWithTimeout(`https://api.blockcypher.com/v1/ltc/main/txs/${txnHash}`);
    if (res.ok) {
      const tx = await res.json();
      if ((tx.confirmations || 0) < 1) return { verified: false, amount: 0, ltcAmount: 0 };
      let ltcAmount = 0;
      for (const o of (tx.outputs || [])) {
        if (Array.isArray(o.addresses) && o.addresses.some((a: string) => a.toLowerCase() === walletAddress.toLowerCase())) {
          ltcAmount += o.value / 1e8;
        }
      }
      if (ltcAmount > 0) {
        const usdt = await convertLtcToUsdt(ltcAmount);
        if (usdt > 0) return { verified: true, amount: usdt, via: "LTC Network", ltcAmount };
      }
    }
  } catch (e) { console.error("LTC err", e); }
  return { verified: false, amount: 0, ltcAmount: 0 };
}

// ── Main handler ──
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Server not configured" }, 500);

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: auth, error: authError } = await userClient.auth.getUser();
    if (authError || !auth.user) return json({ error: "Login required" }, 401);

    const body = await req.json();
    const recheckDepositId = body.recheck_deposit_id ? String(body.recheck_deposit_id) : "";
    const isRecheck = !!recheckDepositId;

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: customer, error: customerError } = await supabase
      .from("bot_customers")
      .select("id,chat_id,username,first_name,balance")
      .eq("auth_user_id", auth.user.id)
      .single();
    if (customerError || !customer) return json({ error: "Customer account not found" }, 404);

    const recipientEmail = auth.user.email;

    let claimedAmount = 0;
    let txnRaw = "";
    let paymentMethod = "";
    let existingDepositId = "";

    if (isRecheck) {
      const { data: existing } = await supabase
        .from("bot_deposits")
        .select("id,amount,txn_hash,status,customer_id")
        .eq("id", recheckDepositId)
        .maybeSingle();
      if (!existing) return json({ error: "Deposit not found" }, 404);
      if (existing.customer_id !== customer.id) return json({ error: "Forbidden" }, 403);
      if (existing.status === "verified") {
        return json({ success: true, verified: true, already: true, amount: Number(existing.amount), deposit_id: existing.id });
      }
      if (existing.status !== "pending") {
        return json({ success: true, verified: false, status: existing.status, deposit_id: existing.id });
      }
      claimedAmount = Number(existing.amount);
      txnRaw = String(existing.txn_hash || "");
      existingDepositId = existing.id;
    } else {
      claimedAmount = Number(body.amount);
      txnRaw = String(body.txn_hash || "").trim();
      paymentMethod = String(body.payment_method || "").trim();
      if (!claimedAmount || claimedAmount <= 0) return json({ error: "Valid amount required" }, 400);
      if (!txnRaw) return json({ error: "Transaction ID required" }, 400);
    }

    const normalizedTxn = normalizeTxnInput(txnRaw);
    if (!normalizedTxn || normalizedTxn.length < 8) return json({ error: "Could not parse a valid TxID / Order ID" }, 400);

    if (!isRecheck) {
      const { data: duplicate } = await supabase
        .from("bot_deposits")
        .select("id,status")
        .eq("txn_hash", normalizedTxn)
        .neq("status", "rejected")
        .maybeSingle();
      if (duplicate) return json({ error: "This transaction has already been submitted" }, 409);
    }

    // Run auto-verification (same logic as bot)
    const targets = inferVerificationTargets(normalizedTxn, paymentMethod);
    const binanceKey = Deno.env.get("BINANCE_API_KEY");
    const binanceSecret = Deno.env.get("BINANCE_API_SECRET");
    const bybitKey = Deno.env.get("BYBIT_API_KEY");
    const bybitSecret = Deno.env.get("BYBIT_API_SECRET");

    const checks: Promise<VerifyResult & { source: string }>[] = [];
    if (targets.binance && binanceKey && binanceSecret) {
      checks.push(verifyBinance(normalizedTxn, binanceKey, binanceSecret).then((r) => ({ source: "Binance", ...r })).catch(() => ({ source: "Binance", verified: false, amount: 0 })));
    }
    if (targets.bybit && bybitKey && bybitSecret) {
      checks.push(verifyBybit(normalizedTxn, bybitKey, bybitSecret).then((r) => ({ source: "Bybit", ...r })).catch(() => ({ source: "Bybit", verified: false, amount: 0 })));
    }
    // On-chain explorer checks (BEP20/TRC20/TON/LTC) disabled by request.
    // Crypto deposits are verified exclusively via Binance API (Binance Pay / Deposit history).

    let verified = false;
    let verifiedAmount = 0;
    let verifiedVia = "";
    let ltcRaw = 0;
    if (checks.length > 0) {
      const results = await Promise.all(checks);
      console.log("[Verify] results:", results.map((r) => `${r.source}=${r.verified}/${r.amount}`).join(", "));
      for (const r of results) {
        if (r.verified && r.amount > 0) {
          verified = true;
          verifiedAmount = r.amount;
          verifiedVia = r.via || r.source;
          if (r.source === "LTC" && (r as any).ltcAmount) ltcRaw = (r as any).ltcAmount;
          break;
        }
      }
    }

    const adminChatId = Number(Deno.env.get("ADMIN_CHAT_ID"));
    const label = customer.username ? `@${customer.username}` : customer.first_name || `#${customer.chat_id}`;

    if (verified && verifiedAmount > 0) {
      let depId = existingDepositId;
      if (isRecheck && existingDepositId) {
        const updatePayload: any = { amount: verifiedAmount, status: "verified", verified_at: new Date().toISOString(), via: verifiedVia };
        const { error: updErr } = await supabase
          .from("bot_deposits")
          .update(updatePayload)
          .eq("id", existingDepositId)
          .eq("status", "pending");
        if (updErr) throw updErr;
      } else {
        const { data: dep, error: depErr } = await supabase
          .from("bot_deposits")
          .insert({ customer_id: customer.id, amount: verifiedAmount, txn_hash: normalizedTxn, status: "verified", verified_at: new Date().toISOString(), payment_method: paymentMethod || null, via: verifiedVia, source: "web" })
          .select("id,created_at")
          .single();
        if (depErr) throw depErr;
        depId = dep.id;
      }

      // Credit balance via RPC (atomic)
      const { data: rpc } = await supabase.rpc("refund_customer_balance", { _customer_id: customer.id, _amount: verifiedAmount });
      const newBal = Array.isArray(rpc) ? Number(rpc[0]?.new_balance ?? 0) : Number((rpc as any)?.new_balance ?? 0);

      let ltcLine = "";
      if (/LTC/i.test(verifiedVia) && ltcRaw > 0) {
        const rate = verifiedAmount / ltcRaw;
        ltcLine = `🪙 Actual Sent: <b>${ltcRaw.toFixed(8)} LTC</b>\n📊 Rate: <b>1 LTC = ${rate.toFixed(2)} USDT</b>\n`;
      }

      if (customer.chat_id) {
        await sendTelegramMessage(customer.chat_id,
          `✅ <b>Deposit Verified!</b>\n\n` +
          `💰 Amount: <b>${verifiedAmount.toFixed(2)} USDT</b>\n` +
          `🪙 Via: <b>${escapeHtml(verifiedVia)}</b>\n${ltcLine}` +
          `🔗 TxID: <code>${escapeHtml(normalizedTxn)}</code>\n` +
          `💳 New Balance: <b>${newBal.toFixed(2)} USDT</b>`);
      }
      if (adminChatId) {
        await sendTelegramMessage(adminChatId,
          `✅ <b>Auto-Verified Deposit (Web)</b>\n\n` +
          `👤 ${escapeHtml(label)}\n` +
          `💰 Amount: <b>${verifiedAmount.toFixed(2)} USDT</b>\n` +
          `🪙 Via: <b>${escapeHtml(verifiedVia)}</b>\n` +
          `🔗 TxID: <code>${escapeHtml(normalizedTxn)}</code>`);
      }

      // Email customer (works for users without Telegram)
      await sendDepositEmail(supabase, recipientEmail, 'deposit-verified', {
        customerName: customer.first_name || customer.username || undefined,
        amount: verifiedAmount,
        via: verifiedVia,
        txnHash: normalizedTxn,
        newBalance: newBal,
        ltcAmount: ltcRaw > 0 ? ltcRaw : undefined,
        rate: ltcRaw > 0 ? verifiedAmount / ltcRaw : undefined,
      }, `deposit-verified-${depId}`);

      return json({ success: true, verified: true, amount: verifiedAmount, via: verifiedVia, new_balance: newBal, deposit_id: depId });
    }

    // Not verified on recheck → keep pending, return status
    if (isRecheck) {
      return json({ success: true, verified: false, deposit_id: existingDepositId, status: "pending" });
    }

    // Not verified → fall back to pending (admin verifies manually)
    const { data: deposit, error: insertError } = await supabase
      .from("bot_deposits")
      .insert({ customer_id: customer.id, amount: claimedAmount, txn_hash: normalizedTxn, status: "pending", payment_method: paymentMethod || null, source: "web" })
      .select("id,created_at")
      .single();
    if (insertError) throw insertError;

    if (adminChatId) {
      await sendTelegramMessage(adminChatId,
        `🔔 <b>New Deposit (Auto-Verify Failed)</b>\n\n` +
        `👤 ${escapeHtml(label)}\n` +
        `💳 Method: <b>${escapeHtml(paymentMethod || "Unknown")}</b>\n` +
        `💰 Claimed: <b>${claimedAmount.toFixed(2)} USDT</b>\n` +
        `🧾 TxID: <code>${escapeHtml(normalizedTxn)}</code>\n\n` +
        `Open Admin → Bot Logs → Deposits to verify or reject manually.`);
    }
    if (customer.chat_id) {
      await sendTelegramMessage(customer.chat_id,
        `⏳ <b>Deposit Submitted</b>\n\nAmount: <b>${claimedAmount.toFixed(2)} USDT</b>\nTxID: <code>${escapeHtml(normalizedTxn)}</code>\n\n` +
        `We couldn't auto-verify it yet. Admin will check it shortly.`);
    }

    // Email customer (works for users without Telegram)
    await sendDepositEmail(supabase, recipientEmail, 'deposit-pending', {
      customerName: customer.first_name || customer.username || undefined,
      amount: claimedAmount,
      paymentMethod: paymentMethod || 'Unknown',
      txnHash: normalizedTxn,
    }, `deposit-pending-${deposit.id}`);

    return json({ success: true, verified: false, deposit_id: deposit.id });
  } catch (error) {
    console.error("submit-deposit-verification error", error);
    return json({ error: error instanceof Error ? error.message : "Failed to submit deposit" }, 500);
  }
});
