// Fetch all installed custom-emoji sticker sets from your Telegram account
// and mirror them into bot_emoji_sticker_sets + bot_custom_emoji_cache.
// Run: node sync.js  (or schedule every 6h via cron / Railway)
import 'dotenv/config';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { createClient } from '@supabase/supabase-js';

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;
const sessionStr = process.env.TG_SESSION;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!apiId || !apiHash || !sessionStr) throw new Error('Missing TG_API_ID / TG_API_HASH / TG_SESSION');
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, { connectionRetries: 5 });
await client.connect();

console.log('🔗 Connected to Telegram. Fetching installed emoji packs…');

// getFeaturedEmojiStickers / getMyStickers — we want the user's ALL installed emoji packs
const all = await client.invoke(new Api.messages.GetAllStickers({ hash: 0 }));
// GetAllStickers returns mask/regular stickers. For custom emoji use GetEmojiStickers.
const emojiPacks = await client.invoke(new Api.messages.GetEmojiStickers({ hash: 0 }));
const sets = emojiPacks.sets || [];
console.log(`📦 Found ${sets.length} installed emoji pack(s)`);

const rows = [];
for (const s of sets) {
  const set = s.set || s;
  const shortName = set.shortName;
  const title = set.title || shortName;
  try {
    // Fetch the actual stickers in the set
    const full = await client.invoke(
      new Api.messages.GetStickerSet({
        stickerset: new Api.InputStickerSetShortName({ shortName }),
        hash: 0,
      })
    );
    const documents = full.documents || [];
    const emojis = [];
    for (const doc of documents) {
      const id = String(doc.id);
      // Find the emoji alt from attributes
      let alt = '';
      for (const a of doc.attributes || []) {
        if (a.className === 'DocumentAttributeCustomEmoji' || a.alt) {
          alt = a.alt || alt;
        }
      }
      emojis.push({ custom_emoji_id: id, emoji: alt, thumb_url: null });
    }
    rows.push({ set_name: shortName, title, emojis, fetched_at: new Date().toISOString() });
    console.log(`  ✓ ${title} (${shortName}) — ${emojis.length} emojis`);
  } catch (e) {
    console.warn(`  ✗ ${shortName}: ${e.message}`);
  }
}

if (rows.length) {
  const { error } = await supabase.from('bot_emoji_sticker_sets').upsert(rows, { onConflict: 'set_name' });
  if (error) console.error('Supabase upsert error:', error);
  else console.log(`\n✅ Synced ${rows.length} pack(s) into bot_emoji_sticker_sets.`);

  // Also warm cache table with fallback emoji so <TgEmoji> works
  const cacheRows = [];
  for (const r of rows) {
    for (const e of r.emojis) {
      cacheRows.push({
        emoji_id: e.custom_emoji_id,
        lottie_url: null,
        fallback: e.emoji || '⭐',
        status: 'pending',
        fetched_at: new Date().toISOString(),
      });
    }
  }
  if (cacheRows.length) {
    // upsert in chunks of 500
    for (let i = 0; i < cacheRows.length; i += 500) {
      const chunk = cacheRows.slice(i, i + 500);
      const { error: e2 } = await supabase.from('bot_custom_emoji_cache').upsert(chunk, { onConflict: 'emoji_id' });
      if (e2) console.error('cache upsert error:', e2);
    }
    console.log(`✅ Cached ${cacheRows.length} custom emojis.`);
  }
}

await client.disconnect();
process.exit(0);
