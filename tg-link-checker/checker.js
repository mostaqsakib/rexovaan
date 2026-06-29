// tg-link-checker — direct port of vps-worker/worker.js judge logic.
// Uses Playwright's persistent Chrome profile + APIRequestContext (ctx.request.get),
// exactly like the site's Link Checker. No native fetch, no undici, no custom
// cookie plumbing — keep it simple and behave identically to the working site checker.

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
  INVALID_TEXT_PATTERNS = '',
  VALID_TEXT_PATTERNS = '',
  BROWSER_FALLBACK_HTTP_STATUSES = '401,403,429',
} = process.env;

const navTimeout = parseInt(NAV_TIMEOUT_MS, 10);
const retries = parseInt(RETRIES_ON_ERROR, 10);
const fetchByteLimit = Math.max(0, parseInt(FETCH_BYTE_LIMIT, 10) || 0);

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

// ---------- Persistent Chrome profile (shared) ----------
let browserCtx = null;
let browserLaunchPromise = null;

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
    ctx.on('close', () => { browserCtx = null; browserLaunchPromise = null; });
    return ctx;
  })();

  try { return await browserLaunchPromise; }
  catch (error) { browserLaunchPromise = null; throw error; }
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

// ---------- Judge (identical to site worker's judgeUrl) ----------
async function judgeUrl(ctx, url) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
  };
  if (fetchByteLimit > 0) headers['Range'] = `bytes=0-${fetchByteLimit - 1}`;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const res = await ctx.request.get(url, {
        timeout: navTimeout,
        maxRedirects: 5,
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
          return await judgeUrlInBrowser(ctx, url, `fast fetch HTTP ${status}`);
        }
        return { result: 'error', reason: `HTTP ${status}` };
      }
      const bodyText = (await res.text()).toLowerCase();
      return classifyPage(finalUrl, bodyText);
    } catch (e) {
      const msg = String(e?.message || e);
      const transient = /timeout|socket hang up|econnreset|enetunreach|etimedout|network/i.test(msg);
      if (transient && attempt <= retries) { await sleep(1000 * attempt); continue; }
      if (/timeout/i.test(msg)) return { result: 'error', reason: 'Timeout' };
      return { result: 'error', reason: msg.slice(0, 240) };
    }
  }
}

async function withHardTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} hard timeout ${ms}ms`)), ms);
  });
  try { return await Promise.race([promise, timeout]); }
  finally { clearTimeout(timer); }
}

// ---------- Public API (consumed by bot.js) ----------
export async function prewarm() {
  try { await getBrowser(); }
  catch (e) { console.warn('prewarm failed (will retry on first use):', e?.message || e); }
}

export async function checkUrls(urls, { concurrency = 50, onProgress, signal } = {}) {
  const ctx = await getBrowser();
  const total = urls.length;
  const results = new Array(total);
  let nextIdx = 0;
  let checked = 0, valid = 0, invalid = 0, errors = 0;

  // Throttle progress callbacks to reduce per-check overhead (bot edits etc.).
  let lastTick = 0;
  let tickTimer = null;
  const PROGRESS_MIN_MS = 150;
  const emit = () => {
    if (typeof onProgress !== 'function') return;
    try { onProgress({ checked, total, valid, invalid, errors }); } catch {}
  };
  const tick = () => {
    if (typeof onProgress !== 'function') return;
    const now = Date.now();
    if (checked === total) {
      if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
      lastTick = now;
      emit();
      return;
    }
    if (now - lastTick >= PROGRESS_MIN_MS) {
      lastTick = now;
      if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
      emit();
    } else if (!tickTimer) {
      tickTimer = setTimeout(() => {
        tickTimer = null;
        lastTick = Date.now();
        emit();
      }, PROGRESS_MIN_MS - (now - lastTick));
    }
  };

  const runWorker = async () => {
    while (true) {
      if (signal?.cancelled) return;
      const i = nextIdx++;
      if (i >= total) return;
      const url = urls[i];
      const judgement = await withHardTimeout(judgeUrl(ctx, url), navTimeout * 3 + 5000, 'judgeUrl')
        .catch((e) => ({ result: 'error', reason: String(e?.message || e).slice(0, 240) }));
      results[i] = { url, ...judgement };
      checked++;
      if (judgement.result === 'valid') valid++;
      else if (judgement.result === 'invalid') invalid++;
      else errors++;
      tick();
    }
  };

  const conc = Math.max(1, Math.min(concurrency, total));
  await Promise.all(Array.from({ length: conc }, () => runWorker()));
  return results;
}
