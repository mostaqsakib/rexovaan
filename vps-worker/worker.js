// Rexovaan Shoppie — Link Checker VPS Worker (FAST FETCH MODE)
//
// Inspired by the Gemini Link Checker Chrome extension:
// instead of opening each URL in a browser tab (slow), we reuse the
// persistent Chrome profile's COOKIES via Playwright's APIRequestContext
// and just do HTTP GETs with `redirect: follow`. Then we look for the
// same text markers the extension uses ("already been used",
// "new activation link") to decide valid / invalid.
//
// Result: ~20–25 links/sec instead of ~1/sec, no Chromium tabs needed.
// The persistent profile is still used so Google login cookies apply.

import 'dotenv/config';
import './polyfill.js'; // MUST be before @supabase import — sets globalThis.WebSocket
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  CHROME_PROFILE_DIR = '/root/chrome-profile',
  HEADFUL = 'false',
  CHROME_CHANNEL = '',
  CHROME_EXECUTABLE_PATH = '',
  MAX_CONCURRENCY = '10',
  POLL_INTERVAL_MS = '5000',
  NAV_TIMEOUT_MS = '15000',
  RETRIES_ON_ERROR = '2',
  DELAY_BETWEEN_JOBS_MS = '200',
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

// Markers from the Chrome extension (kept built-in so detection works
// even with an empty .env config).
const BUILTIN_INVALID_PATTERNS = [
  'already been used',
  'new activation link',
  // legacy / fallback markers from older worker
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
const retries = parseInt(RETRIES_ON_ERROR, 10);
const perJobDelay = parseInt(DELAY_BETWEEN_JOBS_MS, 10);
const autoRetryFailedCooldownMs = parseInt(process.env.AUTO_RETRY_FAILED_COOLDOWN_MS || '300000', 10);
const browserFallbackStatuses = new Set(
  (process.env.BROWSER_FALLBACK_HTTP_STATUSES || '401,403,429')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter(Number.isFinite),
);

let browserCtx = null;
let browserLaunchPromise = null;
let busy = false;
const QUEUED_STATUSES = ['vps_queued', 'queued'];

async function isProfileInUse(profileDir) {
  try {
    const { stdout } = await execFileAsync('pgrep', ['-af', profileDir], { timeout: 3000 });
    return stdout.trim().length > 0;
  } catch { return false; }
}

async function cleanupStaleChromeProfileLocks(profileDir) {
  if (await isProfileInUse(profileDir)) return false;
  await Promise.all(['SingletonLock', 'SingletonSocket', 'SingletonCookie'].map((name) =>
    fs.rm(`${profileDir}/${name}`, { force: true, recursive: true }).catch(() => {}),
  ));
  return true;
}

function isChromeProfileLockError(error) {
  const msg = String(error?.message || error).toLowerCase();
  return msg.includes('opening in existing browser session')
    || msg.includes('processsingleton')
    || msg.includes('singletonlock')
    || msg.includes('user data directory is already in use');
}

async function getBrowser() {
  if (browserCtx && browserCtx.request) return browserCtx;
  if (browserLaunchPromise) return browserLaunchPromise;

  browserLaunchPromise = (async () => {
    console.log('🚀 Launching Chrome (cookies-only fetch mode), profile:', CHROME_PROFILE_DIR);
    await cleanupStaleChromeProfileLocks(CHROME_PROFILE_DIR);
    const launchOptions = {
      headless: HEADFUL !== 'true',
      viewport: { width: 1280, height: 800 },
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--lang=en-US',
      ],
      locale: 'en-US',
    };
    if (CHROME_EXECUTABLE_PATH) launchOptions.executablePath = CHROME_EXECUTABLE_PATH;
    else if (CHROME_CHANNEL) launchOptions.channel = CHROME_CHANNEL;
    let ctx;
    try {
      ctx = await chromium.launchPersistentContext(CHROME_PROFILE_DIR, launchOptions);
    } catch (error) {
      if (!isChromeProfileLockError(error) || !(await cleanupStaleChromeProfileLocks(CHROME_PROFILE_DIR))) {
        throw error;
      }
      console.warn('⚠️ Removed stale Chrome profile lock; retrying launch once...');
      ctx = await chromium.launchPersistentContext(CHROME_PROFILE_DIR, launchOptions);
    }
    browserCtx = ctx;
    ctx.on('close', () => {
      browserCtx = null;
      browserLaunchPromise = null;
    });
    return ctx;
  })();

  try { return await browserLaunchPromise; }
  catch (error) { browserLaunchPromise = null; throw error; }
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

function classifyPage(finalUrl, bodyText) {
  if (isGoogleAuthPage(finalUrl, bodyText)) {
    return { result: 'error', reason: 'google auth required: re-run `node login.js` on the VPS to refresh Chrome profile cookies' };
  }

  for (const pat of invalidPatterns) {
    if (bodyText.includes(pat)) return { result: 'invalid', reason: `matched: ${pat}` };
  }
  if (/already|redeemed|expired|error/.test(finalUrl)) {
    return { result: 'invalid', reason: `redirected: ${finalUrl.slice(0, 120)}` };
  }
  if (validPatterns.length === 0) return { result: 'valid', reason: 'no invalid markers' };
  for (const pat of validPatterns) {
    if (bodyText.includes(pat)) return { result: 'valid', reason: `matched: ${pat}` };
  }
  return { result: 'error', reason: 'no valid/invalid markers detected' };
}

async function judgeUrlInBrowser(ctx, url, reasonPrefix = 'browser fallback') {
  const page = await ctx.newPage();
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeout });
    await page.waitForLoadState('networkidle', { timeout: Math.min(navTimeout, 8000) }).catch(() => {});
    const status = response?.status?.() || 0;
    const finalUrl = page.url().toLowerCase();
    const bodyText = (await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')).toLowerCase();

    if (status && status >= 400 && status !== 403) {
      return { result: 'error', reason: `${reasonPrefix}: HTTP ${status}` };
    }

    const classified = classifyPage(finalUrl, bodyText);
    if (classified.result === 'error' && classified.reason === 'no valid/invalid markers detected' && status === 403) {
      return { result: 'error', reason: `${reasonPrefix}: HTTP 403` };
    }
    return classified;
  } finally {
    await page.close().catch(() => {});
  }
}

// Fast fetch judge — mirrors the Chrome extension's logic exactly.
async function judgeUrl(ctx, url) {
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const res = await ctx.request.get(url, {
        timeout: navTimeout,
        maxRedirects: 10,
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      const status = res.status();
      const finalUrl = res.url().toLowerCase();

      if (status === 429 && attempt <= retries) {
        await sleep(3000);
        continue;
      }
      if (!res.ok()) {
        if (browserFallbackStatuses.has(status)) {
          return await judgeUrlInBrowser(ctx, url, `fast fetch HTTP ${status}`);
        }
        return { result: 'error', reason: `HTTP ${status}` };
      }

      const bodyText = (await res.text()).toLowerCase();
      return classifyPage(finalUrl, bodyText);
    } catch (e) {
      const msg = String(e?.message || e);
      if (attempt <= retries) { await sleep(1000); continue; }
      if (/timeout/i.test(msg)) return { result: 'error', reason: 'Timeout' };
      return { result: 'error', reason: msg.slice(0, 240) };
    }
  }
}

async function populateItems(job) {
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

  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500);
    const { error: insErr } = await sb.from('link_check_items').insert(slice);
    if (insErr) throw insErr;
  }
  return rows.length;
}

async function runWorker(job, ctx, signal) {
  while (!signal.cancelled) {
    const { data: claimed, error } = await sb.rpc('claim_next_link_check_item', { _job_id: job.id });
    if (error) { console.error('claim error:', error.message); await sleep(2000); continue; }
    const item = Array.isArray(claimed) ? claimed[0] : claimed;
    if (!item) return;
    const { result, reason } = await judgeUrl(ctx, item.url);
    await sb.rpc('mark_link_check_result', { _item_id: item.id, _result: result, _reason: reason });
    if (perJobDelay > 0) await sleep(perJobDelay);
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function processJob(job) {
  console.log(`\n📋 Job ${job.id.slice(0, 8)} starting (concurrency=${job.concurrency})`);
  const signal = { cancelled: false };
  let cancelWatcher = null;

  await sb.from('link_check_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', job.id);

  try {
    const ctx = await getBrowser();
    const total = await populateItems(job);
    await sb.from('link_check_jobs').update({ total }).eq('id', job.id);
    console.log(`   → ${total} URLs to check`);

    if (total === 0) {
      await sb.from('link_check_jobs')
        .update({ status: 'completed', finished_at: new Date().toISOString() })
        .eq('id', job.id);
      return;
    }

    const conc = Math.max(1, Math.min(maxConc, job.concurrency || 10));

    cancelWatcher = setInterval(async () => {
      const { data } = await sb.from('link_check_jobs').select('status').eq('id', job.id).single();
      if (data?.status === 'cancelled') signal.cancelled = true;
    }, 3000);

    const workers = Array.from({ length: conc }, () => runWorker(job, ctx, signal));
    const results = await Promise.allSettled(workers);
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) throw failed.reason;

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
      concurrency: 10,
      delay_ms: perJobDelay,
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

console.log('🤖 Rexovaan Link Checker worker (FAST FETCH) started');
console.log('   Profile:', CHROME_PROFILE_DIR);
console.log('   Concurrency cap:', maxConc, '| Retries:', retries, '| Timeout:', navTimeout, 'ms');
pollLoop();
