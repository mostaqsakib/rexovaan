## Goal

1. Admin action & sales-feed notification msg gula **editable** koro (Message Templates tab er moto WYSIWYG editor diye).
2. Premium (custom) emoji er 3 ta problem thik koro:
   - **Picker e pack load hoy na** → pack list refresh + fallback.
   - **Bot e send korle fallback ashe** → serialize/send pipeline check kore `<tg-emoji>` properly forward.
   - **Site preview e broken** → `TelegramRichText` diye render, cache theke image/lottie.

---

## Part A — Editable Admin Notifications

Notun template group **"Admin Notifications"** add korbo `MessageTemplatesTab.tsx` te. Egula edit korle edge functions `bot_settings` theke read korbe (hardcoded fallback thakbe).

### Templates jegula editable hobe:

**Customer-facing (edge → customer telegram/email):**
- `notif_deposit_verified` — Deposit approved
- `notif_deposit_rejected` — Deposit rejected  
- `notif_balance_credit` — Admin manual credit (deposit)
- `notif_balance_debit` — Admin manual deduct
- `notif_refund` — Order refunded
- `notif_withdrawal_confirmed` — Withdrawal completed
- `notif_withdrawal_rejected` — Withdrawal rejected
- `notif_pending_cancelled` — Pending delivery cancelled
- `notif_special_price_set` — Special price added/updated
- `notif_special_price_removed` — Special price removed

**Admin group / sales-feed:**
- `admin_notif_order_delivered` — "💰 {payment} Order Delivered" (bKash/crypto/balance)
- `admin_notif_deposit_received` — Deposit pending review
- `admin_notif_withdrawal_request` — Withdrawal request
- `admin_notif_manual_delivery` — Stock empty, needs manual delivery

Each template with proper `{placeholders}` — e.g. `{amount} {currency} {new_balance} {note} {product} {qty} {txid} {payment_method}`.

### How edge functions read them:

Ekta chhoto helper `_shared/render-template.ts`:

```ts
// Reads bot_settings.value for key, falls back to default,
// then interpolates {placeholders}.
export async function renderTemplate(
  supabase, key: string, defaults: string, vars: Record<string, string>
): Promise<string> { ... }
```

Update these edge functions to use it:
- `admin-verify-deposit`, `admin-reject-deposit`
- `admin-edit-balance`
- `admin-refund-order`
- `admin-confirm-withdrawal`, `admin-reject-withdrawal`
- `admin-cancel-pending-delivery`
- `admin-notify-special-price`
- `stock-broadcast` (manual delivery admin ping)

---

## Part B — Premium Emoji Fixes

### B1. Picker e pack load thik korbo

`EmojiPacksSettings.tsx` te admin pack short_names dey (jemon `AnimatedEmojies`). `list-my-emoji-sticker-sets` edge function call kore Telegram theke sticker fetch kore `bot_emoji_sticker_sets` cache kore.

**Issues:**
- Refresh button add — force re-fetch specific set.
- Error message dekhabe (kono set fail hole).
- Picker load holo cache theke — new pack add korle sathe sathe show.

### B2. Bot e send hole tg-emoji forward

Edge functions/`send-bot-message`/bot delivery — jei msg `bot_settings` theke ashbe, oita already `<tg-emoji emoji-id="..." >X</tg-emoji>` format e stored ache (editor eta save kore). `parse_mode: 'HTML'` diye send korle Telegram premium user der animated emoji dekhabe, free user fallback char dekhabe. **Eta already correct — verify korbo standalone-bot delivery paths.**

Ekta gotcha: `notify-customer.ts` direct BOT_TOKEN diye send kore. Sekhaneo parse_mode HTML thik ase kina check korbo — `<tg-emoji>` tag ta bot Telegram API te forward hocche kina.

### B3. Site preview e premium emoji render

Customer site (Shop, Announcements, ProductDetail) e message dekhale `TelegramRichText` component diye render korbo — eta already ache, kintu maybe kotha te use hocche na. Audit kore lagabo:
- `AnnouncementBanner.tsx`  
- Announcement dialogs  
- Any bot message preview on site

`TgEmoji` component `bot_custom_emoji_cache` theke Lottie/webp URL nibe. Cache warmup e `get-custom-emojis` edge function ache — trigger korbo missing id gula upore.

---

## Files to change

**New:**
- `supabase/functions/_shared/render-template.ts` — template loader + interpolator

**Frontend:**
- `src/components/MessageTemplatesTab.tsx` — new "Admin Notifications" group + templates
- `src/components/telegram-editor/EmojiPacksSettings.tsx` — refresh, error UX
- `src/components/customer/AnnouncementBanner.tsx` (+ others) — use `TelegramRichText`

**Edge functions (update to use renderTemplate):**
- `admin-verify-deposit`, `admin-reject-deposit`
- `admin-edit-balance`  
- `admin-refund-order`
- `admin-confirm-withdrawal`, `admin-reject-withdrawal`
- `admin-cancel-pending-delivery`
- `admin-notify-special-price`
- `_shared/notify-customer.ts` — ensure parse_mode HTML propagates

---

## Out of scope (ask if you also want)

- Per-user notification template customization
- Multi-language (Bangla/English toggle)
- Rich-text editor for email HTML (currently Resend uses React Email templates)

Approve korle implement kori.