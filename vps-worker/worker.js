// Rexovaan Shoppie — Link Checker VPS Worker
// Uses a real persistent Chrome profile so Google login never expires.
//
// Flow:
//  1. Poll `link_check_jobs` for status='queued'
//  2. Claim job → status='running', populate `link_check_items` from available stock
//  3. Spawn N parallel browser tabs (N = job.concurrency, capped by MAX_CONCURRENCY)
//  4. Each tab: claim_next_link_check_item → open URL → judge valid/invalid → mark_link_check_result
//  5. When no more items → finalize job (status='completed' or 'failed')
//  6. Realtime in admin panel auto-updates from DB changes
//
// Run with PM2:  pm2 start worker.js --name link-checker

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import WebSocket from 'ws';

if (!globalThis.WebSocket) {
  globalThis.WebSocket = WebSocket;
}

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  CHROME_PROFILE_DIR = '/root/chrome-profile',
  HEADFUL = 'false',
  MAX_CONCURRENCY = '10',
  POLL_INTERVAL_MS = '5000',
  NAV_TIMEOUT_MS = '30000',
  INVALID_TEXT_PATTERNS = '',
  VALID_TEXT_PATTERNS = '',
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket },
});

// Always-on invalid markers (matched regardless of .env config)
const BUILTIN_INVALID_PATTERNS = [
  'subscription already in use',
  'already in use',
  'already been redeemed',
  'already redeemed',
  'already claimed',
  'no longer available',
  'offer has expired',
  'has expired',
  'not eligible',
  'invalid code',
  'is not valid',
  'cannot be used',
  'this code has already',
];
const invalidPatterns = Array.from(new Set([
  ...BUILTIN_INVALID_PATTERNS,
  ...INVALID_TEXT_PATTERNS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
]));
const validPatterns = VALID_TEXT_PATTERNS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const navTimeout = parseInt(NAV_TIMEOUT_MS, 10);
const maxConc = parseInt(MAX_CONCURRENCY, 10);
const pollMs = parseInt(POLL_INTERVAL_MS, 10);
const autoRetryFailedCooldownMs = parseInt(process.env.AUTO_RETRY_FAILED_COOLDOWN_MS || '300000', 10);

let browserCtx = null;
let browserLaunchPromise = null;
let busy = false;
const QUEUED_STATUSES = ['vps_queued', 'queued'];

async function getBrowser() {
  if (browserCtx && browserCtx.pages) return browserCtx;
  if (browserLaunchPromise) return browserLaunchPromise;

  browserLaunchPromise = (async () => {
    console.log('🚀 Launching Chrome with profile:', CHROME_PROFILE_DIR);
    const ctx = await chromium.launchPersistentContext(CHROME_PROFILE_DIR, {
      headless: HEADFUL !== 'true',
      viewport: { width: 1280, height: 800 },
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--lang=en-US',
      ],
      locale: 'en-US',
    });
    browserCtx = ctx;
    ctx.on('close', () => {
      browserCtx = null;
      browserLaunchPromise = null;
    });
    return ctx;
  })();

  try {
    return await browserLaunchPromise;
  } catch (error) {
    browserLaunchPromise = null;
    throw error;
  }
}

function extractUrl(data) {
  if (!data || typeof data !== 'object') return null;
  for (const v of Object.values(data)) {
    if (typeof v === 'string' && /^https?:\/\//.test(v.trim())) return v.trim();
  }
  return null;
}

function isGoogleAuthPage(finalUrl, bodyText) {
  return /accounts\.google\.com\/(signin|servicelogin|v3\/signin|interactive_login|challenge)/i.test(finalUrl)
    || bodyText.includes('sign in to continue')
    || bodyText.includes('choose an account')
    || bodyText.includes("couldn’t sign you in")
    || bodyText.includes("couldn't sign you in");
}

async function judgeUrl(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeout });
    // small settle for Google redirects
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    const bodyText = (await page.evaluate(() => document.body?.innerText || '')).toLowerCase();
    const finalUrl = page.url().toLowerCase();

    if (isGoogleAuthPage(finalUrl, bodyText)) {
      return { result: 'error', reason: 'google auth required: login using the same CHROME_PROFILE_DIR as the PM2 worker' };
    }

    for (const pat of invalidPatterns) {
      if (bodyText.includes(pat)) return { result: 'invalid', reason: `matched: ${pat}` };
    }
    // Google-specific redirect signals
    if (/already|redeemed|expired|error/.test(finalUrl)) {
      return { result: 'invalid', reason: `redirected: ${finalUrl.slice(0, 120)}` };
    }
    if (validPatterns.length === 0) return { result: 'valid', reason: 'no invalid markers' };
    for (const pat of validPatterns) {
      if (bodyText.includes(pat)) return { result: 'valid', reason: `matched: ${pat}` };
    }
    return { result: 'error', reason: 'no valid/invalid markers detected' };
  } catch (e) {
    return { result: 'error', reason: String(e?.message || e).slice(0, 240) };
  }
}

async function populateItems(job) {
  // Pull all available stock for this product and insert into link_check_items
  const { data: stock, error } = await sb
    .from('bot_product_stock_items')
    .select('id, data')
    .eq('product_id', job.product_id)
    .eq('status', 'available');
  if (error) throw error;

  const rows = [];
  for (const s of stock || []) {
    const url = extractUrl(s.data);
    if (url) rows.push({ job_id: job.id, stock_item_id: s.id, url, status: 'pending' });
  }
  if (rows.length === 0) return 0;

  // Chunk insert (Supabase has a row limit per insert)
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500);
    const { error: insErr } = await sb.from('link_check_items').insert(slice);
    if (insErr) throw insErr;
  }
  return rows.length;
}

async function runWorkerTab(job, signal) {
  let page = null;
  try {
    const ctx = await getBrowser();
    page = await ctx.newPage();
    while (!signal.cancelled) {
      const { data: claimed, error } = await sb.rpc('claim_next_link_check_item', { _job_id: job.id });
      if (error) {
        console.error('claim error:', error.message);
        await sleep(2000);
        continue;
      }
      const item = Array.isArray(claimed) ? claimed[0] : claimed;
      if (!item) return; // no more pending items
      const { result, reason } = await judgeUrl(page, item.url);
      await sb.rpc('mark_link_check_result', { _item_id: item.id, _result: result, _reason: reason });
      if (job.delay_ms > 0) await sleep(job.delay_ms);
    }
  } catch (error) {
    signal.cancelled = true;
    throw error;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function processJob(job) {
  console.log(`\n📋 Job ${job.id.slice(0, 8)} starting (concurrency=${job.concurrency})`);
  const signal = { cancelled: false };
  let cancelWatcher = null;

  // mark running + populate items
  await sb.from('link_check_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', job.id);

  let total = 0;
  try {
    // Fail before creating/claiming work if Chrome profile is locked by another process.
    await getBrowser();

    total = await populateItems(job);
    await sb.from('link_check_jobs').update({ total }).eq('id', job.id);
    console.log(`   → ${total} URLs to check`);

    if (total === 0) {
      await sb.from('link_check_jobs')
        .update({ status: 'completed', finished_at: new Date().toISOString() })
        .eq('id', job.id);
      return;
    }

    const conc = Math.max(1, Math.min(maxConc, job.concurrency || 5));

    // Watch for external cancel
    cancelWatcher = setInterval(async () => {
      const { data } = await sb.from('link_check_jobs').select('status').eq('id', job.id).single();
      if (data?.status === 'cancelled') signal.cancelled = true;
    }, 3000);

    const tabs = Array.from({ length: conc }, () => runWorkerTab(job, signal));
    const tabResults = await Promise.allSettled(tabs);
    const failedTab = tabResults.find((result) => result.status === 'rejected');
    if (failedTab) throw failedTab.reason;

    const finalStatus = signal.cancelled ? 'cancelled' : 'completed';
    await sb.from('link_check_jobs')
      .update({ status: finalStatus, finished_at: new Date().toISOString() })
      .eq('id', job.id);
    console.log(`   ✅ Job ${job.id.slice(0, 8)} ${finalStatus}`);
  } catch (e) {
    console.error('   ❌ Job failed:', e.message);
    await sb.from('link_check_jobs')
      .update({ status: 'failed', error_text: String(e.message).slice(0, 500), finished_at: new Date().toISOString() })
      .eq('id', job.id);
  } finally {
    signal.cancelled = true;
    if (cancelWatcher) clearInterval(cancelWatcher);
  }
}

async function autoEnqueueIfNeeded() {
  const { data: autoProducts, error } = await sb
    .from('bot_products')
    .select('id, name')
    .eq('link_check_auto', true)
    .eq('is_active', true);
  if (error) throw error;
  if (!autoProducts || autoProducts.length === 0) return;

  for (const product of autoProducts) {
    const { data: existing, error: existingError } = await sb
      .from('link_check_jobs')
      .select('id, status, error_text, finished_at')
      .eq('product_id', product.id)
      .order('created_at', { ascending: false })
      .limit(1);
    if (existingError) throw existingError;
    const latestJob = existing?.[0];
    if (latestJob && [...QUEUED_STATUSES, 'running'].includes(latestJob.status)) continue;
    const lastFailedAt = latestJob?.status === 'failed' && latestJob.finished_at
      ? new Date(latestJob.finished_at).getTime()
      : 0;
    const failureText = String(latestJob?.error_text || '').toLowerCase();
    const chromeProfileFailure = failureText.includes('launchpersistentcontext')
      || failureText.includes('existing browser session')
      || failureText.includes('profile is already in use');
    if (chromeProfileFailure && Date.now() - lastFailedAt < autoRetryFailedCooldownMs) {
      console.warn(`   ⏸️ Auto-loop paused for ${product.name}: Chrome profile is locked`);
      continue;
    }

    const { error: insertError } = await sb.from('link_check_jobs').insert({
      product_id: product.id,
      cookie_id: null,
      concurrency: 5,
      delay_ms: 800,
      status: 'vps_queued',
    });
    if (insertError) throw insertError;
    console.log(`   🔁 Auto-loop queued for ${product.name}`);
  }
}

async function pollLoop() {
  while (true) {
    try {
      if (!busy) {
        await autoEnqueueIfNeeded();
        const { data: jobs } = await sb
          .from('link_check_jobs')
          .select('*')
          .in('status', QUEUED_STATUSES)
          .order('created_at', { ascending: true })
          .limit(1);
        if (jobs && jobs[0]) {
          busy = true;
          await processJob(jobs[0]);
          busy = false;
        }
      }
    } catch (e) {
      console.error('poll error:', e.message);
      busy = false;
    }
    await sleep(pollMs);
  }
}

process.on('SIGTERM', async () => {
  console.log('SIGTERM — closing browser');
  if (browserCtx) await browserCtx.close().catch(() => {});
  process.exit(0);
});

console.log('🤖 Rexovaan Link Checker worker started');
console.log('   Profile:', CHROME_PROFILE_DIR);
console.log('   Headful:', HEADFUL);
console.log('   Poll:', pollMs, 'ms');
pollLoop();
