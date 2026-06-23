# Rexovaan Link Checker — VPS Worker

Replaces the cookie-zip system with a persistent Chrome profile that never expires.

👉 **Full setup steps:** see [SETUP.md](./SETUP.md)

## TL;DR

```bash
scp -r vps-worker root@VPS_IP:/opt/link-checker
ssh root@VPS_IP
cd /opt/link-checker
npm install && npx playwright install chromium
cp .env.example .env && nano .env       # paste SUPABASE_SERVICE_ROLE_KEY
DISPLAY=:1 node login.js                # one-time Google login via noVNC
pm2 start ecosystem.config.cjs && pm2 save
```

Admin panel → Link Checker → Start Check → live progress. Done.

## Important

The admin panel now inserts VPS-only jobs with `status='vps_queued'` so the old bot-hosted checker cannot accidentally consume them. This worker still accepts old `queued` jobs as a fallback, but new manual and auto-loop jobs are created as `vps_queued`.
