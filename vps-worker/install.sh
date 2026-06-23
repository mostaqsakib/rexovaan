#!/usr/bin/env bash
# Rexovaan Link Checker — one-shot VPS installer for Ubuntu 22.04 / 24.04
# Run as root:  bash install.sh
set -e

echo ""
echo "🤖 Rexovaan Link Checker — VPS Installer"
echo "========================================"
echo ""

# ---- Prompt for service role key ----
if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "📋 Paste your Supabase SERVICE ROLE KEY (not anon!)."
  echo "   Get it from: https://supabase.com/dashboard/project/eygkdpfjrjwwbiackfpr/settings/api"
  echo ""
  read -rp "SUPABASE_SERVICE_ROLE_KEY: " SUPABASE_SERVICE_ROLE_KEY
fi
if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "❌ Key required. Aborting."; exit 1
fi

# ---- Install system packages ----
echo ""
echo "📦 Installing system packages (Node, Chrome libs, noVNC)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg unzip git

# Node 20
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1)" != "v20" ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs
fi

# Browser + VNC deps
apt-get install -y -qq \
  xvfb x11vnc novnc websockify fluxbox xterm net-tools ufw \
  libnss3 libatk-bridge2.0-0 libxcomposite1 libxdamage1 libxrandr2 \
  libgbm1 libxkbcommon0 libpango-1.0-0 libcairo2 \
  libatk1.0-0 libcups2 libdrm2 libxss1 fonts-noto-color-emoji \
  libasound2t64 2>/dev/null || apt-get install -y -qq libasound2

# PM2
npm install -g pm2 >/dev/null

# ---- Set up worker directory ----
INSTALL_DIR=/opt/link-checker
echo ""
echo "📁 Installing worker to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# package.json
cat > package.json <<'EOF'
{
  "name": "rexovaan-link-checker-worker",
  "version": "1.0.0",
  "type": "module",
  "main": "worker.js",
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "dotenv": "^16.4.5",
    "playwright": "^1.47.0",
    "ws": "^8.18.0"
  }
}
EOF

# .env
cat > .env <<EOF
SUPABASE_URL=https://eygkdpfjrjwwbiackfpr.supabase.co
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
CHROME_PROFILE_DIR=/root/chrome-profile
HEADFUL=false
MAX_CONCURRENCY=10
POLL_INTERVAL_MS=5000
NAV_TIMEOUT_MS=30000
INVALID_TEXT_PATTERNS=already been redeemed,already redeemed,no longer available,offer has expired,not eligible,invalid code,cannot be used,is not valid,already claimed,this code has already
VALID_TEXT_PATTERNS=subscribe,continue,confirm subscription,start your,activate,get started
EOF
chmod 600 .env

# ---- Download worker.js + login.js from GitHub raw (or paste inline) ----
# We embed them so no GitHub dependency
cat > login.js <<'JSEOF'
import 'dotenv/config';
import { chromium } from 'playwright';
const PROFILE = process.env.CHROME_PROFILE_DIR || '/root/chrome-profile';
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1280, height: 800 },
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto('https://accounts.google.com/');
console.log('\n👉 Log into Google in the opened window, then close it.\n');
await new Promise((resolve) => ctx.on('close', resolve));
process.exit(0);
JSEOF

cat > worker.js <<'JSEOF'
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import WebSocket from 'ws';

if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket;

const {
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  CHROME_PROFILE_DIR = '/root/chrome-profile',
  HEADFUL = 'false', MAX_CONCURRENCY = '10',
  POLL_INTERVAL_MS = '5000', NAV_TIMEOUT_MS = '30000',
  INVALID_TEXT_PATTERNS = '', VALID_TEXT_PATTERNS = '',
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket },
});
const invalidPatterns = INVALID_TEXT_PATTERNS.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
const validPatterns = VALID_TEXT_PATTERNS.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
const navTimeout = parseInt(NAV_TIMEOUT_MS,10);
const maxConc = parseInt(MAX_CONCURRENCY,10);
const pollMs = parseInt(POLL_INTERVAL_MS,10);
const autoRetryFailedCooldownMs = parseInt(process.env.AUTO_RETRY_FAILED_COOLDOWN_MS || '300000', 10);
let browserCtx = null, browserLaunchPromise = null, busy = false;
const QUEUED_STATUSES = ['vps_queued', 'queued'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getBrowser() {
  if (browserCtx && browserCtx.pages) return browserCtx;
  if (browserLaunchPromise) return browserLaunchPromise;
  browserLaunchPromise = (async () => {
    console.log('🚀 Launching Chrome:', CHROME_PROFILE_DIR);
    const ctx = await chromium.launchPersistentContext(CHROME_PROFILE_DIR, {
      headless: HEADFUL !== 'true',
      viewport: { width: 1280, height: 800 },
      args: ['--no-sandbox','--disable-dev-shm-usage','--disable-blink-features=AutomationControlled','--lang=en-US'],
      locale: 'en-US',
    });
    browserCtx = ctx;
    ctx.on('close', () => { browserCtx = null; browserLaunchPromise = null; });
    return ctx;
  })();
  try { return await browserLaunchPromise; }
  catch (e) { browserLaunchPromise = null; throw e; }
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
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(()=>{});
    const bodyText = (await page.evaluate(() => document.body?.innerText || '')).toLowerCase();
    const finalUrl = page.url().toLowerCase();
    if (isGoogleAuthPage(finalUrl, bodyText)) {
      return { result: 'error', reason: 'google auth required: login using the same CHROME_PROFILE_DIR as the PM2 worker' };
    }
    for (const pat of invalidPatterns) {
      if (bodyText.includes(pat)) return { result: 'invalid', reason: `matched: ${pat}` };
    }
    if (/already|redeemed|expired|error/.test(finalUrl)) {
      return { result: 'invalid', reason: `redirected: ${finalUrl.slice(0,120)}` };
    }
    if (validPatterns.length === 0) return { result: 'valid', reason: 'no invalid markers' };
    for (const pat of validPatterns) {
      if (bodyText.includes(pat)) return { result: 'valid', reason: `matched: ${pat}` };
    }
    return { result: 'error', reason: 'no markers detected' };
  } catch (e) {
    return { result: 'error', reason: String(e?.message||e).slice(0,240) };
  }
}
async function populateItems(job) {
  const { data: stock, error } = await sb.from('bot_product_stock_items')
    .select('id, data').eq('product_id', job.product_id).eq('status', 'available');
  if (error) throw error;
  const rows = [];
  for (const s of stock || []) {
    const url = extractUrl(s.data);
    if (url) rows.push({ job_id: job.id, stock_item_id: s.id, url, status: 'pending' });
  }
  if (rows.length === 0) return 0;
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i+500);
    const { error: e2 } = await sb.from('link_check_items').insert(slice);
    if (e2) throw e2;
  }
  return rows.length;
}
async function runTab(job, signal) {
  let page = null;
  try {
    const ctx = await getBrowser();
    page = await ctx.newPage();
    while (!signal.cancelled) {
      const { data: claimed, error } = await sb.rpc('claim_next_link_check_item', { _job_id: job.id });
      if (error) { console.error('claim:', error.message); await sleep(2000); continue; }
      const item = Array.isArray(claimed) ? claimed[0] : claimed;
      if (!item) return;
      const { result, reason } = await judgeUrl(page, item.url);
      await sb.rpc('mark_link_check_result', { _item_id: item.id, _result: result, _reason: reason });
      if (job.delay_ms > 0) await sleep(job.delay_ms);
    }
  } catch (e) { signal.cancelled = true; throw e; }
  finally { if (page) await page.close().catch(()=>{}); }
}
async function processJob(job) {
  console.log(`\n📋 Job ${job.id.slice(0,8)} (concurrency=${job.concurrency})`);
  const signal = { cancelled: false };
  let watcher = null;
  await sb.from('link_check_jobs').update({ status:'running', started_at: new Date().toISOString() }).eq('id', job.id);
  try {
    await getBrowser();
    const total = await populateItems(job);
    await sb.from('link_check_jobs').update({ total }).eq('id', job.id);
    console.log(`   ${total} URLs to check`);
    if (total === 0) {
      await sb.from('link_check_jobs').update({ status:'completed', finished_at: new Date().toISOString() }).eq('id', job.id);
      return;
    }
    const conc = Math.max(1, Math.min(maxConc, job.concurrency || 5));
    watcher = setInterval(async () => {
      const { data } = await sb.from('link_check_jobs').select('status').eq('id', job.id).single();
      if (data?.status === 'cancelled') signal.cancelled = true;
    }, 3000);
    const tabs = Array.from({ length: conc }, () => runTab(job, signal));
    const tabResults = await Promise.allSettled(tabs);
    const failedTab = tabResults.find(r => r.status === 'rejected');
    if (failedTab) throw failedTab.reason;
    const finalStatus = signal.cancelled ? 'cancelled' : 'completed';
    await sb.from('link_check_jobs').update({ status: finalStatus, finished_at: new Date().toISOString() }).eq('id', job.id);
    console.log(`   ✅ ${finalStatus}`);
  } catch (e) {
    console.error('   ❌', e.message);
    await sb.from('link_check_jobs').update({ status:'failed', error_text: String(e.message).slice(0,500), finished_at: new Date().toISOString() }).eq('id', job.id);
  } finally {
    signal.cancelled = true;
    if (watcher) clearInterval(watcher);
  }
}
async function autoEnqueueIfNeeded() {
  const { data: products, error } = await sb.from('bot_products').select('id, name').eq('link_check_auto', true).eq('is_active', true);
  if (error) throw error;
  for (const p of products || []) {
    const { data: existing, error: existingError } = await sb.from('link_check_jobs').select('id').eq('product_id', p.id).in('status', [...QUEUED_STATUSES, 'running']).limit(1);
    if (existingError) throw existingError;
    if (existing && existing.length > 0) continue;
    const { error: insertError } = await sb.from('link_check_jobs').insert({ product_id: p.id, cookie_id: null, concurrency: 5, delay_ms: 800, status: 'vps_queued' });
    if (insertError) throw insertError;
    console.log(`   🔁 Auto-loop queued for ${p.name}`);
  }
}
async function pollLoop() {
  while (true) {
    try {
      if (!busy) {
        await autoEnqueueIfNeeded();
        const { data: jobs } = await sb.from('link_check_jobs').select('*').in('status', QUEUED_STATUSES).order('created_at', { ascending: true }).limit(1);
        if (jobs && jobs[0]) { busy = true; await processJob(jobs[0]); busy = false; }
      }
    } catch (e) { console.error('poll:', e.message); busy = false; }
    await sleep(pollMs);
  }
}
process.on('SIGTERM', async () => { if (browserCtx) await browserCtx.close().catch(()=>{}); process.exit(0); });
console.log('🤖 Worker started | poll=', pollMs, 'ms | maxConc=', maxConc);
pollLoop();
JSEOF

cat > ecosystem.config.cjs <<'EOF'
module.exports = {
  apps: [{
    name: 'link-checker', script: 'worker.js', cwd: '/opt/link-checker',
    autorestart: true, max_memory_restart: '1500M',
    out_file: '/var/log/link-checker.out.log',
    error_file: '/var/log/link-checker.err.log',
    time: true,
  }],
};
EOF

# ---- npm install ----
echo ""
echo "📦 Running npm install (this takes 2-3 min)..."
npm install --silent
npx playwright install chromium

# ---- Start noVNC ----
echo ""
echo "🖥️  Starting virtual display + noVNC..."
pkill -f 'Xvfb :1' 2>/dev/null || true
pkill -f 'x11vnc' 2>/dev/null || true
pkill -f 'websockify' 2>/dev/null || true
sleep 1
Xvfb :1 -screen 0 1280x800x24 >/dev/null 2>&1 &
sleep 1
DISPLAY=:1 fluxbox >/dev/null 2>&1 &
x11vnc -display :1 -nopw -forever -shared -rfbport 5900 -bg >/dev/null 2>&1
websockify -D --web=/usr/share/novnc/ 6080 localhost:5900 >/dev/null 2>&1

# ---- Firewall ----
ufw allow 22/tcp >/dev/null 2>&1 || true
ufw allow 6080/tcp >/dev/null 2>&1 || true
echo "y" | ufw enable >/dev/null 2>&1 || true

IP=$(curl -s ifconfig.me || hostname -I | awk '{print $1}')

echo ""
echo "✅ Install complete!"
echo "============================================="
echo ""
echo "🌐 STEP 1 — Open this URL in your laptop browser:"
echo ""
echo "    http://$IP:6080/vnc.html?autoconnect=1&resize=remote"
echo ""
echo "🔐 STEP 2 — Inside that VNC desktop, open xterm (right-click desktop)"
echo "           and run these 2 commands:"
echo ""
echo "    cd /opt/link-checker"
echo "    DISPLAY=:1 node login.js"
echo ""
echo "    → Chrome will open. Log into Google. Close the Chrome window."
echo ""
echo "🚀 STEP 3 — Back in SSH, start the worker forever:"
echo ""
echo "    cd /opt/link-checker"
echo "    pm2 start ecosystem.config.cjs && pm2 save && pm2 startup"
echo "    pm2 logs link-checker"
echo ""
echo "============================================="
