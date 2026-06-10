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

interface NotifyCustomerArgs {
  customer: { id?: string; chat_id?: number | null; auth_user_id?: string | null; first_name?: string | null; username?: string | null };
  telegram?: { text: string; replyMarkup?: unknown; photoUrl?: string | null };
  email?: { templateName: string; templateData?: Record<string, unknown> };
}

async function sendTelegram(chatId: number, args: NonNullable<NotifyCustomerArgs["telegram"]>) {
  if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY) return { ok: false, skipped: "no_telegram_keys" };
  const headers = {
    Authorization: `Bearer ${LOVABLE_API_KEY}`,
    "X-Connection-Api-Key": TELEGRAM_API_KEY,
    "Content-Type": "application/json",
  };
  try {
    if (args.photoUrl) {
      const body: Record<string, unknown> = { chat_id: chatId, photo: args.photoUrl, parse_mode: "HTML" };
      if (args.text) body.caption = args.text;
      const r = await fetch(`${GATEWAY_URL}/sendPhoto`, { method: "POST", headers, body: JSON.stringify(body) });
      return { ok: r.ok };
    }
    const body: Record<string, unknown> = { chat_id: chatId, text: args.text, parse_mode: "HTML", disable_web_page_preview: true };
    if (args.replyMarkup) body.reply_markup = args.replyMarkup;
    const r = await fetch(`${GATEWAY_URL}/sendMessage`, { method: "POST", headers, body: JSON.stringify(body) });
    return { ok: r.ok };
  } catch (e) {
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
