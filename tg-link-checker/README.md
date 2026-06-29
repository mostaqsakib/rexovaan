# tg-link-checker

Standalone Telegram bot that checks links using the same fast-fetch +
browser-fallback engine as the Rexovaan VPS worker, but with no Supabase
dependency. Inputs come from Telegram messages or `.txt` uploads;
results are returned as inline messages (small) or `.txt` files (large).

## Features

- Paste URLs in chat **or** upload `.txt` files (multi-file supported,
  processed one at a time per user)
- Live progress message (`⏳ 312/940 • ✅ 102 • ❌ 210 • ⏱ 1m 4s`),
  throttled to respect Telegram rate limits
- `valid` + `invalid` returned as separate messages or files depending on
  size (`INLINE_LIMIT` env)
- End-of-job summary with total / valid / invalid / duration / speed
- Different users run in parallel; same user's jobs are FIFO
- Optional `ALLOWED_USER_IDS` whitelist

## Setup (Ubuntu / Debian VPS, 12 GB RAM)

```bash
# 1. System deps
sudo apt update
sudo apt install -y curl git build-essential

# 2. Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Real Google Chrome (for browser fallback on 403/429)
wget -qO- https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
  | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt update && sudo apt install -y google-chrome-stable

# 4. Clone & install
sudo mkdir -p /opt && sudo chown $USER /opt
git clone <your-repo> /opt/tg-link-checker
cd /opt/tg-link-checker
npm install
npx playwright install-deps chromium    # only needed if not using real Chrome
                                        # (real Chrome above is enough)

# 5. Config
cp .env.example .env
nano .env                               # set BOT_TOKEN, ALLOWED_USER_IDS

# 6. Sign in to Google so checker can reuse the same Chrome profile cookies
DISPLAY=:1 node login.js

# 7. Run via pm2
sudo npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

## Tuning for 12 GB RAM

Defaults are tuned for ~12 GB:

| Knob | Default | Notes |
| --- | --- | --- |
| `MAX_CONCURRENCY` | `50` | Fast-fetch is network-bound. Bump to 75 if Google does not rate-limit you. |
| `BROWSER_CONCURRENCY` | `5` | Parallel Chrome pages for fallback (~300 MB each). |
| `FETCH_BYTE_LIMIT` | `98304` | Only download first 96 KB per URL. |
| `INLINE_LIMIT` | `50` | Above this, results come as `.txt` files. |
| `MAX_LINKS_PER_JOB` | `20000` | Hard cap per submission. |

## Updating

```bash
cd /opt/tg-link-checker
git pull
npm install
pm2 restart tg-link-checker
```

## Architecture

```
bot.js        Telegram entry (grammY). Per-user FIFO via queue.js.
checker.js    Playwright persistent Chrome profile + cookies-only fast requests.
queue.js      Per-user FIFO; different users run in parallel.
formatter.js  Progress text, summary, URL extraction.
login.js      One-off headful Chrome to seed Google cookies.
diagnose.js   VPS-side profile/cookie/final-URL debug helper.
```
