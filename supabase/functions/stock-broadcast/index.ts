import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const tgUrl = (botToken: string, method: string) => `https://api.telegram.org/bot${botToken}/${method}`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

declare const EdgeRuntime: { waitUntil?: (promise: Promise<unknown>) => void } | undefined;

const PLACEHOLDER_KEYS = new Set(["product", "stock", "price", "added"]);

function normalizePlaceholderMarkup(html: string) {
  return String(html || "").replace(/\{[^{}]*\}/g, (match) => {
    const inner = match.slice(1, -1);
    const plain = inner.replace(/<[^>]*>/g, "").trim();
    if (!PLACEHOLDER_KEYS.has(plain)) return match;

    const openings = (inner.match(/<(?!\/)[^>]+>/g) || []).join("");
    const closings = (inner.match(/<\/[^>]+>/g) || []).join("");
    return `${openings}{${plain}}${closings}`;
  });
}

function normalizeTelegramHtml(html: string) {
  let result = normalizePlaceholderMarkup(html);
  for (let i = 0; i < 5; i += 1) {
    const prev = result;
    result = result
      .replace(/<(b|i|u|s|code)><tg-emoji([^>]*)>([\s\S]*?)<\/\1><\/tg-emoji><\1>([\s\S]*?)<\/\1>/g, '<$1><tg-emoji$2>$3</tg-emoji>$4</$1>')
      .replace(/<(b|i|u|s|code)><tg-emoji([^>]*)>([\s\S]*?)<\/\1><\/tg-emoji>/g, '<$1><tg-emoji$2>$3</tg-emoji></$1>');
    if (result === prev) break;
  }
  return result;
}

function replacePlaceholders(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), normalizeTelegramHtml(template));
}

function stripCustomEmoji(html: string) {
  return html.replace(/<tg-emoji[^>]*>([^<]*)<\/tg-emoji>/g, "$1");
}

function cleanButtonText(text: string) {
  return stripCustomEmoji(text)
    .replace(/<[^>]+>/g, "")
    .replace(/[\u200d\ufe0f]/g, "")
    .replace(/(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function simplifyTelegramHtml(html: string) {
  return stripCustomEmoji(String(html || ""))
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function standardKeyboard(replyMarkup: unknown) {
  if (!replyMarkup || typeof replyMarkup !== "object" || !("inline_keyboard" in replyMarkup)) return replyMarkup;
  const keyboard = (replyMarkup as { inline_keyboard?: unknown[][] }).inline_keyboard;
  if (!Array.isArray(keyboard)) return replyMarkup;
  return {
    inline_keyboard: keyboard.map((row) => row.map((button) => {
      if (!button || typeof button !== "object") return button;
      const { icon_custom_emoji_id: _icon, style: _style, ...rest } = button as Record<string, unknown>;
      return rest;
    })),
  };
}

async function sendTelegramMessage(chatId: number, text: string, replyMarkup: unknown, lovableApiKey: string, telegramApiKey: string) {
  const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (replyMarkup) body.reply_markup = replyMarkup;

  let res = await fetch(`${GATEWAY_URL}/sendMessage`, {
    method: "POST",
    headers: { Authorization: `Bearer ${lovableApiKey}`, "X-Connection-Api-Key": telegramApiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data = await res.json().catch(() => ({}));

  const failed = () => !res.ok || data?.ok === false;
  const isEmojiError = () => {
    const desc = String(data?.description || "").toLowerCase();
    return desc.includes("emoji") || desc.includes("custom_emoji") || desc.includes("entity");
  };

  if (failed() && isEmojiError() && text.includes("<tg-emoji")) {
    body.text = stripCustomEmoji(text);
    res = await fetch(`${GATEWAY_URL}/sendMessage`, {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableApiKey}`, "X-Connection-Api-Key": telegramApiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    data = await res.json().catch(() => ({}));
  }

  if (failed()) {
    const plainText = simplifyTelegramHtml(String(body.text || text));
    if (plainText) {
      body.text = plainText;
      delete body.parse_mode;
      res = await fetch(`${GATEWAY_URL}/sendMessage`, {
        method: "POST",
        headers: { Authorization: `Bearer ${lovableApiKey}`, "X-Connection-Api-Key": telegramApiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      data = await res.json().catch(() => ({}));
    }
  }

  if (failed() && replyMarkup) {
    body.reply_markup = standardKeyboard(replyMarkup);
    res = await fetch(`${GATEWAY_URL}/sendMessage`, {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableApiKey}`, "X-Connection-Api-Key": telegramApiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    data = await res.json().catch(() => ({}));
  }

  return { ok: res.ok && data?.ok !== false, data };
}

async function broadcastStock(productId: string, addedCount: number, stockItemIds: string[] = []) {
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
  const telegramApiKey = Deno.env.get("TELEGRAM_API_KEY_1") || Deno.env.get("TELEGRAM_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!lovableApiKey || !telegramApiKey || !supabaseUrl || !serviceKey) throw new Error("Missing backend configuration");

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data: product, error: productError } = await supabase.from("bot_products").select("id,name,price,custom_emoji_id,short_code").eq("id", productId).single();
  if (productError || !product) throw productError || new Error("Product not found");

  const { count: currentStock, error: countError } = await supabase
    .from("bot_product_stock_items")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId)
    .eq("status", "available");
  if (countError) throw countError;

  const { data: settings } = await supabase.from("bot_settings").select("value").eq("key", "msg_stock_alert").maybeSingle();
  const { data: alertEmoji } = await supabase.from("bot_button_emojis").select("custom_emoji_id,style").eq("button_key", "stock_alert").maybeSingle();
  const alertIcon = alertEmoji?.custom_emoji_id ? `<tg-emoji emoji-id="${alertEmoji.custom_emoji_id}">📢</tg-emoji>` : "📢";
  const productIcon = product.custom_emoji_id ? `<tg-emoji emoji-id="${product.custom_emoji_id}">📦</tg-emoji> ` : "";
  const actualAddedCount = stockItemIds.length > 0 ? stockItemIds.length : addedCount;
  const template = settings?.value || `${alertIcon} <b>{added} new stock added for {product}!</b>\n\n📊 Available: <b>{stock}</b> items\n💰 Price: <b>{price} USDT</b>`;
  const message = replacePlaceholders(template, {
    product: `${productIcon}${product.name}`,
    added: String(actualAddedCount),
    stock: String(currentStock || 0),
    price: Number(product.price || 0).toFixed(2),
  });
  const botUsername = String(Deno.env.get("BOT_USERNAME") || "").replace(/^@/, "");
  const code = product.short_code || product.id.slice(0, 4).toUpperCase();
  const { data: buyNowEmoji } = await supabase.from("bot_button_emojis").select("custom_emoji_id").eq("button_key", "buy_now").maybeSingle();
  const buyNowEmojiId = buyNowEmoji?.custom_emoji_id || null;
  const buttonText = `Buy ${cleanButtonText(product.name)}`;
  const buyButton: Record<string, unknown> = { text: buttonText, callback_data: `buy_${product.id}` };
  if (buyNowEmojiId) buyButton.icon_custom_emoji_id = buyNowEmojiId;
  buyButton.style = "primary";
  const customerKeyboard = { inline_keyboard: [[buyButton]] };

  const groupButtonText = `Buy ${cleanButtonText(product.name)}`;
  const groupButton: Record<string, unknown> = botUsername
    ? { text: groupButtonText, url: `https://t.me/${botUsername}?start=p_${code}` }
    : { text: groupButtonText, callback_data: `buy_${product.id}` };
  if (buyNowEmojiId) groupButton.icon_custom_emoji_id = buyNowEmojiId;
  groupButton.style = "primary";
  const groupKeyboard = { inline_keyboard: [[groupButton]] };

  const { data: customers, error: customersError } = await supabase.from("bot_customers").select("chat_id");
  if (customersError) throw customersError;
  const { data: groups, error: groupsError } = await supabase.from("bot_broadcast_groups").select("chat_id").eq("is_active", true);
  if (groupsError) throw groupsError;
  const recipients = [
    ...(customers || []).map((c) => ({ chat_id: c.chat_id, isGroup: false })),
    ...(groups || []).map((g) => ({ chat_id: g.chat_id, isGroup: true })),
  ];

  let sent = 0;
  let failed = 0;
  const failureSamples: unknown[] = [];
  for (let i = 0; i < recipients.length; i += 25) {
    const batch = recipients.slice(i, i + 25);
    const results = await Promise.allSettled(batch.map((recipient) => sendTelegramMessage(recipient.chat_id, message, recipient.isGroup ? groupKeyboard : customerKeyboard, lovableApiKey, telegramApiKey)));
    for (const result of results) {
      if (result.status === "fulfilled" && result.value.ok) sent += 1;
      else {
        failed += 1;
        if (failureSamples.length < 3) failureSamples.push(result.status === "fulfilled" ? result.value.data : String(result.reason));
      }
    }
    if (i + 25 < recipients.length) await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  await supabase.from("bot_products").update({ last_known_stock: currentStock || 0 }).eq("id", productId);
  console.log(JSON.stringify({ event: "stock_broadcast_complete", productId, total: recipients.length, sent, failed, failureSamples }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const productId = String(body.productId || "");
    const addedCount = Number(body.addedCount || 0);
    const stockItemIds = Array.isArray(body.stockItemIds) ? body.stockItemIds.map(String).filter((id) => uuidRegex.test(id)).slice(0, 10000) : [];
    if (!uuidRegex.test(productId) || !Number.isInteger(addedCount) || addedCount <= 0 || addedCount > 10000) {
      return new Response(JSON.stringify({ error: "Valid productId and addedCount are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const task = broadcastStock(productId, addedCount, stockItemIds).catch((error) => console.error("stock_broadcast_failed", error));
    EdgeRuntime?.waitUntil?.(task);

    return new Response(JSON.stringify({ ok: true, queued: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});