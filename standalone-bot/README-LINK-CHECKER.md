# Gemini Link Checker — Setup

This worker validates Gemini activation links in your internal stock by visiting each link in a real headless Chromium browser with your Google account cookies.

## Railway deploy

1. Make sure this `standalone-bot/` service is already deployed on Railway with all secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BOT_TOKEN`, `ADMIN_CHAT_ID`).
2. Change the Railway start command from `npm start` to `npm run start:all`. This runs both `bot.js` and `link-checker.js` together.
3. The `postinstall` script auto-installs Chromium for Playwright. On the first deploy it adds ~300 MB to the image.
4. Redeploy.

If you prefer two separate Railway services, deploy this folder again with start command `npm run checker`.

## Exporting Google cookies (one-time, repeat every few months)

1. In Chrome, log in to <https://one.google.com> with the Google account whose Gemini links you want to validate.
2. Install the **Cookie-Editor** extension (or EditThisCookie).
3. Open `one.google.com`, click the extension icon, click **Export** → **JSON**.
4. Open admin panel → **Link Checker** → **Google Cookies** tab → **Add**, paste the JSON, save.

Cookies saved in the admin tab are auto-refreshed by the worker while checks run. This is better than Railway env cookies for long-running auto-loop jobs.

### Railway fallback (recommended when profile ZIP keeps expiring)

Chrome profile ZIPs created on Windows often lose Google login when Railway runs them on Linux. If logs say `profile auth is marked expired`, do this instead:

1. Open `one.google.com` while logged in.
2. Cookie-Editor extension → **Export** → **JSON**.
3. Railway → service → **Variables** → add `GOOGLE_COOKIES_JSON`.
4. Paste the full exported JSON as the value, save, redeploy.
5. You can leave `PROFILE_ZIP_URL` as-is; the checker will prefer `GOOGLE_COOKIES_JSON` first.

Note: `GOOGLE_COOKIES_JSON` cannot be auto-refreshed because Railway variables are static. For continuous jobs, paste cookies in the admin **Google Cookies** tab instead.

## Running a check

1. Admin panel → Link Checker → Run Check.
2. Pick the product (e.g. "Jio Gemini AI Pro 18m"), keep concurrency at 1–2 and delay around 5000 ms to avoid Google rate limits.
3. Click Start. The worker picks up the job within ~5 s.
4. Progress and counts stream in. Invalid links are silently removed from available stock and archived in the **Invalid Archive** tab.
5. When cookies expire, the worker marks them expired, stops the job, and sends a Telegram alert to `ADMIN_CHAT_ID`.

## Invalid archive

- The Invalid Archive tab lists every removed link grouped by product.
- **Download** exports a `.txt` (one URL per line) so you can re-check them manually.
- **Clear** permanently deletes those rows so you can re-add fresh stock for the same slots.

---

## ⚡ FAST MODE (v2 — extension-style, default ON)

The link checker now defaults to a **fast HTTP-fetch mode** that replaces Playwright with plain `fetch()` plus the saved Google cookies from `google_account_cookies`. It mirrors the validated Chrome extension logic:

- Markers (only these two count as INVALID):
  - `already been used`  → "Already used"
  - `new activation link` → "Needs new link"
- Anything else (HTTP 200) → **valid**
- Redirect to `accounts.google.com/signin` → **cookies_expired** (auto-rotate to next cookie row)

### Speed
- Default concurrency: **10 workers** (was 5)
- Default delay between jobs: **200 ms** (was 800 ms)
- ~10× faster than Playwright; no Chromium boot, no "unknown page" errors.

### Env flags
| Var | Default | Purpose |
|---|---|---|
| `LINK_CHECKER_FAST_MODE` | `true` | Set to `false` to force the legacy Playwright path. |
| `FAST_TIMEOUT_MS` | `15000` | Per-request timeout. |
| `FAST_RETRIES` | `2` | Retries on network error / 429. |

### When Playwright is still used
- `LINK_CHECKER_FAST_MODE=false`, OR
- No exported cookies exist in `google_account_cookies` and only the persistent Chrome profile is available.

### Cookies
Use the same admin → Link Checker → Google Cookies flow (Cookie-Editor JSON export). Fast mode reads the same rows; nothing to change.
