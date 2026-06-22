import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const tgUrl = (token: string, method: string) =>
  `https://api.telegram.org/bot${token}/${method}`;

async function tgSend(method: string, body: Record<string, unknown>, token: string) {
  try {
    const res = await fetch(tgUrl(token, method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    const ok = res.ok && data?.ok !== false;
    if (!ok) {
      console.error("[referral-campaign-broadcast] Telegram API failed", JSON.stringify({
        method,
        status: res.status,
        error_code: data?.error_code,
        description: data?.description,
        parameters: data?.parameters,
      }));
    }
    return { ok, status: res.status, data };
  } catch (err) {
    const description = `Telegram request failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error("[referral-campaign-broadcast] Telegram request threw", JSON.stringify({ method, description }));
    return { ok: false, status: 0, data: { description } };
  }
}

const DEFAULT_REFERRAL_CAMPAIGN_MESSAGE = `<tg-emoji emoji-id="5787601128669584115">⭐️</tg-emoji> <b>Refer & Earn!</b>

Use our bot and earn bonus on every successful referral!

<tg-emoji emoji-id="5931347928810526429">👥</tg-emoji> <b>How it works?</b>
<blockquote>• Share your referral link
• When a friend clicks your link and starts the bot, you earn a bonus
• Bonus is credited directly to your wallet</blockquote>

<tg-emoji emoji-id="5271604874419647061">🔗</tg-emoji> <b>Your Referral Link:</b>
{referral_link}

<tg-emoji emoji-id="5409048419211682843">💵</tg-emoji> <b>Earn per referral:</b> {reward} USDT

<i>(Limited Time Campaign)</i>`;

function telegramError(label: string, result: { status?: number; data?: any }) {
  const data = result?.data || {};
  const status = result?.status ? `HTTP ${result.status}` : "HTTP unknown";
  const code = data?.error_code ? `error_code ${data.error_code}` : "no error_code";
  const description = data?.description || JSON.stringify(data);
  return `${label}: ${status}, ${code}, ${description}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const BOT_TOKEN = Deno.env.get("BOT_TOKEN");
  const BOT_USERNAME = String(Deno.env.get("BOT_USERNAME") || "").replace(/^@/, "");
  if (!BOT_TOKEN) {
    return new Response(JSON.stringify({ error: "Missing BOT_TOKEN" }), { status: 500, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { target, preview_chat_id } = await req.json();
    if (target !== "users" && target !== "groups" && target !== "preview") {
      return new Response(JSON.stringify({ error: "target must be 'users', 'groups', or 'preview'" }), {
        status: 400, headers: corsHeaders,
      });
    }


    // Load campaign settings
    const { data: settingsRows } = await supabase
      .from("bot_settings")
      .select("key, value")
      .in("key", [
        "referral_campaign_message",
        "referral_campaign_button_text",
        "referral_campaign_button_emoji",
        "referral_campaign_button_emoji_id",
        "referral_campaign_group_button_emoji",
        "referral_campaign_group_button_emoji_id",
        "referral_campaign_group_button_text",
        "referral_campaign_group_button_style",
        "referral_campaign_reward",
      ]);
    const settings: Record<string, string> = Object.fromEntries(
      (settingsRows || []).map((r: any) => [r.key, r.value || ""]),
    );

    const template = settings.referral_campaign_message || DEFAULT_REFERRAL_CAMPAIGN_MESSAGE;
    const buttonText = settings.referral_campaign_button_text || "🔗 My Referral Link";
    const buttonEmojiId = settings.referral_campaign_button_emoji_id || "";
    const groupButtonEmoji = settings.referral_campaign_group_button_emoji || "";
    const groupButtonEmojiId = settings.referral_campaign_group_button_emoji_id || "";
    const groupButtonText = settings.referral_campaign_group_button_text || "Get My Referral Link";
    // Telegram Bot API 9.4: style must be exactly "primary" (blue), "success" (green), or "danger" (red).
    const rawStyle = String(settings.referral_campaign_group_button_style || "primary").toLowerCase();
    const groupButtonStyle = ["primary","success","danger"].includes(rawStyle) ? rawStyle : "primary";
    const reward = settings.referral_campaign_reward || "0.1";

    function buildCampaignButton(label: string, referralLink: string) {
      const btn: any = { text: label, copy_text: { text: referralLink } };
      if (buttonEmojiId) btn.icon_custom_emoji_id = buttonEmojiId;
      return btn;
    }

    function buildGroupButton(url: string) {
      const btn: any = { url };
      if (groupButtonEmojiId) {
        // Premium custom emoji: render emoji only. `text` is required by Telegram
        // but a single space keeps the visual to just the premium emoji icon.
        btn.text = " ";
        btn.icon_custom_emoji_id = groupButtonEmojiId;
      } else if (groupButtonEmoji) {
        btn.text = groupButtonEmoji;
      } else {
        btn.text = groupButtonText;
      }
      // Bot API 9.4+: style renders the button in the chosen color.
      btn.style = groupButtonStyle;
      return btn;
    }


    let sent = 0;
    let failed = 0;
    const stored: Array<{ chat_id: number; message_id: number; target_type: string }> = [];

    if (target === "preview") {
      const cid = Number(preview_chat_id);
      if (!cid) {
        return new Response(JSON.stringify({ error: "preview_chat_id required. Bind your Telegram account first." }), { status: 400, headers: corsHeaders });
      }
      const link = BOT_USERNAME
        ? `https://t.me/${BOT_USERNAME}?start=ref_${cid}`
        : `(link unavailable)`;
      const text = "👁 PREVIEW (only visible to you)\n\n" + template
        .replaceAll("{referral_link}", link)
        .replaceAll("{reward}", reward);
      const userText = "— — — — —\n👥 GROUP VERSION PREVIEW:\n\n" + template
        .replaceAll("{referral_link}", "👉 Start the bot to get your referral link!")
        .replaceAll("{reward}", reward);
      const groupBtnUrl = BOT_USERNAME ? `https://t.me/${BOT_USERNAME}?start=ref` : "https://t.me/";

      const r1 = await tgSend("sendMessage", {
        chat_id: cid,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [[buildCampaignButton(buttonText, link)]] },
      }, BOT_TOKEN);
      const r2 = await tgSend("sendMessage", {
        chat_id: cid,
        text: userText,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [[buildGroupButton(groupBtnUrl)]] },
      }, BOT_TOKEN);

      const errors: string[] = [];
      if (!r1.ok) errors.push(telegramError("Admin preview", r1));
      if (!r2.ok) errors.push(telegramError("Group preview", r2));

      if (errors.length > 0) {
        // Try a plaintext fallback so the admin still receives content + sees the HTML error
        const plain = (s: string) => s.replace(/<\/?[^>]+>/g, "");
        if (!r1.ok) {
          await tgSend("sendMessage", {
            chat_id: cid,
            text: "⚠️ HTML parse failed for admin preview. Plaintext fallback:\n\n" + plain(text),
            disable_web_page_preview: true,
          }, BOT_TOKEN);
        }
        if (!r2.ok) {
          await tgSend("sendMessage", {
            chat_id: cid,
            text: "⚠️ HTML parse failed for group preview. Plaintext fallback:\n\n" + plain(userText),
            disable_web_page_preview: true,
          }, BOT_TOKEN);
        }
      }

      if (!r1.ok && !r2.ok) {
        return new Response(JSON.stringify({
          error: "Telegram rejected the message: " + errors.join(" | "),
          details: { r1: r1.data, r2: r2.data },
        }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        ok: true,
        preview: true,
        sent: (r1.ok?1:0)+(r2.ok?1:0),
        warnings: errors.length ? errors : undefined,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    }

    if (target === "users") {

      const { data: customers, error } = await supabase
        .from("bot_customers")
        .select("chat_id")
        .gt("chat_id", 0)
        .eq("is_banned", false);
      if (error) throw error;
      const list = customers || [];

      for (let i = 0; i < list.length; i += 20) {
        const batch = list.slice(i, i + 20);
        const results = await Promise.allSettled(batch.map(async (c: any) => {
          const link = BOT_USERNAME
            ? `https://t.me/${BOT_USERNAME}?start=ref_${c.chat_id}`
            : `(link unavailable)`;
          const text = template
            .replaceAll("{referral_link}", link)
            .replaceAll("{reward}", reward);
          const replyMarkup = {
            inline_keyboard: [[buildCampaignButton(buttonText, link)]],
          };
          const r = await tgSend("sendMessage", {
            chat_id: c.chat_id,
            text,
            parse_mode: "HTML",
            disable_web_page_preview: true,
            reply_markup: replyMarkup,
          }, BOT_TOKEN);
          return { c, r };
        }));
        for (const res of results) {
          if (res.status === "fulfilled" && res.value.r.ok) {
            sent++;
            const mid = res.value.r.data?.result?.message_id;
            const cid = res.value.r.data?.result?.chat?.id ?? res.value.c.chat_id;
            if (mid && cid) stored.push({ chat_id: cid, message_id: mid, target_type: "user" });
          } else {
            failed++;
          }
        }
        if (i + 20 < list.length) await new Promise((r) => setTimeout(r, 1000));
      }
    } else {
      const { data: groups, error } = await supabase
        .from("bot_broadcast_groups")
        .select("chat_id")
        .eq("is_active", true);
      if (error) throw error;
      const list = groups || [];

      const groupCta = "👉 Start the bot to get your referral link!";
      const groupBtnUrl = BOT_USERNAME
        ? `https://t.me/${BOT_USERNAME}?start=ref`
        : "https://t.me/";

      for (const g of list) {
        const text = template
          .replaceAll("{referral_link}", groupCta)
          .replaceAll("{reward}", reward);
        const replyMarkup = {
          inline_keyboard: [[buildGroupButton(groupBtnUrl)]],
        };
        const r = await tgSend("sendMessage", {
          chat_id: g.chat_id,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
          reply_markup: replyMarkup,
        }, BOT_TOKEN);
        if (r.ok) {
          sent++;
          const mid = r.data?.result?.message_id;
          const cid = r.data?.result?.chat?.id ?? g.chat_id;
          if (mid && cid) stored.push({ chat_id: cid, message_id: mid, target_type: "group" });
        } else {
          failed++;
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    if (stored.length > 0) {
      const rows = stored.map((s) => ({
        chat_id: s.chat_id,
        message_id: s.message_id,
        campaign_key: "referral",
        target_type: s.target_type,
      }));
      // Insert in chunks
      for (let i = 0; i < rows.length; i += 500) {
        await supabase.from("bot_campaign_messages").insert(rows.slice(i, i + 500));
      }
    }

    return new Response(JSON.stringify({ ok: true, sent, failed, total: sent + failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
