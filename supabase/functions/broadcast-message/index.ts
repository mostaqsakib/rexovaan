import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sendTelegramMessage(chatId: number, text: string, LOVABLE_API_KEY: string, TELEGRAM_API_KEY: string) {
  const res = await fetch(`${GATEWAY_URL}/sendMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TELEGRAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const data = await res.json();
  return { ok: res.ok, chatId, data };
}

async function sendTelegramPhoto(chatId: number, photoUrl: string, caption: string | undefined, LOVABLE_API_KEY: string, TELEGRAM_API_KEY: string) {
  const body: Record<string, unknown> = { chat_id: chatId, photo: photoUrl };
  if (caption) { body.caption = caption; body.parse_mode = "HTML"; }
  const res = await fetch(`${GATEWAY_URL}/sendPhoto`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TELEGRAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { ok: res.ok, chatId, data };
}

async function sendTelegramVideo(chatId: number, videoUrl: string, caption: string | undefined, LOVABLE_API_KEY: string, TELEGRAM_API_KEY: string) {
  const body: Record<string, unknown> = { chat_id: chatId, video: videoUrl };
  if (caption) { body.caption = caption; body.parse_mode = "HTML"; }
  const res = await fetch(`${GATEWAY_URL}/sendVideo`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TELEGRAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { ok: res.ok, chatId, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const TELEGRAM_API_KEY = (Deno.env.get("TELEGRAM_API_KEY_1") || Deno.env.get("TELEGRAM_API_KEY"));
  if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY) {
    return new Response(JSON.stringify({ error: "Missing API keys" }), { status: 500, headers: corsHeaders });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const { message, mediaUrl, mediaType } = await req.json();
    if (!message?.trim() && !mediaUrl) {
      return new Response(JSON.stringify({ error: "Message or media is required" }), { status: 400, headers: corsHeaders });
    }

    const { data: customers, error } = await supabase.from("bot_customers").select("chat_id");
    if (error) throw error;
    if (!customers || customers.length === 0) {
      return new Response(JSON.stringify({ error: "No customers found" }), { status: 400, headers: corsHeaders });
    }

    let sent = 0;
    let failed = 0;
    const failures: number[] = [];

    for (const customer of customers) {
      try {
        let result;
        if (mediaUrl && mediaType === 'video') {
          result = await sendTelegramVideo(customer.chat_id, mediaUrl, message?.trim() || undefined, LOVABLE_API_KEY, TELEGRAM_API_KEY);
        } else if (mediaUrl) {
          result = await sendTelegramPhoto(customer.chat_id, mediaUrl, message?.trim() || undefined, LOVABLE_API_KEY, TELEGRAM_API_KEY);
        } else {
          result = await sendTelegramMessage(customer.chat_id, message, LOVABLE_API_KEY, TELEGRAM_API_KEY);
        }

        if (result.ok) {
          sent++;
        } else {
          failed++;
          failures.push(customer.chat_id);
        }
      } catch {
        failed++;
        failures.push(customer.chat_id);
      }
      if (sent % 25 === 0 && sent > 0) await new Promise(r => setTimeout(r, 1000));
    }

    return new Response(JSON.stringify({ ok: true, total: customers.length, sent, failed, failures }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
