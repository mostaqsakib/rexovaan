# Standalone Telegram Link Checker Bot

Alada ekta Node.js bot — apnar current VPS worker er **same fast-fetch + browser fallback logic** use korbe, kintu Supabase/job-queue chara। Direct Telegram theke input → in-memory check → Telegram e result.

## Folder Structure (notun repo / folder)

```
tg-link-checker/
├── bot.js              # Telegram bot entry (grammY)
├── checker.js          # Fast-fetch + browser fallback (worker.js theke port)
├── queue.js            # Per-user FIFO queue (multiple file ekta ekta kore)
├── progress.js         # Live progress message editor (throttled)
├── formatter.js        # Result formatting + valid.txt/invalid.txt builder
├── package.json
├── ecosystem.config.js # pm2 config
└── .env
```

## Features → Implementation

**1. Input: TXT file OR plain message links**
- `bot.on('message:document')` → file download → parse lines (regex `https?://\S+`)
- `bot.on('message:text')` → same regex extract
- Dedupe + trim before checking

**2. Live progress**
- Reply with: `⏳ Checking 0/940 • ✅ 0 • ❌ 0 • ⏱ 0s`
- `editMessageText` throttled to **1 edit / 2s** (Telegram rate limit safe)
- Final edit on completion

**3. Result delivery (auto threshold)**
- **≤ 50 links per category** → inline message:  
  `✅ VALID (12)` + code block links, separate `❌ INVALID (38)` message
- **> 50** → send as `valid.txt` + `invalid.txt` documents with caption counts
- Threshold configurable (`INLINE_LIMIT=50`)

**4. Multi-file queue**
- Per-user FIFO: user 5 ta file ekshathe pathale → ekta ekta process, prottekta alada result message
- Global concurrency: 1 job at a time per user, but **different users parallel** (up to N)

**5. Summary message** (always at end)
```
📊 Summary
Total: 940
✅ Valid: 312
❌ Invalid: 628
⏱ Duration: 2m 14s
⚡ Speed: 7.0 links/sec
```

## Checker Engine (port from worker.js)

Reuse same logic — strip out Supabase calls, keep:
- `undici` Pool keep-alive
- `Range: bytes=0-98303` header
- Marker-based validation (same valid/invalid string patterns)
- Browser fallback (real Chrome + `route.abort()` for images/css/font/media)
- Per-URL hard timeout, retry on 429/5xx only

**Concurrency for 12GB VPS:**
- `MAX_CONCURRENCY=50` fast-fetch (network bound, ~10MB RAM each = ~500MB)
- `BROWSER_CONCURRENCY=5` parallel Chrome contexts for fallback (~1.5GB)
- Headroom: ~9GB free for OS + bot + spikes
- Can push to 75 if Google doesn't rate-limit

## Tech Stack

- **grammY** (Telegram lib — faster + better TS than node-telegram-bot-api)
- **undici** (HTTP)
- **playwright-chromium** (fallback)
- **pino** (logs)
- **pm2** (process manager)
- Node 20+

## Config (.env)

```
BOT_TOKEN=...
MAX_CONCURRENCY=50
BROWSER_CONCURRENCY=5
FETCH_BYTE_LIMIT=98304
INLINE_LIMIT=50
PROGRESS_EDIT_INTERVAL_MS=2000
ALLOWED_USER_IDS=123,456     # optional whitelist
MAX_LINKS_PER_JOB=20000
```

## Security / Abuse

- Optional `ALLOWED_USER_IDS` whitelist (recommended — noyto random user spam korbe)
- Per-user max links per job
- Per-user rate limit (e.g. 3 jobs queued max)

## Deploy

```bash
git clone <repo> /opt/tg-link-checker
cd /opt/tg-link-checker
npm install
npx playwright install chromium
cp .env.example .env  # edit
pm2 start ecosystem.config.js
pm2 save
```

---

## Questions before I build

1. **Bot er valid/invalid marker logic** — current worker er **same exact markers** (Google Drive / Docs etc.) use korbo, naki different type er links er jonno? (e.g. generic HTTP 200 = valid?)
2. **Bot token** — already create kora ase BotFather e? Naki notun lagbe?
3. **Whitelist** — sudhu apni use korben, naki public? (public hole abuse protection strict korte hobe)
4. **Repo location** — `standalone-bot/` er moto main repo te rakhbo, naki ekdom separate repo?

Confirm korle build shuru korbo।
