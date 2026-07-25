// Detect sticker pack short_names from custom_emoji_ids (or HTML with <tg-emoji> tags),
// then trigger sync via list-my-emoji-sticker-sets.
// Input: { emoji_ids?: string[], html?: string }
// Output: { pack_names: string[], sets: [...] }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BOT_TOKEN = Deno.env.get('BOT_TOKEN')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

async function tg(method: string, body: any) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(`${method}: ${JSON.stringify(j)}`);
  return j.result;
}

function extractIdsFromHtml(html: string): string[] {
  const ids = new Set<string>();
  const re = /(?:emoji-id|data-emoji-id|custom-emoji-id)\s*=\s*["']([0-9]+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) ids.add(m[1]);
  // Also raw 16–20 digit numbers (Telegram custom_emoji_ids)
  const raw = html.match(/\b\d{16,20}\b/g);
  if (raw) raw.forEach((n) => ids.add(n));
  return Array.from(ids);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: roleRow } = await supabase
      .from('user_roles').select('role').eq('user_id', userData.user.id).eq('role', 'admin').maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: 'admin_only' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json().catch(() => ({}));
    const ids = new Set<string>();
    if (Array.isArray(body.emoji_ids)) body.emoji_ids.forEach((s: any) => ids.add(String(s).trim()));
    if (typeof body.html === 'string') extractIdsFromHtml(body.html).forEach((id) => ids.add(id));
    const idList = Array.from(ids).filter((s) => /^\d{10,25}$/.test(s)).slice(0, 200);
    if (idList.length === 0) {
      return new Response(JSON.stringify({ error: 'no emoji ids found' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // getCustomEmojiStickers returns Sticker[] each with .set_name
    const stickers: any[] = await tg('getCustomEmojiStickers', { custom_emoji_ids: idList });
    const packNames = Array.from(new Set(stickers.map((s) => s.set_name).filter(Boolean)));
    if (packNames.length === 0) {
      return new Response(JSON.stringify({ pack_names: [], sets: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Delegate sync to list-my-emoji-sticker-sets (which caches thumbnails + main emoji cache)
    const syncRes = await fetch(`${SUPABASE_URL}/functions/v1/list-my-emoji-sticker-sets`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ set_names: packNames }),
    });
    const syncJson = await syncRes.json();
    return new Response(JSON.stringify({ pack_names: packNames, sets: syncJson.sets || [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
