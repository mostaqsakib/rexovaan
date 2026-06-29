import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bot, InputFile } from 'grammy';
import { checkUrls, prewarm } from './checker.js';
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

const bot = new Bot(BOT_TOKEN, {
  client: {
    timeoutSeconds: 180,
  },
});

async function withRetry(fn, label, attempts = 4) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      console.error(`${label} attempt ${i} failed:`, e?.message || e);
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
  throw lastErr;
}

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

  // Deliver results (per category) — never let delivery failures kill summary
  try { await deliverCategory(ctx, '✅ VALID', valid, label); }
  catch (e) { await safeReply(ctx, `⚠️ Failed to deliver VALID list: ${escapeHtml(String(e?.message || e))}`); }
  try { await deliverCategory(ctx, '❌ INVALID', invalid, label); }
  catch (e) { await safeReply(ctx, `⚠️ Failed to deliver INVALID list: ${escapeHtml(String(e?.message || e))}`); }
  if (errors.length > 0 && errors.length <= 20) {
    const lines = errors.slice(0, 20).map((e) => `${e.url} — ${e.reason}`).join('\n');
    await safeReply(ctx, `⚠️ <b>ERRORS (${errors.length})</b>\n${escapeHtml(lines)}`);
  } else if (errors.length > 20) {
    try {
      await withRetry(() => ctx.replyWithDocument(
        new InputFile(Buffer.from(errors.map((e) => `${e.url}\t${e.reason}`).join('\n'), 'utf8'),
          { filename: `errors-${safeName(label)}.txt` }),
        { caption: `⚠️ ${errors.length} errors` },
      ), 'errors doc');
    } catch (e) {
      await safeReply(ctx, `⚠️ Could not send errors file: ${escapeHtml(String(e?.message || e))}`);
    }
  }

  await safeReply(ctx, buildSummary({
    total: urls.length, valid: valid.length, invalid: invalid.length,
    errors: errors.length, durationMs,
  }));
}

async function safeReply(ctx, text) {
  try { await ctx.reply(text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }); }
  catch (e) { console.error('reply failed:', e?.message || e); }
}

async function deliverCategory(ctx, header, list, label) {
  if (list.length === 0) {
    await safeReply(ctx, `${header} (0)`);
    return;
  }
  if (list.length <= inlineLimit) {
    const lines = list.join('\n');
    const body = `<b>${header} (${list.length})</b>\n${escapeHtml(lines)}`;
    if (body.length < 3900) {
      await withRetry(() => ctx.reply(body, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      }), `${header} inline`);
      return;
    }
  }
  const baseName = header.includes('VALID') ? 'valid' : 'invalid';
  const filename = `${baseName}-${safeName(label)}.txt`;
  const content = list.join('\n');
  const MAX_BYTES = 8 * 1024 * 1024;
  const totalBytes = Buffer.byteLength(content, 'utf8');
  if (totalBytes <= MAX_BYTES) {
    await sendDocFromString(ctx, content, filename, `<b>${header} (${list.length})</b>`);
    return;
  }
  const parts = Math.ceil(totalBytes / MAX_BYTES);
  const perPart = Math.ceil(list.length / parts);
  for (let i = 0; i < parts; i++) {
    const slice = list.slice(i * perPart, (i + 1) * perPart);
    if (slice.length === 0) break;
    await sendDocFromString(ctx, slice.join('\n'),
      `${baseName}-part${i + 1}-${safeName(label)}.txt`,
      `<b>${header} part ${i + 1}/${parts} (${slice.length})</b>`);
  }
}

async function sendDocFromString(ctx, content, filename, caption) {
  // Write to a temp file and upload via path — far more reliable than Buffer
  // for grammy/fetch on long uploads (avoids spurious "Network request failed").
  const tmp = path.join(os.tmpdir(), `tglc-${Date.now()}-${Math.random().toString(36).slice(2)}-${filename}`);
  await fs.promises.writeFile(tmp, content, 'utf8');
  try {
    await withRetry(() => ctx.replyWithDocument(
      new InputFile(tmp, filename),
      { caption, parse_mode: 'HTML' },
    ), `doc ${filename}`);
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
  }
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
