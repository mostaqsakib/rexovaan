# Rexovaan Link Checker — VPS Setup (FAST FETCH MODE)

Inspired by the Gemini Link Checker Chrome extension: instead of opening every
URL in a Chrome tab, the worker reuses the persistent Chrome profile **cookies**
and just does HTTP GETs with `redirect: follow`. Then it looks for the same
text markers the extension uses to decide valid / invalid.

Result: ~20–25 links/sec instead of ~1/sec. Google login is still required
(once), because the activation pages need your Google session cookies.

---

## Rebuild on an existing VPS (fastest path)

If you already have the worker running and just want to upgrade + re-login:

```bash
# 1. Stop the old worker
pm2 stop link-checker

# 2. Upload the new vps-worker/ folder (overwrite)
#    From your laptop:
scp -r vps-worker/* root@YOUR_VPS_IP:/opt/link-checker/

# 3. On the VPS — update deps and re-login to Google
ssh root@YOUR_VPS_IP
cd /opt/link-checker
npm install
rm -rf /root/chrome-profile           # wipe old (possibly expired) session

# 4. One-time Google login via noVNC (see below)
Xvfb :1 -screen 0 1280x800x24 &
DISPLAY=:1 fluxbox &
x11vnc -display :1 -nopw -forever -shared -rfbport 5900 &
websockify -D --web=/usr/share/novnc/ 6080 localhost:5900
#   then on your laptop: ssh -L 6080:localhost:6080 root@VPS_IP
#   open http://localhost:6080/vnc.html in your browser
#   in the noVNC desktop (right-click → xterm):
DISPLAY=:1 HEADFUL=true node login.js
#   Log into Google, close the window when done. Session is saved.

# 5. Restart worker
pm2 restart link-checker
pm2 logs link-checker
```

You should see:
```
🤖 Rexovaan Link Checker worker (FAST FETCH) started
   Profile: /root/chrome-profile
   Concurrency cap: 10 | Retries: 2 | Timeout: 15000 ms
```

---

## Fresh install (first time on a VPS)

### 1. VPS requirements
- Ubuntu 22.04 / 24.04 (or Debian 12), 2 GB RAM minimum, root access.

### 2. Install dependencies

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# PM2
npm install -g pm2

# noVNC for one-time Google login
apt-get install -y xvfb x11vnc novnc websockify fluxbox xterm

# Chrome libs
apt-get install -y libnss3 libatk-bridge2.0-0 libxcomposite1 libxdamage1 \
  libxrandr2 libgbm1 libxkbcommon0 libpango-1.0-0 libcairo2 libasound2t64 \
  libatk1.0-0 libcups2 libdrm2 libxss1 fonts-noto-color-emoji
```

### 3. Upload worker

```bash
scp -r vps-worker root@YOUR_VPS_IP:/opt/link-checker
ssh root@YOUR_VPS_IP
cd /opt/link-checker
npm install
npx playwright install chromium
cp .env.example .env
nano .env       # paste SUPABASE_SERVICE_ROLE_KEY
```

### 4. One-time Google login (noVNC)

```bash
Xvfb :1 -screen 0 1280x800x24 &
DISPLAY=:1 fluxbox &
x11vnc -display :1 -nopw -forever -shared -rfbport 5900 &
websockify -D --web=/usr/share/novnc/ 6080 localhost:5900
```

From your laptop, SSH-tunnel and open noVNC:
```bash
ssh -L 6080:localhost:6080 root@VPS_IP
# then in your browser: http://localhost:6080/vnc.html
```

In the noVNC desktop, right-click → xterm:
```bash
cd /opt/link-checker
DISPLAY=:1 HEADFUL=true node login.js
```
Log into Google → close the window. Session saved to `/root/chrome-profile`.

### 5. Start the worker 24/7

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup        # follow printed command
pm2 logs link-checker
```

---

## How detection works (matches the extension)

Each URL is fetched once (with retries on 429/timeout). The response body is
lowercased and scanned for:

| Marker (any of) | Verdict |
|---|---|
| `already been used` | invalid — already used |
| `new activation link` | invalid — needs new link |
| (extra patterns from `INVALID_TEXT_PATTERNS`) | invalid |
| final URL contains `already / redeemed / expired / error` | invalid |
| accounts.google.com/signin redirect | **error: re-login needed** |
| nothing matched | **valid** |

If you ever see `google auth required` in the admin panel, run `node login.js`
again to refresh cookies. That's the only maintenance.

---

## Tuning (optional)

Edit `.env`, then `pm2 restart link-checker`:

```
MAX_CONCURRENCY=10        # parallel workers per job
NAV_TIMEOUT_MS=15000      # per-URL timeout
RETRIES_ON_ERROR=2        # extra attempts on timeout/429
DELAY_BETWEEN_JOBS_MS=200 # delay between checks per worker
INVALID_TEXT_PATTERNS=    # extra invalid markers (comma-separated)
VALID_TEXT_PATTERNS=      # if set, only these mark as valid
```

## Useful commands

```bash
pm2 logs link-checker          # live logs
pm2 restart link-checker       # restart worker
pm2 stop link-checker          # stop
DISPLAY=:1 HEADFUL=true node login.js   # re-login when Google signs out
```

## Firewall

Only port 22 needs to be public. Tunnel noVNC via SSH:
```bash
ufw allow 22 && ufw enable
ssh -L 6080:localhost:6080 root@VPS_IP
```
