// Gemini link checker worker.
// Polls link_check_jobs in Supabase, validates each link in headless Chromium using saved Google cookies,
// silently flips invalid stock items to status='invalid', and alerts admin on Telegram when cookies expire.

import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import WebSocket from 'ws';

if (!globalThis.WebSocket) {
  globalThis.WebSocket = WebSocket;
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[checker] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const POLL_INTERVAL_MS = 5000;

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

async function loadActiveCookie(cookieId) {
  let q = supabase.from('google_account_cookies').select('*').eq('expired', false).eq('is_active', true);
  if (cookieId) q = q.eq('id', cookieId);
  const { data, error } = await q.limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

async function markCookiesExpired(cookieId) {
  if (!cookieId) return;
  await supabase.from('google_account_cookies').update({ expired: true, is_active: false }).eq('id', cookieId);
}

// Check a single URL. Returns { result: 'valid'|'invalid'|'error'|'cookies_expired', reason }
async function checkUrl(context, url) {
  const page = await context.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    // Wait for client-side render a bit
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    const finalUrl = page.url();

    if (/accounts\.google\.com\/(signin|ServiceLogin|v3\/signin)/i.test(finalUrl)) {
      return { result: 'cookies_expired', reason: 'redirected to Google sign-in' };
    }

    // Use VISIBLE text only (innerText) — page.content() includes <script> bundles
    // which often contain strings like "something went wrong" even on valid pages.
    const bodyText = (await page.evaluate(() => document.body?.innerText || '')).toLowerCase();

    const invalidMarkers = [
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
    for (const m of invalidMarkers) {
      if (bodyText.includes(m)) return { result: 'invalid', reason: m };
    }

    const validMarkers = [
      'activate plan',
      'get started',
      'accept and continue',
      'redeem',
      'start your',
      'try google',
      'claim offer',
      'claim your',
      'one ai premium',
      'google ai pro',
    ];
    for (const m of validMarkers) {
      if (bodyText.includes(m)) return { result: 'valid', reason: m };
    }

    // Fallback: unknown page state — treat as error so stock isn't deleted.
    return { result: 'error', reason: `unknown page (status ${resp?.status() || '?'}, len ${bodyText.length})` };
  } catch (e) {
    return { result: 'error', reason: e.message.slice(0, 200) };
  } finally {
    await page.close().catch(() => {});
  }
}

async function runJob(job) {
  console.log(`[checker] starting job ${job.id} for product ${job.product_id}`);

  const cookieRow = await loadActiveCookie(job.cookie_id);
  if (!cookieRow) {
    await supabase.from('link_check_jobs').update({
      status: 'failed', error_text: 'No active cookies', finished_at: new Date().toISOString(),
    }).eq('id', job.id);
    await notifyAdmin('⚠️ Link checker: no active Google cookies. Add fresh cookies in admin → Link Checker.');
    return;
  }

  // Load available stock items for the product
  const { data: stockItems, error: stockErr } = await supabase
    .from('bot_product_stock_items')
    .select('id, data')
    .eq('product_id', job.product_id)
    .eq('status', 'available');
  if (stockErr) throw stockErr;

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

  // Launch browser
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
  });
  await context.addCookies(normalizeCookies(cookieRow.cookies_json));

  let aborted = false;
  let abortReason = '';
  const concurrency = Math.max(1, Math.min(2, job.concurrency || 2));
  const delay = Math.max(0, job.delay_ms || 5000);

  async function worker() {
    while (!aborted) {
      // Check job status (cancellation)
      const { data: cur } = await supabase.from('link_check_jobs').select('status').eq('id', job.id).single();
      if (cur && (cur.status === 'cancelled' || cur.status === 'failed')) { aborted = true; abortReason = abortReason || cur.status; break; }

      const { data: claimed, error: claimErr } = await supabase.rpc('claim_next_link_check_item', { _job_id: job.id });
      if (claimErr) { console.error('[checker] claim error', claimErr); break; }
      const item = Array.isArray(claimed) ? claimed[0] : claimed;
      if (!item) break; // queue empty

      const res = await checkUrl(context, item.url);
      if (res.result === 'cookies_expired') {
        aborted = true;
        abortReason = 'cookies_expired';
        await supabase.from('link_check_items').update({ status: 'skipped', reason: 'cookies expired mid-job', checked_at: new Date().toISOString() }).eq('id', item.id);
        break;
      }

      await supabase.rpc('mark_link_check_result', {
        _item_id: item.id, _result: res.result, _reason: res.reason,
      });

      console.log(`[checker] ${res.result} - ${item.url.slice(0, 80)}... (${res.reason})`);
      if (delay > 0) await new Promise(r => setTimeout(r, delay));
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  await context.close().catch(() => {});
  await browser.close().catch(() => {});

  if (abortReason === 'cookies_expired') {
    await markCookiesExpired(cookieRow.id);
    await supabase.from('link_check_jobs').update({
      status: 'failed', error_text: 'Google cookies expired — re-upload required', finished_at: new Date().toISOString(),
    }).eq('id', job.id);
    await notifyAdmin('⚠️ <b>Google cookies expired</b>\n\nLink checker stopped. Open admin → Link Checker → Google Cookies and paste fresh export from Cookie-Editor extension.');
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
  // For every product with link_check_auto=true, ensure a queued/running job exists.
  const { data: autoProducts } = await supabase
    .from('bot_products')
    .select('id, name')
    .eq('link_check_auto', true)
    .eq('is_active', true);
  if (!autoProducts || autoProducts.length === 0) return;

  // Pick active cookie once
  const { data: cookie } = await supabase
    .from('google_account_cookies')
    .select('id')
    .eq('is_active', true).eq('expired', false)
    .limit(1).maybeSingle();
  if (!cookie) return; // can't auto-loop without cookies

  for (const p of autoProducts) {
    const { data: existing } = await supabase
      .from('link_check_jobs')
      .select('id')
      .eq('product_id', p.id)
      .in('status', ['queued', 'running'])
      .limit(1);
    if (existing && existing.length > 0) continue;

    await supabase.from('link_check_jobs').insert({
      product_id: p.id,
      cookie_id: cookie.id,
      concurrency: 2,
      delay_ms: 5000,
      status: 'queued',
    });
    console.log(`[checker] auto-enqueued job for ${p.name}`);
  }
}

async function poll() {
  try {
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
