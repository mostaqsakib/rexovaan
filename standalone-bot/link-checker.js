// Gemini link checker worker.
// Polls link_check_jobs in Supabase, validates each link in headless Chromium using saved Google cookies,
// silently flips invalid stock items to status='invalid', and alerts admin on Telegram when cookies expire.

import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import WebSocket from 'ws';
import fs from 'node:fs';

if (!globalThis.WebSocket) {
  globalThis.WebSocket = WebSocket;
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const BOT_TOKEN = process.env.BOT_TOKEN;
const GOOGLE_COOKIES_JSON = process.env.GOOGLE_COOKIES_JSON;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[checker] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const POLL_INTERVAL_MS = 5000;
const LEGACY_LINK_CHECKER_ENABLED = process.env.LEGACY_LINK_CHECKER_ENABLED === 'true';

function resolveProfileDir() {
  if (process.env.PROFILE_DIR) return process.env.PROFILE_DIR;
  if (process.env.CHROME_PROFILE_DIR) return process.env.CHROME_PROFILE_DIR;
  try {
    if (fs.existsSync('/root/chrome-profile/Default')) return '/root/chrome-profile';
  } catch {}
  return '/data/google-profile';
}

const PROFILE_DIR = resolveProfileDir();
const PROFILE_AUTH_EXPIRED_MARKER = `${PROFILE_DIR}/.auth-expired`;
const AUTH_EXPIRED_NOTIFY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const COOKIE_REFRESH_SAVE_INTERVAL_MS = 60 * 1000;
let lastAuthExpiredNotifyAt = 0;

function hasProfileAuthExpiredMarker() {
  try { return fs.existsSync(PROFILE_AUTH_EXPIRED_MARKER); } catch { return false; }
}

function markProfileAuthExpired(reason) {
  try {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    fs.writeFileSync(PROFILE_AUTH_EXPIRED_MARKER, `${new Date().toISOString()} ${reason || 'expired'}\n`);
  } catch (e) {
    console.error('[checker] failed to write profile auth marker:', e.message);
  }
}

async function notifyAdmin(text) {
  if (!ADMIN_CHAT_ID || !BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  } catch (e) {
    console.error('[checker] admin notify failed:', e.message);
  }
}

async function notifyAuthExpiredOnce(useProfile) {
  const now = Date.now();
  if (now - lastAuthExpiredNotifyAt < AUTH_EXPIRED_NOTIFY_COOLDOWN_MS) return;
  lastAuthExpiredNotifyAt = now;
  await notifyAdmin(useProfile
    ? '⚠️ <b>Google session expired</b>\n\nThe persistent Chromium profile is no longer logged in. Re-run the local profile capture, upload a fresh zip, update PROFILE_ZIP_URL on Railway, then redeploy.'
    : '⚠️ <b>Google cookies expired</b>\n\nLink checker stopped. Open admin → Link Checker → Google Cookies and paste fresh export from Cookie-Editor extension.');
}

// Extract first http(s) URL from a stock item's data JSON.
function extractUrl(data) {
  if (!data || typeof data !== 'object') return null;
  for (const v of Object.values(data)) {
    if (typeof v === 'string' && /^https?:\/\//i.test(v.trim())) return v.trim();
  }
  return null;
}

// Convert Cookie-Editor export to Playwright cookie format.
function normalizeCookies(arr) {
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr); } catch { return []; }
  }
  if (arr && !Array.isArray(arr) && Array.isArray(arr.cookies)) arr = arr.cookies;
  if (!Array.isArray(arr)) return [];
  return arr.map(c => {
    const out = {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      httpOnly: !!c.httpOnly,
      secure: !!c.secure,
    };
    if (c.sameSite) {
      const ss = String(c.sameSite).toLowerCase();
      out.sameSite = ss === 'no_restriction' || ss === 'none' ? 'None' : ss === 'lax' ? 'Lax' : ss === 'strict' ? 'Strict' : 'Lax';
    } else {
      out.sameSite = 'Lax';
    }
    if (typeof c.expirationDate === 'number') out.expires = Math.floor(c.expirationDate);
    else if (typeof c.expires === 'number') out.expires = Math.floor(c.expires);
    return out;
  }).filter(c => c.name && c.value && c.domain);
}

async function loadActiveCookies(preferredId) {
  // Load ALL active, non-expired cookies. Preferred one first (if provided & still valid),
  // then most-recently-verified, then newest.
  const { data, error } = await supabase
    .from('google_account_cookies')
    .select('*')
    .eq('expired', false)
    .eq('is_active', true)
    .order('last_verified_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = Array.isArray(data) ? [...data] : [];
  if (preferredId) {
    const idx = rows.findIndex(r => r.id === preferredId);
    if (idx > 0) {
      const [row] = rows.splice(idx, 1);
      rows.unshift(row);
    }
  }
  if (rows.length === 0) {
    const envCookies = normalizeCookies(GOOGLE_COOKIES_JSON);
    if (envCookies.length > 0) {
      rows.push({
        id: '__env_google_cookies__',
        label: 'Railway GOOGLE_COOKIES_JSON',
        cookies_json: envCookies,
        is_active: true,
        expired: false,
      });
    }
  }
  return rows;
}

async function markCookiesExpired(cookieId) {
  if (!cookieId || String(cookieId).startsWith('__env_')) return;
  await supabase.from('google_account_cookies').update({ expired: true, is_active: false }).eq('id', cookieId);
}

async function saveRefreshedCookies(cookieRow, context, reason = 'refresh') {
  if (!cookieRow?.id || String(cookieRow.id).startsWith('__env_')) return;
  try {
    const cookies = await context.cookies();
    const googleCookies = cookies.filter(c => /(^|\.)google\.com$/i.test(c.domain) || /(^|\.)googleusercontent\.com$/i.test(c.domain));
    if (googleCookies.length === 0) return;
    await supabase
      .from('google_account_cookies')
      .update({ cookies_json: googleCookies, expired: false, is_active: true, last_verified_at: new Date().toISOString() })
      .eq('id', cookieRow.id);
    console.log(`[checker] saved refreshed Google cookies (${googleCookies.length}) after ${reason}`);
  } catch (e) {
    console.error('[checker] failed to save refreshed cookies:', e.message);
  }
}

// ============================================================================
// FAST MODE — extension-style HTTP fetch with saved Google cookies.
// Only 2 markers (matching the Chrome extension that the operator validated):
//   - "already been used"   → invalid (used)
//   - "new activation link" → invalid (needs new link)
// Any other 200 OK page  → valid.
// Redirect to accounts.google.com/signin → cookies_expired.
// ============================================================================
const INVALID_MARKERS_FAST = [
  { needle: 'already been used', reason: 'Already used' },
  { needle: 'new activation link', reason: 'Needs new link' },
];

const FAST_MODE = process.env.LINK_CHECKER_FAST_MODE !== 'false'; // default ON
const FAST_TIMEOUT_MS = Number(process.env.FAST_TIMEOUT_MS || 15000);
const FAST_RETRIES = Number(process.env.FAST_RETRIES || 2);

function buildCookieHeader(cookiesJson) {
  const arr = normalizeCookies(cookiesJson);
  // Use only google.com cookies (one.google.com / serviceactivation.google.com share base)
  const filtered = arr.filter(c => /(^|\.)google\.com$/i.test(c.domain));
  const seen = new Set();
  const parts = [];
  for (const c of filtered) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    parts.push(`${c.name}=${c.value}`);
  }
  return parts.join('; ');
}

async function checkUrlFast(cookieHeader, url) {
  for (let attempt = 1; attempt <= FAST_RETRIES + 1; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FAST_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
      });
      clearTimeout(t);

      const finalUrl = resp.url || url;
      if (/accounts\.google\.com\/(signin|ServiceLogin|v3\/signin)/i.test(finalUrl)) {
        return { result: 'cookies_expired', reason: 'redirected to Google sign-in' };
      }

      if (resp.status === 429 && attempt <= FAST_RETRIES) {
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      if (!resp.ok) {
        return { result: 'error', reason: `HTTP ${resp.status}` };
      }

      const body = (await resp.text()).toLowerCase();
      for (const m of INVALID_MARKERS_FAST) {
        if (body.includes(m.needle)) return { result: 'invalid', reason: m.reason };
      }
      return { result: 'valid', reason: '' };
    } catch (err) {
      clearTimeout(t);
      if (attempt <= FAST_RETRIES) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      if (err.name === 'AbortError') return { result: 'error', reason: 'Timeout' };
      return { result: 'error', reason: (err.message || 'Network Error').slice(0, 120) };
    }
  }
  return { result: 'error', reason: 'Retry exhausted' };
}

// ============================================================================
// LEGACY PLAYWRIGHT MODE (only used when FAST_MODE=false OR persistent profile)
// ============================================================================
const INVALID_MARKERS = [
  'already been used',
  'new activation link',
  'already in use',
  'already been redeemed',
  'already redeemed',
  'no longer valid',
  'no longer available',
  'this offer is not available',
  'this offer is no longer',
  'link has expired',
  'offer has expired',
  'this link is not valid',
  'this code has already been',
];

const VALID_MARKERS = [
  'activate plan', 'get started', 'accept and continue', 'redeem',
  'start your', 'try google', 'claim offer', 'claim your',
  'one ai premium', 'google ai pro',
];

async function checkUrl(context, url) {
  const page = await context.newPage();
  try {
    await page.route('**/*', (route) => {
      const t = route.request().resourceType();
      if (t === 'image' || t === 'font' || t === 'media' || t === 'stylesheet') return route.abort();
      return route.continue();
    });
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const isSignIn = (u) => /accounts\.google\.com\/(signin|ServiceLogin|v3\/signin)/i.test(u);
    if (isSignIn(page.url())) return { result: 'cookies_expired', reason: 'redirected to Google sign-in' };

    const scan = async () => {
      const t = (await page.evaluate(() => document.body?.innerText || '').catch(() => '')).toLowerCase();
      for (const m of INVALID_MARKERS) if (t.includes(m)) return { text: t, hit: { result: 'invalid', reason: m } };
      return { text: t, hit: null };
    };
    const invalidDeadline = Date.now() + 3500;
    let lastText = '';
    while (Date.now() < invalidDeadline) {
      if (isSignIn(page.url())) return { result: 'cookies_expired', reason: 'redirected to Google sign-in' };
      const { text, hit } = await scan();
      lastText = text;
      if (hit) return hit;
      await new Promise(r => setTimeout(r, 250));
    }
    try { await page.waitForLoadState('networkidle', { timeout: 3000 }); } catch {}
    await new Promise(r => setTimeout(r, 600));
    { const { text, hit } = await scan(); lastText = text; if (hit) return hit; }
    for (const m of VALID_MARKERS) if (lastText.includes(m)) return { result: 'valid', reason: m };
    return { result: 'error', reason: `unknown page (status ${resp?.status() || '?'}, len ${lastText.length})` };
  } catch (e) {
    return { result: 'error', reason: e.message.slice(0, 200) };
  } finally {
    await page.close().catch(() => {});
  }
}



async function runJob(job) {
  console.log(`[checker] starting job ${job.id} for product ${job.product_id}`);

  const hasProfile = (() => {
    try { return fs.existsSync(`${PROFILE_DIR}/Default`); } catch { return false; }
  })();

  // Railway runs Linux, so Chrome profiles zipped from Windows often lose usable Google
  // session cookies (OS-encrypted). Prefer Cookie-Editor JSON cookies when available;
  // keep the persistent profile only as a fallback.
  const cookieQueue = await loadActiveCookies(job.cookie_id);
  let cookieRow = cookieQueue.shift() || null;
  const useProfile = !cookieRow && hasProfile;

  if (cookieRow && hasProfileAuthExpiredMarker()) {
    console.log('[checker] exported cookies are active — ignoring expired persistent-profile marker');
  }

  if (useProfile && hasProfileAuthExpiredMarker()) {
    await supabase.from('link_check_jobs').update({
      status: 'failed',
      error_text: 'Google session expired in persistent profile — fresh PROFILE_ZIP_URL required',
      finished_at: new Date().toISOString(),
    }).eq('id', job.id);
    await notifyAuthExpiredOnce(true);
    return;
  }

  if (!cookieRow && !useProfile) {
    await supabase.from('link_check_jobs').update({
      status: 'failed', error_text: 'No active cookies and no persistent profile', finished_at: new Date().toISOString(),
    }).eq('id', job.id);
    await notifyAdmin('⚠️ Link checker: no active Google cookies and no persistent profile. Add Cookie-Editor JSON cookies in admin → Link Checker.');
    return;
  }

  if (cookieRow) {
    console.log('[checker] using exported Google cookies from Supabase');
    if (String(cookieRow.id).startsWith('__env_')) {
      console.log('[checker] warning: GOOGLE_COOKIES_JSON env cookies cannot be auto-refreshed; save cookies in admin Link Checker tab for longer-lived sessions');
    }
  } else {
    console.log('[checker] using persistent Chromium profile at', PROFILE_DIR);
  }

  // Load ALL available stock items for the product (keyset pagination by id — robust against PostgREST max-rows caps)
  const stockItems = [];
  {
    const PAGE = 1000;
    let lastId = '00000000-0000-0000-0000-000000000000';
    while (true) {
      const { data: page, error: stockErr } = await supabase
        .from('bot_product_stock_items')
        .select('id, data')
        .eq('product_id', job.product_id)
        .eq('status', 'available')
        .gt('id', lastId)
        .order('id', { ascending: true })
        .limit(PAGE);
      if (stockErr) throw stockErr;
      if (!page || page.length === 0) break;
      stockItems.push(...page);
      lastId = page[page.length - 1].id;
      if (page.length < PAGE) break;
    }
  }
  console.log(`[checker] loaded ${stockItems.length} available stock items for product ${job.product_id}`);


  const items = (stockItems || [])
    .map(s => ({ stock_item_id: s.id, url: extractUrl(s.data) }))
    .filter(x => x.url);

  if (items.length === 0) {
    await supabase.from('link_check_jobs').update({
      status: 'completed', total: 0, finished_at: new Date().toISOString(), started_at: new Date().toISOString(),
    }).eq('id', job.id);
    return;
  }

  // Insert pending items
  const rows = items.map(i => ({ job_id: job.id, stock_item_id: i.stock_item_id, url: i.url, status: 'pending' }));
  // chunked insert
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500);
    const { error } = await supabase.from('link_check_items').insert(slice);
    if (error) throw error;
  }

  await supabase.from('link_check_jobs').update({
    status: 'running', total: items.length, started_at: new Date().toISOString(),
  }).eq('id', job.id);

  // Choose runtime mode:
  //   - fastMode (default): plain HTTPS fetch with saved Google cookies (extension-style, 10x faster).
  //   - Playwright mode: only used when FAST_MODE=false OR when only a persistent profile (no exported cookies) is available.
  const fastMode = FAST_MODE && !!cookieRow && !useProfile;
  console.log(`[checker] mode = ${fastMode ? 'FAST (http fetch + cookies)' : useProfile ? 'PLAYWRIGHT (persistent profile)' : 'PLAYWRIGHT (cookies)'}`);

  const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox'];
  const contextOpts = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
  };

  let browser = null;
  let context = null;
  let cookieHeader = '';

  async function buildContextForCookie(row) {
    const b = await chromium.launch({ headless: true, args: launchArgs });
    const ctx = await b.newContext(contextOpts);
    await ctx.addCookies(normalizeCookies(row.cookies_json));
    return { browser: b, context: ctx };
  }

  if (fastMode) {
    cookieHeader = buildCookieHeader(cookieRow.cookies_json);
    if (!cookieHeader) {
      console.warn('[checker] fast mode: built empty cookie header — falling back to Playwright');
    }
  }

  if (!fastMode) {
    if (useProfile) {
      context = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: true,
        args: launchArgs,
        ...contextOpts,
      });
    } else {
      const built = await buildContextForCookie(cookieRow);
      browser = built.browser;
      context = built.context;
    }
  }

  let aborted = false;
  let abortReason = '';
  // In fast mode allow much higher parallelism (extension uses 10). Playwright stays at 5 for stability.
  const concurrency = fastMode
    ? Math.max(1, Math.min(20, job.concurrency_fast || 10))
    : Math.max(1, Math.min(10, job.concurrency || 5));
  const delay = fastMode ? Math.max(0, job.delay_ms ?? 200) : Math.max(0, job.delay_ms || 800);
  let lastCookieRefreshSaveAt = 0;

  // Rotate to the next active cookie when the current one is detected as expired.
  let rotatingPromise = null;
  async function rotateCookie(reason) {
    if (rotatingPromise) return rotatingPromise;
    rotatingPromise = (async () => {
      const oldLabel = cookieRow?.label || 'unknown';
      const oldId = cookieRow?.id;
      console.log(`[checker] rotating cookie "${oldLabel}" — ${reason}`);
      if (oldId) await markCookiesExpired(oldId);
      if (context) { try { await context.close(); } catch {} context = null; }
      if (browser) { try { await browser.close(); } catch {} browser = null; }

      const fresh = await loadActiveCookies().catch(() => []);
      const next = fresh.find(r => r.id !== oldId) || cookieQueue.shift();
      if (!next) {
        cookieRow = null;
        cookieHeader = '';
        await notifyAdmin(`⚠️ Link checker: cookie "${oldLabel}" expired and no fallback cookies available. Add a fresh cookie in admin → Link Checker.`);
        return false;
      }
      cookieRow = next;
      if (fastMode) {
        cookieHeader = buildCookieHeader(next.cookies_json);
      } else {
        const built = await buildContextForCookie(next);
        browser = built.browser;
        context = built.context;
      }
      lastCookieRefreshSaveAt = 0;
      await notifyAdmin(`🔄 Link checker: cookie "${oldLabel}" expired — switched to "${next.label}".`);
      console.log(`[checker] switched to cookie "${next.label}"`);
      return true;
    })().finally(() => { rotatingPromise = null; });
    return rotatingPromise;
  }



  // Top-up: enqueue any newly-added available stock items that aren't already in this job.
  async function topUpNewStock() {
    const PAGE = 1000;
    const existingIds = new Set();
    {
      let lastId = '00000000-0000-0000-0000-000000000000';
      while (true) {
        const { data: page } = await supabase
          .from('link_check_items')
          .select('id, stock_item_id')
          .eq('job_id', job.id)
          .gt('id', lastId)
          .order('id', { ascending: true })
          .limit(PAGE);
        if (!page || page.length === 0) break;
        for (const r of page) if (r.stock_item_id) existingIds.add(r.stock_item_id);
        lastId = page[page.length - 1].id;
        if (page.length < PAGE) break;
      }
    }

    const current = [];
    {
      let lastId = '00000000-0000-0000-0000-000000000000';
      while (true) {
        const { data: page } = await supabase
          .from('bot_product_stock_items')
          .select('id, data')
          .eq('product_id', job.product_id)
          .eq('status', 'available')
          .gt('id', lastId)
          .order('id', { ascending: true })
          .limit(PAGE);
        if (!page || page.length === 0) break;
        current.push(...page);
        lastId = page[page.length - 1].id;
        if (page.length < PAGE) break;
      }
    }

    const fresh = current
      .filter(s => !existingIds.has(s.id))
      .map(s => ({ stock_item_id: s.id, url: extractUrl(s.data) }))
      .filter(x => x.url);



    if (fresh.length === 0) return 0;

    const newRows = fresh.map(i => ({ job_id: job.id, stock_item_id: i.stock_item_id, url: i.url, status: 'pending' }));
    for (let i = 0; i < newRows.length; i += 500) {
      const slice = newRows.slice(i, i + 500);
      const { error } = await supabase.from('link_check_items').insert(slice);
      if (error) { console.error('[checker] top-up insert error', error); return 0; }
    }
    // Bump job.total so the progress bar reflects the new items
    const { data: jobRow } = await supabase.from('link_check_jobs').select('total').eq('id', job.id).single();
    await supabase.from('link_check_jobs').update({ total: (jobRow?.total || 0) + fresh.length, updated_at: new Date().toISOString() }).eq('id', job.id);
    console.log(`[checker] topped up ${fresh.length} newly-added stock items into job ${job.id}`);
    return fresh.length;
  }

  let lastTopUp = Date.now();
  const TOP_UP_INTERVAL_MS = 30000;

  async function worker() {
    while (!aborted) {
      // Wait if a rotation is in progress
      if (rotatingPromise) { await rotatingPromise; if (aborted) break; }

      // Check job status (cancellation)
      const { data: cur } = await supabase.from('link_check_jobs').select('status').eq('id', job.id).single();
      if (cur && (cur.status === 'cancelled' || cur.status === 'failed')) { aborted = true; abortReason = abortReason || cur.status; break; }

      // Periodic top-up while running
      if (Date.now() - lastTopUp > TOP_UP_INTERVAL_MS) {
        lastTopUp = Date.now();
        await topUpNewStock().catch(e => console.error('[checker] topUp err', e));
      }

      const { data: claimed, error: claimErr } = await supabase.rpc('claim_next_link_check_item', { _job_id: job.id });
      if (claimErr) { console.error('[checker] claim error', claimErr); break; }
      let item = Array.isArray(claimed) ? claimed[0] : claimed;

      if (!item) {
        // Queue empty — try one final top-up before giving up
        const added = await topUpNewStock().catch(() => 0);
        lastTopUp = Date.now();
        if (added > 0) {
          const { data: retry } = await supabase.rpc('claim_next_link_check_item', { _job_id: job.id });
          item = Array.isArray(retry) ? retry[0] : retry;
        }
        if (!item) break; // truly empty
      }

      const ctxSnapshot = context;
      const cookieSnapshot = cookieRow;
      const res = fastMode
        ? await checkUrlFast(cookieHeader, item.url)
        : await checkUrl(ctxSnapshot, item.url);
      if (res.result === 'cookies_expired') {
        await supabase.from('link_check_items').update({ status: 'pending', reason: null, checked_at: null }).eq('id', item.id);
        if (useProfile) {
          aborted = true;
          abortReason = 'cookies_expired';
          break;
        }
        if (!cookieSnapshot || !cookieRow || cookieSnapshot.id !== cookieRow.id) {
          console.log('[checker] stale cookies_expired from previous cookie — ignoring, retrying with current cookie');
          continue;
        }
        const ok = await rotateCookie('worker hit Google sign-in redirect');
        if (!ok) {
          aborted = true;
          abortReason = 'cookies_expired';
          break;
        }
        continue;
      }

      await supabase.rpc('mark_link_check_result', {
        _item_id: item.id, _result: res.result, _reason: res.reason,
      });

      // Playwright mode periodically saves refreshed cookies back to DB.
      // Fast mode (raw fetch) can't observe Set-Cookie refreshes reliably, so we skip it.
      if (!fastMode && cookieRow && res.result !== 'cookies_expired' && Date.now() - lastCookieRefreshSaveAt > COOKIE_REFRESH_SAVE_INTERVAL_MS) {
        lastCookieRefreshSaveAt = Date.now();
        await saveRefreshedCookies(cookieRow, context, res.result);
      }

      console.log(`[checker] ${res.result} - ${item.url.slice(0, 80)}... (${res.reason})`);
      if (delay > 0) await new Promise(r => setTimeout(r, delay));
    }
  }


  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  if (!fastMode && !abortReason && cookieRow && context) await saveRefreshedCookies(cookieRow, context, 'job complete');
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});


  if (abortReason === 'cookies_expired') {
    if (cookieRow) await markCookiesExpired(cookieRow.id);
    if (useProfile) markProfileAuthExpired('redirected to Google sign-in');
    await supabase.from('link_check_jobs').update({
      status: 'failed',
      error_text: useProfile
        ? 'Google session expired in persistent profile — re-upload PROFILE_ZIP_URL'
        : 'Google cookies expired — re-upload required',
      finished_at: new Date().toISOString(),
    }).eq('id', job.id);
    await notifyAuthExpiredOnce(useProfile);
    return;
  }

  if (abortReason === 'cancelled') {
    return; // status already cancelled
  }

  const { data: finalJob } = await supabase.from('link_check_jobs').select('*').eq('id', job.id).single();
  await supabase.from('link_check_jobs').update({
    status: 'completed', finished_at: new Date().toISOString(),
  }).eq('id', job.id);

  if (finalJob) {
    const { data: prod } = await supabase.from('bot_products').select('name, link_check_auto').eq('id', job.product_id).single();
    // In auto-loop mode, only notify when invalid links were found (avoid spam).
    const shouldNotify = !prod?.link_check_auto || finalJob.invalid_count > 0;
    if (shouldNotify) {
      await notifyAdmin(
        `✅ <b>Link check complete</b>${prod?.link_check_auto ? ' (auto-loop)' : ''}\n\n` +
        `Product: <b>${prod?.name || job.product_id}</b>\n` +
        `Total: ${finalJob.total}\n` +
        `Valid: ${finalJob.valid_count}\n` +
        `Invalid (removed): ${finalJob.invalid_count}\n` +
        `Errors: ${finalJob.error_count}`
      );
    }
  }
}

async function autoEnqueueIfNeeded() {
  if (!LEGACY_LINK_CHECKER_ENABLED) return;
  // For every product with link_check_auto=true, ensure a queued/running job exists.
  const { data: autoProducts } = await supabase
    .from('bot_products')
    .select('id, name')
    .eq('link_check_auto', true)
    .eq('is_active', true);
  if (!autoProducts || autoProducts.length === 0) return;

  const hasProfile = (() => { try { return fs.existsSync(`${PROFILE_DIR}/Default`); } catch { return false; } })();

  const { data: cookie } = await supabase
    .from('google_account_cookies')
    .select('id')
    .eq('is_active', true).eq('expired', false)
    .limit(1).maybeSingle();
  const hasEnvCookies = normalizeCookies(GOOGLE_COOKIES_JSON).length > 0;

  if (!cookie && !hasEnvCookies && hasProfile && hasProfileAuthExpiredMarker()) {
    console.log('[checker] profile auth is marked expired and no active exported cookies exist — auto link-check jobs paused');
    return;
  }
  if (!cookie && !hasEnvCookies && !hasProfile) return; // can't auto-loop without cookies or profile

  const cookieId = cookie?.id ?? null;

  for (const p of autoProducts) {
    const { data: existing } = await supabase
      .from('link_check_jobs')
      .select('id')
      .eq('product_id', p.id)
      .in('status', ['queued', 'vps_queued', 'running'])
      .limit(1);
    if (existing && existing.length > 0) continue;

    await supabase.from('link_check_jobs').insert({
      product_id: p.id,
      cookie_id: cookieId,
      concurrency: 5,
      delay_ms: 800,
      status: 'queued',
    });
    console.log(`[checker] auto-enqueued job for ${p.name}`);
  }
}

async function poll() {
  try {
    if (!LEGACY_LINK_CHECKER_ENABLED) {
      setTimeout(poll, POLL_INTERVAL_MS);
      return;
    }

    await autoEnqueueIfNeeded();

    const { data, error } = await supabase
      .from('link_check_jobs')
      .select('*')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(1);
    if (error) throw error;
    const job = data?.[0];
    if (job) {
      try {
        await runJob(job);
      } catch (e) {
        console.error('[checker] job error', e);
        await supabase.from('link_check_jobs').update({
          status: 'failed', error_text: String(e.message || e).slice(0, 500), finished_at: new Date().toISOString(),
        }).eq('id', job.id);
        await notifyAdmin(`❌ Link check job failed: ${String(e.message || e).slice(0, 300)}`);
      }
    }
  } catch (e) {
    console.error('[checker] poll error', e);
  } finally {
    setTimeout(poll, POLL_INTERVAL_MS);
  }
}

console.log('[checker] Gemini link checker started, polling every', POLL_INTERVAL_MS, 'ms');
poll();
