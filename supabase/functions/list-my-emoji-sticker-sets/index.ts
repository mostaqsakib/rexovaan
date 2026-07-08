// Fetch admin's Telegram emoji sticker sets and cache them for the editor's emoji picker.
// Input:  { set_names: string[] } — short names like "AnimatedEmojies"
// Output: { sets: [{ set_name, title, emojis: [{ custom_emoji_id, emoji, thumb_url }] }] }
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(`${method}: ${JSON.stringify(j)}`);
  return j.result;
}

async function downloadFile(filePath: string): Promise<Uint8Array> {
  const r = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`);
  if (!r.ok) throw new Error(`download failed ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Only admins may call this
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: roleRow } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userData.user.id)
      .eq('role', 'admin')
      .maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: 'admin_only' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json().catch(() => ({}));
    const setNames: string[] = Array.isArray(body.set_names)
      ? body.set_names.map((s: any) => String(s).trim()).filter(Boolean).slice(0, 20)
      : [];

    // If no set_names passed, return whatever we have cached
    if (setNames.length === 0) {
      const { data: cached } = await supabase.from('bot_emoji_sticker_sets').select('*').order('title');
      return new Response(JSON.stringify({ sets: cached || [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const results: any[] = [];
    for (const setName of setNames) {
      try {
        const set = await tg('getStickerSet', { name: setName });
        if (!set || set.sticker_type !== 'custom_emoji') {
          throw new Error('Not a custom emoji sticker set');
        }

        // Upload thumbnails for each sticker (webp fallback) into custom-emojis bucket
        const emojis: any[] = [];
        for (const st of (set.stickers || []).slice(0, 200)) {
          const id = String(st.custom_emoji_id);
          const emoji = st.emoji || '';
          let thumbUrl: string | null = null;
          try {
            // Use webp thumbnail for fast preview grid
            const thumb = st.thumbnail || st.thumb;
            const fileId = thumb?.file_id || st.file_id;
            const path = `${id}.webp`;
            // Check if already uploaded
            const { data: existing } = supabase.storage.from('custom-emojis').getPublicUrl(path);
            // Try HEAD to see if it's there
            const head = await fetch(existing.publicUrl, { method: 'HEAD' });
            if (head.ok) {
              thumbUrl = existing.publicUrl;
            } else {
              const fileInfo = await tg('getFile', { file_id: fileId });
              const bytes = await downloadFile(fileInfo.file_path);
              await supabase.storage.from('custom-emojis').upload(path, bytes, {
                contentType: 'image/webp', upsert: true, cacheControl: '31536000',
              });
              thumbUrl = existing.publicUrl;
            }
            // Also warm the main cache table so <TgEmoji> works everywhere
            await supabase.from('bot_custom_emoji_cache').upsert({
              emoji_id: id, lottie_url: thumbUrl, fallback: emoji, status: 'ready',
              fetched_at: new Date().toISOString(),
            });
          } catch (e) {
            console.warn('thumb failed', id, e);
          }
          emojis.push({ custom_emoji_id: id, emoji, thumb_url: thumbUrl });
        }

        const row = {
          set_name: setName,
          title: set.title || setName,
          emojis,
          fetched_at: new Date().toISOString(),
        };
        await supabase.from('bot_emoji_sticker_sets').upsert(row);
        results.push(row);
      } catch (e: any) {
        console.error('set failed', setName, e);
        results.push({ set_name: setName, title: setName, emojis: [], error: e.message });
      }
    }

    return new Response(JSON.stringify({ sets: results }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
