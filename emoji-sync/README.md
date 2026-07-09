# Rexovaan Emoji Sync

Syncs YOUR Telegram account's installed premium/custom emoji packs into the
Rexovaan Shoppie admin picker.

## One-time setup (local machine)

```bash
cd emoji-sync
cp .env.example .env      # fill SUPABASE_SERVICE_ROLE_KEY
npm install
npm run login             # enter phone → OTP → 2FA (if any)
```

Copy the printed session string into `.env` as `TG_SESSION=...`

## Sync

```bash
npm run sync
```

Runs through ALL your installed emoji packs and mirrors them to Supabase.
Admin panel emoji picker will show them automatically.

## Deploy (auto every 6h)

Deploy to Railway/VPS the same way as `standalone-bot/`. Add all `.env`
values as Railway secrets. Add a cron/scheduled job:

```
0 */6 * * *   cd /app/emoji-sync && node sync.js
```

## Security

- `TG_SESSION` = FULL access to your Telegram account. Treat like a password.
- Never commit `.env`. Store `TG_SESSION` only as an encrypted secret.
