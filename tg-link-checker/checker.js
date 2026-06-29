// Fast-fetch + browser-fallback link checker.
// Ported from vps-worker/worker.js, but Supabase-free and reusable for
// the Telegram bot. Google activation links use the persistent Chrome
// profile's cookie jar via BrowserContext.request, matching the site checker.

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
  NAV_TIMEOUT_MS = '10000',
  RETRIES_ON_ERROR = '1',
  FETCH_BYTE_LIMIT = '32768',
  BROWSER_CONCURRENCY = '8',
  INVALID_TEXT_PATTERNS = '',
  VALID_TEXT_PATTERNS = '',
  BROWSER_FALLBACK_HTTP_STATUSES = '401,403,429',
} = process.env;

const navTimeout = parseInt(NAV_TIMEOUT_MS, 10);
const retries = parseInt(RETRIES_ON_ERROR, 10);
const fetchByteLimit = Math.max(0, parseInt(FETCH_BYTE_LIMIT, 10) || 0);
const browserConcurrency = Math.max(1, parseInt(BROWSER_CONCURRENCY, 10) || 5);

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
    // Block heavy assets + non-essential scripts to make fallback much faster.
    // Allow scripts only from Google auth/subscription domains (needed for redirects/markers).
    await ctx.route('**/*', (route) => {
      const req = route.request();
      const t = req.resourceType();
      if (t === 'image' || t === 'font' || t === 'media' || t === 'stylesheet') return route.abort();
      if (t === 'script') {
        const u = req.url();
        if (/google\.com|gstatic\.com|googleapis\.com/i.test(u)) return route.continue();
        return route.abort();
      }
      if (t === 'websocket' || t === 'eventsource') return route.abort();
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
      // Skip networkidle — too slow with persistent connections. DOM is enough for marker text.
      await page.waitForLoadState('load', { timeout: Math.min(navTimeout, 4000) }).catch(() => {});
      const status = response?.status?.() || 0;
      const finalUrl = page.url().toLowerCase();
      const bodyText = (await page.locator('body').innerText({ timeout: 2500 }).catch(() => '')).toLowerCase();


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

// ------- Fast HTTP fetch (undici) -------
async function judgeUrl(url) {
  const headers = {
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'accept-encoding': 'gzip, deflate, br',
  };
  if (fetchByteLimit > 0) headers['range'] = `bytes=0-${fetchByteLimit - 1}`;

  const useChromeCookies = isGoogleActivationUrl(url);
  const ctx = await getBrowser();

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const res = await ctx.request.get(url, {
        timeout: navTimeout,
        maxRedirects: 10,
        headers,
      });
      const status = res.status();
      const finalUrl = res.url().toLowerCase();

      if ((status === 429 || status === 408 || status >= 500) && attempt <= retries) {
        await sleep(status === 429 ? 3000 : 1000 * attempt);
        continue;
      }

      const ok = res.ok() || status === 206;
      if (!ok) {
        if (browserFallbackStatuses.has(status)) {
          return await judgeUrlInBrowser(url, `fast fetch HTTP ${status}`);
        }
        return { result: 'error', reason: `HTTP ${status}` };
      }

      const bodyText = (await res.text()).toLowerCase();
      const classified = classifyPage(finalUrl, bodyText);
      if (classified.result === 'error' && classified.reason.startsWith('google auth required')) {
        if (useChromeCookies && (await getProfileCookieCount(ctx)) === 0) {
          return { result: 'error', reason: `google auth required — no Google cookies found in ${CHROME_PROFILE_DIR}. Run DISPLAY=:1 node login.js with the same root/user, then close Chrome and restart pm2.` };
        }
        return await judgeUrlInBrowser(url, 'fast fetch google auth');
      }
      return classified;
    } catch (e) {
      const msg = String(e?.message || e);
      const transient = /timeout|socket hang up|econnreset|enetunreach|etimedout|network|other side closed/i.test(msg);
      if (transient && attempt <= retries) { await sleep(1000 * attempt); continue; }
      if (/timeout/i.test(msg)) return { result: 'error', reason: 'Timeout' };
      return { result: 'error', reason: msg.slice(0, 240) };
    }
  }
}

// Run a batch with bounded concurrency. onProgress({ checked, valid, invalid, errors })
export async function checkUrls(urls, { concurrency, onProgress, signal } = {}) {
  const total = urls.length;
  const results = new Array(total);
  let idx = 0;
  let checked = 0, valid = 0, invalid = 0, errors = 0;

  async function worker() {
    while (true) {
      if (signal?.cancelled) return;
      const i = idx++;
      if (i >= total) return;
      const url = urls[i];
      const judgement = await withHardTimeout(judgeUrl(url), navTimeout * 3 + 5000, 'judgeUrl')
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
