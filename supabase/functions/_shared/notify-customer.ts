// Shared helper: notify a customer over Telegram (if chat_id is real) AND email (if a real
// non-synthetic email is bound to the auth user). Safe to call from any admin edge function.
//
// Usage:
//   await notifyCustomer(supabase, {
//     customer,                  // bot_customers row (must include id, chat_id, auth_user_id, first_name)
//     telegram: { text, replyMarkup, photoUrl },  // photoUrl optional → sends photo with caption
//     email:    { templateName, templateData },   // optional; skipped if no real email bound
//   });

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const TELEGRAM_API_KEY = Deno.env.get("TELEGRAM_API_KEY_1") || Deno.env.get("TELEGRAM_API_KEY");
const BOT_TOKEN = Deno.env.get("BOT_TOKEN") || Deno.env.get("TELEGRAM_BOT_TOKEN");

interface NotifyCustomerArgs {
  customer: { id?: string; chat_id?: number | null; auth_user_id?: string | null; first_name?: string | null; username?: string | null };
  telegram?: { text: string; replyMarkup?: unknown; photoUrl?: string | null };
  email?: { templateName: string; templateData?: Record<string, unknown> };
}

async function sendTelegram(chatId: number, args: NonNullable<NotifyCustomerArgs["telegram"]>) {
  // Prefer direct Bot API (BOT_TOKEN) since standalone bot uses it; fallback to Lovable gateway.
  let url: string;
  let headers: Record<string, string>;

  if (BOT_TOKEN) {
    url = `https://api.telegram.org/bot${BOT_TOKEN}`;
    headers = { "Content-Type": "application/json" };
  } else if (LOVABLE_API_KEY && TELEGRAM_API_KEY) {
    url = GATEWAY_URL;
    headers = {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TELEGRAM_API_KEY,
      "Content-Type": "application/json",
    };
  } else {
    return { ok: false, skipped: "no_telegram_keys" };
  }

  try {
    if (args.photoUrl) {
      const body: Record<string, unknown> = { chat_id: chatId, photo: args.photoUrl, parse_mode: "HTML" };
      if (args.text) body.caption = args.text;
      if (args.replyMarkup) body.reply_markup = args.replyMarkup;
      const r = await fetch(`${url}/sendPhoto`, { method: "POST", headers, body: JSON.stringify(body) });
      if (!r.ok) console.error("notifyCustomer sendPhoto failed", r.status, await r.text().catch(() => ""));
      return { ok: r.ok };
    }
    const body: Record<string, unknown> = { chat_id: chatId, text: args.text, parse_mode: "HTML", disable_web_page_preview: true };
    if (args.replyMarkup) body.reply_markup = args.replyMarkup;
    const r = await fetch(`${url}/sendMessage`, { method: "POST", headers, body: JSON.stringify(body) });
    if (!r.ok) console.error("notifyCustomer sendMessage failed", r.status, await r.text().catch(() => ""));
    return { ok: r.ok };
  } catch (e) {
    console.error("notifyCustomer telegram error", (e as Error).message);
    return { ok: false, error: String((e as Error).message || e) };
  }
}

async function sendEmail(supabase: SupabaseClient, recipientEmail: string, args: NonNullable<NotifyCustomerArgs["email"]>) {
  try {
    const { error } = await supabase.functions.invoke("send-transactional-email", {
      body: {
        templateName: args.templateName,
        recipientEmail,
        templateData: args.templateData || {},
        purpose: "transactional",
      },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error).message || e) };
  }
}

export async function notifyCustomer(supabase: SupabaseClient, args: NotifyCustomerArgs) {
  const results: { telegram?: unknown; email?: unknown } = {};

  // Telegram: real bot chat_ids are positive; web-only synthetic chat_ids are negative.
  if (args.telegram && typeof args.customer.chat_id === "number" && args.customer.chat_id > 0) {
    results.telegram = await sendTelegram(args.customer.chat_id, args.telegram);
  }

  // Email: only if a real (non-synthetic) email is bound to the auth user
  if (args.email && args.customer.auth_user_id) {
    try {
      const { data: u } = await supabase.auth.admin.getUserById(args.customer.auth_user_id);
      const email = u?.user?.email;
      if (email && !email.endsWith("@telegram.local")) {
        results.email = await sendEmail(supabase, email, args.email);
      }
    } catch (e) {
      results.email = { ok: false, error: String((e as Error).message || e) };
    }
  }

  return results;
}
