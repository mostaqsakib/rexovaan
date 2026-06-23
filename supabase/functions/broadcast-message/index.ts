import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdmin } from "../_shared/require-admin.ts";

const tgUrl = (botToken: string, method: string) => `https://api.telegram.org/bot${botToken}/${method}`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

async function tgSend(method: string, body: Record<string, unknown>, botToken: string) {
  const res = await fetch(tgUrl(botToken, method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data?.ok !== false, data };
}

async function sendToChat(
  chatId: number,
  text: string | undefined,
  mediaUrl: string | null,
  mediaType: string | null,
  replyMarkup: unknown,
  botToken: string,
) {
  const base: Record<string, unknown> = { chat_id: chatId, parse_mode: "HTML" };
  if (replyMarkup) base.reply_markup = replyMarkup;

  if (mediaUrl && mediaType === "video") {
    return tgSend("sendVideo", { ...base, video: mediaUrl, caption: text || undefined }, botToken);
  }
  if (mediaUrl) {
    return tgSend("sendPhoto", { ...base, photo: mediaUrl, caption: text || undefined }, botToken);
  }
  return tgSend("sendMessage", { ...base, text: text || "", disable_web_page_preview: true }, botToken);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const _adminGuard = await requireAdmin(req, corsHeaders);
  if (_adminGuard) return _adminGuard;

  const BOT_TOKEN = Deno.env.get("BOT_TOKEN");
  if (!BOT_TOKEN) {
    return new Response(JSON.stringify({ error: "Missing BOT_TOKEN" }), { status: 500, headers: corsHeaders });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const { message, mediaUrl, mediaType, productButtons } = await req.json();
    if (!message?.trim() && !mediaUrl) {
      return new Response(JSON.stringify({ error: "Message or media is required" }), { status: 400, headers: corsHeaders });
    }

    // Build inline keyboard from selected products
    let replyMarkup: unknown = undefined;
    if (Array.isArray(productButtons) && productButtons.length > 0) {
      const ids = productButtons.map((b: any) => String(b.productId)).filter(Boolean);
      const { data: products } = await supabase
        .from("bot_products")
        .select("id,name,short_code,custom_emoji_id")
        .in("id", ids);
      const productMap = new Map((products || []).map((p: any) => [p.id, p]));
      const botUsername = String(Deno.env.get("BOT_USERNAME") || "").replace(/^@/, "");
      const { data: buyNowEmoji } = await supabase
        .from("bot_button_emojis")
        .select("custom_emoji_id")
        .eq("button_key", "buy_now")
        .maybeSingle();
      const buyNowEmojiId = buyNowEmoji?.custom_emoji_id || null;

      const rows: unknown[][] = [];
      for (const b of productButtons) {
        const p: any = productMap.get(String(b.productId));
        if (!p) continue;
        const code = p.short_code || String(p.id).slice(0, 4).toUpperCase();
        const label = String(b.label || "").trim() || `Buy ${cleanButtonText(p.name)}`;
        const btn: Record<string, unknown> = botUsername
          ? { text: label, url: `https://t.me/${botUsername}?start=p_${code}` }
          : { text: label, callback_data: `buy_${p.id}` };
        if (buyNowEmojiId) btn.icon_custom_emoji_id = buyNowEmojiId;
        btn.style = "primary";
        rows.push([btn]);
      }
      if (rows.length > 0) replyMarkup = { inline_keyboard: rows };
    }

    const { data: customers, error } = await supabase.from("bot_customers").select("chat_id");
    if (error) throw error;
    if (!customers || customers.length === 0) {
      return new Response(JSON.stringify({ error: "No customers found" }), { status: 400, headers: corsHeaders });
    }

    let sent = 0;
    let failed = 0;
    const failures: number[] = [];

    for (let i = 0; i < customers.length; i += 25) {
      const batch = customers.slice(i, i + 25);
      const results = await Promise.allSettled(
        batch.map((c) => sendToChat(c.chat_id, message?.trim(), mediaUrl || null, mediaType || null, replyMarkup, BOT_TOKEN)),
      );
      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status === "fulfilled" && r.value.ok) sent++;
        else { failed++; failures.push(batch[j].chat_id); }
      }
      if (i + 25 < customers.length) await new Promise((r) => setTimeout(r, 1000));
    }

    return new Response(JSON.stringify({ ok: true, total: customers.length, sent, failed, failures }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
