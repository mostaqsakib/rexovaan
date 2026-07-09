// Resolves Telegram custom (premium) emoji ids -> cached Lottie/webp URLs for the migrated shop.
// Input:  { ids: string[] }
// Output: { emojis: Record<id, { url: string | null, fallback: string | null }> }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { gunzipSync, strFromU8 } from 'https://esm.sh/fflate@0.8.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BOT_TOKEN = Deno.env.get('BOT_TOKEN')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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


    // Cap fetch batch to keep storage pressure low; the rest retry on next requests.
    const toFetch = missing.slice(0, 25);

    // 2) fetch sticker metadata from Telegram (batched, 200 max per docs)
    const stickers: any[] = await tg('getCustomEmojiStickers', { custom_emoji_ids: toFetch });

    const processOne = async (st: any) => {
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
      } catch (e: any) {
        console.error('emoji fetch failed', id, e?.message || e);
        // Transient (429 / connection) → keep as pending so future requests retry.
        const isTransient = e?.status === 429 || e?.statusCode === '429' ||
          /Too many connections|rate|timeout|ECONN/i.test(String(e?.message || ''));
        await supabase.from('bot_custom_emoji_cache').upsert({
          emoji_id: id, lottie_url: null, fallback,
          status: isTransient ? 'pending' : 'failed',
          fetched_at: new Date().toISOString(),
        });
        out[id] = { url: null, fallback };
      }
    };

    // Small concurrency pool to avoid Supabase Storage 429 (Too many connections).
    const CONCURRENCY = 3;
    let cursor = 0;
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < stickers.length) {
        const idx = cursor++;
        await processOne(stickers[idx]);
      }
    });
    await Promise.all(workers);


    return new Response(JSON.stringify({ emojis: out }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
