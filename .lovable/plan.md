# Gemini Link Checker — Implementation Plan

## Overview
Bulk-validate Gemini activation links (`one.google.com/activate-plan/...`) from a product's internal stock using a headless browser. Invalid links auto-remove from available stock (silently) and get archived for review. Cookie-based Google auth with Telegram alert on expiry.

## Architecture

```text
[Admin Panel UI]                    [Supabase DB]                  [Railway Worker]
 - Cookie manager     ─────────►    google_cookies                 standalone-bot/
 - Select product                   link_check_jobs       ◄──────► link-checker.js
 - Start/stop job                   link_check_items                (Playwright)
 - Progress + results               (invalid archive in                │
 - Download invalid TXT             bot_product_stock_items            │
                                     status='invalid')                 ▼
                                                                  one.google.com
```

## Decision Recap (confirmed)
1. Cookies: one-time manual export, stored in DB (long-lived).
2. Invalid storage: extend `bot_product_stock_items` — set `status='invalid'` (silently removed from `available`), keep row for archive/restore.
3. Worker: in `standalone-bot/` (separate `link-checker.js` process, same Railway service).
4. Cookie expiry → Telegram notification to `ADMIN_CHAT_ID`.
5. Invalid items auto-disappear from active stock; admin can review/clear later in a new tab.

## Database Changes (migration)

**New table: `google_account_cookies`**
- `id uuid pk`, `label text` (e.g. "main account"), `cookies_json jsonb`, `is_active bool default true`, `last_verified_at`, `expired bool default false`, `created_at`, `updated_at`.
- RLS: admin only.

**New table: `link_check_jobs`**
- `id`, `product_id` (fk bot_products), `cookie_id` (fk google_account_cookies), `status` (`queued|running|completed|failed|cancelled`), `concurrency int default 2`, `delay_ms int default 5000`, `total int`, `checked int`, `valid_count int`, `invalid_count int`, `error_text`, `started_at`, `finished_at`, `created_at`.
- RLS: admin only.

**New table: `link_check_items`** (per-link audit log per job)
- `id`, `job_id` (fk), `stock_item_id` (fk bot_product_stock_items, nullable), `url text`, `status` (`pending|valid|invalid|error|skipped`), `reason text`, `checked_at`.
- RLS: admin only.

**Extend `bot_product_stock_items`**
- The existing `status` column already supports `available|sold`. Add new allowed value `invalid`.
- Add columns: `invalid_reason text`, `invalidated_at timestamptz`, `invalidated_job_id uuid`.
- All existing queries that filter `status='available'` already exclude invalid items → silent removal works for free.

**Worker queue helper RPC** (security definer): `claim_next_link_check_item(_job_id)` — picks next pending item, sets to in-progress, returns row. Avoids race when 2 workers run in parallel.

**RPC `mark_stock_item_invalid(_item_id, _reason, _job_id)`** — flips status to invalid and writes audit fields.

## Worker (`standalone-bot/link-checker.js`)

Separate Node process (added to Railway start command alongside bot.js, or run as `npm run checker`).

Flow:
1. Poll `link_check_jobs` where `status='queued'` every 5s.
2. Claim job → set `running`.
3. Load active cookie row from `google_account_cookies`.
4. Launch Playwright Chromium (`headless: true`, realistic user-agent), inject cookies via `context.addCookies()`.
5. Build item list: pull all `available` stock items for product, extract the link from `data` JSON (need to know which column holds the URL — see open question), upsert into `link_check_items` as `pending`.
6. Run a worker pool of `concurrency` (default 2):
   - Navigate to link, wait for network idle + content selector.
   - Detection rules:
     - URL contains `accounts.google.com/signin` → **COOKIES EXPIRED**: mark `google_account_cookies.expired=true`, send Telegram alert via gateway, abort job with `failed`.
     - Page text contains "Subscription already in use" / "already redeemed" / "not available" → **invalid** → call `mark_stock_item_invalid` + log.
     - Page has "Activate plan" / accept button visible → **valid** → log only.
     - Anything else → `error` (do not delete stock).
   - Sleep `delay_ms` between checks.
7. Update `link_check_jobs` counters in real time (UI polls/realtime).
8. On finish → set `completed`, send Telegram summary to admin.

Dependencies to add in `standalone-bot/package.json`: `playwright`. Railway image will need `npx playwright install chromium --with-deps` in postinstall.

## Admin Panel UI (new tab "Link Checker")

New file: `src/components/LinkCheckerTab.tsx` + add to `src/pages/Index.tsx` sidebar + TAB_TITLES.

Sections:
1. **Google Cookies** card
   - List saved cookies with label, status (active/expired), last verified.
   - "Add cookies" dialog: paste JSON exported from a Chrome cookie-editor extension (EditThisCookie / Cookie-Editor) for `one.google.com` + `google.com` + `accounts.google.com`.
   - Delete / set active.
2. **Start Check** card
   - Product dropdown (only products with internal stock).
   - Concurrency (1–2), delay (3–10s).
   - "Start" → inserts a queued job.
3. **Active job** card
   - Progress bar (`checked / total`), live valid/invalid counts (Supabase realtime on `link_check_jobs`).
   - Cancel button.
4. **History** table — past jobs, click to expand items.
5. **Invalid archive** tab inside the page
   - Lists `bot_product_stock_items` where `status='invalid'`, grouped by product.
   - Filter, "Download TXT" (one URL per line), "Clear" (delete rows so admin can re-add fresh stock).

## Telegram Alerts
Reuse existing gateway pattern (`notify-customer.ts` style). Send to `ADMIN_CHAT_ID`:
- Cookies expired: "⚠️ Google cookies expired. Re-upload to continue link checks."
- Job complete: "✅ {product} check done: {valid} valid, {invalid} invalid (removed from stock)."
- Job failed: "❌ Link check failed: {reason}."

## Files Touched

**New**
- `supabase/migrations/<ts>_link_checker.sql` (3 tables + column extensions + RPCs + grants + RLS)
- `src/components/LinkCheckerTab.tsx`
- `src/components/LinkCheckerCookieDialog.tsx`
- `src/components/LinkCheckerInvalidArchive.tsx`
- `standalone-bot/link-checker.js`
- `standalone-bot/README-LINK-CHECKER.md` (cookie export how-to)

**Edited**
- `src/pages/Index.tsx` (sidebar entry, route)
- `src/components/AppSidebar.tsx` (nav item)
- `standalone-bot/package.json` (add `playwright`, add `checker` script, postinstall for browsers)
- `standalone-bot/RAILWAY_DEPLOY_GUIDE.md` (notes for running checker process)

## Open Question (need 1 confirmation before build)

**Which field inside `bot_product_stock_items.data` JSON holds the activation URL?**
The `data` column is a free-form JSON object (one entry per stock row). For "Jio Gemini Ai Pro 18m" what's the key name — e.g. `link`, `url`, `activation_link`, or is it the only value in the JSON? I need this so the worker knows what to extract. (If unsure, paste one example row's JSON from that product.)

Once you confirm the key name, I'll switch to build mode and ship everything.
