// Fast-fetch + browser-fallback link checker.
// Ported from vps-worker/worker.js, but Supabase-free and reusable for
// the Telegram bot. Google activation links use the persistent Chrome
// profile's cookie jar for Google activation links, matching the site checker.

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const {
  CHROME_PROFILE_DIR = '/root/tg-checker-chrome-profile',
  CHROME_CHANNEL = 'chrome',
  CHROME_EXECUTABLE_PATH = '',
  HEADFUL = 'false',
  NAV_TIMEOUT_MS = '15000',
  RETRIES_ON_ERROR = '2',
  FETCH_BYTE_LIMIT = '98304',
  HEAD_FIRST = 'false',
  LINK_CHECK_ENGINE = 'playwright_request',
  HTTP_CONNECTIONS = '50',
  HTTP_PIPELINING = '2',
  BROWSER_CONCURRENCY = '5',

  INVALID_TEXT_PATTERNS = '',
  VALID_TEXT_PATTERNS = '',
  BROWSER_FALLBACK_HTTP_STATUSES = '401,403,429',
} = process.env;

const navTimeout = parseInt(NAV_TIMEOUT_MS, 10);
const retries = parseInt(RETRIES_ON_ERROR, 10);
const fetchByteLimit = Math.max(0, parseInt(FETCH_BYTE_LIMIT, 10) || 0);
const headFirst = HEAD_FIRST !== 'false';
const linkCheckEngine = String(LINK_CHECK_ENGINE || 'playwright_request').toLowerCase();
const httpConnections = Math.max(1, parseInt(HTTP_CONNECTIONS, 10) || 50);
const httpPipelining = Math.max(1, parseInt(HTTP_PIPELINING, 10) || 2);
const browserConcurrency = Math.max(1, parseInt(BROWSER_CONCURRENCY, 10) || 5);

try {
  const { Agent, setGlobalDispatcher } = await import('undici');
  setGlobalDispatcher(new Agent({
    connections: httpConnections,
    pipelining: httpPipelining,
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 120_000,
  }));
  console.log(`⚡ HTTP pool enabled (connections=${httpConnections}, pipelining=${httpPipelining}, engine=${linkCheckEngine})`);
} catch {
  // undici is optional at runtime; Node's built-in fetch still works.
}

const BUILTIN_INVALID_PATTERNS = [
  'already been used',
  'new activation link',
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
const browserFallbackStatuses = new Set(
  BROWSER_FALLBACK_HTTP_STATUSES.split(',').map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite),
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isGoogleActivationUrl(url) {
  return /(^|\.)google\.com\/subscription\//i.test(String(url));
}

function cookieDomainMatches(hostname, cookieDomain = '') {
  const domain = cookieDomain.replace(/^\./, '').toLowerCase();
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function cookiePathMatches(pathname, cookiePath = '/') {
  return pathname === cookiePath || pathname.startsWith(cookiePath.endsWith('/') ? cookiePath : `${cookiePath}/`);
}

let profileCookieCache = { expiresAt: 0, cookies: [] };
let profileCookiePromise = null;
async function getCachedProfileCookies(ctx) {
  const now = Date.now();
  if (profileCookieCache.expiresAt > now) return profileCookieCache.cookies;
  if (!profileCookiePromise) {
    profileCookiePromise = ctx.cookies([
      'https://google.com',
      'https://accounts.google.com',
      'https://serviceactivation.google.com',
    ]).catch(() => []).then((cookies) => {
      profileCookieCache = { expiresAt: Date.now() + 60_000, cookies };
      return cookies;
    }).finally(() => { profileCookiePromise = null; });
  }
  return profileCookiePromise;
}

function buildCookieHeaderFromList(cookies, url) {
  const initial = new URL(url);
  const seen = new Set();
  const pairs = [];
  for (const c of cookies) {
    const key = `${c.name}=${c.value}`;
    if (seen.has(key)) continue;
    if (!cookieDomainMatches(initial.hostname, c.domain)) continue;
    if (!cookiePathMatches(initial.pathname || '/', c.path || '/')) continue;
    seen.add(key);
    pairs.push(`${c.name}=${c.value}`);
  }
  return pairs.join('; ');
}

function shouldFollowRedirect(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function fastFetchWithCookies(url, baseHeaders, profileCookies, method = 'GET', signal) {
  let currentUrl = url;
  for (let redirects = 0; redirects <= 10; redirects++) {
    const headers = { ...baseHeaders };
    if (profileCookies.length > 0) {
      const cookieHeader = buildCookieHeaderFromList(profileCookies, currentUrl);
      if (cookieHeader) headers.cookie = cookieHeader;
    }
    const res = await fetch(currentUrl, {
      method,
      redirect: 'manual',
      headers,
      signal,
    });
    if (!shouldFollowRedirect(res.status) || redirects === 10) return res;
    await res.body?.cancel?.().catch?.(() => {});
    const location = res.headers.get('location');
    if (!location) return res;
    currentUrl = new URL(location, currentUrl).toString();
    if (res.status === 303 && method !== 'HEAD') method = 'GET';
  }
  throw new Error('too many redirects');
}

async function readTextLimited(res, limitBytes) {
  if (!res.body || !limitBytes || limitBytes <= 0) return (await res.text()).toLowerCase();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (bytes < limitBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (bytes >= limitBytes) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
    text += decoder.decode();
    return text.toLowerCase();
  } finally {
    reader.releaseLock();
  }
}

async function readApiResponseTextLimited(res, limitBytes) {
  // Playwright APIResponse already handles cookies, redirects, and decompression.
  // It does not expose a streaming reader, so trim after decode for classification.
  const text = await res.text();
  if (!limitBytes || limitBytes <= 0) return text.toLowerCase();
  return text.slice(0, limitBytes).toLowerCase();
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
    return { result: 'error', reason: 'google auth required (re-run npm run login)' };
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

async function withHardTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} hard timeout ${ms}ms`)), ms);
  });
  try { return await Promise.race([promise, timeout]); }
  finally { clearTimeout(timer); }
}

// ------- Browser fallback (lazy, shared singleton) -------
let browserCtx = null;
let browserLaunchPromise = null;
let browserPageSemaphore = null;

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

async function getProfileCookieCount(ctx) {
  try {
    return (await ctx.cookies('https://accounts.google.com')).length
      + (await ctx.cookies('https://serviceactivation.google.com')).length
      + (await ctx.cookies('https://google.com')).length;
  } catch {
    return 0;
  }
}

async function getBrowser() {
  if (browserCtx) return browserCtx;
  if (browserLaunchPromise) return browserLaunchPromise;
  browserLaunchPromise = (async () => {
    console.log('🚀 Launching Chrome profile:', CHROME_PROFILE_DIR, '| channel:', CHROME_CHANNEL || 'bundled');
    await cleanupStaleChromeProfileLocks(CHROME_PROFILE_DIR);
    const launchOptions = {
      headless: HEADFUL !== 'true',
      viewport: { width: 1280, height: 800 },
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', '--lang=en-US'],
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
    const cookieCount = await getProfileCookieCount(ctx);
    console.log('🍪 Google profile cookies loaded:', cookieCount);
    // Block only heavy static assets — keep scripts running so Google redirects work reliably.
    await ctx.route('**/*', (route) => {
      const t = route.request().resourceType();
      if (t === 'image' || t === 'font' || t === 'media' || t === 'stylesheet') return route.abort();
      return route.continue();
    }).catch(() => {});



    ctx.on('close', () => { browserCtx = null; browserLaunchPromise = null; });
    browserCtx = ctx;
    return ctx;
  })();
  try { return await browserLaunchPromise; }
  catch (e) { browserLaunchPromise = null; throw e; }
}

// Simple semaphore for browser pages.
function makeSemaphore(max) {
  let active = 0;
  const queue = [];
  return {
    async acquire() {
      if (active < max) { active++; return; }
      await new Promise((r) => queue.push(r));
      active++;
    },
    release() {
      active--;
      const next = queue.shift();
      if (next) next();
    },
  };
}

async function judgeUrlInBrowser(url, reasonPrefix = 'browser fallback') {
  if (!browserPageSemaphore) browserPageSemaphore = makeSemaphore(browserConcurrency);
  await browserPageSemaphore.acquire();
  let ctx;
  try {
    ctx = await getBrowser();
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
  } catch (e) {
    return { result: 'error', reason: `${reasonPrefix}: ${String(e?.message || e).slice(0, 200)}` };
  } finally {
    browserPageSemaphore.release();
  }
}

// ------- Fast HTTP fetch (native fetch + Chrome profile cookies) -------
async function judgeUrl(url, { ctx, profileCookies = [] } = {}) {
  // NOTE: do NOT set accept-encoding manually — that disables undici/fetch
  // auto-decompression and body comes back as compressed bytes, so pattern
  // matching silently fails and everything looks "valid".
  const headers = {
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
  };
  // Range header also breaks compression on many servers; only use when explicitly enabled.
  if (fetchByteLimit > 0 && process.env.USE_RANGE_HEADER === 'true') {
    headers['range'] = `bytes=0-${fetchByteLimit - 1}`;
  }

  const useChromeCookies = isGoogleActivationUrl(url);

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), navTimeout);
    try {
      if (useChromeCookies && ctx && linkCheckEngine !== 'native_http') {
        if (headFirst) {
          const headRes = await ctx.request.fetch(url, {
            method: 'HEAD',
            headers,
            timeout: navTimeout,
            maxRedirects: 10,
          });
          const headUrl = headRes.url().toLowerCase();
          if (/already|redeemed|expired|error/.test(headUrl)) {
            await headRes.dispose().catch(() => {});
            return { result: 'invalid', reason: `redirected: ${headUrl.slice(0, 120)}` };
          }
          await headRes.dispose().catch(() => {});
        }

        const res = await ctx.request.get(url, {
          headers,
          timeout: navTimeout,
          maxRedirects: 10,
        });
        const status = res.status();
        const finalUrl = res.url().toLowerCase();

        if ((status === 429 || status === 408 || status >= 500) && attempt <= retries) {
          await res.dispose().catch(() => {});
          await sleep(status === 429 ? 3000 : 1000 * attempt);
          continue;
        }

        if (!res.ok()) {
          if (browserFallbackStatuses.has(status)) {
            await res.dispose().catch(() => {});
            return await judgeUrlInBrowser(url, `playwright request HTTP ${status}`);
          }
          await res.dispose().catch(() => {});
          return { result: 'error', reason: `HTTP ${status}` };
        }

        const bodyText = await readApiResponseTextLimited(res, fetchByteLimit);
        await res.dispose().catch(() => {});
        const classified = classifyPage(finalUrl, bodyText);
        if (classified.result === 'error' && classified.reason.startsWith('google auth required')) {
          if ((await getProfileCookieCount(ctx)) === 0) {
            return { result: 'error', reason: `google auth required — no Google cookies found in ${CHROME_PROFILE_DIR}. Run DISPLAY=:1 node login.js with the same root/user, then close Chrome and restart pm2.` };
          }
          return await judgeUrlInBrowser(url, 'playwright request google auth');
        }
        return classified;
      }

      if (useChromeCookies && headFirst) {
        const headHeaders = { ...headers };
        delete headHeaders.range;
        const headRes = await fastFetchWithCookies(url, headHeaders, profileCookies, 'HEAD', ac.signal);
        const headUrl = headRes.url.toLowerCase();
        if (/already|redeemed|expired|error/.test(headUrl)) {
          await headRes.body?.cancel?.().catch?.(() => {});
          return { result: 'invalid', reason: `redirected: ${headUrl.slice(0, 120)}` };
        }
        await headRes.body?.cancel?.().catch?.(() => {});
      }

      const res = useChromeCookies
        ? await fastFetchWithCookies(url, headers, profileCookies, 'GET', ac.signal)
        : await fetch(url, { redirect: 'follow', headers, signal: ac.signal });
      const status = res.status;
      const finalUrl = res.url.toLowerCase();

      if ((status === 429 || status === 408 || status >= 500) && attempt <= retries) {
        await sleep(status === 429 ? 3000 : 1000 * attempt);
        continue;
      }

      const ok = res.ok || status === 206;
      if (!ok) {
        if (browserFallbackStatuses.has(status)) {
          return await judgeUrlInBrowser(url, `fast fetch HTTP ${status}`);
        }
        return { result: 'error', reason: `HTTP ${status}` };
      }

      const bodyText = await readTextLimited(res, fetchByteLimit);
      const classified = classifyPage(finalUrl, bodyText);
      if (classified.result === 'error' && classified.reason.startsWith('google auth required')) {
        if (useChromeCookies && ctx && (await getProfileCookieCount(ctx)) === 0) {
          return { result: 'error', reason: `google auth required — no Google cookies found in ${CHROME_PROFILE_DIR}. Run DISPLAY=:1 node login.js with the same root/user, then close Chrome and restart pm2.` };
        }
        return await judgeUrlInBrowser(url, 'fast fetch google auth');
      }
      return classified;
    } catch (e) {
      const msg = String(e?.message || e);
      const transient = /abort|timeout|socket hang up|econnreset|enetunreach|etimedout|network|other side closed/i.test(msg);
      if (transient && attempt <= retries) { await sleep(1000 * attempt); continue; }
      if (/abort|timeout/i.test(msg)) return { result: 'error', reason: 'Timeout' };
      return { result: 'error', reason: msg.slice(0, 240) };
    } finally {
      clearTimeout(timer);
    }
  }
}

// Pre-warm the browser context so the first job doesn't pay cold-start cost.
export async function prewarm() {
  try {
    await getBrowser();
    console.log('🔥 Browser pre-warmed');
  } catch (e) {
    console.warn('prewarm failed (will retry on first use):', e?.message || e);
  }
}


// Run a batch with bounded concurrency. onProgress({ checked, valid, invalid, errors })
export async function checkUrls(urls, { concurrency, onProgress, signal } = {}) {
  const total = urls.length;
  const results = new Array(total);
  let idx = 0;
  let checked = 0, valid = 0, invalid = 0, errors = 0;
  const needsChromeCookies = urls.some(isGoogleActivationUrl);
  const ctx = needsChromeCookies ? await getBrowser() : null;
  const profileCookies = ctx ? await getCachedProfileCookies(ctx) : [];

  async function worker() {
    while (true) {
      if (signal?.cancelled) return;
      const i = idx++;
      if (i >= total) return;
      const url = urls[i];
      const judgement = await withHardTimeout(judgeUrl(url, { ctx, profileCookies }), navTimeout * 3 + 5000, 'judgeUrl')
        .catch((e) => ({ result: 'error', reason: String(e?.message || e).slice(0, 240) }));
      results[i] = { url, ...judgement };
      checked++;
      if (judgement.result === 'valid') valid++;
      else if (judgement.result === 'invalid') invalid++;
      else errors++;
      if (onProgress) onProgress({ checked, total, valid, invalid, errors });
    }
  }

  const n = Math.max(1, Math.min(concurrency || 25, total));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}
