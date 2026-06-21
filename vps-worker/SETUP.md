# Rexovaan Link Checker — VPS Setup Guide

This worker replaces the cookie-zip system with a **real Chrome browser** that stays logged in to Google forever.

## What you'll do

1. Install Node + Chrome deps + noVNC on your VPS
2. Login to Google once via noVNC (saved permanently)
3. Run the worker with PM2 — it polls Supabase and processes jobs from the admin panel

---

## 1. VPS Requirements

- Ubuntu 22.04 / 24.04 (or Debian 12)
- 2 GB RAM minimum (4 GB recommended)
- Root access

## 2. Install dependencies

SSH into VPS as root, then:

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# PM2 (process manager)
npm install -g pm2

# noVNC + xvfb + fluxbox (so you can see Chrome via browser)
apt-get install -y xvfb x11vnc novnc websockify fluxbox xterm

# Chrome system libraries (Playwright will install Chrome itself)
apt-get install -y libnss3 libatk-bridge2.0-0 libxcomposite1 libxdamage1 \
  libxrandr2 libgbm1 libxkbcommon0 libpango-1.0-0 libcairo2 libasound2t64 \
  libatk1.0-0 libcups2 libdrm2 libxss1 fonts-noto-color-emoji
```

## 3. Upload the worker

On your local machine, zip the `vps-worker/` folder and SCP to VPS:

```bash
scp -r vps-worker root@YOUR_VPS_IP:/opt/link-checker
```

Then on the VPS:

```bash
cd /opt/link-checker
npm install
npx playwright install chromium    # downloads Chromium ~150MB
cp .env.example .env
nano .env                          # paste SUPABASE_SERVICE_ROLE_KEY
```

**Get your service role key** from:
https://supabase.com/dashboard/project/eygkdpfjrjwwbiackfpr/settings/api
→ copy `service_role` key (not anon!) → paste into `.env`

## 4. One-time Google login (via noVNC)

Start a virtual display + noVNC:

```bash
# Start virtual display
Xvfb :1 -screen 0 1280x800x24 &
DISPLAY=:1 fluxbox &
x11vnc -display :1 -nopw -forever -shared -rfbport 5900 &
websockify -D --web=/usr/share/novnc/ 6080 localhost:5900
```

Now open in your laptop browser:

```
http://YOUR_VPS_IP:6080/vnc.html
```

(For safety, allow port 6080 only from your IP in the firewall, or tunnel via SSH: `ssh -L 6080:localhost:6080 root@VPS_IP`)

Inside that noVNC desktop, open a terminal (right-click → xterm) and run:

```bash
cd /opt/link-checker
DISPLAY=:1 node login.js
```

Chrome will open → log into your Google account → close the window. **Done — session saved permanently to `/root/chrome-profile`.**

## 5. Start the worker (background, 24/7)

```bash
cd /opt/link-checker
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup        # follow the printed command so it auto-starts on reboot
```

Check it's running:

```bash
pm2 logs link-checker
```

You should see:
```
🤖 Rexovaan Link Checker worker started
🚀 Launching Chrome with profile: /root/chrome-profile
```

## 6. Test it

1. Go to https://rexovaan.com/admin → Link Checker tab
2. Pick "Jio Gemini AI Pro 18m" → Start Check
3. Within ~5 seconds you'll see the progress bar moving in real-time
4. The admin UI updates live via Supabase Realtime — exactly like before

---

## How it works

```
Admin panel  ──insert──▶  link_check_jobs (queued)
                                  │
                                  │ polled every 5s
                                  ▼
                          VPS Worker (Chrome)
                                  │
                                  │ claim items + open URLs
                                  ▼
                       mark_link_check_result RPC
                                  │
                                  ▼
                  link_check_jobs (running → completed)
                                  │
                                  │ realtime postgres_changes
                                  ▼
                          Admin panel updates live ✨
```

## Auto-Loop also works automatically

The Auto-Loop toggle in admin already inserts a new `queued` job after each completion (via the existing trigger or cron). The VPS worker picks it up — nothing extra to configure.

---

## Useful commands

```bash
pm2 logs link-checker          # live logs
pm2 restart link-checker       # restart worker
pm2 stop link-checker          # stop
pm2 monit                      # CPU/RAM dashboard

# Re-login (if Google ever signs you out)
DISPLAY=:1 node login.js
```

## Tweaking validity detection

Edit `.env`:

```
INVALID_TEXT_PATTERNS=already been redeemed,no longer available,offer has expired,...
VALID_TEXT_PATTERNS=subscribe,continue,activate,...
```

Then `pm2 restart link-checker`.

## Firewall

Only port 22 (SSH) needs to be public. Block 5900/6080 publicly:

```bash
ufw allow 22
ufw enable
# Access noVNC via SSH tunnel only:
# ssh -L 6080:localhost:6080 root@VPS_IP
```

---

That's it. The cookie-expiry problem is now permanently gone. 🎉
