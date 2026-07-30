#!/usr/bin/env bash
# Rexovaan — VPS one-command deploy/update
# First time:  bash <(curl -fsSL https://raw.githubusercontent.com/mostaqsakib/rexovaan/main/deploy-vps.sh)
# After that:  rexo-update
set -euo pipefail

REPO_URL="https://github.com/mostaqsakib/rexovaan.git"
BRANCH="${BRANCH:-main}"
ROOT="/opt/rexovaan"

echo "🚀 Rexovaan VPS deploy — $(date)"

# ---- 1. Clone or pull ----
if [ -d "$ROOT/.git" ]; then
  echo "📥 Pulling latest code..."
  cd "$ROOT"
  git fetch --all --prune
  git reset --hard "origin/$BRANCH"
else
  echo "📦 Cloning repo to $ROOT ..."
  rm -rf "$ROOT"
  git clone --branch "$BRANCH" "$REPO_URL" "$ROOT"
  cd "$ROOT"
fi

# ---- 2. Keep existing .env files (never overwritten by git) ----
# Old locations we migrate .env from, if present
declare -A ENV_SOURCES=(
  ["tg-link-checker"]="$HOME/tg-link-checker/.env /root/tg-link-checker/.env"
  ["vps-worker"]="/opt/link-checker/.env $HOME/vps-worker/.env /root/vps-worker/.env"
  ["standalone-bot"]="$HOME/standalone-bot/.env /root/standalone-bot/.env"
)
for dir in "${!ENV_SOURCES[@]}"; do
  [ -d "$ROOT/$dir" ] || continue
  if [ ! -f "$ROOT/$dir/.env" ]; then
    for src in ${ENV_SOURCES[$dir]}; do
      if [ -f "$src" ]; then
        cp "$src" "$ROOT/$dir/.env"
        chmod 600 "$ROOT/$dir/.env"
        echo "🔐 $dir/.env copied from $src"
        break
      fi
    done
  fi
done

# ---- 3. Install deps ----
install_deps () {
  local dir="$1"
  [ -f "$ROOT/$dir/package.json" ] || return 0
  echo "📦 npm install → $dir"
  cd "$ROOT/$dir"
  npm install --omit=dev --no-audit --no-fund --silent || npm install --no-audit --no-fund --silent
  if grep -q '"playwright"' package.json; then
    npx playwright install chromium >/dev/null 2>&1 || true
  fi
}
install_deps "tg-link-checker"   # Bot link checker
install_deps "vps-worker"        # Site link checker
install_deps "standalone-bot"    # Telegram bot

# ---- 4. Restart via PM2 ----
command -v pm2 >/dev/null || npm install -g pm2 >/dev/null

start_or_restart () {
  local name="$1" dir="$2" script="$3"
  [ -f "$ROOT/$dir/$script" ] || return 0
  if pm2 describe "$name" >/dev/null 2>&1; then
    pm2 delete "$name" >/dev/null 2>&1 || true
  fi
  cd "$ROOT/$dir"
  if [ -f ecosystem.config.cjs ]; then
    pm2 start ecosystem.config.cjs --update-env
  else
    pm2 start "$script" --name "$name" --update-env
  fi
  echo "♻️  $name restarted"
}

start_or_restart "tg-link-checker" "tg-link-checker" "bot.js"
start_or_restart "link-checker"    "vps-worker"      "worker.js"
start_or_restart "bot"             "standalone-bot"  "bot.js"

pm2 save >/dev/null
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

# ---- 5. Install the `rexo-update` shortcut ----
cat > /usr/local/bin/rexo-update <<EOF
#!/usr/bin/env bash
bash $ROOT/deploy-vps.sh "\$@"
EOF
chmod +x /usr/local/bin/rexo-update

echo ""
pm2 list
echo ""
echo "✅ Done! Next time just run:  rexo-update"
echo "📜 Logs:  pm2 logs tg-link-checker | pm2 logs link-checker | pm2 logs bot"
