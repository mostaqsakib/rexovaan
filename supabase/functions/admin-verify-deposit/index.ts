import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64url.ts";
import { decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { requireAdmin } from "../_shared/require-admin.ts";
import { applyDepositCredit } from "../_shared/apply-deposit-credit.ts";
import { awardReferralCommission } from "../_shared/referral-commission.ts";
import { renderTemplate } from "../_shared/render-template.ts";

const DEFAULT_ADMIN_ORDER_DELIVERED = `💰 <b>{payment} Order Delivered</b>

👤 {customer}
📦 Product: <b>{product}</b>
🔢 Quantity: <b>{quantity}</b>
💵 Total: <b>{total} {currency}</b>
💳 Payment: <b>{payment_method}</b>
🔗 TxID: <code>{txid}</code>`;

const DEFAULT_DEPOSIT_VERIFIED = `✅ <b>Deposit Verified by Admin!</b>

Amount: <b>{amount} USDT</b>{pay_later_block}
New Balance: <b>{new_balance} USDT</b>`;

const DEFAULT_PAYMENT_VERIFIED_MANUAL = `✅ <b>Payment Verified & Order Placed!</b>

Product: <b>{product}</b>
Quantity: <b>{quantity}</b>
Total: <b>{total} {currency}</b>

⏳ <b>Your order is being processed.</b>
Admin will deliver it manually.`;

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";
const BULK_TXT_THRESHOLD = 20;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri: string;
}

function toBase64Url(input: string | Uint8Array): string {
  if (typeof input === "string") return base64Encode(new TextEncoder().encode(input).buffer as ArrayBuffer);
  return base64Encode(new Uint8Array(input).buffer as ArrayBuffer);
}

async function getAccessToken(sa: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = toBase64Url(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: sa.token_uri, exp: now + 3600, iat: now,
  }));
  const unsigned = `${header}.${claim}`;
  const pem = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s/g, "");
  const decodedKey = base64Decode(pem);
  const key = await crypto.subtle.importKey("pkcs8", new Uint8Array(decodedKey).buffer as ArrayBuffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const signed = `${unsigned}.${toBase64Url(new Uint8Array(sig))}`;
  const res = await fetch(sa.token_uri, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${signed}`,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function sheetsRequest(token: string, spreadsheetId: string, path: string, method = "GET", body?: unknown) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}${path}`;
  const opts: RequestInit = { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(`Sheets [${res.status}]: ${JSON.stringify(data)}`);
  return data;
}

async function tgFetch(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: any }> {
  const BOT_TOKEN = Deno.env.get("BOT_TOKEN") || Deno.env.get("TELEGRAM_BOT_TOKEN");
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const TELEGRAM_API_KEY = Deno.env.get("TELEGRAM_API_KEY_1") || Deno.env.get("TELEGRAM_API_KEY");
  // Retry transient failures up to 3 times.
  let lastErr: any = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = BOT_TOKEN
        ? await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : LOVABLE_API_KEY && TELEGRAM_API_KEY
          ? await fetch(`${GATEWAY_URL}/${method}`, {
              method: "POST",
              headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "X-Connection-Api-Key": TELEGRAM_API_KEY, "Content-Type": "application/json" },
              body: JSON.stringify(body),
            })
          : null;
      if (!res) return { ok: false, status: 0, data: { error: "Missing Telegram credentials" } };
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok !== false) return { ok: true, status: res.status, data };
      lastErr = { status: res.status, data };
      // Don't retry client errors (bad chat id, blocked bot, etc.)
      if (res.status >= 400 && res.status < 500) break;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  console.error(`[admin-verify-deposit] Telegram ${method} failed after retries:`, JSON.stringify(lastErr));
  return { ok: false, status: 0, data: lastErr };
}

async function sendTelegramMessage(chatId: number, text: string, replyMarkup?: unknown) {
  const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return await tgFetch("sendMessage", body);
}

async function sendTelegramPhoto(chatId: number, photoUrl: string, caption?: string, replyMarkup?: unknown) {
  const body: Record<string, unknown> = { chat_id: chatId, photo: photoUrl, parse_mode: "HTML" };
  if (caption) body.caption = caption;
  if (replyMarkup) body.reply_markup = replyMarkup;
  return await tgFetch("sendPhoto", body);
}

async function sendTelegramVideo(chatId: number, videoUrl: string, caption?: string, replyMarkup?: unknown) {
  const body: Record<string, unknown> = { chat_id: chatId, video: videoUrl, parse_mode: "HTML" };
  if (caption) body.caption = caption;
  if (replyMarkup) body.reply_markup = replyMarkup;
  return await tgFetch("sendVideo", body);
}

async function notifyAdmin(text: string, replyMarkup?: unknown) {
  const adminChatId = Number(Deno.env.get("ADMIN_CHAT_ID"));
  if (!adminChatId) return;
  await sendTelegramMessage(adminChatId, text, replyMarkup);
}

async function notifyRecentSale(supabase: any, product: any, qty: number, source: "web" | "bot") {
  try {
    const { data: settings } = await supabase
      .from("bot_settings")
      .select("key, value")
      .in("key", ["recent_sales_group_id", "recent_sales_group_id_web", "msg_recent_sale", "msg_recent_sale_web"]);
    const map: Record<string, string> = Object.fromEntries((settings || []).map((s: any) => [s.key, s.value]));
    const webId = map.recent_sales_group_id_web || "";
    const botId = map.recent_sales_group_id || "";
    const rawId = source === "web" ? (webId || botId) : (botId || webId);
    const groupId = rawId ? Number(rawId) : null;
    if (!groupId) return;
    const icon = product.custom_emoji_id ? `<tg-emoji emoji-id="${product.custom_emoji_id}">📦</tg-emoji>` : "🛒";
    const tpl = (source === "web" ? map.msg_recent_sale_web : map.msg_recent_sale) ||
      (source === "web"
        ? `🛍️ Someone just bought <b>{quantity}× {product}</b> from the website`
        : `🛒 Someone just bought <b>{quantity}× {product}</b>`);
    const text = tpl
      .replace(/\{product\}/g, `${icon} <b>${escapeHtml(product.name)}</b>`)
      .replace(/\{quantity\}/g, String(qty));
    await sendTelegramMessage(groupId, text);
  } catch (e) {
    console.error("[admin-verify-deposit] notifyRecentSale failed:", (e as Error)?.message || e);
  }
}



function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function safeFilename(value: string) {
  return String(value || "order").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 60) || "order";
}

function itemText(item: Record<string, unknown>, multiColumn: boolean) {
  const entries = Object.entries(item || {}).filter(([, v]) => v != null && String(v).trim());
  if (!multiColumn || entries.length <= 1) {
    return String(entries.find(([, v]) => String(v).startsWith("http"))?.[1] ?? entries[0]?.[1] ?? "");
  }
  return entries.map(([key, value]) => `${key}: ${value}`).join("\n");
}

async function sendTelegramDocument(chatId: number, content: string, filename: string, caption: string, replyMarkup?: unknown) {
  const BOT_TOKEN = Deno.env.get("BOT_TOKEN") || Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!BOT_TOKEN) {
    console.error("[admin-verify-deposit] Telegram sendDocument skipped: missing BOT_TOKEN");
    return { ok: false, status: 0, data: { error: "Missing BOT_TOKEN" } };
  }

  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", new Blob([content], { type: "text/plain; charset=utf-8" }), filename);
  form.append("caption", caption);
  form.append("parse_mode", "HTML");
  if (replyMarkup) form.append("reply_markup", JSON.stringify(replyMarkup));

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
    method: "POST",
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    console.error("[admin-verify-deposit] Telegram sendDocument failed:", JSON.stringify({ status: res.status, data }));
    return { ok: false, status: res.status, data };
  }
  return { ok: true, status: res.status, data };
}

async function purchaseFromSource(supabaseUrl: string, serviceKey: string, product: any, quantity: number): Promise<Record<string, string>[]> {
  if (!product?.source_id || !product?.source_product_id) return [];
  const res = await fetch(`${supabaseUrl}/functions/v1/product-sources`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
    },
    body: JSON.stringify({
      action: "purchase",
      source_id: product.source_id,
      source_product_id: product.source_product_id,
      quantity,
    }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.ok) throw new Error(payload?.error || `Source purchase failed (${res.status})`);
  const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
  if (accounts.length < quantity) throw new Error("Source returned insufficient accounts");
  return accounts.map((account: unknown) => ({ "Delivery Info": String(account) }));
}

const mainMenuKeyboard = () => ({
  inline_keyboard: [
    [{ text: "🛒 Shop", callback_data: "menu_shop" }],
    [{ text: "💳 Deposit", callback_data: "menu_deposit" }, { text: "💰 Balance", callback_data: "menu_balance" }],
    [{ text: "🧾 My Orders", callback_data: "menu_orders" }, { text: "💸 Withdraw", callback_data: "menu_withdraw" }],
    [{ text: "🆘 Support", callback_data: "menu_support" }],
  ],
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const _adminGuard = await requireAdmin(req, corsHeaders);
  if (_adminGuard) return _adminGuard;

  try {
    const { deposit_id, amount } = await req.json();
    if (!deposit_id || !amount || amount <= 0) {
      return new Response(JSON.stringify({ error: "deposit_id and amount required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get deposit
    const { data: deposit, error: depErr } = await supabase.from("bot_deposits").select("*").eq("id", deposit_id).single();
    if (depErr || !deposit) {
      return new Response(JSON.stringify({ error: "Deposit not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (deposit.status === "verified") {
      return new Response(JSON.stringify({ error: "Already verified" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Only allow manual admin verification for ID-based off-chain rails.
    // On-chain rails (BEP20 / Polygon / TON / LTC) must auto-verify;
    // legacy manual TxID submissions (old Binance BEP20 / TRC20 / etc.) are blocked.
    const ALLOWED_MANUAL = new Set(["Binance Pay", "Bybit Pay", "bKash"]);
    const pm = (deposit.payment_method || "").trim();
    if (!ALLOWED_MANUAL.has(pm)) {
      return new Response(JSON.stringify({
        error: `Manual verification disabled for "${pm || 'unknown'}". Only Binance Pay, Bybit Pay & bKash can be manually approved. On-chain deposits (BEP20/Polygon/TON/LTC) auto-verify only.`
      }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get customer
    const { data: customer } = await supabase.from("bot_customers").select("*").eq("id", deposit.customer_id).single();
    if (!customer) {
      return new Response(JSON.stringify({ error: "Customer not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Update deposit as verified
    await supabase.from("bot_deposits").update({
      status: "verified",
      amount,
      verified_at: new Date().toISOString(),
      via: deposit.via || "Manual (Admin)",
    }).eq("id", deposit_id);

    // If this deposit has a pending product order → auto-deliver
    if (deposit.pending_product_id && deposit.pending_quantity) {
      const { data: product } = await supabase.from("bot_products").select("*").eq("id", deposit.pending_product_id).single();
      if (!product || product.is_active === false) {
        // Product not found OR disabled → credit balance instead of delivering
        const applied = await applyDepositCredit(supabase, customer.id, amount);
        const plLine = applied.paidPayLater > 0
          ? `\n🏷️ Pay-Later Cleared: <b>${applied.paidPayLater.toFixed(2)} USDT</b>`
          : "";
        await supabase.from("bot_customers").update({ pending_action: null, updated_at: new Date().toISOString() }).eq("id", customer.id);
        await supabase.from("bot_deposits").update({ pending_product_id: null, pending_quantity: null }).eq("id", deposit_id);
        const disabledLine = product && product.is_active === false
          ? `\n\n⚠️ <b>${product.name}</b> is currently disabled and could not be delivered. Your payment has been credited to your balance instead.`
          : "";
        await sendTelegramMessage(customer.chat_id,
          `✅ <b>Deposit Verified by Admin!</b>\n\nAmount: <b>${amount.toFixed(2)} USDT</b>${plLine}\nNew Balance: <b>${applied.newBalance.toFixed(2)} USDT</b>${disabledLine}`,
          mainMenuKeyboard()
        );
        return new Response(JSON.stringify({ success: true, action: product ? "product_disabled_balance_added" : "balance_added", ...applied }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }


      const qty = deposit.pending_quantity;

      // Get lowest applicable price: base, tier, customer special, active flash sale
      const nowIso = new Date().toISOString();
      const [tiersRes, flashRes, specialRes] = await Promise.all([
        supabase.from("bot_product_pricing").select("*").eq("product_id", product.id).order("min_quantity"),
        supabase.from("bot_flash_sales").select("sale_price, ends_at, is_active").eq("product_id", product.id).eq("is_active", true).gt("ends_at", nowIso).maybeSingle(),
        supabase.from("bot_customer_pricing").select("price, min_quantity, max_quantity").eq("customer_id", customer.id).eq("product_id", product.id),
      ]);
      const tiers = tiersRes.data;
      let tierPrice: number | null = null;
      if (tiers && tiers.length > 0) {
        for (const tier of tiers) {
          if (qty >= tier.min_quantity && (tier.max_quantity === null || qty <= tier.max_quantity)) {
            tierPrice = Number(tier.price);
            break;
          }
        }
        if (tierPrice === null) tierPrice = Number(tiers[tiers.length - 1].price);
      }
      let specialPrice: number | null = null;
      if (specialRes.data && specialRes.data.length > 0) {
        for (const s of specialRes.data as any[]) {
          if (qty >= (s.min_quantity ?? 1) && (s.max_quantity == null || qty <= s.max_quantity)) {
            const p = Number(s.price);
            if (specialPrice === null || p < specialPrice) specialPrice = p;
          }
        }
      }
      const candidates: number[] = [Number(product.price)];
      if (tierPrice !== null) candidates.push(tierPrice);
      if (specialPrice !== null) candidates.push(specialPrice);
      if (flashRes.data?.sale_price != null) candidates.push(Number(flashRes.data.sale_price));
      const unitPrice = Math.min(...candidates.filter((v) => Number.isFinite(v) && v >= 0));

      const totalPrice = Math.round(unitPrice * qty * 10000) / 10000;
      const currentBalance = Number(customer.balance);
      const totalAvailable = amount + currentBalance;

      // Check if deposit + balance covers the order
      if (totalAvailable < totalPrice) {
        // Insufficient funds — cancel order, apply deposit (pay-later first, then balance)
        const applied = await applyDepositCredit(supabase, customer.id, amount);
        const newBalance = applied.newBalance;

        // Clear pending product from deposit
        await supabase.from("bot_deposits").update({ pending_product_id: null, pending_quantity: null }).eq("id", deposit_id);

        const shortage = totalPrice - totalAvailable;
        const plLine = applied.paidPayLater > 0
          ? `\n🏷️ Pay-Later Cleared: <b>${applied.paidPayLater.toFixed(2)} USDT</b>`
          : "";
        await sendTelegramMessage(customer.chat_id,
          `✅ <b>Deposit Verified!</b>\n\nAmount: <b>${amount.toFixed(2)} USDT</b>${plLine}\n\n❌ <b>Order Cancelled</b> — Insufficient funds.\nRequired: <b>${totalPrice.toFixed(2)} USDT</b>\nYour Total (deposit + balance): <b>${totalAvailable.toFixed(2)} USDT</b>\nShort by: <b>${shortage.toFixed(2)} USDT</b>\n\nNew Balance: <b>${newBalance.toFixed(2)} USDT</b>\n\nYou can re-order when you have enough balance.`,
          mainMenuKeyboard()
        );

        // Notify admin
        const ADMIN_CHAT_ID = Number(Deno.env.get("ADMIN_CHAT_ID"));
        if (ADMIN_CHAT_ID) {
          await sendTelegramMessage(ADMIN_CHAT_ID,
            `⚠️ <b>Order Auto-Cancelled</b>\n\nCustomer: ${customer.first_name || ''} (@${customer.username || 'N/A'})\nProduct: ${product.name} x${qty}\nRequired: ${totalPrice.toFixed(2)} USDT\nDeposit: ${amount.toFixed(2)} USDT\nBalance: ${currentBalance.toFixed(2)} USDT\nTotal Available: ${totalAvailable.toFixed(2)} USDT\n\nDeposit applied (pay-later ${applied.paidPayLater.toFixed(2)}, balance ${applied.addedToBalance.toFixed(2)}).`
          );
        }

        return new Response(JSON.stringify({ success: true, action: "order_cancelled_insufficient", newBalance }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Sufficient funds — new balance = (current balance + deposit) - product cost
      const newBalance = currentBalance + amount - totalPrice;
      const amountFromBalance = Math.max(0, totalPrice - amount);
      await supabase.from("bot_customers").update({ balance: newBalance, pending_action: null, updated_at: new Date().toISOString() }).eq("id", customer.id);

      // Notify customer
      let paymentMsg = `✅ <b>Payment Verified!</b>\n\nAmount: <b>${amount.toFixed(2)} USDT</b>`;
      if (amountFromBalance > 0) {
        paymentMsg += `\nBalance Used: <b>${amountFromBalance.toFixed(2)} USDT</b>`;
      }

      // MANUAL DELIVERY PRODUCT — save as pending_delivery, notify admin
      if (product.is_manual_delivery) {
        paymentMsg += `\n\n⏳ <b>Your order is being processed.</b>\nAdmin will deliver it manually.\n⏱ Delivery Time: <b>30 min — 12 hours</b>.\nIf not delivered within 12 hours, your balance will be fully refunded.`;
        await sendTelegramMessage(customer.chat_id, paymentMsg, mainMenuKeyboard());

        const { data: orderRow } = await supabase.from("bot_orders").insert({
          customer_id: customer.id,
          product_id: product.id,
          product_name: product.name,
          quantity: qty,
          total_price: totalPrice,
          details: [],
          row_numbers: [],
          status: "pending_delivery",
          payment_method: deposit.payment_method || "bKash",
          txn_hash: deposit.txn_hash || null,
          source: deposit.source || "bot",
        }).select("id").single();


        const orderId = orderRow?.id || "unknown";
        const orderShort = orderId.slice(0, 8);
        const custLabel = customer.username ? `@${customer.username}` : customer.first_name || `#${customer.chat_id}`;

        const ADMIN_CHAT_ID = Number(Deno.env.get("ADMIN_CHAT_ID"));
        if (ADMIN_CHAT_ID) {
          await sendTelegramMessage(ADMIN_CHAT_ID,
            `🔔 <b>New Manual Delivery Order!</b>\n\n` +
            `👤 ${custLabel}\n` +
            `📦 Product: <b>${product.name}</b> x${qty}\n` +
            `💰 Total: <b>${totalPrice.toFixed(2)} ${product.currency}</b>`,
            {
              inline_keyboard: [
                [{ text: "📦 Deliver", callback_data: `mdlvr_${orderShort}` }],
                [{ text: "❌ Cancel & Refund", callback_data: `mdcancel_${orderShort}` }],
              ]
            }
          );
        }

        await supabase.from("bot_deposits").update({ pending_product_id: null, pending_quantity: null }).eq("id", deposit_id);

        return new Response(JSON.stringify({ success: true, action: "manual_delivery_pending", product: product.name, qty }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (!product.is_manual_delivery) {
        const { data: orderRow } = await supabase.from("bot_orders").insert({
          customer_id: customer.id,
          product_id: product.id,
          product_name: product.name,
          quantity: qty,
          total_price: totalPrice,
          details: [],
          row_numbers: [],
          status: "completed",
          payment_method: deposit.payment_method || "bKash",
          txn_hash: deposit.txn_hash || null,
          source: deposit.source || "bot",
        }).select("id").single();


        if (!orderRow?.id) throw new Error("Order create failed");

        let orderDetails: Record<string, unknown>[] = [];
        if (product.source_id && product.source_product_id) {
          try {
            orderDetails = await purchaseFromSource(supabaseUrl, supabaseKey, product, qty);
          } catch (sourceErr) {
            await supabase.from("bot_orders").update({ status: "pending_delivery" }).eq("id", orderRow.id);
            await supabase.from("bot_deposits").update({ pending_product_id: null, pending_quantity: null }).eq("id", deposit_id);
            await sendTelegramMessage(customer.chat_id,
              `⏳ <b>Order Placed — Pending Manual Delivery</b>\n\nProduct: <b>${escapeHtml(product.name)}</b>\nQuantity: <b>${qty}</b>\nTotal: <b>${totalPrice.toFixed(2)} ${escapeHtml(product.currency || "USDT")}</b>\n\nAuto-delivery temporarily unavailable. Admin will deliver manually.`,
              mainMenuKeyboard()
            );
            await notifyAdmin(
              `🔔 <b>Source Failed → Manual Delivery Needed</b>\n\n👤 ${escapeHtml(customer.username ? `@${customer.username}` : customer.first_name || `#${customer.chat_id}`)}\n📦 Product: <b>${escapeHtml(product.name)}</b> x${qty}\n💰 Total: <b>${totalPrice.toFixed(2)} ${escapeHtml(product.currency || "USDT")}</b>\n💳 Payment: <b>bKash</b>\n\n⚠️ Source error: <code>${escapeHtml(sourceErr instanceof Error ? sourceErr.message : String(sourceErr))}</code>`,
              { inline_keyboard: [[{ text: "📦 Deliver", callback_data: `mdlvr_${String(orderRow.id).slice(0, 8)}` }], [{ text: "❌ Cancel & Refund", callback_data: `mdcancel_${String(orderRow.id).slice(0, 8)}` }]] }
            );
            return new Response(JSON.stringify({ success: true, action: "pending_delivery", product: product.name, qty, orderId: orderRow.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
        } else {
          const { data: reserved, error: reserveError } = await supabase.rpc("reserve_internal_stock_items", {
            _product_id: product.id,
            _quantity: qty,
            _order_id: orderRow?.id,
          });

          if (reserveError || !reserved || reserved.length < qty) {
            await supabase.from("bot_orders").update({ status: "pending_delivery" }).eq("id", orderRow.id);
            await supabase.from("bot_deposits").update({ pending_product_id: null, pending_quantity: null }).eq("id", deposit_id);
            await sendTelegramMessage(customer.chat_id,
              `⏳ <b>Order Placed — Pending Manual Delivery</b>\n\nProduct: <b>${escapeHtml(product.name)}</b>\nQuantity: <b>${qty}</b>\nTotal: <b>${totalPrice.toFixed(2)} ${escapeHtml(product.currency || "USDT")}</b>\n\nStock temporarily unavailable. Admin will deliver manually.`,
              mainMenuKeyboard()
            );
            await notifyAdmin(
              `🔔 <b>Stock Empty → Manual Delivery Needed</b>\n\n👤 ${escapeHtml(customer.username ? `@${customer.username}` : customer.first_name || `#${customer.chat_id}`)}\n📦 Product: <b>${escapeHtml(product.name)}</b> x${qty}\n💰 Total: <b>${totalPrice.toFixed(2)} ${escapeHtml(product.currency || "USDT")}</b>\n💳 Payment: <b>bKash</b>`,
              { inline_keyboard: [[{ text: "📦 Deliver", callback_data: `mdlvr_${String(orderRow.id).slice(0, 8)}` }], [{ text: "❌ Cancel & Refund", callback_data: `mdcancel_${String(orderRow.id).slice(0, 8)}` }]] }
            );
            return new Response(JSON.stringify({ success: true, action: "pending_delivery", product: product.name, qty, orderId: orderRow.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }

          orderDetails = reserved.map((item: { data: Record<string, unknown> }) => item.data || {});
        }
        await supabase.from("bot_orders").update({ details: orderDetails, delivered_at: new Date().toISOString() }).eq("id", orderRow.id);

        const detailKeys = Object.keys(orderDetails[0] || {});
        const multiColumn = detailKeys.length > 1;
        const productHeader = `📦 <b>${escapeHtml(product.name)} × ${qty}</b>`;

        if (orderDetails.length > BULK_TXT_THRESHOLD) {
          // Bulk order — deliver as TXT file only (no middle "Order Delivered" header)
          paymentMsg += `\n\n⏳ Delivering your order as file…`;
          await sendTelegramMessage(customer.chat_id, paymentMsg);
          let txt = "";
          for (let i = 0; i < orderDetails.length; i++) {
            const text = itemText(orderDetails[i], multiColumn);
            txt += orderDetails.length > 1 ? `${i + 1}. ${text}\n${multiColumn ? "\n" : ""}` : `${text}\n${multiColumn ? "\n" : ""}`;
          }
          const orderNum = String(orderRow.id).slice(0, 4).toUpperCase();
          const filename = `Order-${orderNum}-${safeFilename(product.name)}-${orderDetails.length}items.txt`;
          const fileCaption = `📄 <b>${escapeHtml(product.name)}</b>\n🧾 Order: <b>#${orderNum}</b>\n🔢 Quantity: <b>${qty}</b>\n💵 Total Paid: <b>${totalPrice.toFixed(2)} ${escapeHtml(product.currency || "USDT")}</b>`;
          await sendTelegramDocument(customer.chat_id, txt, filename, fileCaption, mainMenuKeyboard());
        } else {
          paymentMsg += `\n\n⏳ Delivering your order...`;
          await sendTelegramMessage(customer.chat_id, paymentMsg);
          // No middle "Order Delivered!" header — jump straight into product/items block
          const CHUNK_SIZE = 30;
          for (let i = 0; i < orderDetails.length; i += CHUNK_SIZE) {
            const chunk = orderDetails.slice(i, i + CHUNK_SIZE);
            const rangeSuffix = orderDetails.length > CHUNK_SIZE ? ` (${i + 1}-${i + chunk.length} of ${qty})` : '';
            let msg = `${productHeader}${rangeSuffix}\n\n`;
            for (let j = 0; j < chunk.length; j++) {
              const item = chunk[j];
              const entries = Object.entries(item || {}).filter(([, v]) => v != null && String(v).trim());
              const numPrefix = orderDetails.length > 1 ? `${i + j + 1}. ` : '';
              if (multiColumn && entries.length > 1) {
                msg += `<b>${numPrefix.trim() || '•'}</b>`;
                for (const [k, v] of entries) {
                  msg += `\n<b>${escapeHtml(k)}:</b> <code>${escapeHtml(String(v))}</code>`;
                }
                msg += `\n\n`;
              } else {
                const val = entries.find(([, v]) => String(v).startsWith("http"))?.[1] ?? entries[0]?.[1] ?? "";
                msg += `${numPrefix}<code>${escapeHtml(String(val))}</code>\n`;
              }
            }
            await sendTelegramMessage(customer.chat_id, msg);
          }
        }

        if (product.delivery_instruction) {
          await sendTelegramMessage(customer.chat_id, `📋 <b>Important Instructions:</b>\n\n${product.delivery_instruction}`, mainMenuKeyboard());
        }

        await supabase.from("bot_deposits").update({ pending_product_id: null, pending_quantity: null }).eq("id", deposit_id);

        awardReferralCommission(supabase, customer.id, totalPrice, orderRow.id).catch(() => {});

        // Notify admin — bKash order delivered
        const custLabel = customer.username ? `@${customer.username}` : (customer.first_name || `#${customer.chat_id}`);
        const paymentLabel = deposit.payment_method || "bKash";
        const adminText = await renderTemplate(supabase, "admin_notif_order_delivered", DEFAULT_ADMIN_ORDER_DELIVERED, {
          payment: paymentLabel,
          customer: escapeHtml(custLabel),
          product: escapeHtml(product.name),
          quantity: String(qty),
          total: totalPrice.toFixed(2),
          currency: escapeHtml(product.currency || "USDT"),
          payment_method: escapeHtml(paymentLabel),
          txid: escapeHtml(deposit.txn_hash || "—"),
        });
        await notifyAdmin(adminText);

        // Recent Sales Feed (Web/Bot group)
        const saleSource: "web" | "bot" = (deposit.source || "bot") === "web" ? "web" : "bot";
        notifyRecentSale(supabase, product, qty, saleSource).catch(() => {});

        return new Response(JSON.stringify({ success: true, action: "delivered", product: product.name, qty }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Manual delivery product — create pending order only
      const { data: orderRow } = await supabase.from("bot_orders").insert({
        customer_id: customer.id,
        product_id: product.id,
        product_name: product.name,
        quantity: qty,
        total_price: totalPrice,
        details: [],
        row_numbers: [],
        status: "pending_delivery",
        payment_method: deposit.payment_method || "bKash",
        txn_hash: deposit.txn_hash || null,
        source: deposit.source || "bot",
      }).select("id").single();


      await sendTelegramMessage(customer.chat_id,
        `✅ <b>Payment Verified & Order Placed!</b>\n\nProduct: <b>${product.name}</b>\nQuantity: <b>${qty}</b>\nTotal: <b>${totalPrice.toFixed(2)} ${product.currency}</b>\n\n⏳ <b>Your order is being processed.</b>\nAdmin will deliver it manually.`,
        mainMenuKeyboard()
      );

      return new Response(JSON.stringify({ success: true, action: "pending_delivery", product: product.name, qty, orderId: orderRow?.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // No pending product — apply deposit (pay-later first, then balance)
    const applied = await applyDepositCredit(supabase, customer.id, amount);
    const plLine = applied.paidPayLater > 0
      ? `\n🏷️ Pay-Later Cleared: <b>${applied.paidPayLater.toFixed(2)} USDT</b>`
      : "";
    await sendTelegramMessage(customer.chat_id,
      `✅ <b>Deposit Verified by Admin!</b>\n\nAmount: <b>${amount.toFixed(2)} USDT</b>${plLine}\nNew Balance: <b>${applied.newBalance.toFixed(2)} USDT</b>`,
      mainMenuKeyboard()
    );

    return new Response(JSON.stringify({ success: true, action: "balance_added", newBalance: applied.newBalance, ...applied }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Admin verify error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
