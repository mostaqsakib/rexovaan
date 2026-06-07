// Resolves Telegram custom (premium) emoji ids -> cached Lottie/webp URLs.
// Input:  { ids: string[] }
// Output: { emojis: Record<id, { url: string | null, fallback: string | null }> }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { gunzipSync, strFromU8 } from 'https://esm.sh/fflate@0.8.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY = 'https://connector-gateway.lovable.dev/telegram';
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;
const TELEGRAM_API_KEY = (Deno.env.get('TELEGRAM_API_KEY_1') || Deno.env.get('TELEGRAM_API_KEY'))!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const tgHeaders = {
  'Authorization': `Bearer ${LOVABLE_API_KEY}`,
  'X-Connection-Api-Key': TELEGRAM_API_KEY,
  'Content-Type': 'application/json',
};

async function tg(method: string, body: any) {
  const r = await fetch(`${GATEWAY}/${method}`, { method: 'POST', headers: tgHeaders, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(`${method}: ${JSON.stringify(j)}`);
  return j.result;
}

async function downloadFile(filePath: string): Promise<Uint8Array> {
  const r = await fetch(`${GATEWAY}/file/${filePath}`, {
    headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'X-Connection-Api-Key': TELEGRAM_API_KEY },
  });
  if (!r.ok) throw new Error(`download failed ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { ids } = await req.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return new Response(JSON.stringify({ emojis: {} }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const uniqIds: string[] = Array.from(new Set(ids.map(String))).slice(0, 200);
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1) read existing cache
    const { data: cached } = await supabase
      .from('bot_custom_emoji_cache')
      .select('emoji_id, lottie_url, fallback, status')
      .in('emoji_id', uniqIds);

    const out: Record<string, { url: string | null; fallback: string | null }> = {};
    const cachedMap = new Map((cached || []).map(c => [c.emoji_id, c]));
    const missing: string[] = [];
    for (const id of uniqIds) {
      const c = cachedMap.get(id);
      if (c && c.status === 'ready') out[id] = { url: c.lottie_url, fallback: c.fallback };
      else missing.push(id);
    }

    if (missing.length === 0) {
      return new Response(JSON.stringify({ emojis: out }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 2) fetch sticker metadata from Telegram (batched, 200 max per docs)
    const stickers: any[] = await tg('getCustomEmojiStickers', { custom_emoji_ids: missing });

    // 3) for each, download TGS, gunzip to lottie JSON, upload to storage
    await Promise.all(stickers.map(async (st) => {
      const id = String(st.custom_emoji_id);
      const fallback = st.emoji || null;
      const uploadEmojiFile = async (fileId: string, extension: string, contentType: string) => {
        const fileInfo = await tg('getFile', { file_id: fileId });
        const bytes = await downloadFile(fileInfo.file_path);
        const path = `${id}.${extension}`;
        const { error: upErr } = await supabase.storage.from('custom-emojis').upload(path, bytes, {
          contentType, upsert: true, cacheControl: '31536000',
        });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from('custom-emojis').getPublicUrl(path);
        await supabase.from('bot_custom_emoji_cache').upsert({
          emoji_id: id, lottie_url: pub.publicUrl, fallback, status: 'ready', fetched_at: new Date().toISOString(),
        });
        out[id] = { url: pub.publicUrl, fallback };
      };
      try {
        if (st.is_video) {
          await uploadEmojiFile(st.file_id, 'webm', 'video/webm');
          return;
        }
        if (!st.is_animated) {
          await uploadEmojiFile(st.thumbnail?.file_id || st.file_id, 'webp', 'image/webp');
          return;
        }
        const fileInfo = await tg('getFile', { file_id: st.file_id });
        const tgsBytes = await downloadFile(fileInfo.file_path);
        // TGS is usually gzipped Lottie JSON; some gateway responses are already plain JSON.
        const jsonBytes = (tgsBytes[0] === 0x1f && tgsBytes[1] === 0x8b) ? gunzipSync(tgsBytes) : tgsBytes;
        JSON.parse(strFromU8(jsonBytes));
        const path = `${id}.json`;
        const { error: upErr } = await supabase.storage.from('custom-emojis').upload(path, jsonBytes, {
          contentType: 'application/json', upsert: true, cacheControl: '31536000',
        });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from('custom-emojis').getPublicUrl(path);
        await supabase.from('bot_custom_emoji_cache').upsert({
          emoji_id: id, lottie_url: pub.publicUrl, fallback, status: 'ready', fetched_at: new Date().toISOString(),
        });
        out[id] = { url: pub.publicUrl, fallback };
      } catch (e) {
        console.error('emoji fetch failed', id, e);
        await supabase.from('bot_custom_emoji_cache').upsert({
          emoji_id: id, lottie_url: null, fallback, status: 'failed', fetched_at: new Date().toISOString(),
        });
        out[id] = { url: null, fallback };
      }
    }));

    return new Response(JSON.stringify({ emojis: out }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
