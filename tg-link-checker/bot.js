import 'dotenv/config';
import { Bot, InputFile } from 'grammy';
import { checkUrls } from './checker.js';
import { enqueue, pendingCount } from './queue.js';
import { buildSummary, buildProgressText, extractUrls, dedupe, escapeHtml } from './formatter.js';

const {
  BOT_TOKEN,
  MAX_CONCURRENCY = '50',
  INLINE_LIMIT = '50',
  PROGRESS_EDIT_INTERVAL_MS = '2000',
  ALLOWED_USER_IDS = '',
  MAX_LINKS_PER_JOB = '20000',
} = process.env;

if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN in .env');
  process.exit(1);
}

const maxConc = parseInt(MAX_CONCURRENCY, 10);
const inlineLimit = parseInt(INLINE_LIMIT, 10);
const progressInterval = parseInt(PROGRESS_EDIT_INTERVAL_MS, 10);
const maxLinks = parseInt(MAX_LINKS_PER_JOB, 10);
const allowed = ALLOWED_USER_IDS.split(',').map((s) => s.trim()).filter(Boolean).map(Number);
const allowedSet = new Set(allowed);
const isAllowed = (id) => allowedSet.size === 0 || allowedSet.has(Number(id));

const bot = new Bot(BOT_TOKEN);

bot.command('start', (ctx) => ctx.reply(
  '👋 <b>Link Checker Bot</b>\n\n'
  + 'Send me links any of these ways:\n'
  + '• Paste links directly in a message\n'
  + '• Upload a <code>.txt</code> file with one URL per line\n'
  + '• Send multiple files — I will process them one by one\n\n'
  + `Concurrency: <b>${maxConc}</b>   •   Max links / job: <b>${maxLinks}</b>`,
  { parse_mode: 'HTML' },
));
bot.command('help', (ctx) => ctx.reply('Just send a .txt file or paste links. I handle the rest.'));
bot.command('status', (ctx) => {
  const p = pendingCount(ctx.from.id);
  return ctx.reply(p ? `You have ${p} job(s) queued/running.` : 'No jobs queued.');
});

bot.on('message:text', async (ctx) => {
  if (!isAllowed(ctx.from.id)) return ctx.reply('⛔ You are not whitelisted to use this bot.');
  if (ctx.message.text.startsWith('/')) return; // command
  const urls = dedupe(extractUrls(ctx.message.text));
  if (urls.length === 0) return; // ignore non-link chatter
  await scheduleJob(ctx, urls, 'Pasted links');
});

bot.on('message:document', async (ctx) => {
  if (!isAllowed(ctx.from.id)) return ctx.reply('⛔ You are not whitelisted to use this bot.');
  const doc = ctx.message.document;
  const name = doc.file_name || 'file.txt';
  if (doc.file_size && doc.file_size > 25 * 1024 * 1024) {
    return ctx.reply('❌ File too large (max 25 MB).');
  }
  let text;
  try {
    const file = await ctx.getFile();
    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    text = await res.text();
  } catch (e) {
    return ctx.reply(`❌ Could not download file: ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
  }
  const urls = dedupe(extractUrls(text));
  if (urls.length === 0) return ctx.reply(`📄 <b>${escapeHtml(name)}</b>\nNo URLs found.`, { parse_mode: 'HTML' });
  await scheduleJob(ctx, urls, name);
});

async function scheduleJob(ctx, urls, label) {
  if (urls.length > maxLinks) {
    return ctx.reply(`❌ Too many links (${urls.length}). Max per job: ${maxLinks}.`);
  }
  const queuePos = pendingCount(ctx.from.id);
  const ack = await ctx.reply(
    queuePos > 0
      ? `📥 <b>${escapeHtml(label)}</b> — queued (${queuePos} ahead). ${urls.length} links.`
      : `📥 <b>${escapeHtml(label)}</b> — starting. ${urls.length} links.`,
    { parse_mode: 'HTML', reply_parameters: { message_id: ctx.message.message_id } },
  );

  enqueue(ctx.from.id, () => runJob(ctx, ack.message_id, urls, label)).catch((e) => {
    console.error('job failed:', e);
    ctx.reply(`❌ Job failed: ${escapeHtml(String(e?.message || e))}`, { parse_mode: 'HTML' }).catch(() => {});
  });
}

async function runJob(ctx, progressMsgId, urls, label) {
  const startedAt = Date.now();
  let lastEditAt = 0;
  let lastText = '';

  const editProgress = async (state, force = false) => {
    const now = Date.now();
    if (!force && now - lastEditAt < progressInterval) return;
    const text = buildProgressText({ ...state, elapsedMs: now - startedAt, label });
    if (text === lastText) return;
    lastText = text;
    lastEditAt = now;
    try {
      await ctx.api.editMessageText(ctx.chat.id, progressMsgId, text, { parse_mode: 'HTML' });
    } catch (_) { /* rate-limited or unchanged — ignore */ }
  };

  await editProgress({ checked: 0, total: urls.length, valid: 0, invalid: 0, errors: 0 }, true);

  const results = await checkUrls(urls, {
    concurrency: maxConc,
    onProgress: (s) => { editProgress(s).catch(() => {}); },
  });

  const valid = results.filter((r) => r.result === 'valid').map((r) => r.url);
  const invalid = results.filter((r) => r.result === 'invalid').map((r) => r.url);
  const errors = results.filter((r) => r.result === 'error');
  const durationMs = Date.now() - startedAt;

  // Final progress update
  await editProgress({
    checked: results.length, total: urls.length,
    valid: valid.length, invalid: invalid.length, errors: errors.length,
  }, true);

  // Deliver results (per category)
  await deliverCategory(ctx, '✅ VALID', valid, label);
  await deliverCategory(ctx, '❌ INVALID', invalid, label);
  if (errors.length > 0 && errors.length <= 20) {
    const lines = errors.slice(0, 20).map((e) => `${e.url} — ${e.reason}`).join('\n');
    await ctx.reply(`⚠️ <b>ERRORS (${errors.length})</b>\n<pre>${escapeHtml(lines)}</pre>`, { parse_mode: 'HTML' });
  } else if (errors.length > 20) {
    await ctx.replyWithDocument(new InputFile(Buffer.from(
      errors.map((e) => `${e.url}\t${e.reason}`).join('\n'), 'utf8',
    ), { filename: `errors-${safeName(label)}.txt` }), {
      caption: `⚠️ ${errors.length} errors`,
    });
  }

  await ctx.reply(
    buildSummary({
      total: urls.length, valid: valid.length, invalid: invalid.length,
      errors: errors.length, durationMs,
    }),
    { parse_mode: 'HTML' },
  );
}

async function deliverCategory(ctx, header, list, label) {
  if (list.length === 0) {
    await ctx.reply(`${header} (0)`, { parse_mode: 'HTML' });
    return;
  }
  if (list.length <= inlineLimit) {
    // Chunk inline if needed to stay under Telegram 4096-char limit.
    const lines = list.join('\n');
    const body = `<b>${header} (${list.length})</b>\n${escapeHtml(lines)}`;
    if (body.length < 3900) {
      await ctx.reply(body, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
      return;
    }
  }
  const filename = `${header.includes('VALID') ? 'valid' : 'invalid'}-${safeName(label)}.txt`;
  await ctx.replyWithDocument(
    new InputFile(Buffer.from(list.join('\n'), 'utf8'), { filename }),
    { caption: `<b>${header} (${list.length})</b>`, parse_mode: 'HTML' },
  );
}

function safeName(s) {
  return String(s || 'job').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 40) || 'job';
}

bot.catch((err) => {
  console.error('bot error:', err);
});

console.log(`🚀 tg-link-checker starting (concurrency=${maxConc}, inline_limit=${inlineLimit})`);
bot.start({
  drop_pending_updates: true,
  onStart: (me) => console.log(`✅ @${me.username} online`),
});
