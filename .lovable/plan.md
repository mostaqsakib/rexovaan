## Telegram-Style Editor (Shared Component + Rollout)

Ekta shared `<TelegramEditor />` component banabo ja Telegram-er real editor er moto behave korbe, ebong sob admin text field e bosabo. Sathe apnar Telegram account er sob custom emoji stickers panel e ashbe.

---

### 1. Shared component: `src/components/telegram-editor/`

**Files:**
- `TelegramEditor.tsx` — main WYSIWYG editor
- `EmojiPicker.tsx` — emoji panel (tabs + search)
- `Toolbar.tsx` — formatting buttons
- `TelegramPreview.tsx` — live "Telegram view" render
- `useCustomEmojiStickerSets.ts` — fetch user's saved emoji stickers

**Toolbar buttons (reference image er moto):**
- Undo / Redo
- **B** Bold, *I* Italic, U Underline, S Strikethrough
- `<code>` inline, `<pre>` block, `>` quote (blockquote), spoiler (`<tg-spoiler>`)
- 🔗 Link, 📎 Attach media
- 😀 **Emoji** panel
- 🆔 **Emoji ID** — manually paste custom emoji id
- 💡 Example (loads placeholder)

**Editor behavior:**
- `contentEditable` div with green Telegram-bubble background
- Types HTML directly (matches bot API `parse_mode: HTML`)
- Custom emoji render inline as `<tg-emoji emoji-id="...">😀</tg-emoji>` — shows animated Lottie/webp in editor
- Standard emoji insert as raw unicode
- Live "Telegram view" preview below (uses existing `TelegramRichText` component)
- Keyboard shortcuts: Ctrl+B/I/U/K
- Countdown macro helper: `{{countdown:2026-06-30T23:59:59Z}}`

### 2. Emoji Picker Panel

**Tabs:**
- 🕐 **Recently Used** (localStorage, last 32)
- 🤩 **Your Sticker Sets** — apnar Telegram account e sob custom emoji sticker sets (new)
- 😀 Smileys & People, 🐶 Animals, 🍔 Food, ⚽ Activities, ✈️ Travel, 💡 Objects, 💯 Symbols, 🏳️ Flags (standard unicode)

**Search bar** — sob emoji te search (keyword based).

**Custom sticker sets fetch flow (new):**
- Notun edge function: `list-my-emoji-sticker-sets`
- Bot Telegram API te apnar `user_id` diye `getUserChatBoosts`/`getStickerSet` use korbe — better: apnar admin panel e ekta "My Emoji Packs" input (comma-separated sticker set short names, e.g. `AnimatedEmojies,MyCustomPack`), tarpor `getStickerSet` diye protita pack er sob emoji sticker load kore cache korbe → `bot_emoji_sticker_sets` table
- Setup ekbar-i, tarpor "Your Sticker Sets" tab e sob emoji ashbe

### 3. Rollout — Kon file e boshabo

Prottek file er textarea → `<TelegramEditor />` diye replace:

| File | Field | Priority |
|------|-------|----------|
| `BroadcastDialog.tsx` | Main message | ⭐ (already partial) |
| `BotSettingsTab.tsx` | ~30 `msg_*` template fields | ⭐⭐⭐ |
| `AnnouncementsTab.tsx` | Body | ⭐⭐ |
| `GroupsKeywordsTab.tsx` | Response message | ⭐⭐ |
| `ButtonEmojisTab.tsx` | Button label + emoji picker | ⭐⭐ |
| `AddProductDialog.tsx` + `ProductsTab.tsx` | Product name, description, delivery instructions | ⭐ |
| Campaign messages (bot_campaign_messages) | Content | ⭐ |

Text-only field (jekhane HTML na chai, jemn short name) e ekta prop dibo: `<TelegramEditor plainOnly emojiOnly />` — sudhu emoji picker + preview, formatting toolbar hidden.

### 4. Database

**New table:** `bot_emoji_sticker_sets`
```
- set_name (text, PK)      -- e.g. "AnimatedEmojies"
- title (text)
- emojis (jsonb)           -- [{ custom_emoji_id, emoji, thumb_url }]
- fetched_at (timestamptz)
```

Admin-only RLS (`is_admin()` policy).

### 5. Edge function: `list-my-emoji-sticker-sets`

Input: `{ set_names: string[] }`  
Uses existing `BOT_TOKEN`, calls `getStickerSet` for each, caches emoji list + thumbnails, uploads webp thumbs to existing `custom-emojis` storage bucket.

---

### Delivery order

1. ✅ Migration: `bot_emoji_sticker_sets` table + RLS
2. ✅ Edge function `list-my-emoji-sticker-sets`
3. ✅ Shared `TelegramEditor` + `EmojiPicker` + `Toolbar` + `TelegramPreview` components
4. ✅ New "Emoji Packs" section in Settings for apnar sticker set names configure korte
5. ✅ Replace textareas in: BroadcastDialog → BotSettingsTab → AnnouncementsTab → GroupsKeywordsTab → ButtonEmojisTab → AddProductDialog/ProductsTab
6. ✅ Fix security finding (bot_customers privilege escalation) as part of migration
7. ✅ Deploy + publish

Estimated ~15-20 file changes, 1 migration, 1 new edge function.

---

**Confirm korle build shuru kori. Kono kichu badd dite ba age korte chaile bolun.**
