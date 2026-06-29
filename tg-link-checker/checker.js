// Fast-fetch + browser-fallback link checker.
// Ported from vps-worker/worker.js, but Supabase-free and reusable for
// the Telegram bot. Each job has its own runner with shared undici Pool
// and (lazy) Playwright context for fallback.

import { Agent, request as undiciRequest } from 'undici';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const {
  CHROME_PROFILE_DIR = '/root/tg-checker-chrome-profile',
  CHROME_CHANNEL = '',
  CHROME_EXECUTABLE_PATH = '',
  HEADFUL = 'false',
  NAV_TIMEOUT_MS = '15000',
  RETRIES_ON_ERROR = '2',
  FETCH_BYTE_LIMIT = '98304',
  BROWSER_CONCURRENCY = '5',
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

// Shared keep-alive HTTP agent (connection pool).
const httpAgent = new Agent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  connections: 256,
  pipelining: 1,
  bodyTimeout: navTimeout,
  headersTimeout: navTimeout,
});

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

async function getBrowser() {
  if (browserCtx) return browserCtx;
  if (browserLaunchPromise) return browserLaunchPromise;
  browserLaunchPromise = (async () => {
    await cleanupStaleChromeProfileLocks(CHROME_PROFILE_DIR);
    const launchOptions = {
      headless: HEADFUL !== 'true',
      viewport: { width: 1280, height: 800 },
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', '--lang=en-US'],
      locale: 'en-US',
    };
    if (CHROME_EXECUTABLE_PATH) launchOptions.executablePath = CHROME_EXECUTABLE_PATH;
    else if (CHROME_CHANNEL) launchOptions.channel = CHROME_CHANNEL;
    const ctx = await chromium.launchPersistentContext(CHROME_PROFILE_DIR, launchOptions);
    // Block heavy assets to make fallback faster.
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

// ------- Fast HTTP fetch (undici) -------
async function judgeUrl(url) {
  const headers = {
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'accept-encoding': 'gzip, deflate, br',
  };
  if (fetchByteLimit > 0) headers['range'] = `bytes=0-${fetchByteLimit - 1}`;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const res = await undiciRequest(url, {
        method: 'GET',
        dispatcher: httpAgent,
        headers,
        maxRedirections: 10,
        bodyTimeout: navTimeout,
        headersTimeout: navTimeout,
      });
      const status = res.statusCode;
      const finalUrl = (res.context?.history?.length ? res.context.history[res.context.history.length - 1] : url).toString().toLowerCase();

      if ((status === 429 || status === 408 || status >= 500) && attempt <= retries) {
        // drain body to free socket
        for await (const _ of res.body) { /* discard */ }
        await sleep(status === 429 ? 3000 : 1000 * attempt);
        continue;
      }

      const ok = (status >= 200 && status < 300) || status === 206;
      if (!ok) {
        for await (const _ of res.body) { /* discard */ }
        if (browserFallbackStatuses.has(status)) {
          return await judgeUrlInBrowser(url, `fast fetch HTTP ${status}`);
        }
        return { result: 'error', reason: `HTTP ${status}` };
      }

      const bodyText = (await res.body.text()).toLowerCase();
      return classifyPage(finalUrl, bodyText);
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
