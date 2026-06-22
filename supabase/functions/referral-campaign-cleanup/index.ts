import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const tgUrl = (token: string, method: string) =>
  `https://api.telegram.org/bot${token}/${method}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const BOT_TOKEN = Deno.env.get("BOT_TOKEN");
  if (!BOT_TOKEN) {
    return new Response(JSON.stringify({ error: "Missing BOT_TOKEN" }), { status: 500, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: rows, error } = await supabase
      .from("bot_campaign_messages")
      .select("id, chat_id, message_id")
      .eq("campaign_key", "referral");
    if (error) throw error;
    const list = rows || [];

    let deleted = 0;
    let skipped = 0;
    const idsToClear: string[] = [];

    for (let i = 0; i < list.length; i += 20) {
      const batch = list.slice(i, i + 20);
      const results = await Promise.allSettled(batch.map(async (m: any) => {
        const res = await fetch(tgUrl(BOT_TOKEN, "deleteMessage"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: m.chat_id, message_id: m.message_id }),
        });
        const data = await res.json().catch(() => ({}));
        return { id: m.id, ok: res.ok && data?.ok !== false };
      }));
      for (const r of results) {
        if (r.status === "fulfilled") {
          idsToClear.push(r.value.id);
          if (r.value.ok) deleted++; else skipped++;
        } else {
          skipped++;
        }
      }
      if (i + 20 < list.length) await new Promise((r) => setTimeout(r, 500));
    }

    // Clear all attempted rows (silently skip already-deleted-by-user cases too)
    if (idsToClear.length > 0) {
      for (let i = 0; i < idsToClear.length; i += 500) {
        await supabase
          .from("bot_campaign_messages")
          .delete()
          .in("id", idsToClear.slice(i, i + 500));
      }
    }

    return new Response(JSON.stringify({ ok: true, deleted, skipped, total: list.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
