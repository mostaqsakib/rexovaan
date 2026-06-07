import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64url.ts";
import { decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

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

async function sendTelegramMessage(chatId: number, text: string, replyMarkup?: unknown) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
  const TELEGRAM_API_KEY = (Deno.env.get("TELEGRAM_API_KEY_1") || Deno.env.get("TELEGRAM_API_KEY"))!;
  const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (replyMarkup) body.reply_markup = replyMarkup;
  await fetch(`${GATEWAY_URL}/sendMessage`, {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "X-Connection-Api-Key": TELEGRAM_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function sendTelegramPhoto(chatId: number, photoUrl: string, caption?: string, replyMarkup?: unknown) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
  const TELEGRAM_API_KEY = (Deno.env.get("TELEGRAM_API_KEY_1") || Deno.env.get("TELEGRAM_API_KEY"))!;
  const body: Record<string, unknown> = { chat_id: chatId, photo: photoUrl, parse_mode: "HTML" };
  if (caption) body.caption = caption;
  if (replyMarkup) body.reply_markup = replyMarkup;
  await fetch(`${GATEWAY_URL}/sendPhoto`, {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "X-Connection-Api-Key": TELEGRAM_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function sendTelegramVideo(chatId: number, videoUrl: string, caption?: string, replyMarkup?: unknown) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
  const TELEGRAM_API_KEY = (Deno.env.get("TELEGRAM_API_KEY_1") || Deno.env.get("TELEGRAM_API_KEY"))!;
  const body: Record<string, unknown> = { chat_id: chatId, video: videoUrl, parse_mode: "HTML" };
  if (caption) body.caption = caption;
  if (replyMarkup) body.reply_markup = replyMarkup;
  await fetch(`${GATEWAY_URL}/sendVideo`, {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "X-Connection-Api-Key": TELEGRAM_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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
      if (!product) {
        // No product found, just add to balance
        const newBalance = Number(customer.balance) + amount;
        await supabase.from("bot_customers").update({ balance: newBalance, updated_at: new Date().toISOString() }).eq("id", customer.id);
        await sendTelegramMessage(customer.chat_id,
          `✅ <b>Deposit Verified by Admin!</b>\n\nAmount: <b>${amount.toFixed(2)} USDT</b>\nNew Balance: <b>${newBalance.toFixed(2)} USDT</b>`,
          mainMenuKeyboard()
        );
        return new Response(JSON.stringify({ success: true, action: "balance_added" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const qty = deposit.pending_quantity;

      // Get tiered price
      const { data: tiers } = await supabase.from("bot_product_pricing").select("*").eq("product_id", product.id).order("min_quantity");
      let unitPrice = Number(product.price);
      if (tiers && tiers.length > 0) {
        for (const tier of tiers) {
          if (qty >= tier.min_quantity && (tier.max_quantity === null || qty <= tier.max_quantity)) {
            unitPrice = Number(tier.price);
            break;
          }
        }
        if (!tiers.some(t => qty >= t.min_quantity && (t.max_quantity === null || qty <= t.max_quantity))) {
          unitPrice = Number(tiers[tiers.length - 1].price);
        }
      }

      const totalPrice = unitPrice * qty;
      const currentBalance = Number(customer.balance);
      const totalAvailable = amount + currentBalance;

      // Check if deposit + balance covers the order
      if (totalAvailable < totalPrice) {
        // Insufficient funds — cancel order, add deposit to balance
        const newBalance = currentBalance + amount;
        await supabase.from("bot_customers").update({ balance: newBalance, updated_at: new Date().toISOString() }).eq("id", customer.id);

        // Clear pending product from deposit
        await supabase.from("bot_deposits").update({ pending_product_id: null, pending_quantity: null }).eq("id", deposit_id);

        const shortage = totalPrice - totalAvailable;
        await sendTelegramMessage(customer.chat_id,
          `✅ <b>Deposit Verified!</b>\n\nAmount: <b>${amount.toFixed(2)} USDT</b>\n\n❌ <b>Order Cancelled</b> — Insufficient funds.\nRequired: <b>${totalPrice.toFixed(2)} USDT</b>\nYour Total (deposit + balance): <b>${totalAvailable.toFixed(2)} USDT</b>\nShort by: <b>${shortage.toFixed(2)} USDT</b>\n\nThe deposit has been added to your balance.\nNew Balance: <b>${newBalance.toFixed(2)} USDT</b>\n\nYou can re-order when you have enough balance.`,
          mainMenuKeyboard()
        );

        // Notify admin
        const ADMIN_CHAT_ID = Number(Deno.env.get("ADMIN_CHAT_ID"));
        if (ADMIN_CHAT_ID) {
          await sendTelegramMessage(ADMIN_CHAT_ID,
            `⚠️ <b>Order Auto-Cancelled</b>\n\nCustomer: ${customer.first_name || ''} (@${customer.username || 'N/A'})\nProduct: ${product.name} x${qty}\nRequired: ${totalPrice.toFixed(2)} USDT\nDeposit: ${amount.toFixed(2)} USDT\nBalance: ${currentBalance.toFixed(2)} USDT\nTotal Available: ${totalAvailable.toFixed(2)} USDT\n\nDeposit added to balance.`
          );
        }

        return new Response(JSON.stringify({ success: true, action: "order_cancelled_insufficient", newBalance }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Sufficient funds — new balance = (current balance + deposit) - product cost
      const newBalance = currentBalance + amount - totalPrice;
      const amountFromBalance = Math.max(0, totalPrice - amount);
      await supabase.from("bot_customers").update({ balance: newBalance, updated_at: new Date().toISOString() }).eq("id", customer.id);

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

        return new Response(JSON.stringify({ success: true, action: "manual_delivery_pending", product: product.name, qty }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      paymentMsg += `\n\n⏳ Delivering your order...`;
      await sendTelegramMessage(customer.chat_id, paymentMsg);

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
        }).select("id").single();

        if (!orderRow?.id) throw new Error("Order create failed");

        const { data: reserved, error: reserveError } = await supabase.rpc("reserve_internal_stock_items", {
          _product_id: product.id,
          _quantity: qty,
          _order_id: orderRow?.id,
        });

        if (reserveError || !reserved || reserved.length < qty) {
          if (orderRow?.id) await supabase.from("bot_orders").update({ status: "stock_failed" }).eq("id", orderRow.id);
          await sendTelegramMessage(customer.chat_id, "❌ Stock finished. Contact admin for refund.", mainMenuKeyboard());
          return new Response(JSON.stringify({ error: "Insufficient internal stock" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const orderDetails = reserved.map((item: { data: Record<string, string> }) => item.data || {});
        await supabase.from("bot_orders").update({ details: orderDetails }).eq("id", orderRow.id);
        await sendTelegramMessage(customer.chat_id,
          `✅ <b>Order Delivered!</b>\n\nProduct: <b>${product.name}</b>\nQuantity: <b>${qty}</b>\nTotal Paid: <b>${totalPrice.toFixed(2)} ${product.currency}</b>`
        );

        const CHUNK_SIZE = 30;
        for (let i = 0; i < orderDetails.length; i += CHUNK_SIZE) {
          const chunk = orderDetails.slice(i, i + CHUNK_SIZE);
          let msg = `📦 <b>Items${orderDetails.length > CHUNK_SIZE ? ` (${i + 1}-${i + chunk.length} of ${qty})` : ''}:</b>\n\n`;
          for (const item of chunk) msg += `<code>${Object.values(item).join(" | ")}</code>\n`;
          await sendTelegramMessage(customer.chat_id, msg);
        }

        if (product.delivery_instruction) {
          await sendTelegramMessage(customer.chat_id, `📋 <b>Important Instructions:</b>\n\n${product.delivery_instruction}`, mainMenuKeyboard());
        }

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
      }).select("id").single();

      await sendTelegramMessage(customer.chat_id,
        `✅ <b>Payment Verified & Order Placed!</b>\n\nProduct: <b>${product.name}</b>\nQuantity: <b>${qty}</b>\nTotal: <b>${totalPrice.toFixed(2)} ${product.currency}</b>\n\n⏳ <b>Your order is being processed.</b>\nAdmin will deliver it manually.`,
        mainMenuKeyboard()
      );

      return new Response(JSON.stringify({ success: true, action: "pending_delivery", product: product.name, qty, orderId: orderRow?.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // No pending product — just add to balance
    const newBalance = Number(customer.balance) + amount;
    await supabase.from("bot_customers").update({ balance: newBalance, updated_at: new Date().toISOString() }).eq("id", customer.id);

    await sendTelegramMessage(customer.chat_id,
      `✅ <b>Deposit Verified by Admin!</b>\n\nAmount: <b>${amount.toFixed(2)} USDT</b>\nNew Balance: <b>${newBalance.toFixed(2)} USDT</b>`,
      mainMenuKeyboard()
    );

    return new Response(JSON.stringify({ success: true, action: "balance_added", newBalance }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Admin verify error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
