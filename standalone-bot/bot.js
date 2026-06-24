import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import crypto from "crypto";

if (!globalThis.WebSocket) {
  globalThis.WebSocket = WebSocket;
}

// ── Config ──
const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) { console.error("BOT_TOKEN not set"); process.exit(1); }

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const POLL_TIMEOUT = 30; // seconds for long polling

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Maintenance Mode ──
let maintenanceMode = false;
const MAINTENANCE_MSG = "🔧 <b>Bot is currently under maintenance.</b>\n\nPlease try again later. We'll be back shortly! 🙏";

// ── Welcome Message Cache ──
let cachedWelcomeMsg = `✨ <b>Welcome to Rexovaan Shop!</b> ✨\n\n🛒 <b>Shop</b> — Browse & buy products\n💳 <b>Deposit</b> — Add funds to your wallet\n👤 <b>My Profile</b> — Balance, orders & settings\n🆘 <b>Support</b> — Get help\n🎁 <b>Refer & Earn</b> — Invite friends & earn rewards`;
let welcomeMsgLastFetch = 0;

// ── Page Messages Cache ──
const PAGE_MSG_KEYS = {
  welcome_message: "Welcome",
  msg_shop: "Shop",
  msg_deposit: "Deposit",
  msg_support: "Support",
  msg_profile: "Profile",
  msg_balance: "Balance",
  msg_withdraw: "Withdraw",
  msg_referral: "Referral",
  msg_notifications: "Notifications",
  msg_stock_alert: "Stock Alert",
  msg_new_product: "New Product",
  msg_price_up: "Price Increased",
  msg_price_down: "Price Decreased",
  msg_keyword_reply: "Keyword Reply",
  msg_pay_balance_confirm: "Pay with Balance Confirm",
  msg_order_summary: "Order Summary",
  msg_flash_sale: "Flash Sale Announcement",
  msg_flash_sale_ended: "Flash Sale Ended",
  msg_recent_sale: "Recent Sale Feed (Bot)",
  msg_recent_sale_web: "Recent Sale Feed (Web)",
};
const PLACEHOLDER_KEYS = new Set([
  "name",
  "id",
  "balance",
  "joined",
  "link",
  "ref_24h",
  "ref_7d",
  "ref_total",
  "earned",
  "available",
  "transferred",
  "commission",
  "bonus",
  "product",
  "stock",
  "price",
  "added",
  "old_price",
  "new_price",
  "quantity",
  "subtotal",
  "final",
  "after",
  "currency",
  "total",
  "balance_section",
  "payment_hint",
  "pay_later_section",
  "original",
  "savings",
  "countdown",
  "bulk_pricing",
]);
let cachedPageMsgs = {};
let pageMsgsLastFetch = 0;

// ── Channel Join Verification cache ──
let cachedChannelJoin = {
  enabled: false,
  username: "",
  message: '🔔 <b>Please join our channel to continue using this bot.</b>\n\nAfter joining, tap "Done ✅" below.',
  buttonEmoji: "📢",
  doneEmoji: "✅",
  buttonEmojiId: "",
  doneEmojiId: "",
};
let channelJoinLastFetch = 0;

async function fetchChannelJoinSettings(force = false) {
  if (!force && Date.now() - channelJoinLastFetch < 60000) return cachedChannelJoin;
  try {
    const { data } = await supabase
      .from("bot_settings")
      .select("key, value")
      .in("key", [
        "channel_join_enabled",
        "channel_join_username",
        "channel_join_message",
        "channel_join_button_emoji",
        "channel_join_done_emoji",
        "channel_join_button_emoji_id",
        "channel_join_done_emoji_id",
      ]);
    if (data) {
      // Reset id fields so cleared settings actually clear in cache
      cachedChannelJoin.buttonEmojiId = "";
      cachedChannelJoin.doneEmojiId = "";
      for (const row of data) {
        const v = row.value ?? "";
        if (row.key === "channel_join_enabled") cachedChannelJoin.enabled = String(v).toLowerCase() === "true";
        else if (row.key === "channel_join_username") cachedChannelJoin.username = String(v).trim();
        else if (row.key === "channel_join_message" && v) cachedChannelJoin.message = String(v);
        else if (row.key === "channel_join_button_emoji" && v) cachedChannelJoin.buttonEmoji = String(v);
        else if (row.key === "channel_join_done_emoji" && v) cachedChannelJoin.doneEmoji = String(v);
        else if (row.key === "channel_join_button_emoji_id") cachedChannelJoin.buttonEmojiId = String(v || "").trim();
        else if (row.key === "channel_join_done_emoji_id") cachedChannelJoin.doneEmojiId = String(v || "").trim();
      }
    }
    channelJoinLastFetch = Date.now();
  } catch (e) { console.error("fetchChannelJoinSettings failed:", e); }
  return cachedChannelJoin;
}

function channelLinkFromUsername(u) {
  const s = String(u || "").trim();
  if (!s) return null;
  if (s.startsWith("https://") || s.startsWith("http://")) return s;
  if (s.startsWith("@")) return `https://t.me/${s.slice(1)}`;
  if (s.startsWith("-100")) return null; // numeric id has no public link
  return `https://t.me/${s}`;
}

function channelApiId(u) {
  const s = String(u || "").trim();
  if (!s) return null;
  if (/^-?\d+$/.test(s)) return s; // numeric id
  if (s.startsWith("@")) return s;
  if (s.startsWith("https://t.me/") || s.startsWith("http://t.me/")) {
    const handle = s.replace(/^https?:\/\/t\.me\//, "").split(/[/?#]/)[0];
    return handle ? `@${handle}` : null;
  }
  return `@${s}`;
}

async function isUserVerifiedForChannel(chatId) {
  try {
    const { data } = await supabase
      .from("user_channel_verification")
      .select("user_id")
      .eq("user_id", chatId)
      .maybeSingle();
    return !!data;
  } catch (e) { console.error("isUserVerifiedForChannel:", e); return false; }
}

async function markUserVerifiedForChannel(chatId) {
  try {
    await supabase
      .from("user_channel_verification")
      .upsert({ user_id: chatId, verified_at: new Date().toISOString() }, { onConflict: "user_id" });
  } catch (e) { console.error("markUserVerifiedForChannel:", e); }
}

// Returns: 'member' | 'not_member' | 'error'
async function checkChannelMembershipStatus(chatId, channelId) {
  try {
    const res = await tgFetch("getChatMember", { chat_id: channelId, user_id: chatId });
    if (!res?.ok) {
      console.warn("[channel-join] getChatMember not ok:", JSON.stringify(res));
      return "error";
    }
    const status = res.result?.status;
    if (status === "member" || status === "administrator" || status === "creator") return "member";
    return "not_member";
  } catch (e) {
    console.warn("[channel-join] getChatMember threw:", e?.message || e);
    return "error";
  }
}

async function checkUserIsChannelMember(chatId, channelId) {
  return (await checkChannelMembershipStatus(chatId, channelId)) === "member";
}

function buildJoinPromptKeyboard(settings) {
  const link = channelLinkFromUsername(settings.username);
  // Mirror product list buttons: when a premium custom_emoji document_id is set,
  // strip text glyphs and pass icon_custom_emoji_id so the button renders the
  // premium emoji icon. Otherwise fall back to plain unicode in the label.
  const btnEmoji = String(settings.buttonEmoji || "");
  const doneEmoji = String(settings.doneEmoji || "");
  const btnEmojiId = String(settings.buttonEmojiId || "").trim();
  const doneEmojiId = String(settings.doneEmojiId || "").trim();

  const joinBase = btnEmojiId ? "Join Channel" : `${btnEmoji} Join Channel`;
  const doneBase = doneEmojiId ? "Done" : `Done ${doneEmoji}`;

  const joinBtn = link
    ? { text: joinBase, url: link }
    : { text: joinBase, callback_data: "noop" };
  if (btnEmojiId) joinBtn.icon_custom_emoji_id = btnEmojiId;

  const doneBtn = { text: doneBase, callback_data: "chk_join" };
  if (doneEmojiId) doneBtn.icon_custom_emoji_id = doneEmojiId;

  return { inline_keyboard: [[joinBtn], [doneBtn]] };
}


// Returns true if user is allowed to continue, false if blocked by join prompt.
async function ensureChannelVerified(chatId) {
  // Always read fresh from DB so admin emoji edits show up immediately.
  const s = await fetchChannelJoinSettings(true);
  if (!s.enabled || !s.username) return true;
  if (isAdmin(chatId)) return true;
  if (await isUserVerifiedForChannel(chatId)) return true;
  // Auto-verify if user is already a channel member (avoids loop when user
  // joined the channel but never tapped Done).
  const channelId = channelApiId(s.username);
  if (channelId && (await checkUserIsChannelMember(chatId, channelId))) {
    await markUserVerifiedForChannel(chatId);
    return true;
  }
  await sendMessage(chatId, s.message, buildJoinPromptKeyboard(s));
  return false;
}

function normalizePlaceholderMarkup(html) {
  const source = String(html || "");
  return source.replace(/\{[^{}]*\}/g, (match) => {
    const inner = match.slice(1, -1);
    const plain = inner.replace(/<[^>]*>/g, "").trim();
    if (!PLACEHOLDER_KEYS.has(plain)) return match;

    const openings = (inner.match(/<(?!\/)[^>]+>/g) || []).join("");
    const closings = (inner.match(/<\/[^>]+>/g) || []).join("");
    return `${openings}{${plain}}${closings}`;
  });
}

function normalizeTelegramHtml(html) {
  let result = normalizePlaceholderMarkup(html);

  for (let i = 0; i < 5; i++) {
    const prev = result;
    result = result
      .replace(/<(b|i|u|s|code)><tg-emoji([^>]*)>([\s\S]*?)<\/\1><\/tg-emoji><\1>([\s\S]*?)<\/\1>/g, '<$1><tg-emoji$2>$3</tg-emoji>$4</$1>')
      .replace(/<(b|i|u|s|code)><tg-emoji([^>]*)>([\s\S]*?)<\/\1><\/tg-emoji>/g, '<$1><tg-emoji$2>$3</tg-emoji></$1>')
      // Fix swapped close order: <blockquote><X>...</blockquote></X> => <blockquote><X>...</X></blockquote>
      .replace(/<(blockquote)((?:\s[^>]*)?)>(<(b|i|u|s|code)>)([\s\S]*?)<\/\1><\/\4>/g, '<$1$2>$3$5</$4></$1>');
    if (result === prev) break;
  }

  return result;
}

// Telegram rejects custom_emoji entities that overlap any other formatting
// entity (bold/italic/underline/strikethrough/code/spoiler/blockquote). When
// admins author templates like `<b>🕐 <tg-emoji ...>🕐</tg-emoji> {countdown}</b>`,
// the inner <tg-emoji> must be lifted OUT of the <b> wrapper, otherwise the
// channel/group server silently drops the custom emoji and only the fallback
// glyph renders. This works for emoji at any position inside the wrapper —
// start, middle, or end — by splitting the wrapper around each tg-emoji.
function keepCustomEmojiOutsideFormatting(html) {
  let result = String(html || "");
  const tags = ["b", "i", "u", "s", "code", "spoiler"];
  for (let i = 0; i < 6; i++) {
    let next = result;
    for (const tag of tags) {
      const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, "gi");
      next = next.replace(re, (full, attrs, inner) => {
        if (!/<tg-emoji\b/i.test(inner)) return full;
        const parts = inner.split(/(<tg-emoji\b[^>]*>[\s\S]*?<\/tg-emoji>)/i);
        return parts
          .map((part) => {
            if (!part) return "";
            if (/^<tg-emoji\b/i.test(part)) return part;
            return `<${tag}${attrs || ""}>${part}</${tag}>`;
          })
          .join("");
      });
    }
    if (next === result) break;
    result = next;
  }
  return result;
}

function prepareTelegramHtml(html) {
  return keepCustomEmojiOutsideFormatting(normalizeTelegramHtml(html));
}

async function fetchPageMsgs(force = false) {
  if (force || Date.now() - pageMsgsLastFetch > 60000) {
    try {
      const { data } = await supabase.from("bot_settings").select("key, value").in("key", Object.keys(PAGE_MSG_KEYS));
      if (data) {
        cachedPageMsgs = {};
        for (const row of data) {
          if (row.value) cachedPageMsgs[row.key] = normalizeTelegramHtml(row.value);
        }
      }
      pageMsgsLastFetch = Date.now();
    } catch (e) { console.error("Failed to fetch page msgs:", e); }
  }
}

function getPageMsg(key, fallback) {
  return normalizeTelegramHtml(cachedPageMsgs[key] || fallback);
}

// Replace placeholders tolerant of HTML tags interspersed within {key}
// e.g. {<b>name}</b> still matches {name}
function replacePlaceholder(html, key, value) {
  const tagPat = '(?:<[^>]*>)*';
  const charsPat = key.split('').map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(tagPat);
  const regex = new RegExp(`\\{${tagPat}${charsPat}${tagPat}\\}`, 'g');
  return html.replace(regex, value);
}

function stripEmptyPlaceholderLine(html, key) {
  const lines = String(html || "").split("\n");
  const placeholderRe = new RegExp(`\\{${key}\\}`, "g");
  const out = [];
  const stripDecorations = (s) => s
    .replace(/<tg-emoji[^>]*>[\s\S]*?<\/tg-emoji>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[\u200d\ufe0f]/g, "")
    .replace(/(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})+/gu, "")
    .trim();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!placeholderRe.test(line)) { out.push(line); continue; }
    placeholderRe.lastIndex = 0;
    // Treat the line as "empty" when only emojis / tags / whitespace remain after removing the placeholder.
    const stripped = stripDecorations(line.replace(placeholderRe, ""));
    if (stripped !== "") {
      out.push(line.replace(placeholderRe, ""));
      continue;
    }
    // Drop preceding emoji-only / blank line(s)
    while (out.length > 0) {
      const prev = out[out.length - 1];
      if (stripDecorations(prev) === "") { out.pop(); continue; }
      break;
    }
    if (i + 1 < lines.length && lines[i + 1].trim() === "") i++;
  }
  return out.join("\n");
}

function replacePlaceholders(html, replacements) {
  let result = prepareTelegramHtml(html);
  for (const [placeholder, value] of Object.entries(replacements)) {
    const key = placeholder.replace(/^\{|\}$/g, '');
    const strValue = String(value ?? "");
    if (strValue === "") result = stripEmptyPlaceholderLine(result, key);
    result = replacePlaceholder(result, key, strValue);
  }
  return prepareTelegramHtml(result);
}

async function formatBulkPricingBlock(productId) {
  try {
    const { data: tiers } = await supabase
      .from("bot_product_pricing")
      .select("min_quantity, max_quantity, price")
      .eq("product_id", productId)
      .order("min_quantity");
    if (!tiers || tiers.length < 2) return "";
    const lines = tiers.map((t) => {
      const range = t.max_quantity && t.max_quantity > 0
        ? `${t.min_quantity}-${t.max_quantity}`
        : `${t.min_quantity}+`;
      return `• <b>${range}</b> pcs — <b>${Number(t.price).toFixed(2)} USDT</b> each`;
    });
    let headerEmoji = "🤑";
    try {
      const { data: emojiRow } = await supabase
        .from("bot_button_emojis")
        .select("custom_emoji_id")
        .eq("button_key", "bulk_pricing")
        .maybeSingle();
      if (emojiRow?.custom_emoji_id) {
        headerEmoji = `<tg-emoji emoji-id="${emojiRow.custom_emoji_id}">🤑</tg-emoji>`;
      }
    } catch {}
    return `\n\n${headerEmoji} <b>Bulk Pricing:</b>\n${lines.join("\n")}`;
  } catch {
    return "";
  }
}



async function getWelcomeMsg(customerName) {
  await fetchPageMsgs();
  let msg = normalizeTelegramHtml(cachedPageMsgs["welcome_message"] || cachedWelcomeMsg);
  if (customerName) msg = replacePlaceholder(msg, 'name', customerName);
  return msg;
}

function envGet(key) {
  return process.env[key] || "";
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttr(text) {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

function formatPrice(value) {
  const n = Number(value) || 0;
  // For sub-cent prices (< 0.1) preserve up to 4 decimals (trim trailing zeros). Otherwise 2 decimals.
  if (n > 0 && n < 0.1) {
    const s = n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    return s;
  }
  return n.toFixed(2);
}

function utf16ToCodePointIndex(text, utf16Index) {
  return [...String(text || "").slice(0, Math.max(0, utf16Index))].length;
}

function getEntityHtmlTags(entity) {
  switch (entity?.type) {
    case "bold":
      return ["<b>", "</b>"];
    case "italic":
      return ["<i>", "</i>"];
    case "underline":
      return ["<u>", "</u>"];
    case "strikethrough":
      return ["<s>", "</s>"];
    case "code":
      return ["<code>", "</code>"];
    case "pre":
      return entity.language
        ? [`<pre><code class="language-${escapeHtmlAttr(entity.language)}">`, "</code></pre>"]
        : ["<pre>", "</pre>"];
    case "text_link":
      return entity.url ? [`<a href="${escapeHtmlAttr(entity.url)}">`, "</a>"] : null;
    case "text_mention":
      return entity.user?.id ? [`<a href="tg://user?id=${entity.user.id}">`, "</a>"] : null;
    case "custom_emoji":
      return entity.custom_emoji_id ? [`<tg-emoji emoji-id="${entity.custom_emoji_id}">`, "</tg-emoji>"] : null;
    case "spoiler":
      return ["<tg-spoiler>", "</tg-spoiler>"];
    case "blockquote":
      return ["<blockquote>", "</blockquote>"];
    case "expandable_blockquote":
      return ["<blockquote expandable>", "</blockquote>"];
    default:
      return null;
  }
}

// Convert Telegram entities to HTML
function entitiesToHtml(text, entities) {
  const rawText = String(text || "");
  if (!entities || entities.length === 0) return escapeHtml(rawText);

  const chars = [...rawText].map((char) => escapeHtml(char));
  const openings = new Map();
  const closings = new Map();

  const pushTag = (map, index, tagMeta) => {
    if (!map.has(index)) map.set(index, []);
    map.get(index).push(tagMeta);
  };

  // Outer-most types should wrap inner ones. Higher priority => more outer.
  const outerPriority = (type) => {
    switch (type) {
      case "blockquote":
      case "expandable_blockquote":
        return 3;
      case "pre":
        return 2;
      case "text_link":
      case "text_mention":
        return 1;
      default:
        return 0;
    }
  };

  for (const entity of entities) {
    const tags = getEntityHtmlTags(entity);
    if (!tags) continue;

    const start = utf16ToCodePointIndex(rawText, entity.offset || 0);
    const end = utf16ToCodePointIndex(rawText, (entity.offset || 0) + (entity.length || 0));
    const length = end - start;

    if (start < 0 || end < start) continue;

    const priority = outerPriority(entity.type);
    pushTag(openings, start, { tag: tags[0], start, end, length, priority });
    pushTag(closings, end, { tag: tags[1], start, end, length, priority });
  }

  let html = "";
  for (let index = 0; index <= chars.length; index++) {
    const closingTags = closings.get(index) || [];
    closingTags
      .sort((a, b) => a.length - b.length || a.priority - b.priority || b.start - a.start)
      .forEach(({ tag }) => {
        html += tag;
      });

    const openingTags = openings.get(index) || [];
    openingTags
      .sort((a, b) => b.length - a.length || b.priority - a.priority || a.end - b.end)
      .forEach(({ tag }) => {
        html += tag;
      });

    if (index < chars.length) html += chars[index];
  }

  return html;
}

// ── Telegram API helpers (direct, no gateway) ──

// Fetch with timeout helper
function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function sanitizeTgBody(body) {
  return body;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isIgnorableTelegramError(method, data) {
  const description = String(data?.description || "").toLowerCase();
  if (!description) return false;
  if (method === "answerCallbackQuery") {
    return description.includes("query is too old")
      || description.includes("response timeout expired")
      || description.includes("query id is invalid");
  }
  if (method === "editMessageText" || method === "editMessageReplyMarkup") {
    return description.includes("message is not modified");
  }
  return false;
}

async function tgFetch(method, body, retries = 3) {
  body = sanitizeTgBody(body);
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(`${TELEGRAM_API}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }, 15000);
      const data = await res.json();
      if (!data.ok && !isIgnorableTelegramError(method, data)) console.error(`TG ${method} failed:`, JSON.stringify(data));
      return data;
    } catch (err) {
      console.error(`tgFetch ${method} attempt ${attempt}/${retries} error:`, err.message);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

async function tgActionWithRateLimit(method, body, { attempts = 6, okIfDescriptionIncludes = [] } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await tgFetch(method, body, 1);
    if (res?.ok) return { ok: true, response: res };

    const description = String(res?.description || "").toLowerCase();
    if (okIfDescriptionIncludes.some((part) => description.includes(part))) {
      return { ok: true, ignored: true, response: res };
    }

    const retryAfter = Number(res?.parameters?.retry_after || 0);
    const isRateLimited = retryAfter > 0 || description.includes("too many requests") || description.includes("retry after");
    if (isRateLimited && attempt < attempts) {
      await sleep((retryAfter > 0 ? retryAfter + 1 : Math.min(attempt * 2, 10)) * 1000);
      continue;
    }

    return { ok: false, response: res, description };
  }
  return { ok: false, description: "max attempts reached" };
}

let _botUsername = null;
async function getBotUsername() {
  if (_botUsername) return _botUsername;
  try {
    const res = await tgFetch("getMe", {});
    if (res?.ok) _botUsername = res.result.username;
  } catch (e) { console.error("getMe error:", e.message); }
  return _botUsername || "your_bot";
}

// ── Group broadcast helpers ──
// Excludes channels — channels only receive Flash Sale broadcasts when admin
// explicitly selects them as a target (via broadcastToChats).
async function getBroadcastChatIds() {
  const { data: customers } = await supabase.from("bot_customers").select("chat_id");
  const { data: groups } = await supabase
    .from("bot_broadcast_groups")
    .select("chat_id, chat_type")
    .eq("is_active", true);
  const ids = [];
  if (customers) for (const c of customers) ids.push(c.chat_id);
  if (groups) for (const g of groups) {
    if (g.chat_type === "channel") continue; // skip channels for auto-broadcasts
    ids.push(g.chat_id);
  }
  return ids;
}

async function broadcastToAll(text, replyMarkup) {
  const ids = await getBroadcastChatIds();
  const normalizedReplyMarkup = await normalizePurchaseBroadcastKeyboard(replyMarkup);
  let sent = 0, failed = 0;
  const messageIds = [];
  for (let i = 0; i < ids.length; i += 25) {
    const batch = ids.slice(i, i + 25);
    const results = await Promise.allSettled(batch.map((id) => sendMessage(id, text, normalizedReplyMarkup)));
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled" && r.value?.ok) {
        sent++;
        if (r.value?.result?.message_id) messageIds.push({ chat_id: batch[j], message_id: r.value.result.message_id });
      } else failed++;
    }
    if (i + 25 < ids.length) await new Promise((r) => setTimeout(r, 1000));
  }
  return { total: ids.length, sent, failed, messageIds };
}

async function broadcastToChats(chatIds, text, replyMarkup) {
  const ids = (chatIds || []).map(Number).filter((n) => !isNaN(n));
  const normalizedReplyMarkup = await normalizePurchaseBroadcastKeyboard(replyMarkup);
  let sent = 0, failed = 0;
  const messageIds = [];
  for (let i = 0; i < ids.length; i += 25) {
    const batch = ids.slice(i, i + 25);
    const results = await Promise.allSettled(batch.map((id) => sendMessage(id, text, normalizedReplyMarkup)));
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled" && r.value?.ok) {
        sent++;
        if (r.value?.result?.message_id) messageIds.push({ chat_id: batch[j], message_id: r.value.result.message_id });
      } else failed++;
    }
    if (i + 25 < ids.length) await new Promise((r) => setTimeout(r, 1000));
  }
  return { total: ids.length, sent, failed, messageIds };
}

async function showBroadcastProductPicker(chatId, msgId, selectedIds) {
  const { data: prods } = await supabase.from("bot_products").select("id, name, short_code, custom_emoji_id, is_active").eq("is_active", true).order("sort_order");
  const selected = new Set((selectedIds || []).map(String));
  const rows = [];
  for (const p of (prods || [])) {
    const mark = selected.has(p.id) ? "✅" : "▫️";
    rows.push([productSelectButton(p, `${mark} ${p.name}`, `adm_bcast_toggle_${p.id}`)]);
  }
  rows.push([
    { text: `📤 Send ${selected.size ? `(${selected.size} btn)` : "without buttons"}`, callback_data: selected.size ? "adm_bcast_send" : "adm_bcast_skip" },
  ]);
  rows.push([{ text: "❌ Cancel", callback_data: "adm_bcast_cancel" }]);
  const txt = `🔘 <b>Attach Product Buttons</b>\n\nTap products to toggle Buy buttons. Selected: <b>${selected.size}</b>\n\nPress <b>Send</b> when done.`;
  if (msgId) await editOrSend(chatId, msgId, txt, { inline_keyboard: rows });
  else await sendMessage(chatId, txt, { inline_keyboard: rows });
}


// ── Flash Sales helpers ──
async function getActiveFlashSale(productId) {
  const { data } = await supabase
    .from("bot_flash_sales")
    .select("*")
    .eq("product_id", productId)
    .eq("is_active", true)
    .gt("ends_at", new Date().toISOString())
    .lte("starts_at", new Date().toISOString())
    .order("ends_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data || null;
}

function formatCountdown(endsAt) {
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return "00:00:00";
  const total = Math.ceil(ms / 1000);
  // Final 10s: show single digit (9, 8, 7, ... 1) ticking every second
  if (total <= 10) return String(total);
  const t = Math.floor(ms / 1000);
  const h = String(Math.floor(t / 3600)).padStart(2, "0");
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
  const s = String(t % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// ── Premium digit emojis for countdown ──
let cachedDigitEmojis = null;
let cachedDigitEmojisAt = 0;
async function getDigitEmojis() {
  if (cachedDigitEmojis && Date.now() - cachedDigitEmojisAt < 30000) return cachedDigitEmojis;
  try {
    const { data } = await supabase.from("bot_settings").select("value").eq("key", "countdown_digit_emojis").maybeSingle();
    let parsed = {};
    if (data?.value) { try { parsed = JSON.parse(data.value) || {}; } catch (_) { parsed = {}; } }
    cachedDigitEmojis = parsed;
    cachedDigitEmojisAt = Date.now();
    return parsed;
  } catch (_) { return cachedDigitEmojis || {}; }
}
function invalidateDigitEmojisCache() { cachedDigitEmojis = null; cachedDigitEmojisAt = 0; }
const COUNTDOWN_DIGIT_FALLBACKS = {
  "0": "0️⃣",
  "1": "1️⃣",
  "2": "2️⃣",
  "3": "3️⃣",
  "4": "4️⃣",
  "5": "5️⃣",
  "6": "6️⃣",
  "7": "7️⃣",
  "8": "8️⃣",
  "9": "9️⃣",
  ":": "➖",
};
function renderCountdownPremium(text, map) {
  if (!map || Object.keys(map).length === 0) return String(text);
  let out = "";
  for (const ch of String(text)) {
    const id = map[ch];
    out += id ? `<tg-emoji emoji-id="${id}">${COUNTDOWN_DIGIT_FALLBACKS[ch] || ch}</tg-emoji>` : ch;
  }
  return out;
}
function stripFormattingAroundCountdown(tpl) {
  let out = String(tpl || "");
  for (let i = 0; i < 5; i++) {
    // 1) Tight wrap: <b>{countdown}</b> → {countdown}
    let next = out.replace(/<(b|i|u|s|code)>\s*\{countdown\}\s*<\/\1>/gi, "{countdown}");
    // 2) Loose wrap with surrounding content/premium emoji on the time line:
    //    <b>🕐 <tg-emoji ...>...</tg-emoji> {countdown}</b> → 🕐 <tg-emoji ...>...</tg-emoji> {countdown}
    //    Preserves any custom_emoji_id and text the admin placed on the countdown line.
    next = next.replace(/<(b|i|u|s|code)>([^<]*(?:<tg-emoji[^>]*>[\s\S]*?<\/tg-emoji>[^<]*)*)\{countdown\}([^<]*(?:<tg-emoji[^>]*>[\s\S]*?<\/tg-emoji>[^<]*)*)<\/\1>/gi,
      "$2{countdown}$3");
    if (next === out) break;
    out = next;
  }
  return out;
}

function stripProductLineFromFlashSaleSnippet(tpl) {
  return String(tpl || "")
    .replace(/(?:^|\n)[^\n]*\{product\}[^\n]*(?=\n|$)/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function applyTemplate(tpl, vars) {
  let out = String(tpl || "");
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}

async function buildFlashSaleMessage(sale, product, ended = false) {
  await fetchPageMsgs();
  const productIcon = product.custom_emoji_id ? `<tg-emoji emoji-id="${product.custom_emoji_id}">📦</tg-emoji> ` : "🔥 ";
  const tiers = await supabase.from("bot_product_pricing").select("price").eq("product_id", product.id).order("min_quantity").limit(1);
  const originalPrice = tiers?.data?.[0]?.price ?? product.price;
  const savings = Math.max(0, Number(originalPrice) - Number(sale.sale_price));
  const digitMap = await getDigitEmojis();
  const hasDigits = digitMap && Object.keys(digitMap).length > 0;
  const countdownText = formatCountdown(sale.ends_at);
  const vars = {
    product: `${productIcon}${escapeHtml(product.name)}`,
    price: Number(sale.sale_price).toFixed(2),
    original: Number(originalPrice).toFixed(2),
    savings: savings.toFixed(2),
    countdown: hasDigits ? renderCountdownPremium(countdownText, digitMap) : countdownText,
  };
  if (ended) {
    const tpl = cachedPageMsgs.msg_flash_sale_ended ||
      `⏰ <b>FLASH SALE ENDED</b>\n\n{product}\n\n<i>This limited-time offer has expired. Regular pricing is back.</i>`;
    return replacePlaceholders(tpl, vars);
  }
  let tpl = cachedPageMsgs.msg_flash_sale ||
    `🔥 <b>FLASH SALE — LIMITED TIME!</b>\n\n{product}\n\n💰 Sale Price: <b>\${price}</b>\n<s>Regular: \${original}</s> — Save \${savings}\n\n⏳ Ends in: <b><code>{countdown}</code></b>\n\n<i>Hurry — grab it before time runs out!</i>`;
  if (hasDigits) tpl = stripFormattingAroundCountdown(tpl);
  return replacePlaceholders(tpl, vars);
}

async function buildFlashSaleKeyboard(product) {
  const emojiMap = await loadButtonEmojis();
  const botUser = await getBotUsername();
  const code = product.short_code || product.id.slice(0, 4).toUpperCase();
  const buyBtn = buyNowButton({ text: `🛒 Buy ${product.name}`, url: `https://t.me/${botUser}?start=p_${code}` }, emojiMap);
  return { inline_keyboard: [[buyBtn]] };
}

const trackedFlashSaleProductMessages = new Map();

function flashProductMsgKey(chatId, messageId) {
  return `${chatId}:${messageId}`;
}

function trackFlashSaleProductMessage(chatId, messageId, productId) {
  if (!chatId || !messageId || !productId) return;
  trackedFlashSaleProductMessages.set(flashProductMsgKey(chatId, messageId), { chatId, messageId, productId });
}

function untrackFlashSaleProductMessage(chatId, messageId) {
  if (!chatId || !messageId) return;
  trackedFlashSaleProductMessages.delete(flashProductMsgKey(chatId, messageId));
}

function untrackChatFlashSaleProductMessages(chatId) {
  if (!chatId) return;
  const prefix = `${chatId}:`;
  for (const key of trackedFlashSaleProductMessages.keys()) {
    if (key.startsWith(prefix)) trackedFlashSaleProductMessages.delete(key);
  }
}

function firstCustomEmojiTag(text, fallback = "") {
  const match = String(text || "").match(/<tg-emoji\b[^>]*>[\s\S]*?<\/tg-emoji>/i);
  return match ? match[0] : fallback;
}

function customEmojiFromTemplateLine(template, label, fallback = "") {
  const line = String(template || "").split(/\n+/).find((part) => stripHtmlTags(part).toLowerCase().includes(String(label).toLowerCase()));
  return firstCustomEmojiTag(line || "", fallback);
}

async function pinFlashSaleMessages(messageIds) {
  if (!Array.isArray(messageIds)) return;
  for (const m of messageIds) {
    if (!m?.chat_id || !m?.message_id) continue;
    // Never pin flash-sale announcements in customer inboxes (private chats).
    // Positive Telegram chat IDs are private DMs; groups/supergroups are negative.
    if (Number(m.chat_id) > 0) continue;
    await tgActionWithRateLimit("pinChatMessage", { chat_id: m.chat_id, message_id: m.message_id, disable_notification: true }, {
      okIfDescriptionIncludes: ["message to pin not found", "not enough rights", "chat not found"],
    }).catch(() => {});
  }
}

async function markFlashSaleMessageRemoved(m) {
  const body = {
    chat_id: m.chat_id,
    message_id: m.message_id,
    text: "⏰ <b>Flash sale ended.</b>",
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [] },
  };
  const edited = await tgActionWithRateLimit("editMessageText", body, {
    okIfDescriptionIncludes: ["message is not modified", "message to edit not found", "message can't be edited", "chat not found", "bot was blocked"],
  }).catch((e) => ({ ok: false, description: e?.message || String(e) }));
  if (edited.ok) return edited;

  return tgActionWithRateLimit("editMessageReplyMarkup", {
    chat_id: m.chat_id,
    message_id: m.message_id,
    reply_markup: { inline_keyboard: [] },
  }, {
    okIfDescriptionIncludes: ["message is not modified", "message to edit not found", "message can't be edited", "chat not found", "bot was blocked"],
  }).catch((e) => ({ ok: false, description: e?.message || String(e) }));
}

async function deleteOrNeutralizeFlashSaleMessage(m) {
  if (!m?.chat_id || !m?.message_id) return { ok: true, skipped: true };
  const result = await tgActionWithRateLimit("deleteMessage", { chat_id: m.chat_id, message_id: m.message_id }, {
    okIfDescriptionIncludes: ["message to delete not found", "chat not found", "bot was blocked"],
  }).catch((e) => ({ ok: false, description: e?.message || String(e) }));
  if (result.ok) return result;

  const desc = String(result.description || result.response?.description || "").toLowerCase();
  if (desc.includes("message can't be deleted") || desc.includes("message cannot be deleted") || desc.includes("not enough rights")) {
    const neutralized = await markFlashSaleMessageRemoved(m);
    if (neutralized.ok) return { ok: true, neutralized: true, delete_error: desc };
  }
  return result;
}
async function unpinFlashSaleMessages(messageIds) {
  if (!Array.isArray(messageIds)) return;
  const failed = [];
  for (const m of messageIds) {
    if (!m?.chat_id || !m?.message_id) continue;
    const result = await tgActionWithRateLimit("unpinChatMessage", { chat_id: m.chat_id, message_id: m.message_id }, {
      okIfDescriptionIncludes: ["message to unpin not found", "message is not pinned", "not enough rights", "chat not found"],
    }).catch((e) => ({ ok: false, description: e?.message || String(e) }));
    if (!result.ok) failed.push({ ...m, error: result.description || result.response?.description || "unpin failed" });
  }
  return { ok: failed.length === 0, failed };
}

async function flashSaleTickerLoop() {
  while (true) {
    try {
      // Process pending deletes AFTER active sales so a slow/stuck delete (e.g. hundreds of
      // old messages that fail to delete) cannot block new flash-sale broadcasts.
      // Budget: only one pending-delete row per tick, and cap msg ops to avoid starving the loop.
      const { data: toDelete } = await supabase
        .from("bot_flash_sales")
        .select("*")
        .eq("pending_delete", true)
        .order("updated_at", { ascending: true })
        .limit(1);
      if (toDelete && toDelete.length > 0) {
        for (const sale of toDelete) {
          const allMsgs = Array.isArray(sale.announcement_messages) ? sale.announcement_messages : [];
          const PER_TICK_BUDGET = 50;
          const msgs = allMsgs.slice(0, PER_TICK_BUDGET);
          const remaining = allMsgs.slice(PER_TICK_BUDGET);
          const unpinResult = await unpinFlashSaleMessages(msgs).catch((e) => ({ ok: false, failed: [{ error: e?.message || String(e) }] }));
          const deleteFailed = [];
          for (const m of msgs) {
            const result = await deleteOrNeutralizeFlashSaleMessage(m);
            if (!result.ok) deleteFailed.push({ ...m, error: result.description || result.response?.description || "delete failed" });
          }
          // Drop successfully-processed messages; keep only remaining + still-failing ones.
          const stillFailing = deleteFailed.map((f) => ({ chat_id: f.chat_id, message_id: f.message_id }));
          const newAnnouncementMessages = [...stillFailing, ...remaining];
          // Force-give-up safety: if a pending_delete row has been retrying for > 30 min, just
          // drop the DB row so it doesn't block the loop forever.
          const stuckMs = Date.now() - new Date(sale.updated_at || sale.created_at || Date.now()).getTime();
          const giveUp = stuckMs > 30 * 60 * 1000;
          if (newAnnouncementMessages.length > 0 && !giveUp) {
            await supabase.from("bot_flash_sales").update({
              announcement_messages: newAnnouncementMessages,
              updated_at: new Date().toISOString(),
            }).eq("id", sale.id);
          } else {
            if (giveUp && newAnnouncementMessages.length > 0) {
              console.error("[FlashSale] giving up on stuck pending_delete", { saleId: sale.id, leftover: newAnnouncementMessages.length });
            }
            await supabase.from("bot_flash_sales").delete().eq("id", sale.id);
            if (ADMIN_CHAT_ID) {
              try { await sendMessage(ADMIN_CHAT_ID, `🗑️ <b>Flash Sale deleted</b>\n\nRemoved ${allMsgs.length - newAnnouncementMessages.length} broadcast message(s).`); } catch (_) {}
            }
          }
        }
      }
      const { data: active } = await supabase
        .from("bot_flash_sales")
        .select("*")
        .eq("is_active", true)
        .eq("pending_delete", false);
      if (active && active.length > 0) {
        for (const sale of active) {
          const expired = new Date(sale.ends_at).getTime() <= Date.now();
          const { data: product } = await supabase.from("bot_products").select("*").eq("id", sale.product_id).maybeSingle();
          if (!product) {
            await supabase.from("bot_flash_sales").update({ is_active: false }).eq("id", sale.id);
            continue;
          }
          // Auto-broadcast newly created sales (from web or any source) that haven't been broadcast yet
          if (!sale.broadcast_attempted && !expired) {
            try {
              await fetchPageMsgs(true);
              const annText = await buildFlashSaleMessage(sale, product, false);
              const broadcastKeyboard = await buildFlashSaleKeyboard(product);
              // target_group_ids semantics:
              //   null  → legacy "broadcast to everyone" (all customers + all groups)
              //   array → explicit selection. Sentinel `0` = include customer inbox (DMs);
              //           any other value = a specific group chat_id.
              let messageIds = [];
              if (!Array.isArray(sale.target_group_ids)) {
                ({ messageIds } = await broadcastToAll(annText, broadcastKeyboard));
              } else {
                const wantInbox = sale.target_group_ids.map(Number).includes(0);
                const groupIds = sale.target_group_ids.map(Number).filter((n) => !isNaN(n) && n !== 0);
                const targets = [];
                if (wantInbox) {
                  const { data: customers } = await supabase.from("bot_customers").select("chat_id");
                  if (customers) for (const c of customers) targets.push(Number(c.chat_id));
                }
                for (const g of groupIds) targets.push(g);
                if (targets.length === 0) {
                  console.log("[FlashSale] no targets selected, skipping broadcast for", sale.id);
                  messageIds = [];
                } else {
                  ({ messageIds } = await broadcastToChats(targets, annText, broadcastKeyboard));
                }
              }
              await supabase.from("bot_flash_sales").update({
                announcement_messages: messageIds,
                broadcast_attempted: true,
                updated_at: new Date().toISOString(),
              }).eq("id", sale.id);
              sale.announcement_messages = messageIds;
              sale.broadcast_attempted = true;
              // Auto-pin broadcast messages in groups only. Never pin customer inbox DMs.
              try { await pinFlashSaleMessages(messageIds); } catch (_) {}
              if (ADMIN_CHAT_ID) {
                try { await sendMessage(ADMIN_CHAT_ID, `🔥 <b>Flash Sale auto-broadcast</b>\n\n📦 ${escapeHtml(product.name)}\n💰 $${Number(sale.sale_price).toFixed(2)}\n📤 Sent to ${messageIds.length} chat(s)`); } catch (_) {}
              }
            } catch (e) {
              console.error("[FlashSale] auto-broadcast error:", e?.message || e);
            }
          }
          const text = await buildFlashSaleMessage(sale, product, expired);
          const replyMarkup = expired ? null : await buildFlashSaleKeyboard(product);
          const msgs = Array.isArray(sale.announcement_messages) ? sale.announcement_messages : [];
          // Parallel batched edits — sequential was too slow (~3min/tick for 400 msgs), breaking real-time countdown
          const BATCH = 25;
          for (let i = 0; i < msgs.length; i += BATCH) {
            const slice = msgs.slice(i, i + BATCH);
            await Promise.all(slice.map((m) =>
              editMessageText(m.chat_id, m.message_id, text, replyMarkup).catch(() => {})
            ));
          }
          if (expired) {
            // Auto-unpin all broadcast messages now that the sale is over
            await unpinFlashSaleMessages(msgs).catch(() => {});
            await supabase.from("bot_flash_sales").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", sale.id);
          }
        }
      }
      const trackedProductMessages = Array.from(trackedFlashSaleProductMessages.values());
      if (trackedProductMessages.length > 0) {
        const emojiMap = await loadButtonEmojis();
        for (const tracked of trackedProductMessages) {
          try {
            const { data: product } = await supabase.from("bot_products").select("*").eq("id", tracked.productId).maybeSingle();
            if (!product) { untrackFlashSaleProductMessage(tracked.chatId, tracked.messageId); continue; }
            const [{ data: tiers }, flashSale] = await Promise.all([
              supabase.from("bot_product_pricing").select("*").eq("product_id", tracked.productId).order("min_quantity"),
              getActiveFlashSale(tracked.productId),
            ]);
            const { data: trackedCust } = await supabase.from("bot_customers").select("id").eq("chat_id", tracked.chatId).maybeSingle();
            const { msg } = await buildProductDetailMessage(product, tiers || [], trackedCust?.id || null);
            const keyboard = buildProductDetailKeyboard(tracked.productId, emojiMap);
            const res = await editMessageText(tracked.chatId, tracked.messageId, msg, keyboard);
            if (!flashSale) { untrackFlashSaleProductMessage(tracked.chatId, tracked.messageId); continue; }
            if (!res?.ok && !res?.skipped) untrackFlashSaleProductMessage(tracked.chatId, tracked.messageId);
          } catch (_) {
            untrackFlashSaleProductMessage(tracked.chatId, tracked.messageId);
          }
        }
      }
    } catch (e) {
      console.error("[FlashSale] ticker error:", e?.message || e);
    }
    // Tick fast (1s) when any active sale is in its final 10 seconds, otherwise 5s
    let nextDelay = 5000;
    try {
      const { data: soon } = await supabase
        .from("bot_flash_sales")
        .select("ends_at")
        .eq("is_active", true)
        .eq("pending_delete", false);
      if (Array.isArray(soon) && soon.some((s) => {
        const ms = new Date(s.ends_at).getTime() - Date.now();
        return ms > 0 && ms <= 11000;
      })) nextDelay = 1000;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, nextDelay));
  }
}

// ── Recent Sales Feed helper ──
async function notifyRecentSale(productName, qty, productEmojiId = null) {
  try {
    const { data: setting } = await supabase
      .from("bot_settings").select("value").eq("key", "recent_sales_group_id").maybeSingle();
    const groupId = setting?.value && setting.value !== "" ? Number(setting.value) : null;
    if (!groupId) return;
    const icon = productEmojiId ? `<tg-emoji emoji-id="${productEmojiId}">📦</tg-emoji>` : "🛒";
    const vars = {
      product: `${icon} <b>${escapeHtml(productName)}</b>`,
      quantity: String(qty),
    };
    const tpl = cachedPageMsgs.msg_recent_sale ||
      `🛒 Someone just bought <b>{quantity}× {product}</b>`;
    await sendMessage(groupId, applyTemplate(tpl, vars));
  } catch (e) {
    console.error("[RecentSale] notify error:", e?.message || e);
  }
}

function stripCustomEmoji(html) {
  return html.replace(/<tg-emoji[^>]*>([^<]*)<\/tg-emoji>/g, "$1");
}

function stripHtmlTags(html) {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function stripCustomEmojiMarkup(html) {
  return String(html || "").replace(/<tg-emoji[^>]*>[^<]*<\/tg-emoji>/g, "");
}

function stripEmojiGlyphs(text) {
  return String(text || "")
    .replace(/[\u200d\ufe0f]/g, "")
    .replace(/(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function productSelectButton(product, label, callbackData) {
  const baseText = String(label || product?.name || "Product").trim();
  const btn = { text: product?.custom_emoji_id ? stripEmojiGlyphs(baseText) || baseText : baseText, callback_data: callbackData };
  if (product?.custom_emoji_id) btn.icon_custom_emoji_id = product.custom_emoji_id;
  return btn;
}

function simplifyTelegramHtml(text) {
  return stripHtmlTags(stripCustomEmoji(String(text || "")));
}

async function sendMessage(chatId, text, replyMarkup) {
  text = prepareTelegramHtml(text);
  const body = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const isChannel = Number(chatId) < 0 && String(chatId).startsWith("-100");
  const hasCustomEmoji = text.includes("<tg-emoji");
  let result = await tgFetch("sendMessage", body);
  if (!result?.ok) {
    const errDesc = String(result?.description || "").toLowerCase();
    // Surface channel + custom-emoji errors clearly so we can tell when Telegram
    // strips/rejects premium emoji due to insufficient channel boost level.
    if (isChannel && hasCustomEmoji) {
      console.log(`[Channel sendMessage] chat=${chatId} ok=${result?.ok} desc="${result?.description}"`);
    }
    // Only strip custom emoji if the error is specifically about custom emoji
    if (text.includes("<tg-emoji") && (errDesc.includes("custom emoji") || errDesc.includes("premium") || errDesc.includes("boost"))) {
      console.log("Retrying sendMessage without custom emoji tags (emoji error):", result?.description);
      body.text = stripCustomEmoji(text);
      result = await tgFetch("sendMessage", body);
    }
    // If still failing, try simplified plain text
    if (!result?.ok) {
      const plainText = simplifyTelegramHtml(body.text);
      if (plainText && plainText !== body.text) {
        console.log("Retrying sendMessage with simplified plain text:", result?.description);
        body.text = plainText;
        delete body.parse_mode;
        result = await tgFetch("sendMessage", body);
      }
    }
  }
  return result;
}

// Edit existing message, or send new if no messageId
async function editOrSend(chatId, messageId, text, replyMarkup) {
  if (messageId) return editMessageText(chatId, messageId, text, replyMarkup);
  return sendMessage(chatId, text, replyMarkup);
}

async function editMessageText(chatId, messageId, text, replyMarkup) {
  if (!messageId) {
    throw new Error("message_id is required to edit a Telegram message");
  }
  text = prepareTelegramHtml(text);
  const body = { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const isNotModified = (res) => !res?.ok && String(res?.description || "").toLowerCase().includes("message is not modified");
  try {
    let result = await tgFetch("editMessageText", body);
    if (isNotModified(result)) return { ok: true, skipped: true };

    if (!result?.ok) {
      const errDesc = String(result?.description || "").toLowerCase();
      if (text.includes("<tg-emoji") && (errDesc.includes("custom emoji") || errDesc.includes("premium"))) {
        console.log("Retrying editMessageText without custom emoji tags (emoji error):", result?.description);
        body.text = stripCustomEmoji(text);
        result = await tgFetch("editMessageText", body);
        if (isNotModified(result)) return { ok: true, skipped: true };
      }
    }

    if (!result?.ok) {
      const plainText = simplifyTelegramHtml(body.text);
      if (plainText && plainText !== body.text) {
        console.log("Retrying editMessageText with simplified plain text:", result?.description);
        body.text = plainText;
        delete body.parse_mode;
        result = await tgFetch("editMessageText", body);
      }
    }
    return result;
  } catch (e) {
    console.error("editMessageText error:", e.message);
    return { ok: false };
  }
}
async function deleteMessage(chatId, messageId) {
  try {
    return await tgFetch("deleteMessage", { chat_id: chatId, message_id: messageId });
  } catch (e) {
    console.error("deleteMessage error:", e.message);
    return { ok: false };
  }
}

async function sendPhoto(chatId, photoUrl, caption, replyMarkup) {
  const body = { chat_id: chatId, photo: photoUrl, parse_mode: "HTML" };
  if (caption) body.caption = caption;
  if (replyMarkup) body.reply_markup = replyMarkup;
  const result = await tgFetch("sendPhoto", body);
  if (!result?.ok && caption?.includes("<tg-emoji")) {
    console.log("Retrying sendPhoto without custom emoji tags");
    body.caption = stripCustomEmoji(caption);
    return tgFetch("sendPhoto", body);
  }
  return result;
}

async function sendVideo(chatId, videoUrl, caption, replyMarkup) {
  const body = { chat_id: chatId, video: videoUrl, parse_mode: "HTML" };
  if (caption) body.caption = caption;
  if (replyMarkup) body.reply_markup = replyMarkup;
  const result = await tgFetch("sendVideo", body);
  if (!result?.ok && caption?.includes("<tg-emoji")) {
    console.log("Retrying sendVideo without custom emoji tags");
    body.caption = stripCustomEmoji(caption);
    return tgFetch("sendVideo", body);
  }
  return result;
}

async function sendDocumentBuffer(chatId, fileBuffer, filename, caption, replyMarkup) {
  const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
  let preamble = "";
  preamble += `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`;
  if (caption) preamble += `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`;
  preamble += `--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nHTML\r\n`;
  if (replyMarkup) preamble += `--${boundary}\r\nContent-Disposition: form-data; name="reply_markup"\r\n\r\n${JSON.stringify(replyMarkup)}\r\n`;
  const prefix = Buffer.from(preamble + `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  const combined = Buffer.concat([prefix, fileBuffer, suffix]);

  const res = await fetch(`${TELEGRAM_API}/sendDocument`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: combined,
  });
  if (!res.ok) console.error("sendDocument failed:", await res.text());
}

function answerCallbackQuery(callbackQueryId, text) {
  tgFetch("answerCallbackQuery", { callback_query_id: callbackQueryId, text }).catch(() => {});
}

// In-memory dedupe set for confirm_buy callbacks (chat_id:data → expires after 15s)
const _recentConfirmBuy = new Set();

// ── Premium emoji helper ──

let _emojiCache = null;
let _emojiCacheTime = 0;

const BUTTON_EMOJI_TEXT_FALLBACKS = {};

async function loadButtonEmojis() {
  const now = Date.now();
  if (_emojiCache && now - _emojiCacheTime < 60000) return _emojiCache;
  const { data } = await supabase.from("bot_button_emojis").select("button_key, custom_emoji_id, style");
  const map = {};
  if (data) for (const row of data) {
    map[row.button_key] = { emoji: row.custom_emoji_id || null, style: row.style || null };
  }
  _emojiCache = map;
  _emojiCacheTime = now;
  return map;
}

function applyEmoji(button, emojiKey, emojiMap) {
  // Try exact key first, then fallback without "menu_" prefix
  let config = emojiMap[emojiKey];
  if (!config && emojiKey.startsWith("menu_")) {
    config = emojiMap[emojiKey.replace("menu_", "")];
  }
  if (config) {
    const result = { ...button };
    if (config.emoji) {
      const originalText = String(button.text || "");
      const cleanedText = stripEmojiGlyphs(stripCustomEmojiMarkup(stripHtmlTags(originalText))) || originalText;
      const textFallback = BUTTON_EMOJI_TEXT_FALLBACKS[emojiKey];
      result.text = textFallback && !cleanedText.startsWith(textFallback) ? `${textFallback} ${cleanedText}` : cleanedText;
      if (!textFallback) result.icon_custom_emoji_id = config.emoji;
    }
    // DB style overrides hardcoded style; if DB style is null, keep hardcoded
    if (config.style) result.style = config.style;
    return result;
  }
  return button;
}

function buyNowButton(button, emojiMap = {}) {
  const cleaned = stripEmojiGlyphs(stripCustomEmojiMarkup(stripHtmlTags(String(button.text || ""))).replace(/^🛒\s*/u, ""))
    .replace(/^Buy\s+/i, "")
    .replace(/\s*\((?:\d+|∞)\)\s*$/u, "")
    .trim();
  const text = cleaned && cleaned.toLowerCase() !== "now" ? `Buy ${cleaned}` : "Buy Now";
  return applyEmoji({ ...button, text, style: "primary" }, "buy_now", emojiMap);
}

async function normalizePurchaseBroadcastKeyboard(replyMarkup) {
  if (!replyMarkup?.inline_keyboard || !Array.isArray(replyMarkup.inline_keyboard)) return replyMarkup;
  const emojiMap = await loadButtonEmojis();
  return {
    ...replyMarkup,
    inline_keyboard: replyMarkup.inline_keyboard.map((row) => row.map((button) => {
      const data = String(button?.callback_data || "");
      const url = String(button?.url || "");
      const isPurchaseButton = data.startsWith("buy_") || data.startsWith("buynow_") || /[?&]start=p_/i.test(url);
      return isPurchaseButton ? buyNowButton(button, emojiMap) : button;
    })),
  };
}

function premiumEmojiText(fallback, emojiKey, emojiMap = {}) {
  const config = emojiMap[emojiKey] || (emojiKey.startsWith("menu_") ? emojiMap[emojiKey.replace("menu_", "")] : null);
  return config?.emoji ? `<tg-emoji emoji-id="${config.emoji}">${fallback}</tg-emoji>` : fallback;
}

// ── Utility helpers ──

function columnIndexToLetter(idx) {
  let result = "";
  let i = idx;
  while (i >= 0) {
    result = String.fromCharCode(65 + (i % 26)) + result;
    i = Math.floor(i / 26) - 1;
  }
  return result;
}

function isAdmin(chatId) {
  const adminChatId = envGet("ADMIN_CHAT_ID");
  return adminChatId ? String(chatId) === String(adminChatId) : false;
}

function getCustomerLabel(customer) {
  if (customer.username) return `@${customer.username}`;
  if (customer.first_name) return customer.first_name;
  return `#${customer.chat_id}`;
}

function notifyAdmin(text, replyMarkup) {
  const adminChatId = envGet("ADMIN_CHAT_ID");
  if (!adminChatId) return;
  sendMessage(Number(adminChatId), text, replyMarkup).catch(() => {});
}

async function resolvePendingDepositByShortId(depShortId) {
  const { data: pendingDeposits } = await supabase
    .from("bot_deposits")
    .select("id, txn_hash, customer_id, created_at, customer:bot_customers(*)")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(100);
  return pendingDeposits?.find((d) => d.id.startsWith(depShortId)) ?? null;
}

// ── Internal stock helpers ──

function base64UrlEncode(data) {
  const b = typeof data === "string" ? Buffer.from(data) : data;
  return b.toString("base64url");
}

let _stockCache = null;
let _stockCacheTime = 0;
const STOCK_CACHE_TTL = 120000; // 2 minutes

function clearStockCache() {
  _stockCache = null;
  _stockCacheTime = 0;
}

async function refreshSourceProductStock(product) {
  const fallbackStock = Number(product.last_known_stock || 0);
  if (!product.source_id || !product.source_product_id) return fallbackStock;

  const supabaseUrl = envGet("SUPABASE_URL");
  const serviceKey = envGet("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return fallbackStock;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/product-sources`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
        "apikey": serviceKey,
      },
      body: JSON.stringify({ action: "list", source_id: product.source_id }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload?.ok) throw new Error(payload?.error || `Source stock refresh failed (${res.status})`);

    const sourceProduct = (payload.products || []).find((p) => String(p.id) === String(product.source_product_id));
    if (!sourceProduct) return fallbackStock;

    const liveStock = Number(sourceProduct.stock || 0);
    product.last_known_stock = liveStock;
    clearStockCache();
    return liveStock;
  } catch (err) {
    console.error("Source stock refresh error:", err.message || err);
    return fallbackStock;
  }
}

async function getProductStock(product) {
  if (product.is_manual_delivery) return product.last_known_stock || 0;
  // Source-backed products: use cached last_known_stock (refresh via admin Sources tab).
  if (product.source_id) return product.last_known_stock || 0;
  const { count } = await supabase
    .from("bot_product_stock_items")
    .select("id", { count: "exact", head: true })
    .eq("product_id", product.id)
    .eq("status", "available");
  return count || 0;
}

async function getAllProductStocks(products, { force = false } = {}) {
  // Return from cache if fresh
  const now = Date.now();
  if (!force && _stockCache && _stockCache.length === products.length && now - _stockCacheTime < STOCK_CACHE_TTL) {
    return _stockCache;
  }

  const stockProducts = products.filter((p) => !p.is_manual_delivery && !p.source_id);
  const countEntries = await Promise.all(stockProducts.map(async (product) => {
    const { count, error } = await supabase
      .from("bot_product_stock_items")
      .select("id", { count: "exact", head: true })
      .eq("product_id", product.id)
      .eq("status", "available");
    if (error) {
      console.error(`Stock count failed for ${product.name}:`, error.message);
      return [product.id, product.last_known_stock || 0];
    }
    return [product.id, count || 0];
  }));
  const stockById = new Map(countEntries);

  const stocks = products.map((p) => {
    if (p.is_manual_delivery) return p.last_known_stock || 0;
    if (p.source_id) return p.last_known_stock || 0;
    return stockById.get(p.id) || 0;
  });
  _stockCache = stocks;
  _stockCacheTime = Date.now();
  return stocks;
}

// ── Tiered pricing ──

async function getCustomerSpecialPrice(customerId, productId, qty = 1) {
  if (!customerId || !productId) return null;
  const { data } = await supabase
    .from("bot_customer_pricing")
    .select("price, min_quantity, is_active")
    .eq("customer_id", customerId)
    .eq("product_id", productId)
    .maybeSingle();
  if (!data) return null;
  if (data.is_active === false) return null;
  const moq = Number(data.min_quantity || 1);
  if (qty < moq) return null;
  return Number(data.price);
}

// Returns special price info (without MOQ gating) for display purposes.
async function getCustomerSpecialPriceInfo(customerId, productId) {
  if (!customerId || !productId) return null;
  const { data } = await supabase
    .from("bot_customer_pricing")
    .select("price, min_quantity, is_active")
    .eq("customer_id", customerId)
    .eq("product_id", productId)
    .maybeSingle();
  if (!data) return null;
  if (data.is_active === false) return null;
  return { price: Number(data.price), minQuantity: Number(data.min_quantity || 1) };
}

async function getTieredPrice(productId, qty, fallbackPrice, customerId = null) {
  // Always charge the LOWEST applicable price among:
  //   base price, bulk/tier price (for current qty), customer special price, active flash sale.
  const flash = await getActiveFlashSale(productId);
  const special = await getCustomerSpecialPrice(customerId, productId, qty);

  const { data: tiers } = await supabase
    .from("bot_product_pricing").select("*").eq("product_id", productId).order("min_quantity");
  let tierPrice = null;
  if (tiers && tiers.length > 0) {
    for (const tier of tiers) {
      if (qty >= tier.min_quantity && (tier.max_quantity === null || qty <= tier.max_quantity)) {
        tierPrice = Number(tier.price);
        break;
      }
    }
    if (tierPrice === null) tierPrice = Number(tiers[tiers.length - 1].price);
  }

  const candidates = [Number(fallbackPrice)];
  if (tierPrice !== null) candidates.push(tierPrice);
  if (special !== null) candidates.push(Number(special));
  if (flash) candidates.push(Number(flash.sale_price));
  return Math.min(...candidates.filter((v) => Number.isFinite(v) && v >= 0));
}


// ── Admin launch token ──

async function signAdminLaunchToken(chatId) {
  const secret = envGet("SUPABASE_SERVICE_ROLE_KEY");
  const payload = { chat_id: chatId, exp: Math.floor(Date.now() / 1000) + 600 };
  const payloadBase64 = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(payloadBase64).digest("hex");
  return `${payloadBase64}.${sig}`;
}

// ── Keyboards ──

const MINI_APP_URL = process.env.MINI_APP_URL || "https://rexovaanshoppie.com";

function mainMenuKeyboard(emojiMap = null) {
  const map = emojiMap || _emojiCache || {};
  return {
    inline_keyboard: [
      [applyEmoji({ text: "🛍️ Open Mini App", web_app: { url: MINI_APP_URL } }, "menu_miniapp", map)],
      [applyEmoji({ text: "🛒 Shop", callback_data: "menu_shop" }, "menu_shop", map)],
      [applyEmoji({ text: "💳 Deposit", callback_data: "menu_deposit" }, "menu_deposit", map), applyEmoji({ text: "👤 My Profile", callback_data: "menu_profile" }, "menu_profile", map)],
      [applyEmoji({ text: "🆘 Support", callback_data: "menu_support" }, "menu_support", map)],
      [applyEmoji({ text: "🎁 Refer & Earn", callback_data: "menu_referral" }, "menu_referral", map)],
    ],
  };
}

// Remove any existing reply keyboard
function removeReplyKeyboard() {
  return { remove_keyboard: true };
}

// ── Customer ──

async function getOrCreateCustomer(chatId, firstName, username) {
  const { data: existing } = await supabase.from("bot_customers").select("*").eq("chat_id", chatId).single();
  if (existing) {
    // Update profile if changed
    const updates = {};
    if (firstName && firstName !== existing.first_name) updates.first_name = firstName;
    if (username && username !== existing.username) updates.username = username;
    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      await supabase.from("bot_customers").update(updates).eq("id", existing.id);
      Object.assign(existing, updates);
    }
    return existing;
  }
  const { data: created, error } = await supabase.from("bot_customers")
    .insert({ chat_id: chatId, first_name: firstName || null, username: username || null })
    .select().single();
  if (error) throw error;
  return created;
}

// ── Delivery ──

const MAX_MSG_LENGTH = 4000; // Telegram limit is 4096, keep margin
const BULK_DOWNLOAD_THRESHOLD = 20;

async function deliverOrderItems(chatId, product, orderDetails, orderId, headerInfo, emojiMap) {
  const qty = orderDetails.length;
  const detailKeys = Object.keys(orderDetails[0] || {});
  const isMultiCol = detailKeys.length > 1;
  // Check if product has only link-type data (single meaningful column)
  const isSingleValue = !isMultiCol || detailKeys.length === 1;

  const deliveredMsgIds = [];
  const trackSend = async (chatIdArg, text, replyMarkup) => {
    const res = await sendMessage(chatIdArg, text, replyMarkup);
    if (res?.ok && res?.result?.message_id) deliveredMsgIds.push(res.result.message_id);
    return res;
  };

  const formatItem = (item, idx) => {
    const entries = Object.entries(item).filter(([, v]) => v && String(v).trim());
    if (entries.length === 0) return `${idx + 1}. (empty)`;

    if (isSingleValue) {
      const mainVal = entries.find(([, v]) => String(v).startsWith('http'))?.[1] || entries[0]?.[1] || '';
      return `${idx + 1}. <code>${mainVal}</code>`;
    }

    // Multi-column: show each with header
    let lines = `${idx + 1}.`;
    for (const [key, val] of entries) {
      lines += `\n<b>${key}:</b> <code>${val}</code>`;
    }
    return lines;
  };
  const productEmojiTag = product.custom_emoji_id
    ? `<tg-emoji emoji-id="${product.custom_emoji_id}">📦</tg-emoji>`
    : "📦";
  const productHeader = `${productEmojiTag} <b>${product.name} × ${qty}</b>`;

  // Build all formatted items first
  const formattedItems = orderDetails.map((item, i) => formatItem(item, i));

  // Try to fit everything in one message with header
  const singleMsg = headerInfo + `\n${productHeader}\n\n` + formattedItems.join("\n") + "\n";
  if (singleMsg.length <= MAX_MSG_LENGTH) {
    await trackSend(chatId, singleMsg);
  } else {
    // Send header separately, then dynamically chunk items to fit within limit
    await trackSend(chatId, headerInfo);
    let itemNum = 0;
    while (itemNum < formattedItems.length) {
      let msg = `${productEmojiTag} <b>${product.name} (${itemNum + 1}-`;
      const headerTemplate = msg;
      let batchEnd = itemNum;
      let body = "";
      while (batchEnd < formattedItems.length) {
        const candidate = body + formattedItems[batchEnd] + "\n";
        const fullMsg = headerTemplate + `${batchEnd + 1} of ${qty}):</b>\n\n` + candidate;
        if (fullMsg.length > MAX_MSG_LENGTH && batchEnd > itemNum) break;
        body = candidate;
        batchEnd++;
      }
      msg = `${productEmojiTag} <b>${product.name} (${itemNum + 1}-${batchEnd} of ${qty}):</b>\n\n` + body;
      await trackSend(chatId, msg);
      itemNum = batchEnd;
    }
  }

  if (qty > BULK_DOWNLOAD_THRESHOLD) {
    await trackSend(chatId, `📁 Bulk order — download as file?`, {
      inline_keyboard: [
        [applyEmoji({ text: "📄 TXT", callback_data: `dl_txt_${orderId}` }, "download_txt", emojiMap),
         applyEmoji({ text: "📊 CSV", callback_data: `dl_csv_${orderId}` }, "download_csv", emojiMap)],
        [applyEmoji({ text: "❌ No thanks", callback_data: "cancel" }, "no_thanks", emojiMap)],
      ],
    });
  }

  if (product.delivery_instruction) {
    await trackSend(chatId, `📋 <b>Important Instructions:</b>\n\n${product.delivery_instruction}`);
  }

  let mediaItems = [];
  try { mediaItems = typeof product.delivery_media === "string" ? JSON.parse(product.delivery_media) : product.delivery_media || []; } catch {}
  for (const m of mediaItems) {
    if (m.type === "video") await sendVideo(chatId, m.url);
    else await sendPhoto(chatId, m.url);
  }

  // Persist delivery message IDs so admin can wipe them on refund
  if (orderId && deliveredMsgIds.length) {
    try {
      await supabase.from("bot_orders").update({ delivery_message_ids: deliveredMsgIds }).eq("id", orderId);
    } catch (e) { console.error("save delivery_message_ids failed:", e?.message || e); }
  }
}


// ── Admin Menu ──

async function showAdminMenu(chatId, emojiMap, editMessageId) {
  const launchToken = await signAdminLaunchToken(chatId);
  const webAppUrl = `https://www.rexovaan.com/admin?admin_launch=${encodeURIComponent(launchToken)}`;
  const [depRes, wdRes, pendDelRes] = await Promise.all([
    supabase.from("bot_deposits").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("bot_withdrawals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("bot_orders").select("id", { count: "exact", head: true }).eq("status", "pending_delivery"),
  ]);
  const pendingDeps = depRes.count || 0;
  const pendingWds = wdRes.count || 0;
  const pendingDel = pendDelRes.count || 0;
  const buttons = [
    [{ text: `📦 Products`, callback_data: "adm_products" }, { text: `📊 Stats`, callback_data: "adm_stats" }],
    [{ text: `💰 Deposits${pendingDeps > 0 ? ` (${pendingDeps})` : ""}`, callback_data: "adm_deposits" }, { text: `💸 Withdrawals${pendingWds > 0 ? ` (${pendingWds})` : ""}`, callback_data: "adm_withdrawals" }],
    [{ text: `⏳ Pending Deliveries${pendingDel > 0 ? ` (${pendingDel})` : ""}`, callback_data: "adm_pending_deliveries" }],
    [{ text: `👥 Customers`, callback_data: "adm_customers" }, { text: `📩 DM User`, callback_data: "adm_dm_user" }],
    [{ text: `📢 Broadcast`, callback_data: "adm_broadcast" }],
    [{ text: `🆕 New Product`, callback_data: "adm_newproduct" }, { text: `💱 Price Change`, callback_data: "adm_pricechange" }],
    [{ text: `🔥 Flash Sales`, callback_data: "adm_flashsales" }, { text: `📰 Sales Feed`, callback_data: "adm_salesfeed" }],
    [{ text: `👥 Groups`, callback_data: "adm_groups" }, { text: `🔑 Keywords`, callback_data: "adm_keywords" }],
    [{ text: `✨ Button Emojis`, callback_data: "adm_emojis" }, { text: `💳 Payment Emojis`, callback_data: "adm_pemojis" }],
    [{ text: `✏️ Edit Messages`, callback_data: "adm_editmsg" }, { text: `📋 Price List`, callback_data: "adm_pricelist" }],
    [{ text: `📢 Channel Join`, callback_data: "adm_channel_join" }, { text: `🎁 Refer Campaign`, callback_data: "adm_refcamp" }],
    [{ text: maintenanceMode ? "🟢 Maintenance OFF" : "🔴 Maintenance ON", callback_data: "adm_maintenance" }],
    [applyEmoji({ text: "🖥️ Open Web Dashboard", web_app: { url: webAppUrl } }, "admin_panel", emojiMap)],
  ];
  await editOrSend(chatId, editMessageId, `🔐 <b>Admin Panel</b>\n\nSelect an option:`, { inline_keyboard: buttons });
}

// ── Shop ──

async function showShop(chatId, emojiMap, editMessageId, forceRefresh = false) {
  // Send loading message immediately for first-time users (no editMessageId = fresh shop click)
  let loadingMsgId = null;
  if (!editMessageId && (forceRefresh || !_stockCache || Date.now() - _stockCacheTime >= STOCK_CACHE_TTL)) {
    const loadingResp = await sendMessage(chatId, "⏳ <b>Loading products...</b>");
    loadingMsgId = loadingResp?.result?.message_id;
  }

  const { data: products } = await supabase.from("bot_products").select("*").eq("is_active", true).order("sort_order");
  if (!products || products.length === 0) {
    if (loadingMsgId) await deleteMessage(chatId, loadingMsgId).catch(() => {});
    await sendMessage(chatId, "No products available right now.", mainMenuKeyboard());
    return;
  }

  const stocks = await getAllProductStocks(products, { force: forceRefresh });
  const msg = getPageMsg("msg_shop", "🛒 <b>Available Products:</b>");
  const buttons = [];
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const stock = stocks[i];
    const stockNum = stock === "∞" ? 999 : parseInt(stock) || 0;
    const stockDisplay = p.is_manual_delivery ? "" : ` (${stock === "∞" ? "∞" : stock})`;
    const label = `${p.name}${stockDisplay}`;
    const btn = productSelectButton(p, label, `buy_${p.id}`);
    buttons.push([btn]);
  }
  buttons.push([applyEmoji({ text: "🔄 Refresh", callback_data: "refresh_shop" }, "refresh_stock", emojiMap)]);
  buttons.push([applyEmoji({ text: "◀️ Back", callback_data: "menu_main" }, "back", emojiMap)]);

  if (editMessageId) {
    await editMessageText(chatId, editMessageId, msg, { inline_keyboard: buttons });
  } else if (loadingMsgId) {
    // Replace loading message with actual shop
    await editMessageText(chatId, loadingMsgId, msg, { inline_keyboard: buttons });
  } else {
    await sendMessage(chatId, msg, { inline_keyboard: buttons });
  }
}

// ── Balance ──

async function showBalance(chatId, customer, emojiMap = {}, editMessageId = null) {
  const { data: fresh } = await supabase.from("bot_customers").select("balance").eq("id", customer.id).single();
  const rawBalance = fresh ? Number(fresh.balance) : 0;
  const balance = rawBalance < 0
    ? `Due ${Math.abs(rawBalance).toFixed(2)}`
    : rawBalance.toFixed(2);
  const defaultBalMsg = rawBalance < 0
    ? `⚠️ <b>You have a due amount:</b> <b>{balance} USDT</b>\n\nPlease deposit to clear your due.`
    : `💰 <b>Your Balance:</b> {balance} USDT`;
  const balMsg = replacePlaceholder(getPageMsg("msg_balance", defaultBalMsg), 'balance', balance);
  const msg = balMsg;
  const buttons = {
    inline_keyboard: [
      [applyEmoji({ text: "💳 Deposit", callback_data: "menu_deposit" }, "menu_deposit", emojiMap), applyEmoji({ text: "💸 Withdraw", callback_data: "menu_withdraw" }, "menu_withdraw", emojiMap)],
      [applyEmoji({ text: "◀️ Back", callback_data: "menu_profile" }, "back", emojiMap)],
    ],
  };
  if (editMessageId) await editMessageText(chatId, editMessageId, msg, buttons);
  else await sendMessage(chatId, msg, buttons);
}

// ── My Profile ──

async function showProfile(chatId, customer, emojiMap = {}, editMessageId = null) {
  const { data: fresh } = await supabase.from("bot_customers").select("balance, created_at, pay_later_enabled, pay_later_limit, pay_later_used").eq("id", customer.id).single();
  const rawBalance = fresh ? Number(fresh.balance) : 0;
  const balance = rawBalance < 0
    ? `Due ${Math.abs(rawBalance).toFixed(2)}`
    : rawBalance.toFixed(2);
  const joinedDate = fresh?.created_at ? new Date(fresh.created_at).toISOString().split("T")[0] : "N/A";

  // Premium emoji helper for profile text
  function e(fallback, key) {
    const cfg = emojiMap[key] || (key.startsWith("menu_") ? emojiMap[key.replace("menu_", "")] : null);
    if (cfg?.emoji) return `<tg-emoji emoji-id="${cfg.emoji}">${fallback}</tg-emoji>`;
    return fallback;
  }

  const balanceLabel = rawBalance < 0 ? "Due" : "Balance";
  let profileMsg = `${e("👤", "menu_profile")} <b>User Profile</b>\n\n🆔 <b>ID:</b> {id}\n${e("💰", "menu_balance")} <b>${balanceLabel}:</b> {balance} USDT\n📅 <b>Joined:</b> {joined}`;

  // Pay Later credit info
  if (fresh?.pay_later_enabled) {
    const plLimit = Number(fresh.pay_later_limit);
    const plUsed = Number(fresh.pay_later_used);
    const plAvailable = Math.max(0, plLimit - plUsed);
    profileMsg += `\n\n🏷️ <b>Pay Later</b>\n💳 Limit: <b>${plLimit.toFixed(2)} USDT</b>\n📊 Used: <b>${plUsed.toFixed(2)} USDT</b>\n✅ Available: <b>${plAvailable.toFixed(2)} USDT</b>`;
  }

  const defaultProfileMsg = profileMsg;
  const msg = replacePlaceholders(getPageMsg("msg_profile", defaultProfileMsg), {
    "{id}": customer.chat_id,
    "{balance}": balance,
    "{joined}": joinedDate,
  });

  const buttons = {
    inline_keyboard: [
      [applyEmoji({ text: "📊 My Stats", callback_data: "profile_stats" }, "profile_stats", emojiMap)],
      [applyEmoji({ text: "🔔 Notifications", callback_data: "profile_notifications" }, "profile_notifications", emojiMap)],
      [applyEmoji({ text: "🧾 My Orders", callback_data: "menu_orders" }, "profile_orders", emojiMap), applyEmoji({ text: "💸 Withdraw", callback_data: "menu_withdraw" }, "menu_withdraw", emojiMap)],
      [applyEmoji({ text: "🛢️ Developer API", callback_data: "api_dashboard" }, "developer_api", emojiMap)],
      [applyEmoji({ text: "◀️ Back", callback_data: "menu_main" }, "back", emojiMap)],
    ],
  };
  await editOrSend(chatId, editMessageId, msg, buttons);
}

// ── Developer API ──

function generateResellerApiKey() {
  return `rsk_live_${crypto.randomBytes(32).toString("hex")}`;
}

function hashApiKey(apiKey) {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

function getApiKeyCipherKey() {
  return crypto.createHash("sha256").update(envGet("SUPABASE_SERVICE_ROLE_KEY") || envGet("BOT_TOKEN") || "api-key-fallback").digest();
}

function encryptApiKey(apiKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getApiKeyCipherKey(), iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

function decryptApiKey(encryptedValue) {
  try {
    if (!encryptedValue) return null;
    const [ivRaw, tagRaw, dataRaw] = String(encryptedValue).split(".");
    if (!ivRaw || !tagRaw || !dataRaw) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", getApiKeyCipherKey(), Buffer.from(ivRaw, "base64"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataRaw, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function getResellerApiBase() {
  const url = envGet("SUPABASE_URL").replace(/\/$/, "");
  return url ? `${url}/functions/v1/reseller-api` : "https://eygkdpfjrjwwbiackfpr.supabase.co/functions/v1/reseller-api";
}

async function getCustomerReseller(customerId) {
  const { data } = await supabase
    .from("bot_resellers")
    .select("id,name,balance,api_key_prefix,api_key_encrypted,is_active,created_at,updated_at")
    .eq("customer_id", customerId)
    .maybeSingle();
  return data || null;
}

async function showDeveloperApi(chatId, customer, emojiMap = {}, editMessageId = null, extraText = "") {
  const reseller = await getCustomerReseller(customer.id);
  const apiBase = getResellerApiBase();
  let totalOrders = 0;
  let totalSpent = 0;
  let recentOrders = [];

  if (reseller) {
    const [{ count }, { data: orders }] = await Promise.all([
      supabase.from("bot_reseller_orders").select("id", { count: "exact", head: true }).eq("reseller_id", reseller.id),
      supabase.from("bot_reseller_orders").select("product_name,quantity,total_cost,created_at,status").eq("reseller_id", reseller.id).order("created_at", { ascending: false }).limit(3),
    ]);
    totalOrders = count || 0;
    recentOrders = orders || [];
    totalSpent = recentOrders.reduce((sum, order) => sum + Number(order.total_cost || 0), 0);
  }

  const status = reseller?.is_active ? "🟢 Active" : "🔴 No active key";
  const balance = reseller ? Number(customer.balance || 0).toFixed(2) : "0.00";
  const fullApiKey = reseller?.is_active ? decryptApiKey(reseller.api_key_encrypted) : null;
  const keyLine = reseller?.is_active
    ? `\n${premiumEmojiText("🔑", "api_key", emojiMap)} <b>API Key:</b> ${fullApiKey ? `<tg-spoiler>${escapeHtml(fullApiKey)}</tg-spoiler>` : `<code>${escapeHtml(reseller.api_key_prefix)}</code>`}`
    : "";
  const recentText = recentOrders.length
    ? "\n\n<b>Recent API Orders</b>\n" + recentOrders.map((order) => `• ${escapeHtml(order.product_name)} × ${order.quantity} — ${Number(order.total_cost || 0).toFixed(2)} USDT`).join("\n")
    : "";

  const msg = `${extraText ? `${extraText}\n\n` : ""}${premiumEmojiText("🛢️", "api_title", emojiMap)} <b>Reseller Product API</b>\n\n` +
    `Use this API to sell our products from your own website or bot. Orders will be delivered from our stock and cost will be deducted from your API balance.\n\n` +
    `${premiumEmojiText("📶", "api_status", emojiMap)} <b>Status:</b> ${status}\n` +
    `${premiumEmojiText("💰", "api_balance", emojiMap)} <b>API Balance:</b> ${balance} USDT${keyLine}\n` +
    `${premiumEmojiText("📦", "api_orders", emojiMap)} <b>Total API Orders:</b> ${totalOrders}\n` +
    `${premiumEmojiText("💸", "api_spend", emojiMap)} <b>Recent Spend:</b> ${totalSpent.toFixed(2)} USDT\n\n` +
    `${fullApiKey ? `Tap the hidden key to reveal/copy it.\n\n` : ""}` +
    `<b>Available actions</b>\n` +
    `• Product list: <code>GET /?action=products</code>\n` +
    `• Balance check: <code>GET /?action=balance</code>\n` +
    `• Place order: <code>POST /?action=order</code>\n\n` +
    `<b>Endpoint URL</b>\n<code>${escapeHtml(apiBase)}</code>` +
    recentText;

  const buttons = { inline_keyboard: [] };
  if (reseller?.is_active) {
    buttons.inline_keyboard.push([applyEmoji({ text: "🗑️ Delete API Key", callback_data: "api_delete_confirm" }, "api_delete", emojiMap)]);
  } else {
    buttons.inline_keyboard.push([applyEmoji({ text: "🔑 Generate New API Key", callback_data: "api_generate" }, "api_generate", emojiMap)]);
  }
  buttons.inline_keyboard.push([applyEmoji({ text: "📘 View API Documentation", callback_data: "api_docs" }, "api_docs", emojiMap)]);
  buttons.inline_keyboard.push([applyEmoji({ text: "🔄 Refresh", callback_data: "api_dashboard" }, "refresh", emojiMap)]);
  buttons.inline_keyboard.push([applyEmoji({ text: "◀️ Back", callback_data: "menu_profile" }, "back", emojiMap)]);

  await editOrSend(chatId, editMessageId, msg, buttons);
}

async function generateCustomerApiKey(chatId, customer, emojiMap = {}, editMessageId = null) {
  const apiKey = generateResellerApiKey();
  const apiKeyHash = hashApiKey(apiKey);
  const apiKeyEncrypted = encryptApiKey(apiKey);
  const apiKeyPrefix = `${apiKey.slice(0, 13)}...${apiKey.slice(-4)}`;
  const name = customer.username ? `@${customer.username}` : (customer.first_name || `User ${customer.chat_id}`);
  const existing = await getCustomerReseller(customer.id);

  if (existing) {
    await supabase.from("bot_resellers").update({ name, api_key_hash: apiKeyHash, api_key_encrypted: apiKeyEncrypted, api_key_prefix: apiKeyPrefix, is_active: true }).eq("id", existing.id);
  } else {
    await supabase.from("bot_resellers").insert({ customer_id: customer.id, name, balance: 0, api_key_hash: apiKeyHash, api_key_encrypted: apiKeyEncrypted, api_key_prefix: apiKeyPrefix, is_active: true });
  }

  const apiBase = getResellerApiBase();
  const msg = `${premiumEmojiText("✅", "api_generate", emojiMap)} <b>Reseller Product API Key Generated</b>

` +
    `Use this key from your own website or bot to fetch products, check balance, and place stock orders. Copy and save it now; it will not be shown again.

` +
    `${premiumEmojiText("🔑", "api_key", emojiMap)} <b>API Key</b>
<tg-spoiler>${apiKey}</tg-spoiler>

` +
    `<b>Endpoint URL</b>
<code>${escapeHtml(apiBase)}</code>`;

  await editOrSend(chatId, editMessageId, msg, {
    inline_keyboard: [
      [applyEmoji({ text: "📘 API Documentation", callback_data: "api_docs" }, "api_docs", emojiMap)],
      [applyEmoji({ text: "🛢️ Dashboard", callback_data: "api_dashboard" }, "api_dashboard", emojiMap)],
    ],
  });
}

async function deleteCustomerApiKey(chatId, customer, emojiMap = {}, editMessageId = null) {
  const reseller = await getCustomerReseller(customer.id);
  if (!reseller) {
    await showDeveloperApi(chatId, customer, emojiMap, editMessageId);
    return;
  }

  const deletedHash = hashApiKey(`deleted:${reseller.id}:${Date.now()}:${crypto.randomBytes(12).toString("hex")}`);
  await supabase.from("bot_resellers").update({ api_key_hash: deletedHash, api_key_encrypted: null, api_key_prefix: "Deleted", is_active: false }).eq("id", reseller.id);
  await showDeveloperApi(chatId, customer, emojiMap, editMessageId, `${premiumEmojiText("✅", "api_delete", emojiMap)} <b>API key deleted.</b>`);
}

async function showApiDocs(chatId, customer, emojiMap = {}, editMessageId = null) {
  const apiBase = getResellerApiBase();
  const msg = `${premiumEmojiText("📘", "api_docs", emojiMap)} <b>Reseller Product API Documentation</b>

` +
    `This API is for selling our products from your own website or bot. You set your own selling price on your side; this API only charges your wholesale cost from your API balance.\n\n` +
    `<b>Authentication</b>
Use your API key as Bearer token.
<code>Authorization: Bearer YOUR_API_KEY</code>

` +
    `<b>Products</b>
<code>GET ${escapeHtml(apiBase)}?action=products</code>

` +
    `<b>Balance</b>
<code>GET ${escapeHtml(apiBase)}?action=balance</code>

` +
    `<b>Create Order</b>
<code>POST ${escapeHtml(apiBase)}?action=order</code>

` +
    `<b>Order JSON</b>
<pre>{
  "product_id": "PRODUCT_ID",
  "quantity": 1,
  "external_order_id": "YOUR_ORDER_ID"
}</pre>`;

  await editOrSend(chatId, editMessageId, msg, {
    inline_keyboard: [[applyEmoji({ text: "🛢️ Back to API Dashboard", callback_data: "api_dashboard" }, "api_dashboard", emojiMap)]],
  });
}

// ── My Stats ──

async function showMyStats(chatId, customer, emojiMap = {}, editMessageId = null) {
  const { data: orders } = await supabase.from("bot_orders").select("quantity, total_price, created_at").eq("customer_id", customer.id).eq("status", "completed");
  const totalOrders = orders ? orders.length : 0;
  const totalItems = orders ? orders.reduce((s, o) => s + o.quantity, 0) : 0;
  const totalSpent = orders ? orders.reduce((s, o) => s + Number(o.total_price), 0) : 0;

  const { data: deposits } = await supabase.from("bot_deposits").select("amount").eq("customer_id", customer.id).eq("status", "verified");
  const totalDeposits = deposits ? deposits.length : 0;
  const totalDeposited = deposits ? deposits.reduce((s, d) => s + Number(d.amount), 0) : 0;

  const { data: withdrawals } = await supabase.from("bot_withdrawals").select("amount, status").eq("customer_id", customer.id);
  const completedWithdrawals = withdrawals ? withdrawals.filter(w => w.status === "completed") : [];
  const totalWithdrawn = completedWithdrawals.reduce((s, w) => s + Number(w.amount), 0);
  const pendingWithdrawals = withdrawals ? withdrawals.filter(w => w.status === "pending").length : 0;

  const { data: referrals } = await supabase.from("bot_referrals").select("id").eq("referrer_id", customer.id);
  const totalReferrals = referrals ? referrals.length : 0;

  const { data: custData } = await supabase.from("bot_customers").select("referral_total_earned, referral_balance").eq("id", customer.id).single();
  const refEarned = custData ? Number(custData.referral_total_earned).toFixed(2) : "0.00";
  const refBalance = custData ? Number(custData.referral_balance).toFixed(2) : "0.00";

  let lastOrderDate = "N/A";
  if (orders && orders.length > 0) {
    const sorted = orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    lastOrderDate = new Date(sorted[0].created_at).toISOString().split("T")[0];
  }

  // Helper: render emoji as premium tg-emoji if available in emojiMap, else fallback
  function e(fallback, key) {
    const cfg = emojiMap[key] || (key.startsWith("menu_") ? emojiMap[key.replace("menu_", "")] : null);
    if (cfg?.emoji) return `<tg-emoji emoji-id="${cfg.emoji}">${fallback}</tg-emoji>`;
    return fallback;
  }

  const msg = `${e("📊", "profile_stats")} <b>Your Stats</b>\n\n` +
    `${e("🛒", "menu_shop")} <b>Orders:</b> ${totalOrders}\n` +
    `📦 <b>Items Bought:</b> ${totalItems}\n` +
    `💸 <b>Total Spent:</b> ${totalSpent.toFixed(2)} USDT\n` +
    `📅 <b>Last Order:</b> ${lastOrderDate}\n\n` +
    `${e("💳", "menu_deposit")} <b>Deposits:</b> ${totalDeposits} (${totalDeposited.toFixed(2)} USDT)\n` +
    `${e("💸", "menu_withdraw")} <b>Withdrawn:</b> ${totalWithdrawn.toFixed(2)} USDT\n` +
    `⏳ <b>Pending Withdrawals:</b> ${pendingWithdrawals}\n\n` +
    `${e("🎁", "menu_referral")} <b>Referrals:</b> ${totalReferrals}\n` +
    `💰 <b>Referral Earned:</b> ${refEarned} USDT\n` +
    `🏦 <b>Referral Balance:</b> ${refBalance} USDT`;

  const buttons = {
    inline_keyboard: [
      [applyEmoji({ text: "🔄 Refresh", callback_data: "profile_stats" }, "refresh", emojiMap)],
      [applyEmoji({ text: "◀️ Back", callback_data: "menu_profile" }, "back", emojiMap)],
    ],
  };
  await editOrSend(chatId, editMessageId, msg, buttons);
}

// ── Notification Settings ──

async function getNotifSettings(customerId) {
  const { data } = await supabase.from("bot_notification_settings").select("*").eq("customer_id", customerId).maybeSingle();
  if (data) return data;
  // Create default settings
  const { data: created } = await supabase.from("bot_notification_settings").insert({ customer_id: customerId }).select().single();
  return created || { stock_alerts: true, info_alerts: true, referral_bonus: true };
}

async function showNotifications(chatId, customer, emojiMap = {}, editMessageId = null) {
  const settings = await getNotifSettings(customer.id);
  const on = "ON ✅";
  const off = "OFF ❌";

  let msg = getPageMsg("msg_notifications", `🔔 <b>Notifications</b>\n\nCustomize your notification preferences:`);
  const buttons = {
    inline_keyboard: [
      [applyEmoji({ text: `📦 Stock Alerts: ${settings.stock_alerts ? on : off}`, callback_data: "notif_toggle_stock" }, "notif_stock", emojiMap)],
      [applyEmoji({ text: `ℹ️ Info Alerts: ${settings.info_alerts ? on : off}`, callback_data: "notif_toggle_info" }, "notif_info", emojiMap)],
      [applyEmoji({ text: `🎁 Referral Bonus: ${settings.referral_bonus ? on : off}`, callback_data: "notif_toggle_referral" }, "notif_referral", emojiMap)],
      [applyEmoji({ text: "◀️ Back", callback_data: "menu_profile" }, "back", emojiMap)],
    ],
  };
  await editOrSend(chatId, editMessageId, msg, buttons);
}



let cachedRefSettings = { commission: 2, firstBonus: 0.50 };
let refSettingsLastFetch = 0;

async function getRefSettings() {
  if (Date.now() - refSettingsLastFetch > 60000) {
    try {
      const { data } = await supabase.from("bot_settings").select("key, value").in("key", ["referral_commission_percent", "referral_first_bonus"]);
      if (data) {
        for (const s of data) {
          if (s.key === "referral_commission_percent") cachedRefSettings.commission = parseFloat(s.value) || 2;
          if (s.key === "referral_first_bonus") cachedRefSettings.firstBonus = parseFloat(s.value) || 0.50;
        }
      }
      refSettingsLastFetch = Date.now();
    } catch (e) { console.error("Failed to fetch ref settings:", e); }
  }
  return cachedRefSettings;
}

// ── Join-reward referral campaign (admin toggleable) ──
// NOTE: This ONLY controls the limited-time join bonus.
// The existing first-purchase bonus + commission % system is permanent and always active.
let cachedCampaign = {
  active: false,
  reward: 0.1,
  message: "",
  buttonText: "",
  buttonEmoji: "",
  buttonEmojiId: "",
  groupButtonEmoji: "",
  groupButtonEmojiId: "",
  groupButtonText: "",
  groupButtonStyle: "primary",
};
let campaignLastFetch = 0;

async function getCampaignSettings(force = false) {
  if (force || Date.now() - campaignLastFetch > 30000) {
    try {
      const { data } = await supabase.from("bot_settings").select("key, value").in("key", [
        "referral_campaign_active",
        "referral_campaign_reward",
        "referral_campaign_message",
        "referral_campaign_button_text",
        "referral_campaign_button_emoji",
        "referral_campaign_button_emoji_id",
        "referral_campaign_group_button_emoji",
        "referral_campaign_group_button_emoji_id",
        "referral_campaign_group_button_text",
        "referral_campaign_group_button_style",
      ]);
      if (data) {
        const map = Object.fromEntries(data.map(r => [r.key, r.value]));
        cachedCampaign.active = String(map.referral_campaign_active || "").toLowerCase() === "true";
        const rew = parseFloat(map.referral_campaign_reward);
        if (Number.isFinite(rew) && rew >= 0) cachedCampaign.reward = rew;
        cachedCampaign.message = String(map.referral_campaign_message || "");
        cachedCampaign.buttonText = String(map.referral_campaign_button_text || "");
        cachedCampaign.buttonEmoji = String(map.referral_campaign_button_emoji || "");
        cachedCampaign.buttonEmojiId = String(map.referral_campaign_button_emoji_id || "");
        cachedCampaign.groupButtonEmoji = String(map.referral_campaign_group_button_emoji || "");
        cachedCampaign.groupButtonEmojiId = String(map.referral_campaign_group_button_emoji_id || "");
        cachedCampaign.groupButtonText = String(map.referral_campaign_group_button_text || "");
        const style = String(map.referral_campaign_group_button_style || "").toLowerCase();
        cachedCampaign.groupButtonStyle = ["primary","success","danger"].includes(style) ? style : "primary";
      }

      campaignLastFetch = Date.now();
    } catch (e) { console.error("Failed to fetch campaign settings:", e); }
  }
  return cachedCampaign;
}

function generateReferralCode(chatId) {
  // Create a short alphanumeric code from chat_id
  const hash = crypto.createHash("md5").update(String(chatId)).digest("hex");
  return hash.slice(0, 8).toLowerCase();
}

async function processReferralCommission(buyerCustomerId, orderTotal, orderId) {
  try {
    const refSettings = await getRefSettings();
    const { data, error } = await supabase.rpc("process_referral_commission_atomic", {
      _buyer_customer_id: buyerCustomerId,
      _order_total: Number(orderTotal) || 0,
      _order_id: orderId || null,
      _commission_percent: Number(refSettings.commission) || 0,
      _first_bonus_amount: Number(refSettings.firstBonus) || 0,
    });
    if (error) { console.error("Referral RPC error:", error); return; }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || !row.referrer_id) return;

    const commission = Number(row.commission_credited) || 0;
    const firstBonus = Number(row.first_bonus_credited) || 0;
    const newBal = Number(row.new_referral_balance) || 0;
    const chatId = row.referrer_chat_id;

    if (commission > 0 && chatId) {
      sendMessage(chatId, `💰 <b>Referral Commission!</b>\n\nYou earned <b>${commission.toFixed(2)} USDT</b> from a referral's purchase.\nAvailable Referral Balance: <b>${newBal.toFixed(2)} USDT</b>`).catch(() => {});
    }
    if (firstBonus > 0 && chatId) {
      sendMessage(chatId, `🎉 <b>First Purchase Bonus!</b>\n\nYou earned an extra <b>${firstBonus.toFixed(2)} USDT</b> because your referral made their first purchase!\nAvailable Referral Balance: <b>${newBal.toFixed(2)} USDT</b>`).catch(() => {});
    }
  } catch (err) {
    console.error("Referral commission error:", err);
  }
}


async function showReferralMenu(chatId, customer, emojiMap = {}, editMessageId = null) {
  const [{ data: fresh }, refSettings] = await Promise.all([
    supabase.from("bot_customers").select("referral_balance, referral_total_earned, referral_transferred").eq("id", customer.id).single(),
    getRefSettings(),
  ]);
  const refBalance = fresh ? Number(fresh.referral_balance) : 0;
  const totalEarned = fresh ? Number(fresh.referral_total_earned) : 0;
  const transferred = fresh ? Number(fresh.referral_transferred) : 0;

  // Count referrals
  const now = new Date();
  const day24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const day7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [{ count: total }, { count: last24h }, { count: last7d }] = await Promise.all([
    supabase.from("bot_referrals").select("id", { count: "exact", head: true }).eq("referrer_id", customer.id),
    supabase.from("bot_referrals").select("id", { count: "exact", head: true }).eq("referrer_id", customer.id).gte("created_at", day24h),
    supabase.from("bot_referrals").select("id", { count: "exact", head: true }).eq("referrer_id", customer.id).gte("created_at", day7d),
  ]);

  const refCode = generateReferralCode(customer.chat_id);
  const botUser = await getBotUsername();
  const referralLink = `https://t.me/${botUser}?start=ref_${refCode}`;

  const defaultRefMsg = `🎁 <b>Refer & Earn</b>\n\n👥 Referred (24h): {ref_24h}\n👥 Referred (7d): {ref_7d}\n👥 Referred (Total): {ref_total}\n\n💰 Total Earned: <b>{earned} USDT</b>\n💵 Available: <b>{available} USDT</b>\n🔄 Transferred: <b>{transferred} USDT</b>\n\n<blockquote>Earn <b>{commission}%</b> of every purchase/deposit by your referred users.\n<b>+${refSettings.firstBonus.toFixed(2)}</b> bonus on their first purchase.\n\nTransfer earnings to wallet anytime.</blockquote>\n\n<b>Your Referral Link:</b>\n<code>{link}</code>`;
  let msg = replacePlaceholders(getPageMsg("msg_referral", defaultRefMsg), {
    "{ref_24h}": last24h || 0,
    "{ref_7d}": last7d || 0,
    "{ref_total}": total || 0,
    "{earned}": totalEarned.toFixed(2),
    "{available}": refBalance.toFixed(2),
    "{transferred}": transferred.toFixed(2),
    "{commission}": refSettings.commission,
    "{bonus}": refSettings.firstBonus.toFixed(2),
    "{link}": referralLink,
  });

  const buttons = {
    inline_keyboard: [
      [applyEmoji({ text: "📋 Copy Referral Link", callback_data: "ref_copy", style: "primary" }, "ref_copy", emojiMap)],
      [applyEmoji({ text: "💰 Transfer to Wallet", callback_data: "ref_transfer" }, "ref_transfer", emojiMap)],
      [applyEmoji({ text: "◀️ Back", callback_data: "menu_main" }, "back", emojiMap)],
    ],
  };

  if (editMessageId) await editMessageText(chatId, editMessageId, msg, buttons);
  else await sendMessage(chatId, msg, buttons);
}

// ── Deposit ──

async function showDepositInfo(chatId, emojiMap, editMessageId) {
  const { data: methods } = await supabase.from("bot_payment_methods").select("*").eq("is_active", true).order("sort_order");

  if (methods && methods.length > 0) {
    const buttons = [];
    for (const m of methods) {
      const btn = { text: `${m.emoji} ${m.name}`, callback_data: `dpm_${m.id.slice(0, 8)}` };
      if (m.custom_emoji_id) {
        const stripped = String(btn.text).replace(/^(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})\uFE0F?\s*/u, "");
        btn.text = stripped || btn.text;
        btn.icon_custom_emoji_id = m.custom_emoji_id;
        buttons.push([btn]);
      } else {
        buttons.push([applyEmoji(btn, "deposit_method", emojiMap)]);
      }
    }
    buttons.push([applyEmoji({ text: "◀️ Back", callback_data: "menu_main" }, "back", emojiMap)]);
    const msg = getPageMsg("msg_deposit", `💳 <b>Deposit USDT</b>\n\n💡 You can send <b>any amount</b> — it will be added to your balance.\n\nSelect a payment method below:`);
    if (editMessageId) await editMessageText(chatId, editMessageId, msg, { inline_keyboard: buttons });
    else await sendMessage(chatId, msg, { inline_keyboard: buttons });
    return;
  }

  // Fallback
  const walletAddress = envGet("USDT_WALLET_ADDRESS") || "Not configured";
  const binanceId = envGet("BINANCE_ID") || "Not configured";
  const bybitUid = envGet("BYBIT_UID") || "Not configured";
  const trc20Address = envGet("USDT_TRC20_ADDRESS") || "Not configured";
  const tonAddress = envGet("USDT_TON_ADDRESS") || "Not configured";
  const ltcAddress = envGet("LTC_ADDRESS") || "Not configured";

  await sendMessage(chatId,
    `💳 <b>Deposit USDT</b>\n\n` +
    `💡 You can send <b>any amount</b> — it will be added to your balance.\n\n` +
    `<b>Binance ID:</b>\n<code>${binanceId}</code>\n<i>👆 Tap to copy</i>\n\n` +
    `<b>Bybit UID:</b>\n<code>${bybitUid}</code>\n<i>👆 Tap to copy</i>\n\n` +
    `<b>USDT BEP20:</b>\n<code>${walletAddress}</code>\n<i>👆 Tap to copy</i>\n\n` +
    `<b>USDT TRC20:</b>\n<code>${trc20Address}</code>\n<i>👆 Tap to copy</i>\n\n` +
    `<b>USDT TON:</b>\n<code>${tonAddress}</code>\n<i>👆 Tap to copy</i>\n\n` +
    `<b>LTC:</b>\n<code>${ltcAddress}</code>\n<i>👆 Tap to copy</i>\n` +
    `<i>💡 LTC auto-converts to USDT at market rate.</i>\n\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `After sending, paste your <b>Transaction Hash (TxID)</b> or <b>Order ID</b> here and we'll verify it <b>automatically</b>.`,
    mainMenuKeyboard()
  );
}

async function showDepositPaymentDetails(chatId, methodId, emojiMap, editMessageId) {
  const { data: method } = await supabase.from("bot_payment_methods").select("*").eq("id", methodId).single();
  if (!method) return;

  let paymentInfo = method.payment_details;
  const envVal = envGet(method.payment_details);
  if (envVal) paymentInfo = envVal;

  const binanceId = envGet("BINANCE_ID") || null;
  const bybitUid = envGet("BYBIT_UID") || null;
  const walletAddress = envGet("USDT_WALLET_ADDRESS") || null;
  const trc20Address = envGet("USDT_TRC20_ADDRESS") || null;
  const tonAddress = envGet("USDT_TON_ADDRESS") || null;
  const ltcAddress = envGet("LTC_ADDRESS") || null;

  const methodEmojiTag = method.custom_emoji_id
    ? `<tg-emoji emoji-id="${method.custom_emoji_id}">${method.emoji}</tg-emoji>`
    : method.emoji;
  let msg = `${methodEmojiTag} <b>${method.name}</b>\n\n`;
  msg += `💡 You can send <b>any amount</b> — it will be added to your balance.\n\n━━━━━━━━━━━━━━━━\n\n`;

  const paymentType = method.payment_type?.toLowerCase() || "";
  const methodName = method.name?.toLowerCase() || "";

  if (methodName.includes("bkash") || methodName.includes("বিকাশ") || paymentType === "bkash") {
    const bdtRate = await getDollarRateBDT();
    msg += `📱 <b>bKash Payment</b>\n\n`;
    msg += `📊 <b>Dollar Rate:</b> 1 USD = <b>${bdtRate} BDT</b>\n`;
    msg += `<i>💡 Example: $10 = ৳${(10 * bdtRate).toLocaleString()}</i>\n`;
    if (method.instruction) msg += `\n📋 <b>Instructions:</b>\n${method.instruction}\n`;
    msg += `\n━━━━━━━━━━━━━━━━\n`;
    msg += `💡 Enter the amount in BDT (e.g. <code>500</code>).\nYou will receive a bKash payment link.`;

    // Set pending action for bkash deposit amount input
    const { data: cust } = await supabase.from("bot_customers").select("id").eq("chat_id", chatId).single();
    if (cust) {
      await supabase.from("bot_customers").update({ pending_action: `bkash_deposit_amount` }).eq("id", cust.id);
    }
  } else if (methodName.includes("binance") || paymentType === "binance") {
    msg += `🏦 <b>Binance Pay / Internal Transfer</b>\n\n`;
    msg += binanceId ? `<b>Binance ID:</b>\n<code>${binanceId}</code>\n<i>👆 Tap to copy</i>\n` : `<code>${paymentInfo}</code>\n<i>👆 Tap to copy</i>\n`;
  } else if (methodName.includes("bybit") || paymentType === "bybit") {
    msg += `🏦 <b>Bybit Pay / Internal Transfer</b>\n\n`;
    msg += bybitUid ? `<b>Bybit UID:</b>\n<code>${bybitUid}</code>\n<i>👆 Tap to copy</i>\n` : `<code>${paymentInfo}</code>\n<i>👆 Tap to copy</i>\n`;
  } else if (methodName.includes("trc20") || paymentType === "trc20") {
    msg += `🔗 <b>USDT TRC20 Address:</b>\n<code>${trc20Address || paymentInfo}</code>\n<i>👆 Tap to copy</i>\n`;
  } else if (methodName.includes("ton") || paymentType === "ton") {
    msg += `💎 <b>USDT TON Address:</b>\n<code>${tonAddress || paymentInfo}</code>\n<i>👆 Tap to copy</i>\n`;
  } else if (methodName.includes("ltc") || methodName.includes("litecoin") || paymentType === "ltc") {
    msg += `🪙 <b>LTC Address:</b>\n<code>${ltcAddress || paymentInfo}</code>\n<i>👆 Tap to copy</i>\n`;
    try {
      const rateRes = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=LTCUSDT");
      if (rateRes.ok) {
        const rateData = await rateRes.json();
        const ltcPrice = parseFloat(rateData.price);
        if (ltcPrice > 0) {
          msg += `\n📊 <b>Current Rate:</b> 1 LTC = <b>${ltcPrice.toFixed(2)} USDT</b>\n`;
          msg += `<i>💡 Example: 10 USDT = ~${(10 / ltcPrice).toFixed(6)} LTC</i>\n`;
        }
      }
    } catch {}
    msg += `\n<i>💡 LTC will be auto-converted to USDT at current market rate.</i>\n`;
  } else if (methodName.includes("usdt") || methodName.includes("bep20") || paymentType === "wallet") {
    msg += `🔗 <b>Wallet Address:</b>\n<code>${paymentInfo}</code>\n<i>👆 Tap to copy</i>\n`;
    if (walletAddress && paymentInfo !== walletAddress) msg += `\n🔗 <b>USDT BEP20 Address:</b>\n<code>${walletAddress}</code>\n<i>👆 Tap to copy</i>\n`;
  } else {
    msg += `💳 <b>Payment Details:</b>\n<code>${paymentInfo}</code>\n<i>👆 Tap to copy</i>\n`;
  }

  if (!(methodName.includes("bkash") || methodName.includes("বিকাশ") || paymentType === "bkash")) {
    if (method.instruction) msg += `\n📋 <b>Instructions:</b>\n${method.instruction}\n`;
    msg += `\n━━━━━━━━━━━━━━━━\nAfter sending, paste your <b>Transaction Hash (TxID)</b> or <b>Order ID</b> here and we'll verify it <b>automatically</b>.`;
  }

  const buttons = { inline_keyboard: [[applyEmoji({ text: "◀️ Back", callback_data: "dep_back" }, "back", emojiMap)]] };
  if (editMessageId) await editMessageText(chatId, editMessageId, msg, buttons);
  else await sendMessage(chatId, msg, buttons);
}

// ── Blockchain verification ──

async function verifyBinanceTransfer(orderId, apiKey, apiSecret) {
  const normalizedOrderId = String(orderId || "").trim();
  const timestamp = Date.now();
  const recvWindow = 20000;
  const startTime = timestamp - 2 * 60 * 60 * 1000; // look back 2 hours

  function sign(queryString) {
    return crypto.createHmac("sha256", apiSecret).update(queryString).digest("hex");
  }

  function matchesBinanceId(...values) {
    return values.some((value) => {
      const str = String(value || "").trim();
      if (!str) return false;
      if (str === normalizedOrderId) return true;
      // Off-chain transfers come as "Off-chain transfer 363149952714" — extract trailing digits
      const trailingDigits = str.match(/(\d{6,})\s*$/);
      if (trailingDigits && trailingDigits[1] === normalizedOrderId) return true;
      // Also match if the order ID appears anywhere as a whole number in the string
      const re = new RegExp(`(^|\\D)${normalizedOrderId}(\\D|$)`);
      return re.test(str);
    });
  }

  const STABLECOINS = new Set(["USDT", "USDC", "FDUSD", "BUSD", "DAI", "TUSD", "USDP"]);

  async function coinToUsdt(coin, amount) {
    const c = String(coin || "").toUpperCase();
    const amt = parseFloat(amount) || 0;
    if (!c || amt <= 0) return amt;
    if (STABLECOINS.has(c)) return amt;
    try {
      const r = await fetchWithTimeout(`https://api.binance.com/api/v3/ticker/price?symbol=${c}USDT`);
      if (r.ok) {
        const d = await r.json();
        const p = parseFloat(d?.price);
        if (p > 0) return amt * p;
      }
    } catch (_) {}
    return amt;
  }

  function isSuccessfulRecord(record) {
    return record?.status === 1;
  }

  // 1) Check deposit history (on-chain + off-chain deposits)
  try {
    const q1 = `startTime=${startTime}&recvWindow=${recvWindow}&timestamp=${timestamp}`;
    const res = await fetchWithTimeout(`https://api.binance.com/sapi/v1/capital/deposit/hisrec?${q1}&signature=${sign(q1)}`, {
      headers: { "X-MBX-APIKEY": apiKey },
    });
    if (res.ok) {
      const deposits = await res.json();
      if (Array.isArray(deposits)) {
        for (const d of deposits) {
          if (!isSuccessfulRecord(d)) continue;
          if (!matchesBinanceId(d.id, d.txId)) continue;

          const isInternal = d.transferType === 0 || String(d.txId || "").toLowerCase().includes("internal");
          const coin = String(d.coin || "USDT").toUpperCase();
          const network = normalizeBinanceNetwork(d.network);
          const via = isInternal
            ? `${coin} Binance Internal Transfer`
            : `${coin} ${network || "Binance"}${network ? " Network" : ""}`;
          const usdtAmount = await coinToUsdt(coin, d.amount);
          console.log(`Binance verified via deposit history: ${d.amount} ${coin} = ${usdtAmount.toFixed(4)} USDT (id=${d.id}, txId=${d.txId}, network=${d.network}, via=${via})`);
          return { verified: true, amount: usdtAmount, via, network };
        }

        if (/^\d{8,}$/.test(normalizedOrderId)) {
          console.log(`Binance deposit history: no exact match for ${normalizedOrderId}; skipped unsafe internal fallback`);
        }
      }
    } else {
      console.error("Binance deposit check HTTP", res.status, await res.text().catch(() => ""));
    }
  } catch (e) { console.error("Binance deposit check error:", e.message); }

  // 2) Check Binance Pay transactions (UID-to-UID transfers appear here)
  try {
    const q2 = `startTimestamp=${startTime}&recvWindow=${recvWindow}&timestamp=${timestamp}`;
    const payRes = await fetchWithTimeout(`https://api.binance.com/sapi/v1/pay/transactions?${q2}&signature=${sign(q2)}`, {
      headers: { "X-MBX-APIKEY": apiKey },
    });
    if (payRes.ok) {
      const payData = await payRes.json();
      if (payData.data && Array.isArray(payData.data)) {
        for (const t of payData.data) {
          const matchedField = [
            ["orderId", t.orderId],
            ["orderNo", t.orderNo],
            ["transactionId", t.transactionId],
            ["bizId", t.bizId],
          ].find(([, value]) => matchesBinanceId(value));

          if (!matchedField) continue;

          const coin = String(t.currency || "USDT").toUpperCase();
          const rawAmt = Math.abs(parseFloat(t.amount));
          const usdtAmount = await coinToUsdt(coin, rawAmt);
          console.log(`Binance verified via pay transactions: ${rawAmt} ${coin} = ${usdtAmount.toFixed(4)} USDT (matched ${matchedField[0]}=${normalizedOrderId})`);
          return { verified: true, amount: usdtAmount, via: `${coin} Binance Pay` };
        }
      }
    } else {
      console.error("Binance Pay check HTTP", payRes.status, await payRes.text().catch(() => ""));
    }
  } catch (e) { console.error("Binance Pay check error:", e.message); }

  // 3) Check C2C transfer history (internal UID transfers)
  try {
    const q3 = `startDate=${startTime}&recvWindow=${recvWindow}&timestamp=${timestamp}`;
    const c2cRes = await fetchWithTimeout(`https://api.binance.com/sapi/v1/c2c/orderMatch/listUserOrderHistory?${q3}&signature=${sign(q3)}`, {
      headers: { "X-MBX-APIKEY": apiKey },
    });
    if (c2cRes.ok) {
      const c2cData = await c2cRes.json();
      if (c2cData.data && Array.isArray(c2cData.data)) {
        for (const t of c2cData.data) {
          if (String(t.orderNumber) === String(orderId)) {
            const coin = String(t.asset || "USDT").toUpperCase();
            const usdtAmount = await coinToUsdt(coin, t.totalPrice || t.amount);
            return { verified: true, amount: usdtAmount, via: `${coin} Binance C2C` };
          }
        }
      }
    }
  } catch (e) { console.error("Binance C2C check error:", e.message); }

  // 4) Check internal transfer history (between own accounts)
  try {
    for (const tType of ["MAIN_MAIN", "MAIN_FUNDING", "FUNDING_MAIN"]) {
      const q4 = `type=${tType}&startTime=${startTime}&recvWindow=${recvWindow}&timestamp=${timestamp}`;
      const uRes = await fetchWithTimeout(`https://api.binance.com/sapi/v1/asset/transfer?${q4}&signature=${sign(q4)}`, {
        headers: { "X-MBX-APIKEY": apiKey },
      });
      if (uRes.ok) {
        const uData = await uRes.json();
        if (uData.rows && Array.isArray(uData.rows)) {
          for (const t of uData.rows) {
            if (String(t.tranId) === String(orderId)) {
              const coin = String(t.asset || "USDT").toUpperCase();
              const usdtAmount = await coinToUsdt(coin, t.amount);
              return { verified: true, amount: usdtAmount, via: `${coin} Binance Transfer` };
            }
          }
        }
      }
    }
  } catch (e) { console.error("Binance internal transfer check error:", e.message); }

  // 5) Check sub-account transfer (if applicable)
  try {
    const q5 = `startTime=${startTime}&recvWindow=${recvWindow}&timestamp=${timestamp}`;
    const subRes = await fetchWithTimeout(`https://api.binance.com/sapi/v1/sub-account/transfer/subUserHistory?${q5}&signature=${sign(q5)}`, {
      headers: { "X-MBX-APIKEY": apiKey },
    });
    if (subRes.ok) {
      const subData = await subRes.json();
      if (Array.isArray(subData)) {
        for (const t of subData) {
          if (String(t.tranId) === String(orderId)) {
            const coin = String(t.asset || "USDT").toUpperCase();
            const usdtAmount = await coinToUsdt(coin, t.qty || t.amount);
            return { verified: true, amount: usdtAmount, via: `${coin} Binance Sub` };
          }
        }
      }
    }
  } catch (e) { /* sub-account might not be enabled, ignore */ }

  return { verified: false, amount: 0 };
}

async function verifyBep20Transfer(txnHash) {
  const walletAddress = envGet("USDT_WALLET_ADDRESS")?.trim().toLowerCase();
  if (!walletAddress) { console.log("BEP20 verify skipped: USDT_WALLET_ADDRESS not set"); return { verified: false, amount: 0 }; }

  const normalizedHash = String(txnHash || "").trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalizedHash)) {
    console.log(`BEP20 verify skipped: invalid tx hash format ${normalizedHash}`);
    return { verified: false, amount: 0 };
  }

  const usdtContract = "0x55d398326f99059ff775485246999027b3197955";
  const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const rpcUrls = [
    "https://bsc-dataseed.binance.org/",
    "https://bsc-rpc.publicnode.com",
  ];

  for (const rpcUrl of rpcUrls) {
    try {
      const res = await fetchWithTimeout(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_getTransactionReceipt",
          params: [normalizedHash],
          id: 1,
        }),
      });

      if (!res.ok) {
        console.error(`BEP20 RPC HTTP error from ${rpcUrl}:`, res.status);
        continue;
      }

      const data = await res.json();
      if (data?.error) {
        console.error(`BEP20 RPC error from ${rpcUrl}:`, data.error?.message || JSON.stringify(data.error));
        continue;
      }

      const receipt = data?.result;
      if (!receipt || receipt.status !== "0x1" || !Array.isArray(receipt.logs)) continue;

      for (const log of receipt.logs) {
        if (log.address?.toLowerCase() !== usdtContract) continue;
        if (log.topics?.[0] !== transferTopic || !log.topics?.[2]) continue;

        const to = `0x${String(log.topics[2]).slice(-40).toLowerCase()}`;
        if (to !== walletAddress) continue;

        const rawAmount = BigInt(log.data || "0x0");
        const amount = Number(rawAmount) / 1e18;
        if (amount > 0) {
          console.log(`BEP20 verified via RPC (${rpcUrl}): ${amount} USDT`);
          return { verified: true, amount };
        }
      }
    } catch (e) {
      console.error(`BEP20 RPC verify error from ${rpcUrl}:`, e.message);
    }
  }

  console.log(`BEP20 verify: no match for ${normalizedHash}`);
  return { verified: false, amount: 0 };
}

async function verifyTrc20Transfer(txnHash) {
  const walletAddress = envGet("USDT_TRC20_ADDRESS")?.trim();
  if (!walletAddress) { console.log("TRC20 verify skipped: USDT_TRC20_ADDRESS not set"); return { verified: false, amount: 0 }; }
  const usdtContract = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
  
  // Method 1: Tronscan API
  try {
    const res = await fetchWithTimeout(`https://apilist.tronscanapi.com/api/transaction-info?hash=${txnHash}`);
    if (res.ok) {
      const data = await res.json();
      // Check trc20TransferInfo array
      if (data.trc20TransferInfo && Array.isArray(data.trc20TransferInfo)) {
        for (const t of data.trc20TransferInfo) {
          if (t.contract_address === usdtContract && t.to_address?.toLowerCase() === walletAddress.toLowerCase() && data.confirmed) {
            const amount = parseFloat(t.amount_str) / 1e6;
            if (amount > 0) { console.log(`TRC20 verified: ${amount} USDT`); return { verified: true, amount }; }
          }
        }
      }
      // Fallback: check contractData
      if (data.contractData && data.confirmed) {
        const toAddr = data.contractData.to_address || data.toAddress;
        if (toAddr?.toLowerCase() === walletAddress.toLowerCase()) {
          const contractAddr = data.contractData.contract_address || data.contract_address;
          if (contractAddr === usdtContract) {
            const amt = parseFloat(data.contractData.amount) / 1e6;
            if (amt > 0) { console.log(`TRC20 verified via contractData: ${amt} USDT`); return { verified: true, amount: amt }; }
          }
        }
      }
    } else {
      console.error("TRC20 tronscan API error:", res.status);
    }
  } catch (e) { console.error("TRC20 tronscan error:", e.message); }

  // Method 2: TronGrid API (fallback)
  try {
    const res2 = await fetchWithTimeout(`https://api.trongrid.io/v1/transactions/${txnHash}/events`);
    if (res2.ok) {
      const data2 = await res2.json();
      if (data2.data && Array.isArray(data2.data)) {
        for (const evt of data2.data) {
          if (evt.contract_address === usdtContract && evt.event_name === "Transfer") {
            const toAddr = evt.result?.to || evt.result?.["1"];
            if (toAddr) {
              // TronGrid might return hex addresses; compare case-insensitively
              const toHex = toAddr.toLowerCase();
              const walletHex = walletAddress.toLowerCase();
              if (toHex === walletHex || toHex.endsWith(walletHex.slice(-34))) {
                const rawAmt = evt.result?.value || evt.result?.["2"] || "0";
                const amt = parseFloat(rawAmt) / 1e6;
                if (amt > 0) { console.log(`TRC20 verified via TronGrid: ${amt} USDT`); return { verified: true, amount: amt }; }
              }
            }
          }
        }
      }
    }
  } catch (e) { console.error("TRC20 TronGrid fallback error:", e.message); }

  console.log(`TRC20 verify: no match for ${txnHash}`);
  return { verified: false, amount: 0 };
}

async function verifyTonTransfer(txnHash) {
  const walletAddress = envGet("USDT_TON_ADDRESS")?.trim();
  if (!walletAddress) { console.log("TON verify skipped: USDT_TON_ADDRESS not set"); return { verified: false, amount: 0 }; }
  const walletLower = walletAddress.toLowerCase();

  // Helper to match TON addresses (suffix matching for different formats)
  function addressMatch(addr) {
    if (!addr) return false;
    const addrLower = addr.toLowerCase();
    return addrLower === walletLower || addrLower.endsWith(walletLower.slice(-48)) || walletLower.endsWith(addrLower.slice(-48));
  }

  try {
    // Method 1: tonapi.io (best for USDT Jetton transfers)
    const res2 = await fetchWithTimeout(`https://tonapi.io/v2/blockchain/transactions/${txnHash}`, { headers: { "Content-Type": "application/json" } });
    if (res2.ok) {
      const tx2 = await res2.json();
      // Check out_msgs for jetton transfers
      if (tx2.out_msgs) {
        for (const msg of tx2.out_msgs) {
          if (msg.decoded_op_name === "jetton_transfer" || msg.decoded_op_name === "transfer" || msg.decoded_op_name === "internal_transfer") {
            const dest = msg.destination?.address || "";
            if (addressMatch(dest)) {
              if (msg.decoded_body?.amount) {
                const amt = parseInt(msg.decoded_body.amount) / 1e6;
                if (amt > 0) { console.log(`TON verified via tonapi out_msgs: ${amt} USDT`); return { verified: true, amount: amt }; }
              }
            }
          }
        }
      }
      // Check actions for jetton transfer events
      if (tx2.actions) {
        for (const action of tx2.actions) {
          if (action.type === "JettonTransfer" && action.JettonTransfer) {
            const jt = action.JettonTransfer;
            if (addressMatch(jt.recipient?.address)) {
              const amt = parseInt(jt.amount || "0") / 1e6;
              if (amt > 0) { console.log(`TON verified via tonapi actions: ${amt} USDT`); return { verified: true, amount: amt }; }
            }
          }
        }
      }
      // Check in_msg for direct TON transfer
      if (tx2.in_msg && addressMatch(tx2.in_msg.destination?.address)) {
        const value = parseInt(tx2.in_msg.value || "0") / 1e9;
        if (value > 0) { console.log(`TON verified via tonapi in_msg (native TON): ${value}`); return { verified: true, amount: value }; }
      }
    } else {
      console.error("TON tonapi HTTP error:", res2.status);
    }
  } catch (e) { console.error("TON tonapi verify error:", e.message); }

  try {
    // Method 2: toncenter fallback (native TON)
    const res = await fetchWithTimeout(`https://toncenter.com/api/v3/transactions?hash=${txnHash}&limit=1`);
    if (res.ok) {
      const data = await res.json();
      if (data.transactions && data.transactions.length > 0) {
        const tx = data.transactions[0];
        const checkMsg = (msg) => {
          const dest = (msg?.destination?.address || "").toLowerCase();
          if (addressMatch(dest)) {
            const value = parseInt(msg.value || "0") / 1e9;
            if (value > 0) return { verified: true, amount: value };
          }
          return null;
        };
        for (const msg of tx.out_msgs || []) { const r = checkMsg(msg); if (r) { console.log(`TON verified via toncenter out_msg: ${r.amount}`); return r; } }
        if (tx.in_msg) { const r = checkMsg(tx.in_msg); if (r) { console.log(`TON verified via toncenter in_msg: ${r.amount}`); return r; } }
      }
    }
  } catch (e) { console.error("TON toncenter verify error:", e.message); }

  console.log(`TON verify: no match for ${txnHash}`);
  return { verified: false, amount: 0 };
}

async function verifyLtcTransfer(txnHash) {
  const walletAddress = envGet("LTC_ADDRESS")?.trim();
  if (!walletAddress) { console.log("LTC verify skipped: LTC_ADDRESS not set"); return { verified: false, amount: 0, ltcAmount: 0 }; }
  
  // Method 1: BlockCypher
  try {
    const res = await fetchWithTimeout(`https://api.blockcypher.com/v1/ltc/main/txs/${txnHash}`);
    if (res.ok) {
      const tx = await res.json();
      if (tx.confirmations < 1) { console.log("LTC: tx not yet confirmed"); return { verified: false, amount: 0, ltcAmount: 0 }; }
      let ltcAmount = 0;
      for (const output of tx.outputs || []) {
        if (output.addresses && output.addresses.some((a) => a.toLowerCase() === walletAddress.toLowerCase())) {
          ltcAmount += output.value / 1e8;
        }
      }
      if (ltcAmount > 0) {
        const usdtAmount = await convertLtcToUsdt(ltcAmount);
        if (usdtAmount > 0) { console.log(`LTC verified: ${ltcAmount} LTC = ${usdtAmount} USDT`); return { verified: true, amount: usdtAmount, ltcAmount }; }
      }
    } else {
      console.error("LTC BlockCypher error:", res.status);
    }
  } catch (e) { console.error("LTC BlockCypher error:", e.message); }

  // Method 2: Blockchair fallback
  try {
    const res2 = await fetchWithTimeout(`https://api.blockchair.com/litecoin/dashboards/transaction/${txnHash}`);
    if (res2.ok) {
      const data2 = await res2.json();
      const txData = data2.data?.[txnHash];
      if (txData && txData.transaction?.block_id > 0) {
        let ltcAmount = 0;
        for (const out of txData.outputs || []) {
          if (out.recipient?.toLowerCase() === walletAddress.toLowerCase()) {
            ltcAmount += out.value / 1e8;
          }
        }
        if (ltcAmount > 0) {
          const usdtAmount = await convertLtcToUsdt(ltcAmount);
          if (usdtAmount > 0) { console.log(`LTC verified via Blockchair: ${ltcAmount} LTC = ${usdtAmount} USDT`); return { verified: true, amount: usdtAmount, ltcAmount }; }
        }
      }
    }
  } catch (e) { console.error("LTC Blockchair fallback error:", e.message); }

  console.log(`LTC verify: no match for ${txnHash}`);
  return { verified: false, amount: 0, ltcAmount: 0 };
}

async function convertLtcToUsdt(ltcAmount) {
  try {
    const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=LTCUSDT");
    if (res.ok) { const data = await res.json(); const price = parseFloat(data.price); if (price > 0) return ltcAmount * price; }
  } catch {}
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=usd");
    if (res.ok) { const data = await res.json(); if (data.litecoin?.usd) return ltcAmount * data.litecoin.usd; }
  } catch {}
  return 0;
}

async function verifyBybitTransfer(orderId, apiKey, apiSecret) {
  const normalizedOrderId = String(orderId || "").trim();
  const recvWindow = "20000";

  function freshBybitSign(queryString) {
    const ts = String(Date.now());
    const preSign = `${ts}${apiKey}${recvWindow}${queryString}`;
    const sign = crypto.createHmac("sha256", apiSecret).update(preSign).digest("hex");
    return { ts, sign };
  }

  function hasSuccessStatus(value) {
    const status = String(value || "").toUpperCase();
    return status === "SUCCESS" || status === "2" || status === "3" || status === "4" || status === "COMPLETED";
  }

  function matchBybitId(...values) {
    return values.some((value) => String(value || "").trim() === normalizedOrderId);
  }

  // 1) Check internal transfers (between own accounts or UID transfers)
  try {
    const qs = `coin=USDT&limit=50&transferId=${encodeURIComponent(normalizedOrderId)}`;
    const { ts, sign } = freshBybitSign(qs);
    const res = await fetchWithTimeout(`https://api.bybit.com/v5/asset/transfer/query-inter-transfer-list?${qs}`, {
      headers: { "X-BAPI-API-KEY": apiKey, "X-BAPI-TIMESTAMP": ts, "X-BAPI-RECV-WINDOW": recvWindow, "X-BAPI-SIGN": sign },
    });
    if (res.ok) {
      const data = await res.json();
      console.log(`Bybit inter-transfer response: retCode=${data.retCode}, list=${data.result?.list?.length || 0}`);
      if (data.retCode === 0 && data.result?.list) {
        for (const t of data.result.list) {
          if (matchBybitId(t.transferId, t.transferID, t.id) && hasSuccessStatus(t.status)) {
            const coin = String(t.coin || "USDT").toUpperCase();
            console.log(`Bybit verified via inter-transfer: ${t.amount} ${coin}`);
            return { verified: true, amount: parseFloat(t.amount), via: `${coin} Bybit Transfer` };
          }
        }
      }
    } else {
      console.error("Bybit inter-transfer HTTP error:", res.status, await res.text().catch(() => ""));
    }
  } catch (e) { console.error("Bybit internal transfer check error:", e.message); }

  // 2) Check on-chain deposit records (by txID filter)
  try {
    const qs2 = `coin=USDT&limit=50&txID=${encodeURIComponent(normalizedOrderId)}`;
    const { ts: ts2, sign: sign2 } = freshBybitSign(qs2);
    const res2 = await fetchWithTimeout(`https://api.bybit.com/v5/asset/deposit/query-record?${qs2}`, {
      headers: { "X-BAPI-API-KEY": apiKey, "X-BAPI-TIMESTAMP": ts2, "X-BAPI-RECV-WINDOW": recvWindow, "X-BAPI-SIGN": sign2 },
    });
    if (res2.ok) {
      const data2 = await res2.json();
      console.log(`Bybit deposit (txID) response: retCode=${data2.retCode}, rows=${data2.result?.rows?.length || 0}`);
      if (data2.retCode === 0 && data2.result?.rows) {
        for (const d of data2.result.rows) {
          if (matchBybitId(d.txID, d.txId, d.id, d.orderId, d.orderLinkId, d.transferId) && hasSuccessStatus(d.status)) {
            const coin = String(d.coin || "USDT").toUpperCase();
            const chain = d.chain || d.network || d.chainType || "Bybit Deposit";
            console.log(`Bybit verified via deposit record: ${d.amount} ${coin} (${chain})`);
            return { verified: true, amount: parseFloat(d.amount), via: `${coin} ${chain}` };
          }
        }
      }
    } else {
      console.error("Bybit deposit HTTP error:", res2.status, await res2.text().catch(() => ""));
    }
  } catch (e) { console.error("Bybit deposit check error:", e.message); }

  // 3) Check internal deposit records (UID transfers received) — scan recent without txID filter
  try {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const qs3i = `coin=USDT&limit=50&startTime=${twoHoursAgo}`;
    const { ts: ts3i, sign: sign3i } = freshBybitSign(qs3i);
    const res3i = await fetchWithTimeout(`https://api.bybit.com/v5/asset/deposit/query-internal-record?${qs3i}`, {
      headers: { "X-BAPI-API-KEY": apiKey, "X-BAPI-TIMESTAMP": ts3i, "X-BAPI-RECV-WINDOW": recvWindow, "X-BAPI-SIGN": sign3i },
    });
    if (res3i.ok) {
      const data3i = await res3i.json();
      console.log(`Bybit internal-deposit response: retCode=${data3i.retCode}, rows=${JSON.stringify(data3i.result?.rows?.length || 0)}`);
      if (data3i.retCode === 0 && data3i.result?.rows) {
        for (const d of data3i.result.rows) {
          // Match by any available ID field
          if (matchBybitId(d.id, d.txID, d.txId, d.transferId, d.orderId) && hasSuccessStatus(d.status)) {
            const coin = String(d.coin || "USDT").toUpperCase();
            console.log(`Bybit verified via internal deposit: ${d.amount} ${coin}`);
            return { verified: true, amount: parseFloat(d.amount), via: `${coin} Bybit Internal Deposit` };
          }
        }
      }
    } else {
      const errText = await res3i.text().catch(() => "");
      console.error("Bybit internal-deposit HTTP error:", res3i.status, errText);
    }
  } catch (e) { console.error("Bybit internal deposit check error:", e.message); }

  // 4) Check universal transfer (sub-accounts etc)
  try {
    const qs4 = `coin=USDT&limit=50&transferId=${encodeURIComponent(normalizedOrderId)}`;
    const { ts: ts4, sign: sign4 } = freshBybitSign(qs4);
    const res4 = await fetchWithTimeout(`https://api.bybit.com/v5/asset/transfer/query-universal-transfer-list?${qs4}`, {
      headers: { "X-BAPI-API-KEY": apiKey, "X-BAPI-TIMESTAMP": ts4, "X-BAPI-RECV-WINDOW": recvWindow, "X-BAPI-SIGN": sign4 },
    });
    if (res4.ok) {
      const data4 = await res4.json();
      if (data4.retCode === 0 && data4.result?.list) {
        for (const t of data4.result.list) {
          if (matchBybitId(t.transferId, t.transferID, t.id) && hasSuccessStatus(t.status)) {
            const coin = String(t.coin || "USDT").toUpperCase();
            console.log(`Bybit verified via universal transfer: ${t.amount} ${coin}`);
            return { verified: true, amount: parseFloat(t.amount), via: `${coin} Bybit Universal Transfer` };
          }
        }
      }
    }
  } catch (e) { /* universal transfer might not apply */ }

  console.log(`Bybit verify: no match for ${normalizedOrderId}`);
  return { verified: false, amount: 0 };
}

function normalizeTxnInput(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  // Strip zero-width / invisible unicode chars that often sneak in when users
  // copy Order IDs from Bybit's web UI (ZWSP, ZWNJ, ZWJ, BOM, LRM/RLM, etc.).
  const stripped = raw.replace(/[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g, "");
  const cleaned = stripped.replace(/[<>`"']/g, " ").replace(/\s+/g, " ").trim();

  const hexMatch = cleaned.match(/0x[a-fA-F0-9]{20,}/);
  if (hexMatch) return hexMatch[0];

  const tronHashMatch = cleaned.match(/\b[a-fA-F0-9]{32,128}\b/);
  if (tronHashMatch) return tronHashMatch[0];

  const uuidMatch = cleaned.match(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/i);
  if (uuidMatch) return uuidMatch[0];

  const hyphenatedOrderMatch = cleaned.match(/\b[A-Za-z0-9]{6,}(?:-[A-Za-z0-9]{3,}){2,}\b/);
  if (hyphenatedOrderMatch && hyphenatedOrderMatch[0].length >= 20 && /\d/.test(hyphenatedOrderMatch[0])) return hyphenatedOrderMatch[0];

  const tonHashMatch = cleaned.match(/\b[a-zA-Z0-9_-]{40,128}\b/);
  if (tonHashMatch && /[0-9]/.test(tonHashMatch[0])) return tonHashMatch[0];

  // Long numeric IDs first (e.g. Bybit Order IDs are 18-32 digits).
  const longNumericMatch = cleaned.match(/\d{15,}/);
  if (longNumericMatch) return longNumericMatch[0];

  const numericMatch = cleaned.match(/\b\d{8,}\b/);
  if (numericMatch) return numericMatch[0];

  return cleaned;
}

// ── TXN hash handler ──


function isBybitOrderLikeId(value) {
  const txn = String(value || "").trim();
  if (txn.length < 18) return false;
  // Long all-numeric Bybit Order IDs (e.g. "26061800022067683511204085762475").
  if (/^\d{18,}$/.test(txn)) return true;
  // Hyphenated order IDs like "ABC123-XYZ-456".
  if (/^[A-Za-z0-9]{6,}(?:-[A-Za-z0-9]{3,}){2,}$/.test(txn) && txn.length >= 20) return true;
  return false;
}


function parseDirectPayAction(pendingAction) {
  const stripped = pendingAction.replace(/^(directpay|bkashpay)_/, "");
  const midMatch = stripped.match(/_mid_(\d+)$/);
  const paymentMsgId = midMatch ? parseInt(midMatch[1]) : null;
  const withoutMid = midMatch ? stripped.replace(/_mid_\d+$/, "") : stripped;
  const pmMatch = withoutMid.match(/_pm_(.+)$/);
  const paymentMethodId = pmMatch ? pmMatch[1] : null;
  const withoutPm = pmMatch ? withoutMid.replace(/_pm_.+$/, "") : withoutMid;
  const parts = withoutPm.split("_qty_");
  return { productId: parts[0], qty: parseInt(parts[1] || "1"), paymentMethodId, paymentMsgId };
}

function parseDepositPaymentAction(pendingAction) {
  const match = String(pendingAction || "").match(/^deposit_pm_(.+?)(?:_mid_(\d+))?$/);
  return {
    paymentMethodId: match?.[1] || null,
    paymentMsgId: match?.[2] ? parseInt(match[2]) : null,
  };
}

function hasPendingPaymentTxnAction(pendingAction) {
  return pendingAction?.startsWith("directpay_") || pendingAction?.startsWith("bkashpay_") || pendingAction?.startsWith("deposit_pm_");
}

function inferVerificationTargets(normalizedTxn, paymentMethodName = "") {
  const txn = String(normalizedTxn || "").trim();
  const method = String(paymentMethodName || "").toLowerCase();

  const isBybitMethod = method.includes("bybit");
  const isBkashMethod = method.includes("bkash") || method.includes("বিকাশ");

  // Policy: every deposit funnels through Binance EXCEPT Bybit and bKash.
  // So always enable Binance unless the user explicitly chose Bybit/bKash.
  const hintedTargets = {
    binance: !isBybitMethod && !isBkashMethod,
    bybit: isBybitMethod,
    bep20: method.includes("bep20") || method.includes("bsc"),
    trc20: method.includes("trc20") || method.includes("tron"),
    ton: /(^|\s)ton(\s|$)/.test(method),
    ltc: method.includes("ltc") || method.includes("litecoin"),
    bkash: isBkashMethod,
  };

  if (Object.values(hintedTargets).some(Boolean)) return hintedTargets;

  // No method hint — fall back on TxID shape, but still keep Binance on by default.
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(txn)) return { binance: false, bybit: true, bep20: false, trc20: false, ton: false, ltc: false, bkash: false };
  if (isBybitOrderLikeId(txn)) return { binance: true, bybit: true, bep20: false, trc20: false, ton: false, ltc: false, bkash: false };
  if (/^\d{8,}$/.test(txn)) return { binance: true, bybit: txn.length >= 15, bep20: false, trc20: false, ton: false, ltc: false, bkash: false };

  if (/^0x[a-fA-F0-9]{20,}$/.test(txn)) return { binance: true, bybit: false, bep20: true, trc20: false, ton: false, ltc: false, bkash: false };
  if (/^[a-fA-F0-9]{32,128}$/.test(txn)) return { binance: true, bybit: false, bep20: true, trc20: true, ton: false, ltc: true, bkash: false };
  if (/^[A-Za-z0-9_-]{40,128}$/.test(txn)) return { binance: true, bybit: false, bep20: false, trc20: false, ton: true, ltc: false, bkash: false };

  return { binance: true, bybit: false, bep20: true, trc20: true, ton: true, ltc: true, bkash: false };
}

function normalizeBinanceNetwork(network) {
  const n = String(network || "").trim().toUpperCase();
  if (!n) return "";
  // Map Binance internal chain codes -> friendly network names
  const map = {
    BSC: "BEP20",
    BNB: "BEP20",
    "BNB SMART CHAIN": "BEP20",
    BEP20: "BEP20",
    BEP2: "BEP2",
    TRX: "TRC20",
    TRON: "TRC20",
    TRC20: "TRC20",
    ETH: "ERC20",
    ERC20: "ERC20",
    ETHEREUM: "ERC20",
    MATIC: "Polygon",
    POLYGON: "Polygon",
    ARBITRUM: "Arbitrum",
    ARB: "Arbitrum",
    OP: "Optimism",
    OPTIMISM: "Optimism",
    SOL: "Solana",
    SOLANA: "Solana",
    TON: "TON",
    AVAX: "Avalanche",
    AVAXC: "Avalanche C-Chain",
  };
  return map[n] || n;
}

function formatVerificationVia(via) {
  const label = String(via || "").trim();
  if (!label) return "Auto Verification";
  if (/\b(USDT|LTC|BDT|TON)\b/i.test(label)) return label;
  if (/BEP20|TRC20|ERC20/i.test(label)) return `USDT ${label.toUpperCase()}`;
  if (/^TON$/i.test(label)) return "USDT TON";
  if (/^LTC$/i.test(label)) return "LTC Network";
  if (/bKash/i.test(label)) return "BDT bKash";
  if (/Binance|Bybit/i.test(label)) return `USDT ${label}`;
  return label;
}

function formatTxnLine(txnHash) {
  return txnHash ? `🔗 TxID: <code>${escapeHtml(txnHash)}</code>\n` : "";
}

function formatPaymentResultLine(amount, via, ltcRawAmount = 0, txnHash = "") {
  const viaLabel = formatVerificationVia(via);
  let line = `💰 Amount: <b>${Number(amount || 0).toFixed(2)} USDT</b>\n🪙 Network/Coin: <b>${escapeHtml(viaLabel)}</b>\n`;
  if (/LTC/i.test(viaLabel) && ltcRawAmount > 0) {
    const rate = amount / ltcRawAmount;
    line += `🪙 Actual Sent: <b>${ltcRawAmount.toFixed(8)} LTC</b>\n📊 Rate: <b>1 LTC = ${rate.toFixed(2)} USDT</b>\n`;
  }
  line += formatTxnLine(txnHash);
  return line;
}

// ── bKash Tokenized API ──
let bkashTokenCache = { token: null, expiresAt: 0 };

async function getBkashToken() {
  const now = Date.now();
  if (bkashTokenCache.token && bkashTokenCache.expiresAt > now + 60000) return bkashTokenCache.token;

  const appKey = process.env.BKASH_APP_KEY;
  const appSecret = process.env.BKASH_APP_SECRET;
  const username = process.env.BKASH_USERNAME;
  const password = process.env.BKASH_PASSWORD;
  if (!appKey || !appSecret || !username || !password) return null;

  const res = await fetch("https://tokenized.pay.bka.sh/v1.2.0-beta/tokenized/checkout/token/grant", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", username, password },
    body: JSON.stringify({ app_key: appKey, app_secret: appSecret }),
  });
  if (!res.ok) { console.log(`[bKash] Token grant failed: ${res.status}`); return null; }
  const data = await res.json();
  if (!data.id_token) { console.log(`[bKash] No id_token in response`); return null; }
  bkashTokenCache = { token: data.id_token, expiresAt: now + (data.expires_in || 3600) * 1000 };
  return data.id_token;
}

async function verifyBkashPayment(trxID) {
  try {
    const token = await getBkashToken();
    if (!token) return { verified: false, amount: 0 };
    const appKey = process.env.BKASH_APP_KEY;

    const res = await fetch("https://tokenized.pay.bka.sh/v1.2.0-beta/tokenized/checkout/general/searchTransaction", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", authorization: token, "x-app-key": appKey },
      body: JSON.stringify({ trxID }),
    });
    if (!res.ok) { console.log(`[bKash] Search failed: ${res.status}`); return { verified: false, amount: 0 }; }
    const data = await res.json();
    console.log(`[bKash] Search response for ${trxID}:`, JSON.stringify(data));

    if (data.trxID && data.transactionStatus === "Completed" && parseFloat(data.amount) > 0) {
      const bdtAmount = parseFloat(data.amount);
      // Convert BDT to USDT using stored rate
      const { data: rateSetting } = await supabase.from("bot_settings").select("value").eq("key", "dollar_rate_bdt").maybeSingle();
      const rate = rateSetting ? parseFloat(rateSetting.value) : 125;
      const usdtAmount = bdtAmount / rate;
      console.log(`[bKash] Verified: ${bdtAmount} BDT / ${rate} = ${usdtAmount.toFixed(2)} USDT`);
      return { verified: true, amount: parseFloat(usdtAmount.toFixed(2)), bdtAmount, rate, via: "bKash" };
    }
    return { verified: false, amount: 0 };
  } catch (err) {
    console.error("[bKash] Verify error:", err.message);
    return { verified: false, amount: 0 };
  }
}

function getMissingBkashConfig() {
  return ["BKASH_APP_KEY", "BKASH_APP_SECRET", "BKASH_USERNAME", "BKASH_PASSWORD"]
    .filter((key) => !envGet(key).trim());
}

function parseBkashCreatePaymentResponse(data) {
  const payload = data && typeof data === "object" ? data : {};
  const nested = payload.data && typeof payload.data === "object" ? payload.data : {};

  return {
    paymentID:
      payload.paymentID ||
      payload.paymentId ||
      payload.payment_id ||
      nested.paymentID ||
      nested.paymentId ||
      nested.payment_id ||
      null,
    bkashURL:
      payload.bkashURL ||
      payload.paymentURL ||
      payload.paymentUrl ||
      payload.redirectURL ||
      payload.redirectUrl ||
      nested.bkashURL ||
      nested.paymentURL ||
      nested.paymentUrl ||
      nested.redirectURL ||
      nested.redirectUrl ||
      null,
    error:
      payload.statusMessage ||
      payload.errorMessage ||
      payload.message ||
      nested.statusMessage ||
      nested.errorMessage ||
      nested.message ||
      null,
  };
}

async function createBkashPayment(amountBDT, customerId, pendingProductId = null, pendingQuantity = null) {
  try {
    const missingConfig = getMissingBkashConfig();
    if (missingConfig.length > 0) {
      const error = `bKash is not configured on the bot server (${missingConfig.join(", ")}).`;
      console.error(`[bKash] ${error}`);
      return { ok: false, error };
    }

    const token = await getBkashToken();
    if (!token) {
      return { ok: false, error: "Could not get a bKash access token. Please check the server credentials." };
    }

    const appKey = process.env.BKASH_APP_KEY;
    const callbackURL = `${process.env.SUPABASE_URL}/functions/v1/bkash-callback`;
    const invoiceNumber = `INV${Date.now()}`;

    const res = await fetch("https://tokenized.pay.bka.sh/v1.2.0-beta/tokenized/checkout/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", authorization: token, "x-app-key": appKey },
      body: JSON.stringify({
        mode: "0011",
        payerReference: String(customerId),
        callbackURL,
        amount: amountBDT.toFixed(2),
        currency: "BDT",
        intent: "sale",
        merchantInvoiceNumber: invoiceNumber,
      }),
    });
    const data = await res.json();
    console.log(`[bKash] CreatePayment response:`, JSON.stringify(data));

    const parsed = parseBkashCreatePaymentResponse(data);
    if (!res.ok) {
      const error = parsed.error || `bKash create payment failed with status ${res.status}.`;
      console.log(`[bKash] CreatePayment failed: ${error}`);
      return { ok: false, error };
    }

    if (!parsed.bkashURL || !parsed.paymentID) {
      const error = parsed.error || "bKash did not return a payment URL.";
      console.log(`[bKash] No bkashURL/paymentID: ${error}`);
      return { ok: false, error };
    }

    // Store pending deposit
    const { error: depositError } = await supabase.from("bot_deposits").insert({
      customer_id: customerId,
      amount: 0, // will be updated on callback
      status: "bkash_pending",
      txn_hash: `bkash_${parsed.paymentID}`,
      pending_product_id: pendingProductId,
      pending_quantity: pendingQuantity,
    });

    if (depositError) {
      console.error("[bKash] Failed to store pending deposit:", depositError.message);
      return { ok: false, error: "The payment link was created, but the pending order could not be saved." };
    }

    return { ok: true, bkashURL: parsed.bkashURL, paymentID: parsed.paymentID };
  } catch (err) {
    console.error("[bKash] CreatePayment error:", err.message);
    return { ok: false, error: err.message || "Unexpected bKash error." };
  }
}

async function getDollarRateBDT() {
  const { data } = await supabase.from("bot_settings").select("value").eq("key", "dollar_rate_bdt").maybeSingle();
  return data ? parseFloat(data.value) : 125;
}

async function handleTxnHash(chatId, customer, txnHash, emojiMap) {
  const normalizedTxn = normalizeTxnInput(txnHash);
  if (!normalizedTxn || normalizedTxn.length < 8) {
    await sendMessage(chatId, "❌ Could not find a valid TxID / Order ID. Please send the exact ID only.", mainMenuKeyboard());
    return;
  }

  const { data: existing } = await supabase.from("bot_deposits").select("id").eq("txn_hash", normalizedTxn).maybeSingle();
  if (existing) { await sendMessage(chatId, "⚠️ This transaction has already been submitted.", mainMenuKeyboard()); return; }

  let selectedPaymentMethodLabel = null;
  let selectedPaymentMethodName = "";
  if (hasPendingPaymentTxnAction(customer.pending_action)) {
    const { paymentMethodId, paymentMsgId } = customer.pending_action?.startsWith("deposit_pm_")
      ? parseDepositPaymentAction(customer.pending_action)
      : parseDirectPayAction(customer.pending_action);
    // Delete the payment details message
    if (paymentMsgId) {
      try { await tgFetch("deleteMessage", { chat_id: chatId, message_id: paymentMsgId }); } catch(e) {}
    }
    if (paymentMethodId) {
      const { data: paymentMethod } = await supabase.from("bot_payment_methods").select("name, emoji").eq("id", paymentMethodId).maybeSingle();
      if (paymentMethod) {
        selectedPaymentMethodName = paymentMethod.name || "";
        selectedPaymentMethodLabel = [paymentMethod.emoji, paymentMethod.name].filter(Boolean).join(" ").trim();
      }
    }
  }

  const verifyTargets = inferVerificationTargets(normalizedTxn, selectedPaymentMethodName);
  console.log(`[Verify] Starting verification for TxID: ${normalizedTxn}, raw: ${txnHash}, customer: ${customer.id}, pending_action: ${customer.pending_action || "none"}, targets: ${JSON.stringify(verifyTargets)}`);
  let amount = 0, verified = false, verifiedVia = "", ltcRawAmount = 0;

  const binanceApiKey = envGet("BINANCE_API_KEY"), binanceApiSecret = envGet("BINANCE_API_SECRET");
  const bybitApiKey = envGet("BYBIT_API_KEY"), bybitApiSecret = envGet("BYBIT_API_SECRET");

  const internalChecks = [];
  if (verifyTargets.binance && binanceApiKey && binanceApiSecret) {
    internalChecks.push(verifyBinanceTransfer(normalizedTxn, binanceApiKey, binanceApiSecret).then((r) => ({ source: "Binance", ...r })).catch(() => ({ source: "Binance", verified: false, amount: 0 })));
  }
  if (verifyTargets.bybit && bybitApiKey && bybitApiSecret) {
    internalChecks.push(verifyBybitTransfer(normalizedTxn, bybitApiKey, bybitApiSecret).then((r) => ({ source: "Bybit", ...r })).catch(() => ({ source: "Bybit", verified: false, amount: 0 })));
  }
  if (verifyTargets.bkash) {
    internalChecks.push(verifyBkashPayment(normalizedTxn).then((r) => ({ source: "bKash", ...r })).catch(() => ({ source: "bKash", verified: false, amount: 0 })));
  }

  if (internalChecks.length > 0) {
    const results = await Promise.all(internalChecks);
    console.log(`[Verify] Exchange check results:`, results.map(r => `${r.source}=${r.verified}/${r.amount}`).join(", "));
    for (const r of results) { if (r.verified && r.amount > 0) { amount = r.amount; verified = true; verifiedVia = r.via || r.source; break; } }
  }

  if (!verified && (verifyTargets.bep20 || verifyTargets.trc20 || verifyTargets.ton || verifyTargets.ltc)) {
    const [bep20, trc20, ton, ltc] = await Promise.all([
      verifyTargets.bep20 ? verifyBep20Transfer(normalizedTxn).catch(() => ({ verified: false, amount: 0 })) : Promise.resolve({ verified: false, amount: 0 }),
      verifyTargets.trc20 ? verifyTrc20Transfer(normalizedTxn).catch(() => ({ verified: false, amount: 0 })) : Promise.resolve({ verified: false, amount: 0 }),
      verifyTargets.ton ? verifyTonTransfer(normalizedTxn).catch(() => ({ verified: false, amount: 0 })) : Promise.resolve({ verified: false, amount: 0 }),
      verifyTargets.ltc ? verifyLtcTransfer(normalizedTxn).catch(() => ({ verified: false, amount: 0, ltcAmount: 0 })) : Promise.resolve({ verified: false, amount: 0, ltcAmount: 0 }),
    ]);
    if (bep20.verified && bep20.amount > 0) { amount = bep20.amount; verified = true; verifiedVia = "BEP20"; }
    else if (trc20.verified && trc20.amount > 0) { amount = trc20.amount; verified = true; verifiedVia = "TRC20"; }
    else if (ton.verified && ton.amount > 0) { amount = ton.amount; verified = true; verifiedVia = "TON"; }
    else if (ltc.verified && ltc.amount > 0) { amount = ltc.amount; verified = true; verifiedVia = "LTC"; ltcRawAmount = ltc.ltcAmount || 0; }
    console.log(`[Verify] Chain check results: BEP20=${bep20.verified}/${bep20.amount}, TRC20=${trc20.verified}/${trc20.amount}, TON=${ton.verified}/${ton.amount}, LTC=${ltc.verified}/${ltc.amount}`);
  }

  if (verified && amount > 0) {
    await supabase.from("bot_deposits").insert({ customer_id: customer.id, amount, txn_hash: normalizedTxn, status: "verified", verified_at: new Date().toISOString() });

    if (customer.pending_action?.startsWith("directpay_") || customer.pending_action?.startsWith("bkashpay_")) {
      const { productId, qty } = parseDirectPayAction(customer.pending_action);
      await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
      const { data: product } = await supabase.from("bot_products").select("*").eq("id", productId).single();
      if (product && product.is_active !== false) {
        const unitPrice = await getTieredPrice(productId, qty, Number(product.price), customer.id);
        const expectedTotal = Math.round(unitPrice * qty * 10000) / 10000;
        await processDirectPayPurchase({ chatId, customer, product, qty, expectedTotal, amount, verifiedVia, ltcRawAmount, normalizedTxn, emojiMap });
        return;
      }
      if (product && product.is_active === false) {
        await sendMessage(chatId, `⚠️ <b>Product Unavailable</b>\n\nThe product <b>${product.name}</b> is currently disabled and cannot be delivered.\n\nYour payment of <b>${amount.toFixed(2)} USDT</b> has been credited to your balance instead. You can use it for any other product or withdraw it.`);
        notifyAdmin(`⚠️ <b>Direct Pay on Disabled Product</b>\n\n👤 ${getCustomerLabel(customer)}\n📦 ${product.name} x${qty}\n💵 ${amount.toFixed(2)} USDT credited to balance (product is disabled).\n🔗 TxID: <code>${normalizedTxn}</code>`);
      }
    }

    // Regular deposit (no pending order) — auto-deduct pay later first
    const plResult = await autoDeductPayLater(customer.id, amount);
    const creditAmount = plResult.remaining;
    const { data: freshBal } = await supabase.from("bot_customers").select("balance").eq("id", customer.id).single();
    const newBal = (freshBal ? Number(freshBal.balance) : 0) + creditAmount;
    await supabase.from("bot_customers").update({ balance: newBal, updated_at: new Date().toISOString() }).eq("id", customer.id);

    let receiptMsg = `✅ <b>Deposit Verified!</b>\n\n${formatPaymentResultLine(amount, verifiedVia, ltcRawAmount, normalizedTxn)}`;
    if (plResult.deducted > 0) {
      receiptMsg += `🏷️ Pay Later Deducted: <b>-${plResult.deducted.toFixed(2)} USDT</b>\n💳 Remaining Due: <b>${(plResult.newUsed || 0).toFixed(2)} USDT</b>\n`;
    }
    receiptMsg += `💳 New Balance: <b>${newBal.toFixed(2)} USDT</b>`;
    await sendMessage(chatId, receiptMsg, mainMenuKeyboard());
    notifyAdmin(`✅ <b>Auto-Verified Deposit</b>\n\n👤 ${getCustomerLabel(customer)}\n${formatPaymentResultLine(amount, verifiedVia, ltcRawAmount, normalizedTxn)}${plResult.deducted > 0 ? `🏷️ Pay Later Deducted: ${plResult.deducted.toFixed(2)} USDT\n` : ""}`);
  } else {
    // Fire-and-forget: run retry loop in background so bot stays responsive
    (async () => {
    try {
    // Retry verification with progress bar for up to 5 minutes
    const RETRY_INTERVAL_SEC = 10;
    const MAX_RETRIES = 30; // 30 x 10s = 5 minutes
    const progressBarLen = 10;

    function buildProgressBar(step, total) {
      const filled = Math.round((step / total) * progressBarLen);
      return "▓".repeat(filled) + "░".repeat(progressBarLen - filled);
    }

    function buildProgressMsg(step, total, txn) {
      const elapsed = step * RETRY_INTERVAL_SEC;
      const remaining = (total - step) * RETRY_INTERVAL_SEC;
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      return `⏳ <b>Verifying Transaction...</b>\n\n` +
        `TxID: <code>${txn}</code>\n\n` +
        `${buildProgressBar(step, total)} ${Math.round((step / total) * 100)}%\n\n` +
        `🔄 Checking blockchain & exchange APIs...\n` +
        `⏱ ~${mins}m ${secs}s remaining\n\n` +
        `<i>Please wait while we confirm your payment.</i>`;
    }

    const progressResult = await sendMessage(chatId, buildProgressMsg(0, MAX_RETRIES, normalizedTxn));
    const progressMsgId = progressResult?.result?.message_id;

    let retryVerified = false, retryAmount = 0, retryVia = "", retryLtcRaw = 0;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      await new Promise(r => setTimeout(r, RETRY_INTERVAL_SEC * 1000));

      if (progressMsgId) {
        await editMessageText(chatId, progressMsgId, buildProgressMsg(attempt, MAX_RETRIES, normalizedTxn));
      }

      let rAmount = 0, rVerified = false, rVia = "", rLtcRaw = 0;
      const rChecks = [];
      if (verifyTargets.binance && binanceApiKey && binanceApiSecret) {
        rChecks.push(verifyBinanceTransfer(normalizedTxn, binanceApiKey, binanceApiSecret).then(r => ({ source: "Binance", ...r })).catch(() => ({ source: "Binance", verified: false, amount: 0 })));
      }
      if (verifyTargets.bybit && bybitApiKey && bybitApiSecret) {
        rChecks.push(verifyBybitTransfer(normalizedTxn, bybitApiKey, bybitApiSecret).then(r => ({ source: "Bybit", ...r })).catch(() => ({ source: "Bybit", verified: false, amount: 0 })));
      }
      if (verifyTargets.bkash) {
        rChecks.push(verifyBkashPayment(normalizedTxn).then(r => ({ source: "bKash", ...r })).catch(() => ({ source: "bKash", verified: false, amount: 0 })));
      }
      if (rChecks.length > 0) {
        const results = await Promise.all(rChecks);
        for (const r of results) { if (r.verified && r.amount > 0) { rAmount = r.amount; rVerified = true; rVia = r.via || r.source; break; } }
      }
      if (!rVerified && (verifyTargets.bep20 || verifyTargets.trc20 || verifyTargets.ton || verifyTargets.ltc)) {
        const [bep20, trc20, ton, ltc] = await Promise.all([
          verifyTargets.bep20 ? verifyBep20Transfer(normalizedTxn).catch(() => ({ verified: false, amount: 0 })) : Promise.resolve({ verified: false, amount: 0 }),
          verifyTargets.trc20 ? verifyTrc20Transfer(normalizedTxn).catch(() => ({ verified: false, amount: 0 })) : Promise.resolve({ verified: false, amount: 0 }),
          verifyTargets.ton ? verifyTonTransfer(normalizedTxn).catch(() => ({ verified: false, amount: 0 })) : Promise.resolve({ verified: false, amount: 0 }),
          verifyTargets.ltc ? verifyLtcTransfer(normalizedTxn).catch(() => ({ verified: false, amount: 0, ltcAmount: 0 })) : Promise.resolve({ verified: false, amount: 0, ltcAmount: 0 }),
        ]);
        if (bep20.verified && bep20.amount > 0) { rAmount = bep20.amount; rVerified = true; rVia = "BEP20"; }
        else if (trc20.verified && trc20.amount > 0) { rAmount = trc20.amount; rVerified = true; rVia = "TRC20"; }
        else if (ton.verified && ton.amount > 0) { rAmount = ton.amount; rVerified = true; rVia = "TON"; }
        else if (ltc.verified && ltc.amount > 0) { rAmount = ltc.amount; rVerified = true; rVia = "LTC"; rLtcRaw = ltc.ltcAmount || 0; }
      }

      if (rVerified && rAmount > 0) {
        retryVerified = true; retryAmount = rAmount; retryVia = rVia; retryLtcRaw = rLtcRaw;
        console.log(`[Verify] Retry #${attempt} SUCCESS for ${normalizedTxn}: ${rAmount} via ${rVia}`);
        break;
      }
      console.log(`[Verify] Retry #${attempt}/${MAX_RETRIES} for ${normalizedTxn}: not found yet`);
    }

    if (progressMsgId) {
      try { await tgFetch("deleteMessage", { chat_id: chatId, message_id: progressMsgId }); } catch (e) {}
    }

    if (retryVerified && retryAmount > 0) {
      amount = retryAmount; verified = true; verifiedVia = retryVia; ltcRawAmount = retryLtcRaw;
      // Guard against race: ensure deposit isn't already recorded (e.g. background checker raced us)
      const { data: dupDep } = await supabase.from("bot_deposits").select("id, status").eq("txn_hash", normalizedTxn).maybeSingle();
      if (dupDep && dupDep.status === "verified") {
        console.log(`[Verify] Retry skipped: deposit ${normalizedTxn} already verified`);
        return;
      }
      await supabase.from("bot_deposits").insert({ customer_id: customer.id, amount, txn_hash: normalizedTxn, status: "verified", verified_at: new Date().toISOString() });

      if (customer.pending_action?.startsWith("directpay_") || customer.pending_action?.startsWith("bkashpay_")) {
        const { productId, qty } = parseDirectPayAction(customer.pending_action);
        await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
        const { data: product } = await supabase.from("bot_products").select("*").eq("id", productId).single();
        if (product && product.is_active !== false) {
          const unitPrice = await getTieredPrice(productId, qty, Number(product.price), customer.id);
          const expectedTotal = Math.round(unitPrice * qty * 10000) / 10000;
          await processDirectPayPurchase({ chatId, customer, product, qty, expectedTotal, amount, verifiedVia, ltcRawAmount, normalizedTxn, emojiMap });
          return;
        }
        if (product && product.is_active === false) {
          await sendMessage(chatId, `⚠️ <b>Product Unavailable</b>\n\nThe product <b>${product.name}</b> is currently disabled and cannot be delivered.\n\nYour payment of <b>${amount.toFixed(2)} USDT</b> has been credited to your balance instead. You can use it for any other product or withdraw it.`);
          notifyAdmin(`⚠️ <b>Direct Pay on Disabled Product</b>\n\n👤 ${getCustomerLabel(customer)}\n📦 ${product.name} x${qty}\n💵 ${amount.toFixed(2)} USDT credited to balance (product is disabled).\n🔗 TxID: <code>${normalizedTxn}</code>`);
        }
      }

      const plResult = await autoDeductPayLater(customer.id, amount);
      const creditAmount = plResult.remaining;
      const { data: freshBal } = await supabase.from("bot_customers").select("balance").eq("id", customer.id).single();
      const newBal = (freshBal ? Number(freshBal.balance) : 0) + creditAmount;
      await supabase.from("bot_customers").update({ balance: newBal, updated_at: new Date().toISOString() }).eq("id", customer.id);
      let receiptMsg = `✅ <b>Deposit Verified!</b>\n\n${formatPaymentResultLine(amount, verifiedVia, ltcRawAmount, normalizedTxn)}`;
      if (plResult.deducted > 0) {
        receiptMsg += `🏷️ Pay Later Deducted: <b>-${plResult.deducted.toFixed(2)} USDT</b>\n💳 Remaining Due: <b>${(plResult.newUsed || 0).toFixed(2)} USDT</b>\n`;
      }
      receiptMsg += `💳 New Balance: <b>${newBal.toFixed(2)} USDT</b>`;
      await sendMessage(chatId, receiptMsg, mainMenuKeyboard());
      notifyAdmin(`✅ <b>Auto-Verified Deposit</b>\n\n👤 ${getCustomerLabel(customer)}\n${formatPaymentResultLine(amount, verifiedVia, ltcRawAmount, normalizedTxn)}${plResult.deducted > 0 ? `🏷️ Pay Later Deducted: ${plResult.deducted.toFixed(2)} USDT\n` : ""}`);
    } else {
      // All retries exhausted - fall back to manual verification
      if (customer.pending_action?.startsWith("directpay_") || customer.pending_action?.startsWith("bkashpay_")) {
        const { productId, qty } = parseDirectPayAction(customer.pending_action);
        const { data: product } = await supabase.from("bot_products").select("name, price").eq("id", productId).single();
        const unitPrice = product ? await getTieredPrice(productId, qty, Number(product.price), customer.id) : 0;
        const totalPrice = Math.round(unitPrice * qty * 10000) / 10000;

        await supabase.from("bot_deposits").insert({
          customer_id: customer.id, amount: totalPrice, txn_hash: normalizedTxn, status: "pending",
          pending_product_id: productId, pending_quantity: qty,
        });

        await sendMessage(chatId,
          `⏳ <b>Payment Submitted for Manual Review</b>\n\nProduct: <b>${product?.name || "Unknown"}</b> x${qty}\n` +
          `TxID: <code>${normalizedTxn}</code>\n\n` +
          `⚠️ We tried verifying for 5 minutes but couldn't confirm this transaction automatically. Your payment has been sent to <b>admin for manual review</b>.\n\n` +
          `Once verified, your order will be delivered automatically.`,
          mainMenuKeyboard()
        );

        const { data: latestDep } = await supabase.from("bot_deposits").select("id").eq("customer_id", customer.id).eq("status", "pending").order("created_at", { ascending: false }).limit(1).single();
        const depShortId = latestDep ? latestDep.id.slice(0, 8) : "";
        notifyAdmin(
          `⏳ <b>Pending Direct Pay</b>\n\n👤 ${getCustomerLabel(customer)}\n📦 ${product?.name || "?"} x${qty} = ${totalPrice.toFixed(2)} USDT${selectedPaymentMethodLabel ? `\n💳 Method: <b>${selectedPaymentMethodLabel}</b>` : ""}\n🪙 Expected Network/Coin: <b>${escapeHtml(formatVerificationVia(selectedPaymentMethodName || "Auto Verification"))}</b>\n🔗 TxID: <code>${normalizedTxn}</code>\n\n⚠️ Auto-verification failed after 5min retry. Manual review needed.`,
          depShortId ? { inline_keyboard: [[{ text: "✅ Verify Deposit", callback_data: `dep_approve_${depShortId}` }, { text: "❌ Reject", callback_data: `dep_reject_${depShortId}` }]] } : undefined
        );
      } else {
        await supabase.from("bot_deposits").insert({ customer_id: customer.id, amount: 0, txn_hash: normalizedTxn, status: "pending" });
        await sendMessage(chatId, `⏳ <b>Deposit Submitted for Manual Review</b>\n\nTxID: <code>${normalizedTxn}</code>\n\n⚠️ We tried verifying for 5 minutes but couldn't confirm automatically. It has been sent to <b>admin for manual review</b>.\nYour balance will be updated once verified.`, mainMenuKeyboard());
        const { data: latestDep2 } = await supabase.from("bot_deposits").select("id").eq("customer_id", customer.id).eq("status", "pending").order("created_at", { ascending: false }).limit(1).single();
        const depShortId2 = latestDep2 ? latestDep2.id.slice(0, 8) : "";
        notifyAdmin(
          `⏳ <b>Pending Deposit</b>\n\n👤 ${getCustomerLabel(customer)}${selectedPaymentMethodLabel ? `\n💳 Method: <b>${selectedPaymentMethodLabel}</b>` : ""}\n🪙 Expected Network/Coin: <b>${escapeHtml(formatVerificationVia(selectedPaymentMethodName || "Auto Verification"))}</b>\n🔗 TxID: <code>${normalizedTxn}</code>\n\n⚠️ Auto-verification failed after 5min retry. Manual review needed.`,
          depShortId2 ? { inline_keyboard: [[{ text: "✅ Verify Deposit", callback_data: `dep_approve_${depShortId2}` }, { text: "❌ Reject", callback_data: `dep_reject_${depShortId2}` }]] } : undefined
        );
      }
    }
    } catch (bgErr) {
      console.error("[Verify] Background retry error:", bgErr.message);
    }
    })(); // fire-and-forget - don't await
  }
}

// ── Buy flow ──

async function buildProductFlashSaleSnippet(flashSale, product, tiers) {
  const original = (tiers && tiers.length > 0) ? Number(tiers[0].price) : Number(product.price);
  const digitMap = await getDigitEmojis();
  const hasDigits = digitMap && Object.keys(digitMap).length > 0;
  const cdText = formatCountdown(flashSale.ends_at);
  let tpl = cachedPageMsgs.msg_flash_sale ||
    `🔥 <b>FLASH SALE — LIMITED TIME!</b>\n\n{product}\n\n💰 Sale Price: <b>\${price}</b>\n<s>Regular: \${original}</s> — Save \${savings}\n\n⏳ Ends in: <b><code>{countdown}</code></b>\n\n<i>Hurry — grab it before time runs out!</i>`;
  tpl = stripProductLineFromFlashSaleSnippet(tpl);
  if (hasDigits) tpl = stripFormattingAroundCountdown(tpl);
  const productIcon = product.custom_emoji_id ? `<tg-emoji emoji-id="${product.custom_emoji_id}">📦</tg-emoji> ` : "";
  return replacePlaceholders(tpl, {
    product: `${productIcon}${escapeHtml(product.name)}`,
    price: Number(flashSale.sale_price).toFixed(2),
    original: original.toFixed(2),
    savings: Math.max(0, original - Number(flashSale.sale_price)).toFixed(2),
    countdown: hasDigits ? renderCountdownPremium(cdText, digitMap) : cdText,
  }) + "\n";
}

async function buildProductDetailMessage(product, tiers, customerId = null) {
  const productEmoji = product.custom_emoji_id
    ? `<tg-emoji emoji-id="${product.custom_emoji_id}">📦</tg-emoji>`
    : "🔍";

  let priceLine = "", bulkBlock = "";
  const flashSale = await getActiveFlashSale(product.id);
  const specialInfo = await getCustomerSpecialPriceInfo(customerId, product.id);
  const special = specialInfo?.price ?? null;
  const specialMoq = specialInfo?.minQuantity ?? 1;
  const specialEligibleNow = special !== null && specialMoq <= 1;

  // Always show the lowest of the immediately-applicable prices.
  const regularPrice = (tiers && tiers.length > 0) ? Number(tiers[0].price) : Number(product.price);
  const flashPrice = flashSale ? Number(flashSale.sale_price) : null;
  const eligibleSpecial = specialEligibleNow ? special : null;

  const candidates = [regularPrice];
  if (flashPrice !== null) candidates.push(flashPrice);
  if (eligibleSpecial !== null) candidates.push(eligibleSpecial);
  const lowest = Math.min(...candidates);

  const flashIsLowest = flashPrice !== null && flashPrice <= lowest;
  const specialIsLowest = !flashIsLowest && eligibleSpecial !== null && eligibleSpecial <= lowest;

  if (flashIsLowest) {
    priceLine = await buildProductFlashSaleSnippet(flashSale, product, tiers);
  } else if (specialIsLowest) {
    priceLine = `Price: <b>$${formatPrice(eligibleSpecial)}</b> / code  <i>(special)</i>\n`;
  } else if (tiers && tiers.length > 0) {
    priceLine = `Price: <b>$${formatPrice(tiers[0].price)}</b> / code\n`;
    if (tiers.length > 1) {
      bulkBlock = "\n<b>Bulk Discounts:</b>\n";
      for (const tier of tiers) {
        const rangeLabel = tier.max_quantity ? `${tier.min_quantity}-${tier.max_quantity} codes` : `${tier.min_quantity}+ codes`;
        bulkBlock += `${rangeLabel} -> <b>$${formatPrice(tier.price)}</b> each\n`;
      }
    }
  } else { priceLine = `Price: <b>$${formatPrice(product.price)}</b> / code\n`; }

  // If there's a conditional special price (MOQ > 1), show it as an extra line so the customer knows.
  if (special !== null && specialMoq > 1) {
    priceLine += `\n🎯 <b>Your special price:</b> $${formatPrice(special)} / code <i>(when ordering ${specialMoq}+ codes)</i>\n`;
  }


  const descBlock = product.description ? `\n${product.description}\n` : "";
  const manualNote = product.is_manual_delivery
    ? `\n⚠️ <b>Note:</b> <i>This product is delivered manually by admin.\n⏱ Delivery Time: 30 minutes — 12 hours.\nIf not delivered within 12 hours, your balance will be fully refunded.</i>`
    : `\n<i>Delivery is automatic after payment confirmation.</i>`;
  return { msg: `${productEmoji} <b>${product.name}</b>\n\n${priceLine}${descBlock}${bulkBlock}${manualNote}`, flashSale };
}

function buildProductDetailKeyboard(productId, emojiMap) {
  const buyBtn = buyNowButton({ text: "Buy Now", callback_data: `buynow_${productId}` }, emojiMap);
  return {
    inline_keyboard: [
      [buyBtn],
      [applyEmoji({ text: "◀️ Back to Store", callback_data: "refresh_shop" }, "back_to_store", emojiMap)],
    ],
  };
}

// ── Customer Input Collection (for products that need email/username/etc before checkout) ──
function getProductInputFields(product) {
  const f = product?.customer_input_fields;
  if (!Array.isArray(f)) return [];
  return f.filter((x) => x && x.label && x.key);
}

function fieldTypeHint(type) {
  switch (type) {
    case "email": return "📧 Enter a valid email address:";
    case "username": return "👤 Enter the username / ID:";
    case "password": return "🔒 Enter the password (use a temporary one if possible):";
    default: return "✏️ Enter the value:";
  }
}

function validateInputValue(field, raw) {
  const val = (raw || "").trim();
  if (!val) return { ok: false, error: "Value cannot be empty." };
  if (val.length > 500) return { ok: false, error: "Value too long (max 500 chars)." };
  if (field.type === "email") {
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(val)) return { ok: false, error: "Invalid email format. Try again:" };
  }
  return { ok: true, value: val };
}

function inputKey(field, qty, itemIdx) {
  return qty > 1 ? `${field.key}#${itemIdx + 1}` : field.key;
}
function inputLabel(field, qty, itemIdx) {
  return qty > 1 ? `${field.label} (Item ${itemIdx + 1})` : field.label;
}

async function promptCustomerInput(chatId, customer, product, qty, idx, emojiMap, editMessageId) {
  const fields = getProductInputFields(product);
  const totalSteps = fields.length * qty;
  if (fields.length === 0 || idx >= totalSteps) {
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
    await showBuyConfirmation(chatId, customer, product.id, qty, emojiMap, editMessageId);
    return;
  }
  const itemIdx = Math.floor(idx / fields.length);
  const fieldIdx = idx % fields.length;
  const field = fields[fieldIdx];
  const pending = customer.pending_inputs && typeof customer.pending_inputs === "object" ? customer.pending_inputs : {};
  const values = (pending.productId === product.id && pending.values) ? pending.values : {};
  await supabase.from("bot_customers").update({
    pending_action: `collectinput_${product.id}_${qty}_${idx}`,
    pending_inputs: { productId: product.id, qty, values },
  }).eq("id", customer.id);

  const productEmoji = product.custom_emoji_id ? `<tg-emoji emoji-id="${product.custom_emoji_id}">📦</tg-emoji>` : "📦";
  const progress = `Step ${idx + 1} of ${totalSteps}` + (qty > 1 ? ` · Item ${itemIdx + 1}/${qty}` : "");
  const providedKeys = Object.keys(values);
  const prevBlock = providedKeys.length > 0
    ? "\n\n<b>Provided so far:</b>\n" + providedKeys.slice(-6).map((k) => `• <code>${escapeHtml(values[k] || "—")}</code>`).join("\n")
    : "";
  const labelDisplay = inputLabel(field, qty, itemIdx);
  const msg = `${productEmoji} <b>${escapeHtml(product.name)}</b> × ${qty}\n\n📝 <b>${escapeHtml(labelDisplay)}</b>\n<i>${progress}</i>\n\n${fieldTypeHint(field.type)}${prevBlock}`;
  const kb = { inline_keyboard: [[applyEmoji({ text: "❌ Cancel", callback_data: `cancelinput_${product.id}` }, "cancel", emojiMap)]] };
  if (editMessageId) await editMessageText(chatId, editMessageId, msg, kb).catch(() => sendMessage(chatId, msg, kb));
  else await sendMessage(chatId, msg, kb);
}

async function attachCustomerInputs(orderRowId, customerId) {
  if (!orderRowId || !customerId) return;
  const { data: cust } = await supabase.from("bot_customers").select("pending_inputs").eq("id", customerId).single();
  const pending = cust?.pending_inputs;
  const values = pending && typeof pending === "object" ? pending.values : null;
  if (values && Object.keys(values).length > 0) {
    await supabase.from("bot_orders").update({ customer_inputs: values }).eq("id", orderRowId);
  }
  await supabase.from("bot_customers").update({ pending_inputs: null }).eq("id", customerId);
}

async function handleBuyProduct(chatId, customer, productId, emojiMap, editMessageId) {
  const [{ data: product }, { data: tiers }] = await Promise.all([
    supabase.from("bot_products").select("*").eq("id", productId).single(),
    supabase.from("bot_product_pricing").select("*").eq("product_id", productId).order("min_quantity"),
  ]);
  if (!product) { await sendMessage(chatId, "❌ Product not found.", mainMenuKeyboard()); return; }

  const { msg, flashSale } = await buildProductDetailMessage(product, tiers, customer?.id);
  const keyboard = buildProductDetailKeyboard(productId, emojiMap);
  const result = editMessageId
    ? await editMessageText(chatId, editMessageId, msg, keyboard)
    : await sendMessage(chatId, msg, keyboard);

  const productMessageId = editMessageId || result?.result?.message_id;

  if (!result?.ok) {
    console.error(`Failed to show product ${productId} to chat ${chatId}`);
    const fallbackMsg = simplifyTelegramHtml(msg);
    const fallbackResult = await sendMessage(chatId, fallbackMsg, keyboard);
    const fallbackMessageId = fallbackResult?.result?.message_id || productMessageId;
    if (flashSale) trackFlashSaleProductMessage(chatId, fallbackMessageId, productId);
    else untrackFlashSaleProductMessage(chatId, fallbackMessageId);
    return;
  }

  if (flashSale) trackFlashSaleProductMessage(chatId, productMessageId, productId);
  else untrackFlashSaleProductMessage(chatId, productMessageId);
}

async function showQuantitySelection(chatId, productId, emojiMap, editMessageId) {
  const [{ data: product }, { data: tiers }, { data: custRow }] = await Promise.all([
    supabase.from("bot_products").select("name, price, currency, custom_emoji_id, is_manual_delivery, source_id, source_product_id, last_known_stock").eq("id", productId).single(),
    supabase.from("bot_product_pricing").select("price").eq("product_id", productId).order("min_quantity").limit(1),
    supabase.from("bot_customers").select("id").eq("chat_id", chatId).maybeSingle(),
  ]);
  if (!product) return;
  // Only use special as base price if MOQ is 1 (always-applicable). Otherwise show tier/regular.
  const special = await getCustomerSpecialPrice(custRow?.id, productId, 1);
  const flash = await getActiveFlashSale(productId);
  const tierOrRegular = tiers && tiers.length > 0 ? Number(tiers[0].price) : Number(product.price);
  const candidates = [tierOrRegular];
  if (special !== null) candidates.push(Number(special));
  if (flash) candidates.push(Number(flash.sale_price));
  const basePrice = Math.min(...candidates);

  const productEmoji = product.custom_emoji_id
    ? `<tg-emoji emoji-id="${product.custom_emoji_id}">📦</tg-emoji>`
    : "🔍";

  // Determine available stock for limiting quantity buttons (only for non-manual products)
  let availableStock = null;
  if (!product.is_manual_delivery) {
    try {
      if (product.source_id && product.source_product_id) {
        availableStock = await refreshSourceProductStock(product);
      } else {
        const { count } = await supabase
          .from("bot_product_stock_items")
          .select("id", { count: "exact", head: true })
          .eq("product_id", productId)
          .eq("status", "available");
        availableStock = count || 0;
      }
    } catch (e) { console.error("Quantity stock check error:", e); }
  }

  const buttons = [];
  const defaultRow1 = [1, 2, 3, 5];
  const defaultRow2 = [10, 15, 20, 25];

  if (availableStock !== null && availableStock <= 12) {
    // Show only buttons up to available stock
    if (availableStock >= 1) {
      const allQtys = [];
      for (let i = 1; i <= availableStock; i++) allQtys.push(i);
      // Chunk into rows of 4
      for (let i = 0; i < allQtys.length; i += 4) {
        buttons.push(allQtys.slice(i, i + 4).map((q) => ({ text: `${q}`, callback_data: `qty_${productId}_${q}` })));
      }
    }
  } else {
    buttons.push(defaultRow1.map((q) => ({ text: `${q}`, callback_data: `qty_${productId}_${q}` })));
    buttons.push(defaultRow2.map((q) => ({ text: `${q}`, callback_data: `qty_${productId}_${q}` })));
  }

  buttons.push([applyEmoji({ text: "✏️ Custom Amount", callback_data: `customqty_${productId}` }, "custom_amount", emojiMap)]);
  buttons.push([applyEmoji({ text: "◀️ Back to Product", callback_data: `buy_${productId}` }, "back_to_product", emojiMap)]);

  const stockNote = availableStock !== null && availableStock <= 12 ? `\n📦 Stock: <b>${availableStock}</b> available` : "";
  const msg = `Select Quantity\n\n${productEmoji} ${product.name}\n$${formatPrice(basePrice)} / code${stockNote}\n\nHow many codes do you want?`;
  if (editMessageId) await editMessageText(chatId, editMessageId, msg, { inline_keyboard: buttons });
  else await sendMessage(chatId, msg, { inline_keyboard: buttons });
}

async function showBuyConfirmation(chatId, customer, productId, qty, emojiMap, editMessageId) {
  const [{ data: product }, { data: fresh }] = await Promise.all([
    supabase.from("bot_products").select("*").eq("id", productId).single(),
    supabase.from("bot_customers").select("balance, pay_later_enabled, pay_later_limit, pay_later_used").eq("id", customer.id).single(),
  ]);
  if (!product) return;

  const productEmoji = product.custom_emoji_id
    ? `<tg-emoji emoji-id="${product.custom_emoji_id}">📦</tg-emoji>`
    : "📦";

  if (!product.is_manual_delivery && product.source_id && product.source_product_id) {
    const availableStock = await refreshSourceProductStock(product);
    if (qty > availableStock) {
      const errorMsg = `❌ <b>Insufficient Stock!</b>\n\nProduct: <b>${product.name}</b>\nRequested: <b>${qty}</b>\nAvailable: <b>${availableStock}</b>\n\nPlease choose a smaller quantity.`;
      if (editMessageId) await editMessageText(chatId, editMessageId, errorMsg, { inline_keyboard: [[applyEmoji({ text: "◀️ Back", callback_data: `buynow_${productId}` }, "back", emojiMap)]] });
      else await sendMessage(chatId, errorMsg, mainMenuKeyboard());
      return;
    }
  } else if (!product.is_manual_delivery) {
    try {
      const { data: availableRows, error: stockError } = await supabase
        .from("bot_product_stock_items")
        .select("id")
        .eq("product_id", product.id)
        .eq("status", "available")
        .limit(qty);
      if (!stockError) {
        const availableStock = availableRows?.length || 0;
        if (qty > availableStock) {
          const errorMsg = `❌ <b>Insufficient Stock!</b>\n\nProduct: <b>${product.name}</b>\nRequested: <b>${qty}</b>\nAvailable: <b>${availableStock}</b>\n\nPlease choose a smaller quantity.`;
          if (editMessageId) await editMessageText(chatId, editMessageId, errorMsg, { inline_keyboard: [[applyEmoji({ text: "◀️ Back", callback_data: `buynow_${productId}` }, "back", emojiMap)]] });
          else await sendMessage(chatId, errorMsg, mainMenuKeyboard());
          return;
        }
      }
    } catch (e) { console.error("Internal stock validation error:", e); }
  }

  const unitPrice = await getTieredPrice(productId, qty, Number(product.price), customer?.id);
  const total = Math.round(unitPrice * qty * 10000) / 10000;
  const balance = fresh ? Number(fresh.balance) : 0;
  const shortId = productId.slice(0, 8);

  let balanceSection = "";
  let paymentHint = "";
  let payLaterSection = "";

  if (balance > 0) {
    const balanceUsed = Math.min(balance, total);
    const amountToPay = total - balanceUsed;
    balanceSection = `\n\n💰 Your Balance: <b>$${balance.toFixed(2)} USDT</b>`;
    if (amountToPay > 0) {
      balanceSection += `\n✂️ Balance Deduction: <b>-$${balanceUsed.toFixed(2)} USDT</b>`;
      balanceSection += `\n💵 Amount to Pay: <b>$${amountToPay.toFixed(2)} USDT</b>`;
    } else {
      balanceSection += `\n✅ Fully covered by balance!`;
    }
  }

  // Pay Later info
  const payLaterEnabled = fresh?.pay_later_enabled || false;
  const payLaterLimit = fresh ? Number(fresh.pay_later_limit) : 0;
  const payLaterUsed = fresh ? Number(fresh.pay_later_used) : 0;
  const payLaterAvailable = Math.max(0, payLaterLimit - payLaterUsed);

  const buttons = [];
  if (balance >= total) {
    buttons.push([applyEmoji({ text: "💰 Pay with Balance", callback_data: `bp_${shortId}_${qty}` }, "pay_balance", emojiMap)]);
  } else if (balance > 0) {
    paymentHint = `\n\n⚠️ Pay the remaining amount via:`;
  } else {
    paymentHint = `\n\n💳 Choose a payment method:`;
  }
  buttons.push([applyEmoji({ text: "💳 Pay Directly", callback_data: `directpay_${productId}_qty_${qty}` }, "pay_direct", emojiMap)]);

  // Pay Later button - only for eligible customers with enough credit
  if (payLaterEnabled && payLaterAvailable >= total) {
    payLaterSection = `\n\n🏷️ <b>Pay Later Available!</b>\n💳 Credit: <b>$${payLaterAvailable.toFixed(2)}</b> / $${payLaterLimit.toFixed(2)} USDT`;
    buttons.push([applyEmoji({ text: "🏷️ Pay Later", callback_data: `paylater_${shortId}_${qty}` }, "pay_later", emojiMap)]);
  } else if (payLaterEnabled && payLaterAvailable > 0 && payLaterAvailable < total) {
    payLaterSection = `\n\n🏷️ <i>Pay Later credit: $${payLaterAvailable.toFixed(2)} (not enough for this order)</i>`;
  }

  const defaultOrderSummary = `📋 <b>Order Summary</b>\n\n{product}\n🔢 Qty: <b>{quantity}</b>\n💵 Price: <b>\${price}</b> each\n💰 Total: <b>\${total} {currency}</b>{balance_section}{payment_hint}{pay_later_section}`;
  const msg = replacePlaceholders(getPageMsg("msg_order_summary", defaultOrderSummary), {
    product: `${productEmoji} ${product.name}`,
    quantity: qty,
    price: unitPrice.toFixed(2),
    total: total.toFixed(2),
    currency: product.currency,
    balance_section: balanceSection,
    payment_hint: paymentHint,
    pay_later_section: payLaterSection,
  });

  buttons.push([applyEmoji({ text: "◀️ Back", callback_data: `buynow_${productId}` }, "back", emojiMap), applyEmoji({ text: "❌ Cancel", callback_data: "cancel_order" }, "cancel_order", emojiMap)]);

  if (editMessageId) await editMessageText(chatId, editMessageId, msg, { inline_keyboard: buttons });
  else await sendMessage(chatId, msg, { inline_keyboard: buttons });
}

async function showPaymentMethodSelection(chatId, customer, productId, qty, emojiMap, editMessageId) {
  const [{ data: methods }, { data: product }, { data: fresh }] = await Promise.all([
    supabase.from("bot_payment_methods").select("*").eq("is_active", true).order("sort_order"),
    supabase.from("bot_products").select("name, price, currency, custom_emoji_id").eq("id", productId).single(),
    supabase.from("bot_customers").select("balance").eq("id", customer.id).single(),
  ]);
  if (!methods || methods.length === 0) {
    await supabase.from("bot_customers").update({ pending_action: `directpay_${productId}_qty_${qty}` }).eq("id", customer.id);
    await showDirectPayInfo(chatId, productId, qty);
    return;
  }

  const unitPrice = await getTieredPrice(productId, qty, Number(product?.price || 0), customer?.id);
  const total = Math.round(unitPrice * qty * 10000) / 10000;
  const balance = fresh ? Number(fresh.balance) : 0;

  const shortProdId = productId.slice(0, 8);
  const buttons = [];
  for (const m of methods) {
    const shortMethodId = m.id.slice(0, 8);
    const btn = { text: `${m.emoji} ${m.name}`, callback_data: `pm_${shortMethodId}_${shortProdId}_${qty}` };
    if (m.custom_emoji_id) {
      const stripped = String(btn.text).replace(/^(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})\uFE0F?\s*/u, "");
      btn.text = stripped || btn.text;
      btn.icon_custom_emoji_id = m.custom_emoji_id;
      buttons.push([btn]);
    } else {
      buttons.push([applyEmoji(btn, "deposit_method", emojiMap)]);
    }
  }
  buttons.push([applyEmoji({ text: "◀️ Back", callback_data: `qty_${productId}_${qty}` }, "back", emojiMap)]);

  const pmProductEmoji = product?.custom_emoji_id
    ? `<tg-emoji emoji-id="${product.custom_emoji_id}">📦</tg-emoji>`
    : "🔍";
  let msg = `💳 <b>Select Payment Method</b>\n\n${pmProductEmoji} ${product?.name || "Product"} x ${qty}\nTotal: <b>$${total.toFixed(2)} USDT</b>`;
  if (balance > 0 && balance < total) {
    const amountToPay = total - balance;
    msg += `\n\n💰 Balance: <b>$${balance.toFixed(2)} USDT</b> (will be deducted)`;
    msg += `\n💵 Remaining to Pay: <b>$${amountToPay.toFixed(2)} USDT</b>`;
  }

  if (editMessageId) await editMessageText(chatId, editMessageId, msg, { inline_keyboard: buttons });
  else await sendMessage(chatId, msg, { inline_keyboard: buttons });
}

async function showPaymentDetails(chatId, methodId, productId, qty, emojiMap, editMessageId) {
  const [{ data: method }, { data: product }, { data: fresh }] = await Promise.all([
    supabase.from("bot_payment_methods").select("*").eq("id", methodId).single(),
    supabase.from("bot_products").select("*").eq("id", productId).single(),
    supabase.from("bot_customers").select("id, balance").eq("chat_id", chatId).single(),
  ]);
  if (!method || !product) return;

  const unitPrice = await getTieredPrice(productId, qty, Number(product.price), fresh?.id);
  const total = Math.round(unitPrice * qty * 10000) / 10000;
  const balance = fresh ? Number(fresh.balance) : 0;
  const balanceUsed = Math.min(balance, total);
  const amountToPay = total - balanceUsed;

  let paymentInfo = method.payment_details;
  const envVal = envGet(method.payment_details);
  if (envVal) paymentInfo = envVal;

  const binanceId = envGet("BINANCE_ID") || null;
  const bybitUid = envGet("BYBIT_UID") || null;
  const walletAddress = envGet("USDT_WALLET_ADDRESS") || null;
  const trc20Address = envGet("USDT_TRC20_ADDRESS") || null;
  const tonAddress = envGet("USDT_TON_ADDRESS") || null;
  const ltcAddress = envGet("LTC_ADDRESS") || null;

  const pdProductEmoji = product.custom_emoji_id
    ? `<tg-emoji emoji-id="${product.custom_emoji_id}">📦</tg-emoji>`
    : "📦";
  const paymentType0 = method.payment_type?.toLowerCase() || "";
  const methodName0 = method.name?.toLowerCase() || "";
  const isBkash0 = methodName0.includes("bkash") || methodName0.includes("বিকাশ") || paymentType0 === "bkash";

  const methodEmojiTag = method.custom_emoji_id
    ? `<tg-emoji emoji-id="${method.custom_emoji_id}">${method.emoji}</tg-emoji>`
    : method.emoji;
  // For bKash: charge full amount via bKash (no balance deduction)
  const effectiveAmountToPay = isBkash0 ? total : amountToPay;

  let msg = `${methodEmojiTag} <b>${method.name}</b>\n\n━━━━━━━━━━━━━━━━\n${pdProductEmoji} Product: <b>${product.name}</b>\n🔢 Quantity: <b>${qty}</b>\n💵 Total: <b>$${total.toFixed(2)} USDT</b>\n`;
  if (isBkash0) {
    const bdtRate0 = await getDollarRateBDT();
    msg += `🇧🇩 BDT: <b>৳${(total * bdtRate0).toFixed(2)}</b> (Rate: ${bdtRate0})\n`;
  } else if (balanceUsed > 0) {
    msg += `💰 Balance Deduction: <b>-$${balanceUsed.toFixed(2)} USDT</b>\n💳 Amount to Pay: <b>$${effectiveAmountToPay.toFixed(2)} USDT</b>\n`;
  }
  msg += `━━━━━━━━━━━━━━━━\n\n`;

  const paymentType = method.payment_type?.toLowerCase() || "";
  const methodName = method.name?.toLowerCase() || "";

  const isBkash = methodName.includes("bkash") || methodName.includes("বিকাশ") || paymentType === "bkash";

  if (isBkash) {
    const bdtRate = await getDollarRateBDT();
    const bdtAmount = total * bdtRate; // Full amount via bKash, no balance deduction
    msg += `📱 <b>bKash Payment</b>\n\n`;
    msg += `📊 <b>Dollar Rate:</b> 1 USD = <b>${bdtRate} BDT</b>\n`;
    msg += `💵 <b>Amount:</b> ৳<b>${bdtAmount.toFixed(2)} BDT</b>\n`;
    if (method.instruction) msg += `\n📋 <b>Instructions:</b>\n${method.instruction}\n`;
    msg += `\n━━━━━━━━━━━━━━━━\n`;
    msg += `👇 <b>"Continue to Pay"</b> Click the <b>"Continue to Pay"</b> button below to complete your bKash payment.`;

    // Get customer ID
    const { data: cust } = await supabase.from("bot_customers").select("id").eq("chat_id", chatId).single();
    if (cust) {
      const bkashResult = await createBkashPayment(bdtAmount, cust.id, productId, qty);
      if (bkashResult?.ok && bkashResult.bkashURL) {
        const shortProdId = productId.slice(0, 8);
        const payBtn = { inline_keyboard: [
          [applyEmoji({ text: "💳 Continue to Pay", url: bkashResult.bkashURL }, "continue_to_pay", emojiMap)],
          [applyEmoji({ text: "◀️ Back", callback_data: `backpay_${shortProdId}_qty_${qty}` }, "back", emojiMap)],
          [applyEmoji({ text: "❌ Cancel Order", callback_data: "cancel_order" }, "cancel_order", emojiMap)],
        ] };
        if (editMessageId) await editMessageText(chatId, editMessageId, msg, payBtn);
        else await sendMessage(chatId, msg, payBtn);
        return;
      }

      if (bkashResult?.error) {
        msg += `\n\n⚠️ ${escapeHtml(bkashResult.error)}`;
      }
    } else {
      msg += `\n\n⚠️ Could not load your customer record for bKash checkout.`;
    }
    msg += `\n\n⚠️ bKash auto-payment could not be initialized. Please try again.`;
  } else if (methodName.includes("binance") || paymentType === "binance") {
    msg += `🏦 <b>Binance Pay / Internal Transfer</b>\n\n`;
    msg += binanceId ? `<b>Binance ID:</b>\n<code>${binanceId}</code>\n<i>👆 Tap to copy</i>\n` : `<code>${paymentInfo}</code>\n<i>👆 Tap to copy</i>\n`;
  } else if (methodName.includes("bybit") || paymentType === "bybit") {
    msg += `🏦 <b>Bybit Pay / Internal Transfer</b>\n\n`;
    msg += bybitUid ? `<b>Bybit UID:</b>\n<code>${bybitUid}</code>\n<i>👆 Tap to copy</i>\n` : `<code>${paymentInfo}</code>\n<i>👆 Tap to copy</i>\n`;
  } else if (methodName.includes("trc20") || paymentType === "trc20") {
    msg += `🔗 <b>USDT TRC20 Address:</b>\n<code>${trc20Address || paymentInfo}</code>\n<i>👆 Tap to copy</i>\n`;
  } else if (methodName.includes("ton") || paymentType === "ton") {
    msg += `💎 <b>USDT TON Address:</b>\n<code>${tonAddress || paymentInfo}</code>\n<i>👆 Tap to copy</i>\n`;
  } else if (methodName.includes("ltc") || methodName.includes("litecoin") || paymentType === "ltc") {
    msg += `🪙 <b>LTC Address:</b>\n<code>${ltcAddress || paymentInfo}</code>\n<i>👆 Tap to copy</i>\n`;
    try {
      const rateRes = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=LTCUSDT");
      if (rateRes.ok) {
        const rateData = await rateRes.json();
        const ltcPrice = parseFloat(rateData.price);
        if (ltcPrice > 0) {
          const ltcNeeded = amountToPay / ltcPrice;
          msg += `\n📊 <b>Current Rate:</b> 1 LTC = <b>${ltcPrice.toFixed(2)} USDT</b>\n🪙 <b>Send:</b> ~<code>${ltcNeeded.toFixed(6)}</code> LTC\n<i>(≈ ${amountToPay.toFixed(2)} USDT)</i>\n`;
        }
      }
    } catch {}
    msg += `\n<i>💡 LTC auto-converts to USDT at market rate.</i>\n`;
  } else if (methodName.includes("usdt") || methodName.includes("bep20") || paymentType === "wallet") {
    msg += `🔗 <b>Wallet Address:</b>\n<code>${paymentInfo}</code>\n<i>👆 Tap to copy</i>\n`;
    if (walletAddress && paymentInfo !== walletAddress) msg += `\n🔗 <b>USDT BEP20 Address:</b>\n<code>${walletAddress}</code>\n<i>👆 Tap to copy</i>\n`;
  } else {
    msg += `💳 <b>Payment Details:</b>\n<code>${paymentInfo}</code>\n<i>👆 Tap to copy</i>\n`;
  }

  if (!isBkash) {
    if (method.instruction) msg += `\n📋 <b>Instructions:</b>\n${method.instruction}\n`;
    msg += `\n━━━━━━━━━━━━━━━━\n✅ After payment, send the <b>Transaction Hash (TxID)</b> or <b>Order ID</b> here.\n`;
  }
  if (product.is_manual_delivery) {
    msg += `⚠️ This product will be delivered <b>manually</b> by admin.\n⏱ Delivery: <b>30 min — 12 hours</b>. If delayed beyond 12 hours, full refund guaranteed.`;
  } else {
    msg += `⚡ Once verified, your items will be delivered <b>automatically</b>.`;
  }

  const shortProdId = productId.slice(0, 8);
  const backButton = { inline_keyboard: [
    [applyEmoji({ text: "◀️ Back", callback_data: `backpay_${shortProdId}_qty_${qty}` }, "back", emojiMap)],
    [applyEmoji({ text: "❌ Cancel Order", callback_data: "cancel_order" }, "cancel_order", emojiMap)],
  ] };

  if (editMessageId) await editMessageText(chatId, editMessageId, msg, backButton);
  else await sendMessage(chatId, msg, backButton);
}

async function showDirectPayInfo(chatId, productId, qty) {
  const { data: product } = await supabase.from("bot_products").select("*").eq("id", productId).single();
  if (!product) return;
  const { data: cust } = await supabase.from("bot_customers").select("id").eq("chat_id", chatId).maybeSingle();
  const unitPrice = await getTieredPrice(productId, qty, Number(product.price), cust?.id);
  const total = Math.round(unitPrice * qty * 10000) / 10000;
  const walletAddress = envGet("USDT_WALLET_ADDRESS") || "Not configured";
  const binanceId = envGet("BINANCE_ID") || "Not configured";
  const bybitUid = envGet("BYBIT_UID") || "Not configured";
  const trc20Address = envGet("USDT_TRC20_ADDRESS") || "Not configured";
  const tonAddress = envGet("USDT_TON_ADDRESS") || "Not configured";
  const ltcAddress = envGet("LTC_ADDRESS") || "Not configured";

  await sendMessage(chatId,
    `💳 <b>Direct Payment</b>\n\nProduct: <b>${product.name}</b> x${qty}\nSend exactly <b>${total.toFixed(2)} USDT</b>\n\n` +
    `<b>Binance ID:</b> <code>${binanceId}</code>\n<b>Bybit UID:</b> <code>${bybitUid}</code>\n<b>USDT BEP20:</b> <code>${walletAddress}</code>\n` +
    `<b>USDT TRC20:</b> <code>${trc20Address}</code>\n<b>USDT TON:</b> <code>${tonAddress}</code>\n<b>LTC:</b> <code>${ltcAddress}</code>\n\n` +
    `<i>💡 LTC auto-converts to USDT at market rate.</i>\n\nAfter payment, send the <b>TxID / Order ID</b> here.\nOnce verified, your items will be delivered automatically.`,
    mainMenuKeyboard()
  );
}

// ── Direct Pay Delivery ──

async function purchaseFromSource(product, quantity) {
  if (!product.source_id || !product.source_product_id) return null;
  const url = `${process.env.SUPABASE_URL}/functions/v1/product-sources`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({ action: "purchase", source_id: product.source_id, source_product_id: product.source_product_id, quantity }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.ok) throw new Error(payload?.error || `Source purchase failed (${res.status})`);
  return payload.accounts || [];
}

async function executeInternalStockDelivery(chatId, customer, product, qty, totalPrice, emojiMap, paymentLabel, extraAdminText = "", suppressAdminNotify = false, txnHash = "") {
  const { data: orderRow, error: orderError } = await supabase.from("bot_orders").insert({
    customer_id: customer.id, product_id: product.id, product_name: product.name,
    quantity: qty, total_price: totalPrice, details: [], row_numbers: [], status: "completed",
    payment_method: paymentLabel || null, txn_hash: txnHash || null,
  }).select("id").single();
  if (orderError || !orderRow) throw orderError || new Error("Order create failed");
  await attachCustomerInputs(orderRow.id, customer.id).catch(() => {});

  let orderDetails;

  // ── Source-backed product: live proxy purchase ──
  if (product.source_id && product.source_product_id) {
    try {
      const accounts = await purchaseFromSource(product, qty);
      if (!accounts || accounts.length < qty) throw new Error("Source returned insufficient accounts");
      orderDetails = accounts.map((acc) => ({ "Delivery Info": String(acc) }));
    } catch (err) {
      await supabase.from("bot_orders").update({ status: "pending_delivery" }).eq("id", orderRow.id);
      const orderShort = orderRow.id.slice(0, 8);
      // Notify customer that order is pending manual delivery
      sendMessage(chatId,
        `⏳ <b>Order Placed — Pending Manual Delivery</b>\n\nProduct: <b>${product.name}</b>\nQuantity: <b>${qty}</b>\nTotal: <b>${totalPrice.toFixed(2)} ${product.currency}</b>\n\nAuto-delivery temporarily unavailable. Admin will deliver manually.\n⏱ Delivery Time: <b>30 min — 12 hours</b>.\nIf not delivered within 12 hours, your balance will be fully refunded.`,
        mainMenuKeyboard(emojiMap)
      ).catch(() => {});
      notifyAdmin(
        `🔔 <b>Source Failed → Manual Delivery Needed</b>\n\n👤 ${getCustomerLabel(customer)}\n📦 Product: <b>${escapeHtml(product.name)}</b> x${qty}\n💰 Total: <b>${totalPrice.toFixed(2)} ${product.currency}</b>\n💳 Payment: <b>${escapeHtml(formatVerificationVia(paymentLabel))}</b>${txnHash ? `\n🔗 TxID: <code>${escapeHtml(txnHash)}</code>` : ""}\n\n⚠️ Source error: <code>${escapeHtml(err.message || String(err))}</code>\n\nDeliver from source bot, then tap below.`,
        { inline_keyboard: [[{ text: "📦 Deliver", callback_data: `mdlvr_${orderShort}` }], [{ text: "❌ Cancel & Refund", callback_data: `mdcancel_${orderShort}` }]] }
      ).catch(() => {});
      return orderRow; // swallow error — flow handled via manual delivery
    }
  } else {
    // ── Internal stock path (existing) ──
    const { data: reserved, error: reserveError } = await supabase.rpc("reserve_internal_stock_items", {
      _product_id: product.id,
      _quantity: qty,
      _order_id: orderRow.id,
    });
    if (reserveError || !reserved || reserved.length < qty) {
      await supabase.from("bot_orders").update({ status: "pending_delivery" }).eq("id", orderRow.id);
      const orderShort = orderRow.id.slice(0, 8);
      sendMessage(chatId,
        `⏳ <b>Order Placed — Pending Manual Delivery</b>\n\nProduct: <b>${product.name}</b>\nQuantity: <b>${qty}</b>\nTotal: <b>${totalPrice.toFixed(2)} ${product.currency}</b>\n\nStock temporarily unavailable. Admin will deliver manually.\n⏱ Delivery Time: <b>30 min — 12 hours</b>.`,
        mainMenuKeyboard(emojiMap)
      ).catch(() => {});
      notifyAdmin(
        `🔔 <b>Stock Empty → Manual Delivery Needed</b>\n\n👤 ${getCustomerLabel(customer)}\n📦 Product: <b>${escapeHtml(product.name)}</b> x${qty}\n💰 Total: <b>${totalPrice.toFixed(2)} ${product.currency}</b>\n💳 Payment: <b>${escapeHtml(formatVerificationVia(paymentLabel))}</b>${txnHash ? `\n🔗 TxID: <code>${escapeHtml(txnHash)}</code>` : ""}`,
        { inline_keyboard: [[{ text: "📦 Deliver", callback_data: `mdlvr_${orderShort}` }], [{ text: "❌ Cancel & Refund", callback_data: `mdcancel_${orderShort}` }]] }
      ).catch(() => {});
      return orderRow;
    }
    orderDetails = reserved.map((item) => item.data || {});
  }

  await supabase.from("bot_orders").update({ details: orderDetails }).eq("id", orderRow.id);
  clearStockCache();
  processReferralCommission(customer.id, totalPrice, orderRow.id).catch(e => console.error("Ref commission err:", e));
  const headerInfo = `✅ <b>Order Successful!</b>\n\nProduct: <b>${product.name}</b>\nQuantity: <b>${qty}</b>\nTotal: <b>${totalPrice.toFixed(2)} ${product.currency}</b>${extraAdminText}\n`;
  await deliverOrderItems(chatId, product, orderDetails, orderRow.id, headerInfo, emojiMap);
  notifyRecentSale(product.name, qty, product.custom_emoji_id).catch(() => {});
  if (!suppressAdminNotify) {
    const title = txnHash ? "📦 <b>Direct Pay Order Delivered</b>" : "📦 <b>New Order</b>";
    notifyAdmin(`${title}\n\n👤 ${getCustomerLabel(customer)}\n🛒 Product: <b>${product.name}</b> x${qty}\n💰 Total: <b>${totalPrice.toFixed(2)} ${product.currency}</b>\n💳 Payment: <b>${escapeHtml(formatVerificationVia(paymentLabel))}</b>\n${formatTxnLine(txnHash)}`.trim());
  }
  return orderRow;
}

// ── Apply payment to outstanding due first, then to product ──
// Rule: if customer has a negative balance (due), incoming payment first clears the due.
// Product is delivered only when (current balance + payment) >= product total.
async function processDirectPayPurchase({ chatId, customer, product, qty, expectedTotal, amount, verifiedVia, ltcRawAmount, normalizedTxn, emojiMap, receiptPrefix = "✅ <b>Payment Verified!</b>" }) {
  const { data: freshBal } = await supabase.from("bot_customers").select("balance").eq("id", customer.id).single();
  const currentBal = freshBal ? Number(freshBal.balance) : 0;
  const dueBefore = currentBal < 0 ? Math.abs(currentBal) : 0;
  const afterPayment = currentBal + amount;
  const dueCleared = dueBefore > 0 ? Math.min(dueBefore, amount) : 0;

  // Insufficient: payment + balance can't cover product
  if (afterPayment < expectedTotal) {
    await supabase.from("bot_customers").update({ balance: afterPayment, updated_at: new Date().toISOString() }).eq("id", customer.id);
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
    const shortfall = expectedTotal - afterPayment;
    let msg = `⚠️ <b>Insufficient Payment — Order Not Delivered</b>\n\n${formatPaymentResultLine(amount, verifiedVia, ltcRawAmount, normalizedTxn)}`;
    if (dueBefore > 0) {
      msg += `🧾 Previous Due: <b>${dueBefore.toFixed(2)} USDT</b>\n💸 Applied to Due: <b>${dueCleared.toFixed(2)} USDT</b>\n`;
      const dueAfter = Math.max(0, dueBefore - amount);
      if (dueAfter > 0) msg += `🧾 Remaining Due: <b>${dueAfter.toFixed(2)} USDT</b>\n`;
    }
    msg += `🛒 Product Required: <b>${expectedTotal.toFixed(2)} USDT</b>\n📉 Shortfall: <b>${shortfall.toFixed(2)} USDT</b>\n\n`;
    if (afterPayment < 0) msg += `🧾 New Due: <b>${Math.abs(afterPayment).toFixed(2)} USDT</b>\n`;
    else msg += `💳 New Balance: <b>${afterPayment.toFixed(2)} USDT</b>\n`;
    msg += `\nOrder cancelled. Add more funds and re-order.`;
    await sendMessage(chatId, msg, mainMenuKeyboard(emojiMap));
    return;
  }

  // Sufficient: deliver product. balance = (currentBal + amount) - expectedTotal
  const newBal = afterPayment - expectedTotal;
  await supabase.from("bot_customers").update({ balance: newBal, updated_at: new Date().toISOString() }).eq("id", customer.id);

  let receiptMsg = `${receiptPrefix}\n\n${formatPaymentResultLine(amount, verifiedVia, ltcRawAmount, normalizedTxn)}`;
  if (dueCleared > 0) receiptMsg += `🧾 Due Cleared: <b>${dueCleared.toFixed(2)} USDT</b>\n`;
  // Balance used = portion of expectedTotal not paid by direct payment
  const balanceUsed = Math.max(0, expectedTotal - Math.max(0, amount - dueCleared));
  // (when currentBal was positive and amount < expectedTotal, we used some balance)
  if (currentBal > 0 && amount < expectedTotal) {
    receiptMsg += `💳 Used from balance: <b>${(expectedTotal - amount).toFixed(2)} USDT</b>\n`;
  }
  const change = newBal > 0 && currentBal <= 0 ? newBal : (newBal - Math.max(0, currentBal));
  if (change > 0) receiptMsg += `💳 Change added to balance: <b>${change.toFixed(2)} USDT</b>\n`;
  if (newBal < 0) receiptMsg += `🧾 Remaining Due: <b>${Math.abs(newBal).toFixed(2)} USDT</b>\n`;
  else receiptMsg += `💵 New Balance: <b>${newBal.toFixed(2)} USDT</b>\n`;
  receiptMsg += `\n⏳ Delivering your items...`;
  await sendMessage(chatId, receiptMsg);
  await executeDirectPayDelivery(chatId, customer, product, qty, expectedTotal, emojiMap, verifiedVia, normalizedTxn);
}


async function executeDirectPayDelivery(chatId, customer, product, qty, totalPrice, emojiMap, verifiedVia, normalizedTxn) {
  // Manual delivery product
  if (product.is_manual_delivery) {
    const { data: orderRow } = await supabase.from("bot_orders").insert({
      customer_id: customer.id, product_id: product.id, product_name: product.name,
      quantity: qty, total_price: totalPrice, details: [], row_numbers: [], status: "pending_delivery",
      payment_method: verifiedVia || "Direct Pay", txn_hash: normalizedTxn || null,
    }).select("id").single();
    if (orderRow?.id) await attachCustomerInputs(orderRow.id, customer.id).catch(() => {});
    const orderShort = (orderRow?.id || "unknown").slice(0, 8);
    processReferralCommission(customer.id, totalPrice, orderRow?.id).catch(e => console.error("Ref commission err:", e));
    notifyRecentSale(product.name, qty, product.custom_emoji_id).catch(() => {});
    await sendMessage(chatId,
      `✅ <b>Payment Verified & Order Placed!</b>\n\nProduct: <b>${product.name}</b>\nQuantity: <b>${qty}</b>\nTotal: <b>${totalPrice.toFixed(2)} ${product.currency}</b>\n\n⏳ <b>Your order is being processed.</b>\nAdmin will deliver it manually.\n⏱ Delivery Time: <b>30 min — 12 hours</b>.\nIf not delivered within 12 hours, your balance will be fully refunded.`,
      mainMenuKeyboard(emojiMap)
    );
    notifyAdmin(
      `🔔 <b>New Manual Delivery Order!</b>\n\n👤 ${getCustomerLabel(customer)}\n📦 Product: <b>${product.name}</b> x${qty}\n💰 Total: <b>${totalPrice.toFixed(2)} ${product.currency}</b>\n🪙 Network/Coin: <b>${escapeHtml(formatVerificationVia(verifiedVia))}</b>\n🔗 TxID: <code>${normalizedTxn}</code>`,
      { inline_keyboard: [[{ text: "📦 Deliver", callback_data: `mdlvr_${orderShort}` }], [{ text: "❌ Cancel & Refund", callback_data: `mdcancel_${orderShort}` }]] }
    );
    return;
  }

  try {
    await executeInternalStockDelivery(chatId, customer, product, qty, totalPrice, emojiMap, verifiedVia, `\n${formatTxnLine(normalizedTxn)}`, false, normalizedTxn);
  } catch (err) {
    console.error("Internal direct delivery error:", err);
    await sendMessage(chatId, "❌ Delivery error or stock finished. Contact admin with your TxID.", mainMenuKeyboard(emojiMap));
  }
}

// ── Execute purchase (balance) ──

async function executePurchase(chatId, customer, productId, qty, emojiMap) {
  const { data: product } = await supabase.from("bot_products").select("*").eq("id", productId).single();
  if (!product) { await sendMessage(chatId, "❌ Product not found.", mainMenuKeyboard(emojiMap)); return; }

  const unitPrice = await getTieredPrice(productId, qty, Number(product.price), customer?.id);
  const total = Math.round(unitPrice * qty * 10000) / 10000;

  // Atomically deduct balance — prevents double-spend race when user fires two orders concurrently
  const { data: deductRows, error: deductErr } = await supabase.rpc("deduct_customer_balance", {
    _customer_id: customer.id,
    _amount: total,
  });
  if (deductErr) {
    console.error("deduct_customer_balance error:", deductErr);
    await sendMessage(chatId, "❌ Could not process payment. Please try again.", mainMenuKeyboard(emojiMap));
    return;
  }
  const deductResult = Array.isArray(deductRows) ? deductRows[0] : deductRows;
  if (!deductResult?.success) {
    await sendMessage(chatId, "❌ Insufficient balance. Please deposit first.", mainMenuKeyboard(emojiMap));
    return;
  }
  const newBalance = Number(deductResult.new_balance);

  // Manual delivery product
  if (product.is_manual_delivery) {
    const { data: orderRow } = await supabase.from("bot_orders").insert({
      customer_id: customer.id, product_id: product.id, product_name: product.name,
      quantity: qty, total_price: total, details: [], row_numbers: [], status: "pending_delivery",
      payment_method: "Balance",
    }).select("id").single();
    if (orderRow?.id) await attachCustomerInputs(orderRow.id, customer.id).catch(() => {});
    const orderShort = (orderRow?.id || "unknown").slice(0, 8);
    processReferralCommission(customer.id, total, orderRow?.id).catch(e => console.error("Ref commission err:", e));
    notifyRecentSale(product.name, qty, product.custom_emoji_id).catch(() => {});
    await sendMessage(chatId,
      `✅ <b>Order Placed!</b>\n\nProduct: <b>${product.name}</b>\nQuantity: <b>${qty}</b>\nTotal: <b>${total.toFixed(2)} ${product.currency}</b>\nRemaining Balance: <b>${newBalance.toFixed(2)} USDT</b>\n\n⏳ <b>Your order is being processed.</b>\nAdmin will deliver it manually.\n⏱ Delivery Time: <b>30 min — 12 hours</b>.\nIf not delivered within 12 hours, your balance will be fully refunded.`,
      mainMenuKeyboard(emojiMap)
    );
    notifyAdmin(
      `🔔 <b>New Manual Delivery Order!</b>\n\n👤 ${getCustomerLabel(customer)}\n📦 Product: <b>${product.name}</b> x${qty}\n💰 Total: <b>${total.toFixed(2)} ${product.currency}</b>\n💳 Payment: <b>Balance</b>`,
      { inline_keyboard: [[{ text: "📦 Deliver", callback_data: `mdlvr_${orderShort}` }], [{ text: "❌ Cancel & Refund", callback_data: `mdcancel_${orderShort}` }]] }
    );
    return;
  }

  try {
    await executeInternalStockDelivery(chatId, customer, product, qty, total, emojiMap, "Balance", `\nRemaining Balance: <b>${newBalance.toFixed(2)} USDT</b>`);
  } catch (err) {
    console.error("Internal balance purchase error:", err);
    // Atomic refund on hard failure
    await supabase.rpc("refund_customer_balance", { _customer_id: customer.id, _amount: total }).then(({ error }) => {
      if (error) console.error("refund_customer_balance err:", error);
    });
    await sendMessage(chatId, "❌ Not enough stock or delivery error. Your balance has been refunded.", mainMenuKeyboard(emojiMap));
  }
}

// ── Auto-deduct Pay Later from deposit (atomic) ──
async function autoDeductPayLater(customerId, depositAmount) {
  const { data: cust } = await supabase.from("bot_customers").select("pay_later_used, pay_later_enabled").eq("id", customerId).single();
  if (!cust || !cust.pay_later_enabled || Number(cust.pay_later_used) <= 0) return { deducted: 0, remaining: depositAmount };

  const used = Number(cust.pay_later_used);
  const deduct = Math.min(used, depositAmount);
  if (deduct <= 0) return { deducted: 0, remaining: depositAmount };

  // Use atomic RPC — refund_pay_later_credit decrements `used` under row lock
  const { data: rows, error } = await supabase.rpc("refund_pay_later_credit", { _customer_id: customerId, _amount: deduct });
  if (error) { console.error("autoDeductPayLater refund err:", error); return { deducted: 0, remaining: depositAmount }; }
  const r = Array.isArray(rows) ? rows[0] : rows;
  const newUsed = Number(r?.new_used ?? Math.max(0, used - deduct));
  return { deducted: deduct, remaining: depositAmount - deduct, newUsed };
}

// ── Execute Pay Later Purchase ──
async function executePayLaterPurchase(chatId, customer, productId, qty, emojiMap) {
  const { data: product } = await supabase.from("bot_products").select("*").eq("id", productId).single();
  if (!product) { await sendMessage(chatId, "❌ Product not found.", mainMenuKeyboard(emojiMap)); return; }

  const unitPrice = await getTieredPrice(productId, qty, Number(product.price), customer?.id);
  const total = Math.round(unitPrice * qty * 10000) / 10000;

  // Atomic pay-later credit deduction
  const { data: deductRows, error: deductErr } = await supabase.rpc("deduct_pay_later_credit", {
    _customer_id: customer.id,
    _amount: total,
  });
  if (deductErr) {
    console.error("deduct_pay_later_credit error:", deductErr);
    await sendMessage(chatId, "❌ Could not process Pay Later. Please try again.", mainMenuKeyboard(emojiMap));
    return;
  }
  const deductResult = Array.isArray(deductRows) ? deductRows[0] : deductRows;
  if (!deductResult?.success) {
    await sendMessage(chatId, "❌ Insufficient Pay Later credit.", mainMenuKeyboard(emojiMap));
    return;
  }
  const newUsed = Number(deductResult.new_used);
  const limit = Number(deductResult.limit_amount);
  const remainingCredit = Math.max(0, limit - newUsed);

  if (!product.is_manual_delivery) {
    try {
      await executeInternalStockDelivery(
        chatId,
        customer,
        product,
        qty,
        total,
        emojiMap,
        "Pay Later",
        `\n🏷️ Credit Used: <b>${total.toFixed(2)} USDT</b>\n💳 Remaining Credit: <b>${remainingCredit.toFixed(2)} USDT</b>`,
        true
      );
      notifyAdmin(`📦 <b>New Order (Pay Later)</b>\n\n👤 ${getCustomerLabel(customer)}\n🛒 Product: <b>${product.name}</b> x${qty}\n💰 Total: <b>${total.toFixed(2)} ${product.currency}</b>\n🏷️ Payment: <b>Pay Later</b>\n💳 Used: <b>${newUsed.toFixed(2)}/${limit.toFixed(2)} USDT</b>`);
    } catch (err) {
      console.error("Internal Pay Later purchase error:", err);
      // Atomic refund of pay-later credit on hard failure
      await supabase.rpc("refund_pay_later_credit", { _customer_id: customer.id, _amount: total }).then(({ error }) => {
        if (error) console.error("refund_pay_later_credit err:", error);
      });
      await sendMessage(chatId, "❌ Not enough stock or delivery error. Your credit has been refunded.", mainMenuKeyboard(emojiMap));
    }
    return;
  }

  // Manual delivery product
  const { data: orderRow } = await supabase.from("bot_orders").insert({
    customer_id: customer.id, product_id: product.id, product_name: product.name,
    quantity: qty, total_price: total, details: [], row_numbers: [], status: "pending_delivery",
    payment_method: "Pay Later",
  }).select("id").single();
  if (orderRow?.id) await attachCustomerInputs(orderRow.id, customer.id).catch(() => {});
  const orderShort = (orderRow?.id || "unknown").slice(0, 8);
  processReferralCommission(customer.id, total, orderRow?.id).catch(e => console.error("Ref commission err:", e));
  notifyRecentSale(product.name, qty, product.custom_emoji_id).catch(() => {});
  await sendMessage(chatId,
    `✅ <b>Order Placed (Pay Later)!</b>\n\nProduct: <b>${product.name}</b>\nQuantity: <b>${qty}</b>\nTotal: <b>${total.toFixed(2)} ${product.currency}</b>\n🏷️ Credit Used: <b>${total.toFixed(2)} USDT</b>\n💳 Remaining Credit: <b>${remainingCredit.toFixed(2)} USDT</b>\n\n⏳ <b>Your order is being processed.</b>\nAdmin will deliver it manually.`,
    mainMenuKeyboard(emojiMap)
  );
  notifyAdmin(
    `🔔 <b>New Manual Delivery Order (Pay Later)!</b>\n\n👤 ${getCustomerLabel(customer)}\n📦 Product: <b>${product.name}</b> x${qty}\n💰 Total: <b>${total.toFixed(2)} ${product.currency}</b>\n🏷️ Payment: <b>Pay Later</b>`,
    { inline_keyboard: [[{ text: "📦 Deliver", callback_data: `mdlvr_${orderShort}` }], [{ text: "❌ Cancel & Refund", callback_data: `mdcancel_${orderShort}` }]] }
  );
}

// ── Orders ──

async function showOrders(chatId, customer, page = 0, emojiMap = {}, editMessageId = null) {
  const PAGE_SIZE = 5;
  const offset = page * PAGE_SIZE;

  const { data: orders, count } = await supabase
    .from("bot_orders")
    .select("*", { count: "exact" })
    .eq("customer_id", customer.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (!orders || orders.length === 0) {
    if (page === 0) await editOrSend(chatId, editMessageId, "📦 You have no orders yet.", mainMenuKeyboard(emojiMap));
    else await editOrSend(chatId, editMessageId, "📦 No more orders.", mainMenuKeyboard(emojiMap));
    return;
  }

  const totalPages = Math.ceil((count || 0) / PAGE_SIZE);
  let msg = `📦 <b>ORDER HISTORY</b>\n\nSelect an order to view details:`;
  const buttons = [];

  for (const o of orders) {
    const rows = (o.row_numbers || []);
    const rowLabel = rows.length > 0 ? `#${Math.min(...rows)}` : "";
    const priceStr = Number(o.total_price) >= 1000 ? `${Math.round(Number(o.total_price) / 1000)}k` : String(Number(o.total_price));
    const statusPrefix = o.status === "pending_delivery" ? "⏳ " : o.status === "cancelled" ? "❌ " : "";
    const btnText = `${statusPrefix}${rowLabel} ${o.product_name}  x${o.quantity} ${priceStr}`.trim();
    buttons.push([{ text: btnText, callback_data: `vord_${o.id}` }]);
  }

  const navRow = [];
  if (page > 0) navRow.push({ text: "⬅️ Prev", callback_data: `ordpg_${page - 1}` });
  if (page + 1 < totalPages) navRow.push({ text: "➡️ Next", callback_data: `ordpg_${page + 1}` });
  if (navRow.length > 0) buttons.push(navRow);
  buttons.push([applyEmoji({ text: "◀️ Back", callback_data: "menu_profile" }, "back", emojiMap)]);

  await editOrSend(chatId, editMessageId, msg, { inline_keyboard: buttons });
}

async function handleViewOrder(chatId, customer, orderIdOrShortId, emojiMap, editMessageId = null) {
  let order = null;

  if (/^[0-9a-f-]{36}$/i.test(orderIdOrShortId)) {
    const { data } = await supabase
      .from("bot_orders")
      .select("*")
      .eq("id", orderIdOrShortId)
      .eq("customer_id", customer.id)
      .maybeSingle();
    order = data;
  } else {
    const { data: recentOrders } = await supabase
      .from("bot_orders")
      .select("*")
      .eq("customer_id", customer.id)
      .order("created_at", { ascending: false })
      .limit(100);
    order = recentOrders?.find((item) => String(item.id).startsWith(orderIdOrShortId));
  }

  if (!order) { await editOrSend(chatId, editMessageId, "❌ Order not found.", mainMenuKeyboard()); return; }

  // Fetch product emoji
  const { data: prodData } = await supabase.from("bot_products").select("custom_emoji_id").eq("id", order.product_id).single();
  const orderProductEmoji = prodData?.custom_emoji_id
    ? `<tg-emoji emoji-id="${prodData.custom_emoji_id}">📦</tg-emoji>`
    : "📦";

  const date = new Date(order.created_at).toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const statusEmoji = order.status === "completed" ? "✅" : order.status === "pending_delivery" ? "⏳" : order.status === "cancelled" ? "❌" : "📦";
  const statusLabel = order.status === "pending_delivery" ? "Pending Delivery" : order.status === "cancelled" ? "Cancelled" : "Completed";

  const orderNum = order.id.substring(0, 4).toUpperCase();
  let msg = `📦 <b>Order #${orderNum}</b>\n\n📌 Product: <b>${order.product_name}</b>\n📊 Quantity: ${order.quantity}\n💰 Total: ${Number(order.total_price).toFixed(2)} USDT\n📅 Date: ${date}\n${statusEmoji} Status: <b>${statusLabel}</b>\n`;

  const details = order.details || [];
  if (details.length > 0 && order.status === "completed") {
    msg += `\n${orderProductEmoji} <b>${order.product_name} × ${order.quantity}</b>\n\n`;
    const SHOW_INLINE = 10;
    const showItems = details.slice(0, SHOW_INLINE);
    const historyKeys = Object.keys(showItems[0] || {});
    const historyMultiCol = historyKeys.length > 1;
    for (let i = 0; i < showItems.length; i++) {
      const entries = Object.entries(showItems[i]).filter(([, v]) => v && String(v).trim());
      const numPrefix = details.length > 1 ? `${i + 1}. ` : '';
      if (!historyMultiCol || entries.length <= 1) {
        const mainVal = entries.find(([, v]) => String(v).startsWith('http'))?.[1] || entries[0]?.[1] || '';
        msg += `${numPrefix}<code>${mainVal}</code>\n`;
      } else {
        msg += `${numPrefix.trim()}`;
        for (const [key, val] of entries) msg += `\n<b>${key}:</b> <code>${val}</code>`;
        msg += `\n`;
      }
    }
    if (details.length > SHOW_INLINE) msg += `\n... and ${details.length - SHOW_INLINE} more items`;
  } else if (order.status === "pending_delivery") {
    msg += `\n⏳ <i>This order is awaiting manual delivery from admin.\n⏱ Delivery Time: 30 min — 12 hours. If delayed, full refund guaranteed.</i>`;
  } else if (order.status === "cancelled") {
    msg += `\n❌ <i>This order was cancelled and refunded.</i>`;
  }

  const btns = [];
  if (details.length > 0 && order.status === "completed") {
    btns.push([
      applyEmoji({ text: "📄 TXT", callback_data: `dl_txt_${order.id}` }, "download_txt", emojiMap),
      applyEmoji({ text: "📊 CSV", callback_data: `dl_csv_${order.id}` }, "download_csv", emojiMap),
    ]);
  }
  btns.push([applyEmoji({ text: "🔙 Back to Orders", callback_data: "ordpg_0" }, "back", emojiMap)]);
  await editOrSend(chatId, editMessageId, msg, { inline_keyboard: btns });
}

// ── Withdrawal ──

async function handleWithdrawStart(chatId, customer, emojiMap = {}, editMessageId = null) {
  const { data: fresh } = await supabase.from("bot_customers").select("balance").eq("id", customer.id).single();
  const balance = fresh ? Number(fresh.balance) : 0;
  if (balance <= 0) { await editOrSend(chatId, editMessageId, "❌ You have no balance to withdraw.", mainMenuKeyboard(emojiMap)); return; }
  await supabase.from("bot_customers").update({ pending_action: "withdraw_amount" }).eq("id", customer.id);
  const cancelBtn = [applyEmoji({ text: "❌ Cancel", callback_data: "menu_profile" }, "cancel", emojiMap)];
  const withdrawMsg = replacePlaceholder(getPageMsg("msg_withdraw", `💸 <b>Withdraw Funds</b>\n\nYour Balance: <b>{balance} USDT</b>\n\nEnter the amount you want to withdraw:`), 'balance', balance.toFixed(2));
  await editOrSend(chatId, editMessageId, withdrawMsg, { inline_keyboard: [cancelBtn] });
}

async function showAdminWithdrawals(chatId, emojiMap, editMessageId) {
  const { data: wds } = await supabase.from("bot_withdrawals").select("*, customer:bot_customers(chat_id, username, first_name)").eq("status", "pending").order("created_at", { ascending: false }).limit(20);
  if (!wds || wds.length === 0) { await editOrSend(chatId, editMessageId, "✅ No pending withdrawals.", { inline_keyboard: [[{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]] }); return; }
  let msg = `💸 <b>Pending Withdrawals (${wds.length})</b>\n\n`;
  const buttons = [];
  for (const w of wds) {
    const cust = w.customer;
    const label = cust?.username ? `@${cust.username}` : cust?.first_name || `#${cust?.chat_id}`;
    const date = new Date(w.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    msg += `👤 ${label} — <b>${Number(w.amount).toFixed(2)} USDT</b> — ${date}\n📋 <code>${w.payment_details}</code>\n\n`;
    buttons.push([
      applyEmoji({ text: `✅ ${label}`, callback_data: `wd_approve_${w.id}` }, "approve_withdrawal", emojiMap),
      applyEmoji({ text: `❌ Reject`, callback_data: `wd_reject_${w.id}` }, "reject_withdrawal", emojiMap),
    ]);
  }
  buttons.push([{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]);
  await editOrSend(chatId, editMessageId, msg, { inline_keyboard: buttons });
}

async function handleDownloadOrder(chatId, orderId, isCsv) {
  const { data: order } = await supabase.from("bot_orders").select("*").eq("id", orderId).single();
  if (!order || !order.details) { await sendMessage(chatId, "❌ Order not found.", mainMenuKeyboard()); return; }
  const details = order.details;
  const productName = order.product_name || "order";
  const startRow = order.row_numbers?.[0] || 1;
  const endRow = order.row_numbers?.[order.row_numbers.length - 1] || details.length;

  const getMainValue = (item) => {
    const values = Object.values(item).filter(v => v && String(v).trim());
    return values.find(v => String(v).startsWith('http')) || values[0] || '';
  };

  const dlKeys = Object.keys(details[0] || {});
  const dlMultiCol = dlKeys.length > 1;

  const getItemText = (item, idx) => {
    const entries = Object.entries(item).filter(([, v]) => v && String(v).trim());
    if (!dlMultiCol || entries.length <= 1) {
      return entries.find(([, v]) => String(v).startsWith('http'))?.[1] || entries[0]?.[1] || '';
    }
    return entries.map(([k, v]) => `${k}: ${v}`).join('\n');
  };

  if (isCsv) {
    if (dlMultiCol) {
      let csv = dlKeys.join(',') + '\n';
      for (const item of details) csv += dlKeys.map(k => `"${(item[k] || '').replace(/"/g, '""')}"`).join(',') + '\n';
      const filename = `${productName}-#${startRow}-#${endRow}.csv`;
      await sendDocumentBuffer(chatId, Buffer.from(csv), filename, `📊 ${productName} — ${details.length} items`);
    } else {
      let csv = "Item\n";
      for (const item of details) csv += `"${getItemText(item).replace(/"/g, '""')}"\n`;
      const filename = `${productName}-#${startRow}-#${endRow}.csv`;
      await sendDocumentBuffer(chatId, Buffer.from(csv), filename, `📊 ${productName} — ${details.length} items`);
    }
  } else {
    let txt = "";
    for (let i = 0; i < details.length; i++) {
      const text = getItemText(details[i], i);
      txt += details.length > 1 ? `${i + 1}. ${text}\n${dlMultiCol ? '\n' : ''}` : `${text}\n${dlMultiCol ? '\n' : ''}`;
    }
    const filename = `${productName}-#${startRow}-#${endRow}.txt`;
    await sendDocumentBuffer(chatId, Buffer.from(txt), filename, `📄 ${productName} — ${details.length} items`);
  }
}

// ── Handle media message (photo/video) ──

async function handleMediaMessage(message, emojiMap) {
  const chatId = message.chat.id;

  // Maintenance mode guard
  if (maintenanceMode && !isAdmin(chatId)) {
    await sendMessage(chatId, MAINTENANCE_MSG);
    return;
  }

  const customer = await getOrCreateCustomer(chatId, message.from?.first_name, message.from?.username);

  // Banned user guard
  if (customer.is_banned && !isAdmin(chatId)) {
    await sendMessage(chatId, `🚫 <b>You are banned from using this bot.</b>${customer.ban_reason ? `\n\nReason: ${customer.ban_reason}` : ""}`);
    return;
  }

  // Admin media upload for product delivery instructions
  if (customer.pending_action?.startsWith("admin_media_upload_") && isAdmin(chatId)) {
    const prodShort = customer.pending_action.replace("admin_media_upload_", "");
    await supabase.from("bot_customers").update({ pending_action: null }).eq("chat_id", chatId);

    const { data: prods } = await supabase.from("bot_products").select("id, name, delivery_media");
    const prod = prods?.find(p => p.id.startsWith(prodShort));
    if (!prod) { await sendMessage(chatId, "❌ Product not found.", mainMenuKeyboard()); return; }

    let fileId, mediaType;
    if (message.photo) {
      // Get the largest photo
      fileId = message.photo[message.photo.length - 1].file_id;
      mediaType = "image";
    } else if (message.video) {
      fileId = message.video.file_id;
      mediaType = "video";
    }

    if (!fileId) { await sendMessage(chatId, "❌ Could not process media.", mainMenuKeyboard()); return; }

    // Get file URL from Telegram
    const fileRes = await tgFetch("getFile", { file_id: fileId });
    if (!fileRes?.ok || !fileRes.result?.file_path) {
      await sendMessage(chatId, "❌ Failed to get file from Telegram.", mainMenuKeyboard());
      return;
    }

    const filePath = fileRes.result.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

    // Download and upload to Supabase Storage
    try {
      const fileResponse = await fetch(fileUrl);
      if (!fileResponse.ok) throw new Error("Download failed");
      const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
      const ext = filePath.split('.').pop() || (mediaType === 'video' ? 'mp4' : 'jpg');
      const storagePath = `${prod.id}/${Date.now()}.${ext}`;
      const contentType = mediaType === 'video' ? 'video/mp4' : 'image/jpeg';

      const { error: uploadError } = await supabase.storage
        .from("instruction-media")
        .upload(storagePath, fileBuffer, { contentType, upsert: false });

      if (uploadError) throw uploadError;

      const { data: publicUrl } = supabase.storage.from("instruction-media").getPublicUrl(storagePath);
      const url = publicUrl.publicUrl;

      let mediaItems = [];
      try { mediaItems = typeof prod.delivery_media === 'string' ? JSON.parse(prod.delivery_media) : prod.delivery_media || []; } catch {}
      mediaItems.push({ url, type: mediaType });
      await supabase.from("bot_products").update({ delivery_media: mediaItems }).eq("id", prod.id);

      await sendMessage(chatId, `✅ ${mediaType === 'video' ? '🎥 Video' : '🖼️ Photo'} added to <b>${prod.name}</b>!`, { inline_keyboard: [[{ text: "📷 Add More", callback_data: `pmedia_add_${prodShort}` }], [{ text: "◀️ Media", callback_data: `pmedia_${prodShort}` }]] });
    } catch (err) {
      console.error("Media upload error:", err);
      await sendMessage(chatId, `❌ Upload failed: ${err.message}`, mainMenuKeyboard());
    }
    return;
  }

  // If not an admin media upload, ignore photo/video
  await sendMessage(chatId, "Use the menu buttons below to navigate.", mainMenuKeyboard());
}

// ── Handle message ──

async function handleMessage(message, emojiMap) {
  const chatId = message.chat.id;
  const rawText = typeof message.text === "string" ? message.text : "";
  const text = rawText.trim();
  await fetchPageMsgs();

  // Maintenance mode guard — allow admin through
  if (maintenanceMode && !isAdmin(chatId)) {
    await sendMessage(chatId, MAINTENANCE_MSG);
    return;
  }

  const customer = await getOrCreateCustomer(chatId, message.from?.first_name, message.from?.username);

  // Banned user guard
  if (customer.is_banned && !isAdmin(chatId)) {
    await sendMessage(chatId, `🚫 <b>You are banned from using this bot.</b>${customer.ban_reason ? `\n\nReason: ${customer.ban_reason}` : ""}`);
    return;
  }

  // Channel join verification guard
  if (!(await ensureChannelVerified(chatId))) return;

  // ── Customer input collection (purchase pre-checkout) ──
  if (customer.pending_action?.startsWith("collectinput_") && text && !text.startsWith("/")) {
    const parts = customer.pending_action.replace("collectinput_", "").split("_");
    const idx = parseInt(parts[parts.length - 1] || "0");
    const qty = parseInt(parts[parts.length - 2] || "1");
    const productId = parts.slice(0, -2).join("_");
    const { data: product } = await supabase.from("bot_products").select("*").eq("id", productId).single();
    if (!product) {
      await supabase.from("bot_customers").update({ pending_action: null, pending_inputs: null }).eq("id", customer.id);
      await sendMessage(chatId, "❌ Product not found.", mainMenuKeyboard(emojiMap));
      return;
    }
    const fields = getProductInputFields(product);
    const totalSteps = fields.length * qty;
    const itemIdx = Math.floor(idx / Math.max(1, fields.length));
    const fieldIdx = idx % Math.max(1, fields.length);
    const field = fields[fieldIdx];
    if (!field || idx >= totalSteps) {
      await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
      await showBuyConfirmation(chatId, customer, productId, qty, emojiMap);
      return;
    }
    const v = validateInputValue(field, text);
    if (!v.ok) {
      await sendMessage(chatId, `❌ ${v.error}`, { inline_keyboard: [[applyEmoji({ text: "❌ Cancel", callback_data: `cancelinput_${productId}` }, "cancel", emojiMap)]] });
      return;
    }
    const pending = customer.pending_inputs && typeof customer.pending_inputs === "object" ? customer.pending_inputs : { productId, qty, values: {} };
    const key = inputKey(field, qty, itemIdx);
    const values = { ...(pending.values || {}), [key]: v.value };
    const updated = { productId, qty, values };
    await supabase.from("bot_customers").update({ pending_inputs: updated }).eq("id", customer.id);
    const fresh = { ...customer, pending_inputs: updated };
    await promptCustomerInput(chatId, fresh, product, qty, idx + 1, emojiMap);
    return;
  }

  // /bind <CODE>  → link this Telegram account to a web account that generated <CODE>
  if (text?.startsWith("/bind")) {
    const parts = text.trim().split(/\s+/);
    const code = (parts[1] || "").toUpperCase();
    if (!code) {
      await sendMessage(chatId, "Usage: <code>/bind &lt;CODE&gt;</code>\n\nGenerate a code from your web account → Account page → Bind Telegram.", { parse_mode: "HTML" });
      return;
    }
    try {
      const resp = await fetch(`${process.env.SUPABASE_URL}/functions/v1/bot-bind-telegram-confirm`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code,
          chat_id: chatId,
          username: msg?.from?.username || null,
          first_name: msg?.from?.first_name || null,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        await sendMessage(chatId, `❌ ${data?.error || "Failed to bind"}`);
      } else {
        await sendMessage(chatId, "✅ Your Telegram is now linked to your web account. You can use either to access the same balance and orders.");
      }
    } catch (e) {
      await sendMessage(chatId, `❌ Bind failed: ${e.message}`);
    }
    return;
  }

  if (text === "/start" || text?.startsWith("/start ")) {
    // Deep linking: /start p_<short_code> → directly show product details
    const startParam = text.split(" ")[1];
    if (startParam && startParam.startsWith("p_")) {
      const shortCode = startParam.replace("p_", "").toUpperCase();
      const { data: prod, error: prodErr } = await supabase.from("bot_products").select("id").eq("short_code", shortCode).maybeSingle();
      console.log(`Deep link lookup: shortCode=${shortCode}, prod=${JSON.stringify(prod)}, error=${prodErr?.message}`);
      if (prod) {
        await handleBuyProduct(chatId, customer, prod.id, emojiMap);
        return;
      }
      await sendMessage(chatId, "❌ Product not found.", mainMenuKeyboard());
      return;
    }

    // Referral deep link: /start ref_<code>
    if (startParam && startParam.startsWith("ref_")) {
      const refCode = startParam.replace("ref_", "").toLowerCase();
      // Find referrer by matching code
      const { data: allCustomers } = await supabase.from("bot_customers").select("id, chat_id, balance").neq("id", customer.id);
      if (allCustomers) {
        const referrer = allCustomers.find(c => generateReferralCode(c.chat_id) === refCode);
        if (referrer) {
          // Check if already referred (one-time per referred user)
          const { data: existingRef } = await supabase.from("bot_referrals").select("id").eq("referred_id", customer.id).maybeSingle();
          if (!existingRef) {
            await supabase.from("bot_referrals").insert({ referrer_id: referrer.id, referred_id: customer.id });
            console.log(`Referral registered: ${customer.id} referred by ${referrer.id}`);
            // Campaign join bonus is credited automatically by DB trigger
            // (handle_referral_campaign_credit) into referral_balance.
            // Notify referrer if campaign is active.
            try {
              const campaign = await getCampaignSettings();
              if (campaign.active && campaign.reward > 0) {
                sendMessage(
                  referrer.chat_id,
                  `🎉 <b>Referral Join Bonus!</b>\n\nA new user joined via your referral link.\nYou earned <b>${Number(campaign.reward).toFixed(2)} USDT</b> in your referral balance!`
                ).catch(() => {});
              }
            } catch (e) {
              console.error("Join-bonus notify failed:", e?.message || e);
            }
          }

        }
      }
      // Continue to show welcome regardless
    }
    
    // Remove any persisting reply keyboard
    const tmpMsg = await sendMessage(chatId, "⏳", removeReplyKeyboard());
    if (tmpMsg?.result?.message_id) {
      await tgFetch("deleteMessage", { chat_id: chatId, message_id: tmpMsg.result.message_id }).catch(() => {});
    }
    
    const welcomeMsg = await getWelcomeMsg(customer.first_name || "there");
    await sendMessage(chatId, welcomeMsg, mainMenuKeyboard(emojiMap));
    return;
  }

  // ── Shortcut commands (Menu button) ──
  if (text === "/shop") { await showShop(chatId, emojiMap); return; }
  if (text === "/balance") { await showBalance(chatId, customer, emojiMap); return; }
  if (text === "/deposit") { await showDepositInfo(chatId, emojiMap); return; }
  if (text === "/orders") { await showOrders(chatId, customer, 0, emojiMap); return; }
  if (text === "/api") { await showDeveloperApi(chatId, customer, emojiMap); return; }
  if (text === "/withdraw") { await handleWithdrawStart(chatId, customer, emojiMap); return; }
  if (text === "/support") {
    await sendMessage(chatId,
      `🆘 <b>Support</b>\n\nNeed help? Contact our admin:\n\n👤 @Rexovaan\n\nWe usually respond within a few hours.`,
      mainMenuKeyboard(emojiMap)
    );
    return;
  }

  if ((text === "/admin" || text === "⚙️ Admin") && isAdmin(chatId)) {
    await showAdminMenu(chatId, emojiMap);
    return;
  }

  if (text === "/maintenance" && isAdmin(chatId)) {
    maintenanceMode = !maintenanceMode;
    const status = maintenanceMode ? "🔴 ON — Users will see maintenance message" : "🟢 OFF — Bot is live";
    await sendMessage(chatId, `🔧 <b>Maintenance Mode:</b> ${status}`, mainMenuKeyboard());
    return;
  }

  if (text === "/cancel" && isAdmin(chatId)) {
    await supabase.from("bot_customers").update({ pending_action: null }).eq("chat_id", chatId);
    await sendMessage(chatId, "❌ Cancelled.", mainMenuKeyboard());
    return;
  }

  // /setdigits → instructs admin to send 0123456789: with premium emojis
  if (text === "/setdigits" && isAdmin(chatId)) {
    await supabase.from("bot_customers").update({ pending_action: "admin_setdigits" }).eq("chat_id", chatId);
    await sendMessage(chatId,
      `🔢 <b>Set Countdown Digit Emojis</b>\n\nNow send a single message containing exactly:\n<code>0123456789:</code>\n\n…where every character is replaced with the matching <b>premium emoji</b> from your favorite pack (e.g. RetroFontEmoji). Order matters: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → :\n\nSend /cancel to abort. Send /resetdigits to clear current mapping.`
    );
    return;
  }

  if (text === "/resetdigits" && isAdmin(chatId)) {
    const { data: existing } = await supabase.from("bot_settings").select("id").eq("key", "countdown_digit_emojis").maybeSingle();
    if (existing) await supabase.from("bot_settings").update({ value: "{}", updated_at: new Date().toISOString() }).eq("key", "countdown_digit_emojis");
    invalidateDigitEmojisCache();
    await sendMessage(chatId, "✅ Countdown digit emojis cleared. Countdowns will use plain digits again.");
    return;
  }

  // Capture the digits message after /setdigits
  if (customer.pending_action === "admin_setdigits" && isAdmin(chatId)) {
    const ents = Array.isArray(message.entities) ? message.entities.filter((e) => e.type === "custom_emoji") : [];
    if (ents.length === 0) {
      await sendMessage(chatId, "❌ No premium emojis detected in that message. Send digits 0–9 and `:` as premium emojis, or /cancel.");
      return;
    }
    // Position-based mapping (independent of base character — pack-agnostic).
    // Expected order: 0,1,2,3,4,5,6,7,8,9,:
    const required = ["0","1","2","3","4","5","6","7","8","9",":"];
    if (ents.length < required.length) {
      await sendMessage(chatId,
        `⚠️ Got only <b>${ents.length}</b> premium emojis. Need <b>11</b> in this exact order: <code>0 1 2 3 4 5 6 7 8 9 :</code>\n\nResend the full sequence, or /cancel.`
      );
      return;
    }
    const sorted = [...ents].sort((a, b) => a.offset - b.offset);
    const map = {};
    for (let i = 0; i < required.length; i++) {
      map[required[i]] = sorted[i].custom_emoji_id;
    }
    const json = JSON.stringify(map);
    const { data: existing } = await supabase.from("bot_settings").select("id").eq("key", "countdown_digit_emojis").maybeSingle();
    if (existing) {
      await supabase.from("bot_settings").update({ value: json, updated_at: new Date().toISOString() }).eq("key", "countdown_digit_emojis");
    } else {
      await supabase.from("bot_settings").insert({ key: "countdown_digit_emojis", value: json });
    }
    await supabase.from("bot_customers").update({ pending_action: null }).eq("chat_id", chatId);
    invalidateDigitEmojisCache();
    const preview = renderCountdownPremium("02:45:13", map);
    await sendMessage(chatId, `✅ <b>Countdown digit emojis saved!</b>\n\nPreview: ${preview}\n\nAll active and future flash sale countdowns will use these.`);
    return;
  }

  if (text === "/notify_pending" && isAdmin(chatId)) {
    const { data: pendings } = await supabase
      .from("bot_orders")
      .select("*, customer:bot_customers(*)")
      .eq("status", "pending_delivery")
      .order("created_at", { ascending: false })
      .limit(50);
    if (!pendings || pendings.length === 0) {
      await sendMessage(chatId, "✅ No pending delivery orders.", mainMenuKeyboard());
      return;
    }
    for (const o of pendings) {
      const orderShort = o.id.slice(0, 8);
      await notifyAdmin(
        `🔔 <b>Pending Delivery</b>\n\n👤 ${getCustomerLabel(o.customer)}\n📦 Product: <b>${escapeHtml(o.product_name)}</b> x${o.quantity}\n💰 Total: <b>${Number(o.total_price).toFixed(2)} USDT</b>\n📅 ${new Date(o.created_at).toLocaleString()}\n\nDeliver from source bot, then tap below.`,
        { inline_keyboard: [[{ text: "📦 Deliver", callback_data: `mdlvr_${orderShort}` }], [{ text: "❌ Cancel & Refund", callback_data: `mdcancel_${orderShort}` }]] }
      ).catch(() => {});
    }
    await sendMessage(chatId, `✅ Re-sent ${pendings.length} pending delivery notification(s).`, mainMenuKeyboard());
    return;
  }

  // Force price change broadcast - admin types old price
  if (customer.pending_action?.startsWith("force_pricech_") && isAdmin(chatId)) {
    const productId = customer.pending_action.replace("force_pricech_", "");
    await supabase.from("bot_customers").update({ pending_action: null }).eq("chat_id", chatId);
    const oldPrice = Number(text.trim());
    if (isNaN(oldPrice) || oldPrice < 0) {
      await sendMessage(chatId, "❌ Invalid price. Cancelled.", mainMenuKeyboard());
      return;
    }
    const { data: product } = await supabase.from("bot_products").select("*").eq("id", productId).single();
    if (!product) { await sendMessage(chatId, "❌ Product not found.", mainMenuKeyboard()); return; }
    const newPrice = Number(product.price);
    if (oldPrice === newPrice) {
      await sendMessage(chatId, `❌ Old price (${oldPrice.toFixed(2)}) cannot equal current price (${newPrice.toFixed(2)}).`, mainMenuKeyboard());
      return;
    }
    const isUp = newPrice > oldPrice;
    await fetchPageMsgs();
    const tplKey = isUp ? "msg_price_up" : "msg_price_down";
    const bulkPricing = await formatBulkPricingBlock(productId);
    const defaultUp = `📈 <b>Price Increased</b>\n\n📦 <b>{product}</b>\n💰 Old: <s>${oldPrice.toFixed(2)} USDT</s>\n💎 New: <b>{new_price} USDT</b>{bulk_pricing}\n\n<i>Grab it before it goes higher!</i>`;
    const defaultDown = `📉 <b>Price Drop!</b>\n\n📦 <b>{product}</b>\n💰 Was: <s>${oldPrice.toFixed(2)} USDT</s>\n🔥 Now: <b>{new_price} USDT</b>{bulk_pricing}\n\n<i>Limited time offer — buy now!</i>`;
    let tpl = cachedPageMsgs[tplKey] || (isUp ? defaultUp : defaultDown);
    const productIcon = product.custom_emoji_id ? `<tg-emoji emoji-id="${product.custom_emoji_id}">📦</tg-emoji> ` : "";
    if (productIcon) tpl = tpl.replace(/📦\s*(<[^>]+>)?\s*\{product\}/g, "$1{product}");
    const broadcastMsg = replacePlaceholders(tpl, {
      product: `${productIcon}${product.name}`,
      old_price: oldPrice.toFixed(2),
      new_price: newPrice.toFixed(2),
      price: newPrice.toFixed(2),
      bulk_pricing: bulkPricing,
    });
    const botUser = await getBotUsername();
    const code = product.short_code || product.id.slice(0, 4).toUpperCase();
    const { data: buyNowEmoji } = await supabase.from("bot_button_emojis").select("custom_emoji_id").eq("button_key", "buy_now").maybeSingle();
    const buyBtn = buyNowButton({ text: `Buy ${product.name}`, url: `https://t.me/${botUser}?start=p_${code}` }, { buy_now: { emoji: buyNowEmoji?.custom_emoji_id || null } });
    const broadcastKeyboard = { inline_keyboard: [[buyBtn]] };
    await sendMessage(chatId, `${isUp ? '📈' : '📉'} Broadcasting price ${isUp ? 'increase' : 'drop'}...`);
    const { total, sent, failed } = await broadcastToAll(broadcastMsg, broadcastKeyboard);
    const settingKey = `last_price_${productId}`;
    const { data: lastRow } = await supabase.from("bot_settings").select("value").eq("key", settingKey).maybeSingle();
    if (lastRow) {
      await supabase.from("bot_settings").update({ value: String(newPrice), updated_at: new Date().toISOString() }).eq("key", settingKey);
    } else {
      await supabase.from("bot_settings").insert({ key: settingKey, value: String(newPrice) });
    }
    await sendMessage(chatId, `✅ <b>Price ${isUp ? 'Up' : 'Down'} Broadcast Complete!</b>\n\n📦 <b>${product.name}</b>\n💰 ${oldPrice.toFixed(2)} → <b>${newPrice.toFixed(2)} USDT</b>\n📤 Sent: <b>${sent}</b>\n❌ Failed: <b>${failed}</b>\n👥 Total: <b>${total}</b>`, mainMenuKeyboard());
    return;
  }

  // ── Admin pending action handlers ──

  // Add internal stock product - name
  if (customer.pending_action === "admin_addstock_name" && isAdmin(chatId)) {
    const prodName = text.trim();
    if (!prodName) { await sendMessage(chatId, "❌ Invalid name. Try again."); return; }
    await supabase.from("bot_customers").update({ pending_action: `admin_addstock_price_${prodName}` }).eq("chat_id", chatId);
    await sendMessage(chatId, `Product: <b>${prodName}</b>\n\nNow enter the price (USDT):`, { force_reply: true, selective: true });
    return;
  }

  // Add internal stock product - price
  if (customer.pending_action?.startsWith("admin_addstock_price_") && isAdmin(chatId)) {
    const prodName = customer.pending_action.replace("admin_addstock_price_", "");
    await supabase.from("bot_customers").update({ pending_action: null }).eq("chat_id", chatId);
    const price = parseFloat(text);
    if (isNaN(price) || price < 0) { await sendMessage(chatId, "❌ Invalid price.", mainMenuKeyboard()); return; }
    const { data: maxSort } = await supabase.from("bot_products").select("sort_order").order("sort_order", { ascending: false }).limit(1);
    const nextOrder = (maxSort && maxSort.length > 0 ? maxSort[0].sort_order : 0) + 1;
    const { error } = await supabase.from("bot_products").insert({
      name: prodName, sheet_tab: prodName, price, stock_source: "internal", is_manual_delivery: false,
      is_active: true, sort_order: nextOrder, detail_columns: ["Delivery Info"], sold_column: "", sold_value: "",
    });
    if (error) { await sendMessage(chatId, `❌ Failed: ${error.message}`, mainMenuKeyboard()); return; }
    await sendMessage(chatId, `✅ Stock product <b>${prodName}</b> added!\nPrice: <b>$${price.toFixed(2)} USDT</b>`, { inline_keyboard: [[{ text: "◀️ Products", callback_data: "adm_products" }]] });
    return;
  }

  // Add manual product - name
  if (customer.pending_action === "admin_addmanual_name" && isAdmin(chatId)) {
    const prodName = text.trim();
    if (!prodName) { await sendMessage(chatId, "❌ Invalid name. Try again."); return; }
    await supabase.from("bot_customers").update({ pending_action: `admin_addmanual_price_${prodName}` }).eq("chat_id", chatId);
    await sendMessage(chatId, `Product: <b>${prodName}</b>\n\nNow enter the price (USDT):`, { force_reply: true, selective: true });
    return;
  }

  // Add manual product - price
  if (customer.pending_action?.startsWith("admin_addmanual_price_") && isAdmin(chatId)) {
    const prodName = customer.pending_action.replace("admin_addmanual_price_", "");
    await supabase.from("bot_customers").update({ pending_action: null }).eq("chat_id", chatId);
    const price = parseFloat(text);
    if (isNaN(price) || price < 0) { await sendMessage(chatId, "❌ Invalid price.", mainMenuKeyboard()); return; }
    const { data: maxSort } = await supabase.from("bot_products").select("sort_order").order("sort_order", { ascending: false }).limit(1);
    const nextOrder = (maxSort && maxSort.length > 0 ? maxSort[0].sort_order : 0) + 1;
    const { error } = await supabase.from("bot_products").insert({
      name: prodName, sheet_tab: `manual_${Date.now()}`, price, is_manual_delivery: true,
      stock_source: "internal", is_active: true, sort_order: nextOrder, sold_column: "", sold_value: "",
    });
    if (error) { await sendMessage(chatId, `❌ Failed: ${error.message}`, mainMenuKeyboard()); return; }
    await sendMessage(chatId, `✅ Manual product <b>${prodName}</b> added!\nPrice: <b>$${price.toFixed(2)} USDT</b>`, { inline_keyboard: [[{ text: "◀️ Products", callback_data: "adm_products" }]] });
    return;
  }

  // Edit product name
  if (customer.pending_action?.startsWith("admin_editprod_name_") && isAdmin(chatId)) {
    const prodShort = customer.pending_action.replace("admin_editprod_name_", "");
    const { data: prods } = await supabase.from("bot_products").select("id, name");
    const prod = prods?.find(p => p.id.startsWith(prodShort));
    if (!prod) { await supabase.from("bot_customers").update({ pending_action: null }).eq("chat_id", chatId); await sendMessage(chatId, "❌ Product not found.", mainMenuKeyboard()); return; }
    const newName = text.trim();
    if (!newName) { await sendMessage(chatId, "❌ Invalid name. Try again."); return; }
    await supabase.from("bot_products").update({ name: newName }).eq("id", prod.id);
    await supabase.from("bot_customers").update({ pending_action: null }).eq("chat_id", chatId);
    await sendMessage(chatId, `✅ Product renamed to <b>${newName}</b>.`, { inline_keyboard: [[{ text: "◀️ Back to Product", callback_data: `pedit_${prodShort}` }]] });
    return;
  }

  // Edit product price
  if (customer.pending_action?.startsWith("admin_editprod_price_") && isAdmin(chatId)) {
    const prodShort = customer.pending_action.replace("admin_editprod_price_", "");
    const { data: prods } = await supabase.from("bot_products").select("id, name");
    const prod = prods?.find(p => p.id.startsWith(prodShort));
    if (!prod) { await supabase.from("bot_customers").update({ pending_action: null }).eq("chat_id", chatId); await sendMessage(chatId, "❌ Product not found.", mainMenuKeyboard()); return; }
    const newPrice = parseFloat(text);
    if (isNaN(newPrice) || newPrice < 0) { await supabase.from("bot_customers").update({ pending_action: null }).eq("chat_id", chatId); await sendMessage(chatId, "❌ Invalid price.", mainMenuKeyboard()); return; }
    await supabase.from("bot_products").update({ price: newPrice }).eq("id", prod.id);
    await supabase.from("bot_customers").update({ pending_action: null }).eq("chat_id", chatId);
    await sendMessage(chatId, `✅ <b>${prod.name}</b> price updated to <b>$${newPrice.toFixed(2)} USDT</b>.`, { inline_keyboard: [[{ text: "◀️ Back to Product", callback_data: `pedit_${prodShort}` }]] });
    return;
  }

  // Edit product description
  if (customer.pending_action?.startsWith("admin_editprod_desc_") && isAdmin(chatId)) {
    const prodShort = customer.pending_action.replace("admin_editprod_desc_", "");
    const { data: prods } = await supabase.from("bot_products").select("id, name");
    const prod = prods?.find(p => p.id.startsWith(prodShort));
    if (!prod) { await supabase.from("bot_customers").update({ pending_action: null }).eq("chat_id", chatId); await sendMessage(chatId, "❌ Product not found.", mainMenuKeyboard()); return; }
    const desc = text === "-" ? null : normalizeTelegramHtml(entitiesToHtml(rawText, message.entities));
    await supabase.from("bot_products").update({ description: desc }).eq("id", prod.id);
    await supabase.from("bot_customers").update({ pending_action: null }).eq("chat_id", chatId);
    await sendMessage(chatId, desc ? `✅ Description updated for <b>${prod.name}</b>.` : `✅ Description cleared for <b>${prod.name}</b>.`, { inline_keyboard: [[{ text: "◀️ Back to Product", callback_data: `pedit_${prodShort}` }]] });
    return;
  }

  // Edit delivery instruction
  if (customer.pending_action?.startsWith("admin_editprod_instr_") && isAdmin(chatId)) {
    const prodShort = customer.pending_action.replace("admin_editprod_instr_", "");
    const { data: prods } = await supabase.from("bot_products").select("id, name");
    const prod = prods?.find(p => p.id.startsWith(prodShort));
    if (!prod) { await supabase.from("bot_customers").update({ pending_action: null }).eq("chat_id", chatId); await sendMessage(chatId, "❌ Product not found.", mainMenuKeyboard()); return; }
    const instr = text === "-" ? null : normalizeTelegramHtml(entitiesToHtml(rawText, message.entities));
    await supabase.from("bot_products").update({ delivery_instruction: instr }).eq("id", prod.id);
    await supabase.from("bot_customers").update({ pending_action: null }).eq("chat_id", chatId);
    await sendMessage(chatId, instr ? `✅ Delivery instruction updated for <b>${prod.name}</b>.` : `✅ Delivery instruction cleared for <b>${prod.name}</b>.`, { inline_keyboard: [[{ text: "◀️ Back to Product", callback_data: `pedit_${prodShort}` }]] });
    return;
  }

  // Add pricing tier - min qty
  if (customer.pending_action?.startsWith("admin_tier_min_") && isAdmin(chatId)) {
    const prodShort = customer.pending_action.replace("admin_tier_min_", "");
    const minQty = parseInt(text);
    if (isNaN(minQty) || minQty < 1) { await sendMessage(chatId, "❌ Invalid number. Enter minimum quantity (e.g. 1):"); return; }
    await supabase.from("bot_customers").update({ pending_action: `admin_tier_max_${prodShort}_${minQty}` }).eq("chat_id", chatId);
    await sendMessage(chatId, `Min qty: <b>${minQty}</b>\n\nNow enter <b>max quantity</b> (or send <b>0</b> for unlimited):`, { force_reply: true, selective: true });
    return;
  }

  // Add pricing tier - max qty
  if (customer.pending_action?.startsWith("admin_tier_max_") && isAdmin(chatId)) {
    const rest = customer.pending_action.replace("admin_tier_max_", "");
    const lastUnderscore = rest.lastIndexOf("_");
    const prodShort = rest.substring(0, lastUnderscore);
    const minQty = parseInt(rest.substring(lastUnderscore + 1));
    const maxQty = parseInt(text);
    if (isNaN(maxQty) || maxQty < 0) { await sendMessage(chatId, "❌ Invalid number. Enter max quantity or 0 for unlimited:"); return; }
    await supabase.from("bot_customers").update({ pending_action: `admin_tier_price_${prodShort}_${minQty}_${maxQty}` }).eq("chat_id", chatId);
    await sendMessage(chatId, `Range: <b>${minQty}${maxQty > 0 ? `-${maxQty}` : "+"}</b>\n\nNow enter the <b>price per unit</b> (USDT):`, { force_reply: true, selective: true });
    return;
  }

  // Add pricing tier - price
  if (customer.pending_action?.startsWith("admin_tier_price_") && isAdmin(chatId)) {
    const rest = customer.pending_action.replace("admin_tier_price_", "");
    const parts = rest.split("_");
    const prodShort = parts[0];
    const minQty = parseInt(parts[1]);
    const maxQty = parseInt(parts[2]);
    await supabase.from("bot_customers").update({ pending_action: null }).eq("chat_id", chatId);
    const price = parseFloat(text);
    if (isNaN(price) || price < 0) { await sendMessage(chatId, "❌ Invalid price.", mainMenuKeyboard()); return; }
    const { data: prods } = await supabase.from("bot_products").select("id, name");
    const prod = prods?.find(p => p.id.startsWith(prodShort));
    if (!prod) { await sendMessage(chatId, "❌ Product not found.", mainMenuKeyboard()); return; }
    const { error } = await supabase.from("bot_product_pricing").insert({
      product_id: prod.id, min_quantity: minQty, max_quantity: maxQty > 0 ? maxQty : null, price,
    });
    if (error) { await sendMessage(chatId, `❌ Failed: ${error.message}`, mainMenuKeyboard()); return; }
    await sendMessage(chatId, `✅ Tier added for <b>${prod.name}</b>:\n${minQty}${maxQty > 0 ? `-${maxQty}` : "+"} → $${price.toFixed(2)} each`, { inline_keyboard: [[{ text: "◀️ Pricing Tiers", callback_data: `ptiers_${prodShort}` }]] });
    return;
  }

  // Admin DM by username — step 1: user typed a username, look them up
  if (customer.pending_action === "admin_dm_byuser" && isAdmin(chatId)) {
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
    const searchName = text.replace(/^@/, "").trim().toLowerCase();
    if (!searchName) { await sendMessage(chatId, "❌ Please provide a username.", mainMenuKeyboard()); return; }
    const { data: custs } = await supabase.from("bot_customers").select("id, chat_id, username, first_name");
    const matches = custs?.filter(c => c.username?.toLowerCase() === searchName || c.username?.toLowerCase().includes(searchName) || c.first_name?.toLowerCase().includes(searchName) || String(c.chat_id) === searchName) || [];
    if (matches.length === 0) { await sendMessage(chatId, `❌ No customer found matching "<b>${text}</b>".`, { inline_keyboard: [[{ text: "🔄 Try Again", callback_data: "adm_dm_user" }, { text: "◀️ Admin Menu", callback_data: "adm_menu" }]] }); return; }
    if (matches.length === 1) {
      const cust = matches[0];
      const custShort = cust.id.slice(0, 8);
      const label = cust.username ? `@${cust.username}` : cust.first_name || `#${cust.chat_id}`;
      await supabase.from("bot_customers").update({ pending_action: `admin_dm_${custShort}` }).eq("chat_id", chatId);
      await sendMessage(chatId, `💬 <b>Send Message to ${label}</b>\n\nType your message now. HTML formatting supported.\n\n❌ /cancel to cancel`, { force_reply: true, selective: true });
      return;
    }
    // Multiple matches — show buttons
    const buttons = matches.slice(0, 10).map(c => {
      const label = c.username ? `@${c.username}` : c.first_name || `#${c.chat_id}`;
      return [{ text: `💬 ${label}`, callback_data: `cmsg_${c.id.slice(0, 8)}` }];
    });
    buttons.push([{ text: "🔄 Try Again", callback_data: "adm_dm_user" }, { text: "◀️ Admin Menu", callback_data: "adm_menu" }]);
    await sendMessage(chatId, `Found <b>${matches.length}</b> matching customers. Select one:`, { inline_keyboard: buttons });
    return;
  }

  // Admin DM to specific customer — step 2: send the message
  if (customer.pending_action?.startsWith("admin_dm_") && isAdmin(chatId)) {
    const custShort = customer.pending_action.replace("admin_dm_", "");
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
    const { data: custs } = await supabase.from("bot_customers").select("id, chat_id, username, first_name");
    const cust = custs?.find(c => c.id.startsWith(custShort));
    if (!cust) { await sendMessage(chatId, "❌ Customer not found.", mainMenuKeyboard()); return; }
    const label = cust.username ? `@${cust.username}` : cust.first_name || `#${cust.chat_id}`;
    try {
      const htmlText = normalizeTelegramHtml(entitiesToHtml(rawText, message.entities));
      const result = await sendMessage(cust.chat_id, htmlText);
      if (result?.ok) await sendMessage(chatId, `✅ Message sent to <b>${label}</b>!`, { inline_keyboard: [[{ text: "💬 Send Another", callback_data: `cmsg_${custShort}` }], [{ text: "📩 DM Another", callback_data: "adm_dm_user" }, { text: "◀️ Menu", callback_data: "adm_menu" }]] });
      else await sendMessage(chatId, `❌ Failed to send message to ${label}.`, mainMenuKeyboard());
    } catch (err) {
      await sendMessage(chatId, `❌ Error: ${err.message}`, mainMenuKeyboard());
    }
    return;
  }

  // Edit Page Messages
  if (customer.pending_action?.startsWith("admin_editmsg_") && isAdmin(chatId)) {
    const msgKey = customer.pending_action.replace("admin_editmsg_", "");
    const label = PAGE_MSG_KEYS[msgKey] || msgKey;
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);

    // ── Byte-aware capture of premium/custom emoji entities ──
    // Telegram entity offsets are UTF-16 code-units; entitiesToHtml() already converts these
    // and emits raw <tg-emoji emoji-id="..."> wrappers from each entity.custom_emoji_id.
    // We additionally collect the raw IDs here so the admin sees confirmation that
    // every premium emoji on the time/{countdown} line (or anywhere) was captured.
    const entities = Array.isArray(message.entities) ? message.entities : [];
    const capturedEmojiIds = [];
    for (const ent of entities) {
      if (ent?.type === "custom_emoji" && ent.custom_emoji_id) {
        const startU16 = ent.offset || 0;
        const endU16 = startU16 + (ent.length || 0);
        // Byte/UTF-16 aware slice of the original placeholder glyph
        const glyph = rawText.substring(startU16, endU16);
        capturedEmojiIds.push({ id: String(ent.custom_emoji_id), glyph });
      }
    }

    const htmlText = prepareTelegramHtml(entitiesToHtml(rawText, message.entities));
    // Upsert into bot_settings
    const { data: existing } = await supabase.from("bot_settings").select("id").eq("key", msgKey).maybeSingle();
    if (existing) {
      await supabase.from("bot_settings").update({ value: htmlText, updated_at: new Date().toISOString() }).eq("key", msgKey);
    } else {
      await supabase.from("bot_settings").insert({ key: msgKey, value: htmlText });
    }
    // Update cache
    cachedPageMsgs[msgKey] = htmlText;
    pageMsgsLastFetch = Date.now();
    // Build preview with admin's actual data as sample
    let previewText = htmlText;
    const adminName = customer.first_name || "Admin";
    const refSettings = await getRefSettings();
    const sampleReplacements = {
      "{name}": adminName,
      "{id}": String(chatId),
      "{balance}": Number(customer.balance).toFixed(2),
      "{joined}": new Date(customer.created_at).toLocaleDateString("en-GB"),
      "{link}": `https://t.me/${await getBotUsername()}?start=ref_${customer.id.substring(0, 8)}`,
      "{ref_24h}": "0",
      "{ref_7d}": "0",
      "{ref_total}": "0",
      "{earned}": Number(customer.referral_total_earned || 0).toFixed(2),
      "{available}": Number(customer.referral_balance || 0).toFixed(2),
      "{transferred}": Number(customer.referral_transferred || 0).toFixed(2),
      "{commission}": String(refSettings.commission),
      "{bonus}": refSettings.firstBonus.toFixed(2),
    };
    previewText = replacePlaceholders(previewText, sampleReplacements);
    const editButtons = { inline_keyboard: [[{ text: "✏️ Edit More", callback_data: "adm_editmsg" }, { text: "◀️ Admin Menu", callback_data: "adm_menu" }]] };

    // Build emoji capture summary (raw icon_custom_emoji_id values, like other handlers expose)
    let emojiNote = "";
    if (capturedEmojiIds.length > 0) {
      const lines = capturedEmojiIds
        .slice(0, 12)
        .map((e, i) => `${i + 1}. ${escapeHtml(e.glyph)} → <code>${escapeHtml(e.id)}</code>`)
        .join("\n");
      const more = capturedEmojiIds.length > 12 ? `\n… +${capturedEmojiIds.length - 12} more` : "";
      emojiNote = `\n\n🌟 <b>${capturedEmojiIds.length} premium emoji captured:</b>\n${lines}${more}`;
    }

    // First send confirmation
    await sendMessage(chatId, `✅ <b>${label}</b> message saved successfully!${emojiNote}`, editButtons);
    // Then send preview separately so if it fails, confirmation is already sent
    try {
      const previewResult = await sendMessage(chatId, prepareTelegramHtml(`📝 <b>Preview:</b>\n\n${previewText}`));
      if (!previewResult?.ok) {
        console.log("Preview send failed, trying without custom emoji");
        await sendMessage(chatId, `📝 <b>Preview:</b>\n\n${stripCustomEmoji(previewText)}`);
      }
    } catch (e) {
      console.error("Preview send error:", e.message);
      await sendMessage(chatId, `📝 Preview could not be rendered. The message was saved successfully.`);
    }
    return;
  }


  // ── Channel Join settings: collect inputs ──
  if (customer.pending_action === "admin_cj_msg" && isAdmin(chatId)) {
    const htmlText = prepareTelegramHtml(entitiesToHtml(rawText, message.entities));
    if (!htmlText.trim()) { await sendMessage(chatId, "❌ Empty message. Send the join message text or /cancel."); return; }
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
    const { data: existing } = await supabase.from("bot_settings").select("id").eq("key", "channel_join_message").maybeSingle();
    if (existing) await supabase.from("bot_settings").update({ value: htmlText, updated_at: new Date().toISOString() }).eq("key", "channel_join_message");
    else await supabase.from("bot_settings").insert({ key: "channel_join_message", value: htmlText });
    cachedChannelJoin.message = htmlText;
    channelJoinLastFetch = Date.now();
    await sendMessage(chatId, `✅ <b>Join message updated!</b>`, { inline_keyboard: [[{ text: "📢 Channel Join", callback_data: "adm_channel_join" }, { text: "◀️ Admin Menu", callback_data: "adm_menu" }]] });
    try {
      await sendMessage(chatId, `📝 <b>Preview:</b>\n\n${htmlText}`);
    } catch (e) { console.error("CJ preview failed:", e.message); }
    return;
  }

  if ((customer.pending_action === "admin_cj_join_emoji" || customer.pending_action === "admin_cj_done_emoji") && isAdmin(chatId)) {
    const isJoin = customer.pending_action === "admin_cj_join_emoji";
    const key = isJoin ? "channel_join_button_emoji" : "channel_join_done_emoji";
    const idKey = isJoin ? "channel_join_button_emoji_id" : "channel_join_done_emoji_id";
    const label = isJoin ? "Join button emoji" : "Done button emoji";

    // Telegram entity offsets/lengths are in UTF-16 code units. JS strings are
    // UTF-16 internally, so slicing rawText by [offset, offset+length] correctly
    // extracts the raw fallback character(s), including surrogate pairs.
    // If a custom_emoji entity is present, ALSO capture its document_id so we
    // can render a premium emoji icon on the inline button (same approach as
    // bot_products.custom_emoji_id + icon_custom_emoji_id on product buttons).
    let value = "";
    let customEmojiId = "";
    const entities = Array.isArray(message.entities) ? message.entities : [];
    const customEmojiEntity = entities.find((e) => e.type === "custom_emoji");
    if (customEmojiEntity && typeof customEmojiEntity.offset === "number" && typeof customEmojiEntity.length === "number") {
      value = rawText.substring(customEmojiEntity.offset, customEmojiEntity.offset + customEmojiEntity.length);
      customEmojiId = String(customEmojiEntity.custom_emoji_id || "");
    } else {
      value = String(rawText || "").trim();
    }

    if (!value) { await sendMessage(chatId, "❌ Empty input. Send an emoji or /cancel."); return; }
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);

    // Upsert the fallback unicode character
    const { data: existing } = await supabase.from("bot_settings").select("id").eq("key", key).maybeSingle();
    if (existing) await supabase.from("bot_settings").update({ value, updated_at: new Date().toISOString() }).eq("key", key);
    else await supabase.from("bot_settings").insert({ key, value });

    // Upsert the premium document_id (empty string clears it if admin sent a plain emoji)
    const { data: existingId } = await supabase.from("bot_settings").select("id").eq("key", idKey).maybeSingle();
    if (existingId) await supabase.from("bot_settings").update({ value: customEmojiId, updated_at: new Date().toISOString() }).eq("key", idKey);
    else await supabase.from("bot_settings").insert({ key: idKey, value: customEmojiId });

    if (isJoin) { cachedChannelJoin.buttonEmoji = value; cachedChannelJoin.buttonEmojiId = customEmojiId; }
    else { cachedChannelJoin.doneEmoji = value; cachedChannelJoin.doneEmojiId = customEmojiId; }
    channelJoinLastFetch = Date.now();

    const idNote = customEmojiId ? `\n\n🌟 Premium emoji document_id captured: <code>${customEmojiId}</code>` : "";
    await sendMessage(chatId, `✅ <b>${label}</b> updated to: ${escapeHtml(value)}${idNote}`, { inline_keyboard: [[{ text: "📢 Channel Join", callback_data: "adm_channel_join" }, { text: "◀️ Admin Menu", callback_data: "adm_menu" }]] });
    return;
  }

  if (customer.pending_action === "admin_cj_username" && isAdmin(chatId)) {
    const value = text.trim();
    if (!value) { await sendMessage(chatId, "❌ Empty input. Send the channel username/ID or /cancel."); return; }
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
    const { data: existing } = await supabase.from("bot_settings").select("id").eq("key", "channel_join_username").maybeSingle();
    if (existing) await supabase.from("bot_settings").update({ value, updated_at: new Date().toISOString() }).eq("key", "channel_join_username");
    else await supabase.from("bot_settings").insert({ key: "channel_join_username", value });
    cachedChannelJoin.username = value;
    channelJoinLastFetch = Date.now();
    await sendMessage(chatId, `✅ Channel updated to: <code>${escapeHtml(value)}</code>\n\n⚠️ Remember: the bot must be an <b>admin</b> in the channel.`, { inline_keyboard: [[{ text: "📢 Channel Join", callback_data: "adm_channel_join" }, { text: "◀️ Admin Menu", callback_data: "adm_menu" }]] });
    return;
  }

  if (customer.pending_action === "admin_rc_reward" && isAdmin(chatId)) {
    const v = parseFloat(text.trim());
    if (!Number.isFinite(v) || v < 0) { await sendMessage(chatId, "❌ Invalid amount. Send a non-negative number (e.g. 0.1) or /cancel."); return; }
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
    const val = String(v);
    const { data: existing } = await supabase.from("bot_settings").select("id").eq("key", "referral_campaign_reward").maybeSingle();
    if (existing) await supabase.from("bot_settings").update({ value: val, updated_at: new Date().toISOString() }).eq("key", "referral_campaign_reward");
    else await supabase.from("bot_settings").insert({ key: "referral_campaign_reward", value: val });
    cachedCampaign.reward = v;
    campaignLastFetch = Date.now();
    await sendMessage(chatId, `✅ Join reward updated to <b>${v.toFixed(2)} USDT</b>.`, { inline_keyboard: [[{ text: "🎁 Refer Campaign", callback_data: "adm_refcamp" }, { text: "◀️ Admin Menu", callback_data: "adm_menu" }]] });
    return;
  }

  if (customer.pending_action === "admin_rc_msg" && isAdmin(chatId)) {
    const htmlText = prepareTelegramHtml(entitiesToHtml(rawText, message.entities));
    if (!htmlText.trim()) { await sendMessage(chatId, "❌ Empty message. Send the campaign message text or /cancel."); return; }
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
    const { data: existing } = await supabase.from("bot_settings").select("id").eq("key", "referral_campaign_message").maybeSingle();
    if (existing) await supabase.from("bot_settings").update({ value: htmlText, updated_at: new Date().toISOString() }).eq("key", "referral_campaign_message");
    else await supabase.from("bot_settings").insert({ key: "referral_campaign_message", value: htmlText });
    cachedCampaign.message = htmlText;
    campaignLastFetch = Date.now();
    await sendMessage(chatId, `✅ <b>Campaign message updated!</b>`, { inline_keyboard: [[{ text: "🎁 Refer Campaign", callback_data: "adm_refcamp" }, { text: "◀️ Admin Menu", callback_data: "adm_menu" }]] });
    try { await sendMessage(chatId, `📝 <b>Preview:</b>\n\n${htmlText}`); } catch (e) { console.error("RC preview failed:", e.message); }
    return;
  }

  if (customer.pending_action === "admin_rc_btn" && isAdmin(chatId)) {
    const value = String(rawText || "").trim();
    if (!value) { await sendMessage(chatId, "❌ Empty input. Send the button text or /cancel."); return; }
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
    const { data: existing } = await supabase.from("bot_settings").select("id").eq("key", "referral_campaign_button_text").maybeSingle();
    if (existing) await supabase.from("bot_settings").update({ value, updated_at: new Date().toISOString() }).eq("key", "referral_campaign_button_text");
    else await supabase.from("bot_settings").insert({ key: "referral_campaign_button_text", value });
    cachedCampaign.buttonText = value;
    campaignLastFetch = Date.now();
    await sendMessage(chatId, `✅ Campaign button text updated to: ${escapeHtml(value)}`, { inline_keyboard: [[{ text: "🎁 Refer Campaign", callback_data: "adm_refcamp" }, { text: "◀️ Admin Menu", callback_data: "adm_menu" }]] });
    return;
  }

  if (customer.pending_action === "admin_rc_btn_emoji" && isAdmin(chatId)) {
    let value = "";
    let customEmojiId = "";
    const entities = Array.isArray(message.entities) ? message.entities : [];
    const customEmojiEntity = entities.find((e) => e.type === "custom_emoji");
    if (customEmojiEntity && typeof customEmojiEntity.offset === "number" && typeof customEmojiEntity.length === "number") {
      value = rawText.substring(customEmojiEntity.offset, customEmojiEntity.offset + customEmojiEntity.length);
      customEmojiId = String(customEmojiEntity.custom_emoji_id || "");
    } else {
      value = String(rawText || "").trim();
    }
    if (!value) { await sendMessage(chatId, "❌ Empty input. Send an emoji or /cancel."); return; }
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);

    const { data: existing } = await supabase.from("bot_settings").select("id").eq("key", "referral_campaign_button_emoji").maybeSingle();
    if (existing) await supabase.from("bot_settings").update({ value, updated_at: new Date().toISOString() }).eq("key", "referral_campaign_button_emoji");
    else await supabase.from("bot_settings").insert({ key: "referral_campaign_button_emoji", value });

    const { data: existingId } = await supabase.from("bot_settings").select("id").eq("key", "referral_campaign_button_emoji_id").maybeSingle();
    if (existingId) await supabase.from("bot_settings").update({ value: customEmojiId, updated_at: new Date().toISOString() }).eq("key", "referral_campaign_button_emoji_id");
    else await supabase.from("bot_settings").insert({ key: "referral_campaign_button_emoji_id", value: customEmojiId });

    cachedCampaign.buttonEmoji = value;
    cachedCampaign.buttonEmojiId = customEmojiId;
    campaignLastFetch = Date.now();

    const idNote = customEmojiId ? `\n\n🌟 Premium emoji document_id captured: <code>${customEmojiId}</code>` : "";
    await sendMessage(chatId, `✅ Campaign button emoji updated to: ${escapeHtml(value)}${idNote}`, { inline_keyboard: [[{ text: "🎁 Refer Campaign", callback_data: "adm_refcamp" }, { text: "◀️ Admin Menu", callback_data: "adm_menu" }]] });
    return;
  }

  if (customer.pending_action === "admin_rc_group_btn_emoji" && isAdmin(chatId)) {
    let value = "";
    let customEmojiId = "";
    const entities = Array.isArray(message.entities) ? message.entities : [];
    const customEmojiEntity = entities.find((e) => e.type === "custom_emoji");
    if (customEmojiEntity && typeof customEmojiEntity.offset === "number" && typeof customEmojiEntity.length === "number") {
      value = rawText.substring(customEmojiEntity.offset, customEmojiEntity.offset + customEmojiEntity.length);
      customEmojiId = String(customEmojiEntity.custom_emoji_id || "");
    } else {
      value = String(rawText || "").trim();
    }
    if (!value && String(rawText || "").trim().toLowerCase() !== "clear") {
      await sendMessage(chatId, "❌ Empty input. Send an emoji, or send <code>clear</code> to remove, or /cancel."); return;
    }
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);

    if (String(rawText || "").trim().toLowerCase() === "clear") {
      value = "";
      customEmojiId = "";
    }

    const { data: existing } = await supabase.from("bot_settings").select("id").eq("key", "referral_campaign_group_button_emoji").maybeSingle();
    if (existing) await supabase.from("bot_settings").update({ value, updated_at: new Date().toISOString() }).eq("key", "referral_campaign_group_button_emoji");
    else await supabase.from("bot_settings").insert({ key: "referral_campaign_group_button_emoji", value });

    const { data: existingId } = await supabase.from("bot_settings").select("id").eq("key", "referral_campaign_group_button_emoji_id").maybeSingle();
    if (existingId) await supabase.from("bot_settings").update({ value: customEmojiId, updated_at: new Date().toISOString() }).eq("key", "referral_campaign_group_button_emoji_id");
    else await supabase.from("bot_settings").insert({ key: "referral_campaign_group_button_emoji_id", value: customEmojiId });

    cachedCampaign.groupButtonEmoji = value;
    cachedCampaign.groupButtonEmojiId = customEmojiId;
    campaignLastFetch = Date.now();

    const idNote = customEmojiId ? `\n\n🌟 Premium emoji document_id captured: <code>${customEmojiId}</code>` : "";
    const display = value ? escapeHtml(value) : "<i>cleared</i>";
    await sendMessage(chatId, `✅ Group version button emoji updated to: ${display}${idNote}\n\n<i>Note: inline button labels only display the fallback character; premium emoji animation does not render on buttons.</i>`, { inline_keyboard: [[{ text: "🎁 Refer Campaign", callback_data: "adm_refcamp" }, { text: "◀️ Admin Menu", callback_data: "adm_menu" }]] });
    return;
  }

  if (customer.pending_action === "admin_rc_group_btn_text" && isAdmin(chatId)) {
    let value = String(rawText || "").trim();
    if (!value) { await sendMessage(chatId, "❌ Empty input. Send the button text, or <code>clear</code> to reset, or /cancel."); return; }
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
    if (value.toLowerCase() === "clear") value = "";

    const { data: existing } = await supabase.from("bot_settings").select("id").eq("key", "referral_campaign_group_button_text").maybeSingle();
    if (existing) await supabase.from("bot_settings").update({ value, updated_at: new Date().toISOString() }).eq("key", "referral_campaign_group_button_text");
    else await supabase.from("bot_settings").insert({ key: "referral_campaign_group_button_text", value });

    cachedCampaign.groupButtonText = value;
    campaignLastFetch = Date.now();

    const display = value ? escapeHtml(value) : "<i>Get My Referral Link</i> (default)";
    await sendMessage(chatId, `✅ Group version button text updated to: ${display}`, { inline_keyboard: [[{ text: "🎁 Refer Campaign", callback_data: "adm_refcamp" }, { text: "◀️ Admin Menu", callback_data: "adm_menu" }]] });
    return;
  }







  // Broadcast
  // ── Flash Sale: collect sale price ──
  if (customer.pending_action?.startsWith("fs_price_") && isAdmin(chatId)) {
    const productId = customer.pending_action.replace("fs_price_", "");
    const price = parseFloat(text);
    if (isNaN(price) || price <= 0) {
      await sendMessage(chatId, "❌ Invalid price. Send a number like <code>1.99</code>.");
      return;
    }
    await supabase.from("bot_customers").update({ pending_action: `fs_dur_${productId}_${price}` }).eq("id", customer.id);
    await sendMessage(chatId, `🔥 <b>Sale Price:</b> $${price.toFixed(2)}\n\nNow send the <b>duration in minutes</b> (e.g. <code>60</code> for 1 hour, <code>1440</code> for 24 hours).\n\n❌ /cancel to abort.`);
    return;
  }

  // ── Flash Sale: collect duration & launch ──
  if (customer.pending_action?.startsWith("fs_dur_") && isAdmin(chatId)) {
    const rest = customer.pending_action.replace("fs_dur_", "");
    const lastUnderscore = rest.lastIndexOf("_");
    const productId = rest.slice(0, lastUnderscore);
    const salePrice = parseFloat(rest.slice(lastUnderscore + 1));
    const minutes = parseInt(text);
    if (isNaN(minutes) || minutes < 1 || minutes > 10080) {
      await sendMessage(chatId, "❌ Invalid duration. Send a number of minutes between 1 and 10080.");
      return;
    }
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
    const { data: product } = await supabase.from("bot_products").select("*").eq("id", productId).maybeSingle();
    if (!product) { await sendMessage(chatId, "❌ Product not found."); return; }
    const startsAt = new Date();
    const endsAt = new Date(Date.now() + minutes * 60 * 1000);
    const { data: sale, error: saleErr } = await supabase.from("bot_flash_sales").insert({
      product_id: productId,
      sale_price: salePrice,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      is_active: true,
      announcement_messages: [],
      broadcast_attempted: true,
    }).select("*").single();
    if (saleErr || !sale) { await sendMessage(chatId, `❌ Could not create flash sale: ${saleErr?.message || "unknown"}`); return; }

    await sendMessage(chatId, "📢 Broadcasting flash sale announcement...");
    const annText = await buildFlashSaleMessage(sale, product, false);
    const botUser = await getBotUsername();
    const code = product.short_code || product.id.slice(0, 4).toUpperCase();
    const buyBtn = buyNowButton({ text: `🛒 Buy ${product.name}`, url: `https://t.me/${botUser}?start=p_${code}` }, emojiMap);
    const { sent, failed, total, messageIds } = await broadcastToAll(annText, { inline_keyboard: [[buyBtn]] });
    await supabase.from("bot_flash_sales").update({ announcement_messages: messageIds, broadcast_attempted: true, updated_at: new Date().toISOString() }).eq("id", sale.id);
    await sendMessage(chatId,
      `✅ <b>Flash Sale Live!</b>\n\n📦 ${escapeHtml(product.name)}\n💰 $${salePrice.toFixed(2)}\n⏱ ${minutes} min\n📤 Sent: ${sent} • ❌ Failed: ${failed} • 👥 Total: ${total}\n\nCountdown will auto-update every 5s in announcement messages.`,
      { inline_keyboard: [[{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]] }
    );
    return;
  }

  if (customer.pending_action === "admin_broadcast" && isAdmin(chatId)) {
    const htmlText = normalizeTelegramHtml(entitiesToHtml(rawText, message.entities));
    await supabase.from("bot_customers").update({
      pending_action: "admin_broadcast_pickprod",
      pending_inputs: { text: htmlText, productIds: [] },
    }).eq("id", customer.id);
    await showBroadcastProductPicker(chatId, null, []);
    return;
  }

  // New stock count
  if (customer.pending_action?.startsWith("newstock_count_") && isAdmin(chatId)) {
    const productId = customer.pending_action.replace("newstock_count_", "");
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
    const addedCount = parseInt(text);
    if (isNaN(addedCount) || addedCount < 1) { await sendMessage(chatId, "❌ Invalid number.", mainMenuKeyboard()); return; }
    const { data: product } = await supabase.from("bot_products").select("*").eq("id", productId).single();
    if (!product) { await sendMessage(chatId, "❌ Product not found.", mainMenuKeyboard()); return; }
    const totalStock = await getProductStock(product);
    // Use stock_alert emoji if configured
    const alertEmoji = emojiMap["stock_alert"];
    let alertIcon = "📢";
    if (alertEmoji?.emoji) alertIcon = `<tg-emoji emoji-id="${alertEmoji.emoji}">📢</tg-emoji>`;
    await fetchPageMsgs();
    const stockAlertTemplate = cachedPageMsgs["msg_stock_alert"] || `${alertIcon} <b>{added} new stock added for {product}!</b>\n\n📊 Available: <b>{stock}</b> items\n💰 Price: <b>{price} USDT</b>`;
    const productIconTpl = product.custom_emoji_id ? `<tg-emoji emoji-id="${product.custom_emoji_id}">📦</tg-emoji> ` : "";
    const bulkPricingStock = await formatBulkPricingBlock(productId);
    const broadcastMsg = replacePlaceholders(stockAlertTemplate, { product: `${productIconTpl}${product.name}`, added: String(addedCount), stock: String(totalStock), price: Number(product.price).toFixed(2), bulk_pricing: bulkPricingStock });
    const botUser = await getBotUsername();
    const code = product.short_code || product.id.slice(0, 4).toUpperCase();
    const buyBtn = buyNowButton({ text: `Buy ${product.name}`, url: `https://t.me/${botUser}?start=p_${code}` }, emojiMap);
    const broadcastKeyboard = { inline_keyboard: [[buyBtn]] };
    // Update last_known_stock
    await supabase.from("bot_products").update({ last_known_stock: totalStock }).eq("id", product.id);
    await sendMessage(chatId, `📢 Broadcasting stock update...`);
    const { total, sent, failed } = await broadcastToAll(broadcastMsg, broadcastKeyboard);
    await sendMessage(chatId, `✅ <b>Stock Broadcast Complete!</b>\n\n📦 Product: <b>${product.name}</b>\n📤 Sent: <b>${sent}</b>\n❌ Failed: <b>${failed}</b>\n👥 Total: <b>${total}</b>`, { inline_keyboard: [[{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]] });
    return;
  }

  if (text === "🛒 Shop") { await showShop(chatId, emojiMap); return; }
  if (text === "💰 Balance") { await showBalance(chatId, customer); return; }
  if (text === "🧾 My Orders") { await showOrders(chatId, customer, 0, emojiMap); return; }
  if (text === "💳 Deposit") { await showDepositInfo(chatId, emojiMap); return; }
  if (text === "💸 Withdraw") { await handleWithdrawStart(chatId, customer); return; }
  if (text === "🆘 Support") {
    await sendMessage(chatId, `🆘 <b>Need Help?</b>\n\nContact our support team directly:`, { inline_keyboard: [[applyEmoji({ text: "💬 Contact Support", url: "https://t.me/VenexOG" }, "contact_support", emojiMap)]] });
    return;
  }

  // Admin: edit customer balance
  if (customer.pending_action?.startsWith("admin_editbal_") && isAdmin(chatId)) {
    const custShort = customer.pending_action.replace("admin_editbal_", "");
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
    const newBal = parseFloat(text);
    if (isNaN(newBal) || newBal < 0) { await sendMessage(chatId, "❌ Invalid amount. Enter a valid number (0 or more).", mainMenuKeyboard()); return; }
    const { data: custs } = await supabase.from("bot_customers").select("id, chat_id, username, first_name, balance");
    const cust = custs?.find(c => c.id.startsWith(custShort));
    if (!cust) { await sendMessage(chatId, "❌ Customer not found.", mainMenuKeyboard()); return; }
    const oldBal = Number(cust.balance);
    await supabase.from("bot_customers").update({ balance: newBal, updated_at: new Date().toISOString() }).eq("id", cust.id);
    const label = cust.username ? `@${cust.username}` : cust.first_name || `#${cust.chat_id}`;
    await sendMessage(chatId, `✅ Balance updated for <b>${label}</b>\n\nOld: <b>${oldBal.toFixed(2)} USDT</b>\nNew: <b>${newBal.toFixed(2)} USDT</b>`, { inline_keyboard: [[{ text: "👥 Customers", callback_data: "adm_customers" }], [{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]] });
    return;
  }

  // Admin: set pay later limit
  if (customer.pending_action?.startsWith("admin_pllimit_") && isAdmin(chatId)) {
    const custShort = customer.pending_action.replace("admin_pllimit_", "");
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
    const newLimit = parseFloat(text);
    if (isNaN(newLimit) || newLimit < 0) { await sendMessage(chatId, "❌ Invalid amount. Enter a valid number (0 or more).", mainMenuKeyboard()); return; }
    const { data: custs } = await supabase.from("bot_customers").select("id, chat_id, username, first_name, pay_later_limit");
    const cust = custs?.find(c => c.id.startsWith(custShort));
    if (!cust) { await sendMessage(chatId, "❌ Customer not found.", mainMenuKeyboard()); return; }
    await supabase.from("bot_customers").update({ pay_later_limit: newLimit, updated_at: new Date().toISOString() }).eq("id", cust.id);
    const label = cust.username ? `@${cust.username}` : cust.first_name || `#${cust.chat_id}`;
    await sendMessage(chatId, `✅ Pay Later limit updated for <b>${label}</b>\n\nOld: <b>${Number(cust.pay_later_limit).toFixed(2)} USDT</b>\nNew: <b>${newLimit.toFixed(2)} USDT</b>`, { inline_keyboard: [[{ text: "🏷️ View Credit", callback_data: `cpl_${custShort}` }], [{ text: "👥 Customers", callback_data: "adm_customers" }]] });
    return;
  }

  // Admin: deposit amount entry
  if (customer.pending_action?.startsWith("dep_amount_") && isAdmin(chatId)) {
    const depositId = customer.pending_action.replace("dep_amount_", "");
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
    const amt = parseFloat(text);
    if (isNaN(amt) || amt <= 0) { await sendMessage(chatId, "❌ Invalid amount. Please enter a valid number. Operation cancelled.", mainMenuKeyboard()); return; }
    const supabaseUrl = envGet("SUPABASE_URL");
    const supabaseKey = envGet("SUPABASE_SERVICE_ROLE_KEY");
    const verifyRes = await fetch(`${supabaseUrl}/functions/v1/admin-verify-deposit`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` }, body: JSON.stringify({ deposit_id: depositId, amount: amt }) });
    const verifyData = await verifyRes.json();
    if (!verifyRes.ok || verifyData.error) { await sendMessage(chatId, `❌ Verification failed: ${verifyData.error || "Unknown error"}`, mainMenuKeyboard()); return; }
    if (verifyData.action === "delivered") await sendMessage(chatId, `✅ Deposit verified (${amt.toFixed(2)} USDT) — <b>${verifyData.product}</b> x${verifyData.qty} delivered to customer!`, mainMenuKeyboard());
    else await sendMessage(chatId, `✅ Deposit verified — ${amt.toFixed(2)} USDT added to customer's balance.`, mainMenuKeyboard());
    return;
  }

  // (duplicate broadcast/newstock handlers removed — already handled above lines 1919-1957)

  // Withdrawal amount
  if (customer.pending_action === "withdraw_amount") {
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
    const amt = parseFloat(text);
    if (isNaN(amt) || amt <= 0) { await sendMessage(chatId, "❌ Invalid amount. Please enter a valid number.", mainMenuKeyboard()); return; }
    const { data: freshBal } = await supabase.from("bot_customers").select("balance").eq("id", customer.id).single();
    const bal = freshBal ? Number(freshBal.balance) : 0;
    if (amt > bal) { await sendMessage(chatId, `❌ Insufficient balance. Your balance is <b>${bal.toFixed(2)} USDT</b>.`, mainMenuKeyboard()); return; }
    // Show payment method buttons
    const { data: activeMethods } = await supabase.from("bot_payment_methods").select("id, name, emoji, custom_emoji_id").eq("is_active", true).order("sort_order");
    if (!activeMethods || activeMethods.length === 0) {
      await sendMessage(chatId, "❌ No payment methods available. Contact support.", mainMenuKeyboard());
      return;
    }
    await supabase.from("bot_customers").update({ pending_action: `withdraw_method_${amt}` }).eq("id", customer.id);
    const methodButtons = [];
    for (const m of activeMethods) {
      const btn = { text: `${m.emoji} ${m.name}`, callback_data: `wd_method_${m.id.substring(0, 8)}_${amt}` };
      if (m.custom_emoji_id) {
        const stripped = String(btn.text).replace(/^(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})\uFE0F?\s*/u, "");
        btn.text = stripped || btn.text;
        btn.icon_custom_emoji_id = m.custom_emoji_id;
      }
      methodButtons.push([btn]);
    }
    const emojiMap = await loadButtonEmojis();
    methodButtons.push([applyEmoji({ text: "❌ Cancel", callback_data: "cancel_order" }, "cancel_order", emojiMap)]);
    await sendMessage(chatId, `💸 Withdrawing <b>${amt.toFixed(2)} USDT</b>\n\nSelect your preferred <b>payment method</b>:`, { inline_keyboard: methodButtons });
    return;
  }

  // Withdrawal details (after method selection)
  if (customer.pending_action?.startsWith("withdraw_details_")) {
    const parts = customer.pending_action.replace("withdraw_details_", "");
    const firstUnderscore = parts.indexOf("_");
    const amt = parseFloat(parts.substring(0, firstUnderscore));
    const methodName = parts.substring(firstUnderscore + 1);
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
    if (isNaN(amt) || !text.trim()) { await sendMessage(chatId, "❌ Invalid input. Please try again.", mainMenuKeyboard()); return; }
    const { data: freshBal } = await supabase.from("bot_customers").select("balance").eq("id", customer.id).single();
    const bal = freshBal ? Number(freshBal.balance) : 0;
    if (amt > bal) { await sendMessage(chatId, `❌ Insufficient balance. Your balance is <b>${bal.toFixed(2)} USDT</b>.`, mainMenuKeyboard()); return; }
    const newBal = bal - amt;
    const [, { data: wdRow }] = await Promise.all([
      supabase.from("bot_customers").update({ balance: newBal, updated_at: new Date().toISOString() }).eq("id", customer.id),
      supabase.from("bot_withdrawals").insert({
        customer_id: customer.id,
        amount: amt,
        payment_details: `[${methodName}] ${text.trim()}`,
        status: "pending",
      }).select("id").single(),
    ]);

    await sendMessage(chatId, `✅ <b>Withdrawal Request Submitted!</b>\n\nAmount: <b>${amt.toFixed(2)} USDT</b>\nMethod: <b>${methodName}</b>\nPayment Details: <b>${text.trim()}</b>\nRemaining Balance: <b>${newBal.toFixed(2)} USDT</b>\n\n⏳ Your request is being processed. You'll receive a confirmation once completed.`, mainMenuKeyboard());
    if (wdRow) {
      const emojiMap = await loadButtonEmojis();
      notifyAdmin(`🔔 <b>New Withdrawal Request!</b>\n\n👤 Customer: <b>${getCustomerLabel(customer)}</b>\n💰 Amount: <b>${amt.toFixed(2)} USDT</b>\n💳 Method: <b>${methodName}</b>\n📋 Details: <code>${text.trim()}</code>`, {
        inline_keyboard: [[applyEmoji({ text: "✅ Approve", callback_data: `wd_approve_${wdRow.id}` }, "approve_withdrawal", emojiMap), applyEmoji({ text: "❌ Reject", callback_data: `wd_reject_${wdRow.id}` }, "reject_withdrawal", emojiMap)]],
      });
    }
    return;
  }

  // Custom quantity
  if (customer.pending_action?.startsWith("customqty_")) {
    const productId = customer.pending_action.replace("customqty_", "");
    const qty = parseInt(text);
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
    if (isNaN(qty) || qty < 1) { await sendMessage(chatId, "❌ Invalid quantity. Please enter a number greater than 0.", mainMenuKeyboard()); return; }
    if (qty > 10000) { await sendMessage(chatId, "❌ Maximum quantity is 10,000.", mainMenuKeyboard()); return; }
    await showBuyConfirmation(chatId, customer, productId, qty, emojiMap);
    return;
  }

  // Product emoji setting (admin)
  if (customer.pending_action?.startsWith("set_prod_emoji_") && isAdmin(chatId)) {
    const prodShort = customer.pending_action.replace("set_prod_emoji_", "");
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
    const entities = message.entities || [];
    const customEmojiEntity = entities.find((e) => e.type === "custom_emoji");
    if (!customEmojiEntity || !customEmojiEntity.custom_emoji_id) {
      await sendMessage(chatId, `❌ No premium emoji detected.\n\nPlease send a <b>premium/custom emoji</b> (not a regular emoji).`, mainMenuKeyboard());
      return;
    }
    const { data: prods } = await supabase.from("bot_products").select("id, name");
    const prod = prods?.find(p => p.id.startsWith(prodShort));
    if (!prod) { await sendMessage(chatId, "❌ Product not found.", mainMenuKeyboard()); return; }
    const { error } = await supabase.from("bot_products").update({ custom_emoji_id: customEmojiEntity.custom_emoji_id }).eq("id", prod.id);
    if (error) await sendMessage(chatId, `❌ Failed to save: ${error.message}`, mainMenuKeyboard());
    else await sendMessage(chatId, `✅ Premium emoji set for <b>${prod.name}</b>!\n\nEmoji ID: <code>${customEmojiEntity.custom_emoji_id}</code>`, { inline_keyboard: [[{ text: "◀️ Back to Product", callback_data: `pedit_${prodShort}` }]] });
    return;
  }

  // Premium emoji setting (admin)
  if (customer.pending_action?.startsWith("set_emoji_") && isAdmin(chatId)) {
    const buttonKey = customer.pending_action.replace("set_emoji_", "");
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
    const entities = message.entities || [];
    const customEmojiEntity = entities.find((e) => e.type === "custom_emoji");
    if (!customEmojiEntity || !customEmojiEntity.custom_emoji_id) {
      await sendMessage(chatId, `❌ No premium emoji detected.\n\nPlease send a <b>premium/custom emoji</b> (not a regular emoji). Try again with /emojis.`, mainMenuKeyboard());
      return;
    }
    const { error } = await supabase.from("bot_button_emojis").update({ custom_emoji_id: customEmojiEntity.custom_emoji_id }).eq("button_key", buttonKey);
    if (error) await sendMessage(chatId, `❌ Failed to save emoji: ${error.message}`, mainMenuKeyboard());
    else { _emojiCache = null; await sendMessage(chatId, `✅ Premium emoji set for <b>${buttonKey}</b>!\n\nEmoji ID: <code>${customEmojiEntity.custom_emoji_id}</code>\n\nThe old default emoji has been replaced. Use /emojis to manage more.`, mainMenuKeyboard()); }
    return;
  }

  // Payment method emoji
  if (customer.pending_action?.startsWith("set_pm_emoji_") && isAdmin(chatId)) {
    const pmShortId = customer.pending_action.replace("set_pm_emoji_", "");
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
    const entities = message.entities || [];
    const customEmojiEntity = entities.find((e) => e.type === "custom_emoji");
    if (!customEmojiEntity || !customEmojiEntity.custom_emoji_id) {
      await sendMessage(chatId, `❌ No premium emoji detected.\n\nPlease send a <b>premium/custom emoji</b>. Try again with /pemojis.`, mainMenuKeyboard());
      return;
    }
    const { data: allMethods } = await supabase.from("bot_payment_methods").select("*").eq("is_active", true);
    const method = allMethods?.find((m) => m.id.startsWith(pmShortId));
    if (!method) { await sendMessage(chatId, "❌ Payment method not found.", mainMenuKeyboard()); return; }
    const { error } = await supabase.from("bot_payment_methods").update({ custom_emoji_id: customEmojiEntity.custom_emoji_id }).eq("id", method.id);
    if (error) await sendMessage(chatId, `❌ Failed to save: ${error.message}`, mainMenuKeyboard());
    else await sendMessage(chatId, `✅ Premium emoji set for <b>${method.name}</b>!\n\nEmoji ID: <code>${customEmojiEntity.custom_emoji_id}</code>\n\nUse /pemojis to manage more.`, mainMenuKeyboard());
    return;
  }

  // Admin: manual delivery text input
  if (customer.pending_action?.startsWith("manual_deliver_") && isAdmin(chatId)) {
    const orderId = customer.pending_action.replace("manual_deliver_", "");
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
    const { data: order } = await supabase.from("bot_orders").select("*, customer:bot_customers(*)").eq("id", orderId).single();
    if (!order || order.status !== "pending_delivery") { await sendMessage(chatId, "⚠️ Order not found or already processed.", mainMenuKeyboard()); return; }
    const cust = order.customer;
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    const details = lines.map(line => ({ "Delivery Info": line }));
    await supabase.from("bot_orders").update({ status: "completed", details }).eq("id", orderId);
    const orderNum = order.id.substring(0, 4).toUpperCase();
    const headerInfo = `✅ <b>Order Delivered!</b>\n\nOrder: <b>#${orderNum}</b>\nTotal Paid: <b>${Number(order.total_price).toFixed(2)} USDT</b>\n`;
    const productHeader = `<b>${order.product_name} × ${order.quantity}</b>`;
    let msg = headerInfo + `\n📦 ${productHeader}\n\n`;
    lines.forEach((line, i) => { msg += `${i + 1}. <code>${line}</code>\n`; });
    await sendMessage(cust.chat_id, msg, mainMenuKeyboard());
    const { data: product } = await supabase.from("bot_products").select("delivery_instruction, delivery_media").eq("id", order.product_id).single();
    if (product?.delivery_instruction) await sendMessage(cust.chat_id, `📋 <b>Important Instructions:</b>\n\n${product.delivery_instruction}`, mainMenuKeyboard());
    let mediaItems = [];
    try { mediaItems = typeof product?.delivery_media === 'string' ? JSON.parse(product.delivery_media) : product?.delivery_media || []; } catch {}
    for (const m of mediaItems) {
      if (m.type === 'video') await sendVideo(cust.chat_id, m.url, undefined, mainMenuKeyboard());
      else await sendPhoto(cust.chat_id, m.url, undefined, mainMenuKeyboard());
    }
    await sendMessage(chatId, `✅ Delivery sent to ${getCustomerLabel(cust)} for <b>${order.product_name}</b> x${order.quantity}.`, mainMenuKeyboard());
    return;
  }

  // If user has a pending payment method/order, treat any text as a txn hash/order id
  if (hasPendingPaymentTxnAction(customer.pending_action)) { await handleTxnHash(chatId, customer, text.trim(), emojiMap); return; }

  // TxID check - hex hashes, UUID-style Bybit IDs, TON/base64 IDs, or numeric Binance/Bybit IDs
  const trimmed = text.trim();
  const normalizedTxn = normalizeTxnInput(trimmed);
  const looksLikeTxn =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(normalizedTxn) ||
    isBybitOrderLikeId(normalizedTxn) ||
    (normalizedTxn.length >= 20 && /^[a-fA-F0-9x]+$/.test(normalizedTxn)) ||
    (normalizedTxn.length >= 40 && /^[A-Za-z0-9_-]+$/.test(normalizedTxn)) ||
    (normalizedTxn.length >= 10 && /^\d+$/.test(normalizedTxn));
  if (looksLikeTxn) { await handleTxnHash(chatId, customer, normalizedTxn, emojiMap); return; }

  await sendMessage(chatId, "Use the menu buttons below to navigate.", mainMenuKeyboard());
}

// ── Handle callback ──

async function handleCallback(callbackQuery, emojiMap) {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  await fetchPageMsgs();

  answerCallbackQuery(callbackQuery.id);

  // Maintenance mode guard
  if (maintenanceMode && !isAdmin(chatId)) {
    await sendMessage(chatId, MAINTENANCE_MSG);
    return;
  }

  const customer = await getOrCreateCustomer(chatId, callbackQuery.from?.first_name, callbackQuery.from?.username);
  const msgId = callbackQuery.message?.message_id;

  // Banned user guard
  if (customer.is_banned && !isAdmin(chatId)) {
    await sendMessage(chatId, `🚫 <b>You are banned from using this bot.</b>${customer.ban_reason ? `\n\nReason: ${customer.ban_reason}` : ""}`);
    return;
  }


  // ── Channel join verification flow ──
  if (data === "chk_join") {
    const s = await fetchChannelJoinSettings(true);
    if (!s.enabled || !s.username) return;
    if (isAdmin(chatId)) return;
    if (await isUserVerifiedForChannel(chatId)) return;
    const channelId = channelApiId(s.username);
    const status = channelId ? await checkChannelMembershipStatus(chatId, channelId) : "error";
    if (status === "member") {
      await markUserVerifiedForChannel(chatId);
      await sendMessage(chatId, "✅ <b>Verified!</b> You can now use the bot. Send /start to begin.");
    } else if (status === "error") {
      // Graceful fallback: bot may not be admin in the channel, or channel ID
      // is invalid. Trust the user and let them through to avoid a hard loop.
      console.warn(`[channel-join] Verification API failed for chat ${chatId}, channel ${channelId}. Granting access as fallback.`);
      await markUserVerifiedForChannel(chatId);
      await sendMessage(chatId, "✅ <b>Verified!</b> You can now use the bot. Send /start to begin.");
    } else {
      await sendMessage(chatId, `❌ <b>You haven't joined the channel yet.</b>\n\nPlease join first, then tap "Done ${s.doneEmoji}" again.`, buildJoinPromptKeyboard(s));
    }
    return;
  }

  // Channel join verification guard (block all other callbacks until verified)
  if (!(await ensureChannelVerified(chatId))) return;

  // ── Admin menu callbacks ──

  if (data === "noop") return;

  if (data === "adm_menu" && isAdmin(chatId)) { await showAdminMenu(chatId, emojiMap, msgId); return; }

  if (data === "adm_pricelist" && isAdmin(chatId)) {
    const { data: products } = await supabase
      .from("bot_products")
      .select("id, name, price, is_active")
      .eq("is_active", true)
      .order("sort_order");
    if (!products || products.length === 0) {
      await editOrSend(chatId, msgId, "No active products.", { inline_keyboard: [[{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]] });
      return;
    }
    const ids = products.map(p => p.id);
    const { data: tiers } = await supabase
      .from("bot_product_pricing")
      .select("product_id, min_quantity, max_quantity, price")
      .in("product_id", ids)
      .order("min_quantity");
    const tierMap = new Map();
    for (const t of (tiers || [])) {
      if (!tierMap.has(t.product_id)) tierMap.set(t.product_id, []);
      tierMap.get(t.product_id).push(t);
    }
    const fmt = (n) => {
      const num = Number(n);
      return Number.isInteger(num) ? String(num) : num.toFixed(2);
    };
    let msg = `📋 <b>Price List</b>\n\n`;
    for (const p of products) {
      msg += `🛍 <b>${p.name}</b>\n`;
      const pt = tierMap.get(p.id);
      if (pt && pt.length > 0) {
        for (const t of pt) {
          const range = t.max_quantity ? `${t.min_quantity}-${t.max_quantity}` : `${t.min_quantity}+`;
          msg += `   • ${range} pcs → $${fmt(t.price)}\n`;
        }
      } else {
        msg += `   • $${fmt(p.price)} / pc\n`;
      }
      msg += `\n`;
    }
    // Telegram message limit 4096; chunk if needed
    const chunks = [];
    while (msg.length > 4000) {
      let cut = msg.lastIndexOf("\n\n", 4000);
      if (cut < 1000) cut = 4000;
      chunks.push(msg.slice(0, cut));
      msg = msg.slice(cut).trimStart();
    }
    chunks.push(msg);
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      await sendMessage(chatId, chunks[i], isLast ? { inline_keyboard: [[{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]] } : undefined);
    }
    return;
  }


  if (data === "adm_maintenance" && isAdmin(chatId)) {
    maintenanceMode = !maintenanceMode;
    const status = maintenanceMode ? "🔴 ON — Users will see maintenance message" : "🟢 OFF — Bot is live";
    await sendMessage(chatId, `🔧 <b>Maintenance Mode:</b> ${status}`);
    await showAdminMenu(chatId, emojiMap, msgId);
    return;
  }

  if (data === "adm_pending_deliveries" && isAdmin(chatId)) {
    const { data: pendings } = await supabase
      .from("bot_orders")
      .select("*, customer:bot_customers(*)")
      .eq("status", "pending_delivery")
      .order("created_at", { ascending: false })
      .limit(50);
    if (!pendings || pendings.length === 0) {
      await editOrSend(chatId, msgId, "✅ No pending delivery orders.", { inline_keyboard: [[{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]] });
      return;
    }
    const buttons = pendings.map((o) => {
      const orderShort = o.id.slice(0, 8);
      const label = `⏳ ${o.product_name} x${o.quantity} — ${getCustomerLabel(o.customer)}`.slice(0, 60);
      return [{ text: label, callback_data: `pdview_${orderShort}` }];
    });
    buttons.push([{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]);
    await editOrSend(chatId, msgId, `⏳ <b>Pending Deliveries (${pendings.length})</b>\n\nSelect an order to deliver or cancel:`, { inline_keyboard: buttons });
    return;
  }

  if (data.startsWith("pdview_") && isAdmin(chatId)) {
    const orderShort = data.replace("pdview_", "");
    const { data: orders } = await supabase
      .from("bot_orders")
      .select("*, customer:bot_customers(*)")
      .eq("status", "pending_delivery")
      .order("created_at", { ascending: false })
      .limit(100);
    const order = orders?.find((o) => o.id.startsWith(orderShort));
    if (!order) { await editOrSend(chatId, msgId, "⚠️ Order not found or already processed.", { inline_keyboard: [[{ text: "◀️ Pending", callback_data: "adm_pending_deliveries" }]] }); return; }
    const cust = order.customer;
    const date = new Date(order.created_at).toLocaleString();
    const msg = `⏳ <b>Pending Delivery</b>\n\n👤 ${getCustomerLabel(cust)}\n📦 Product: <b>${escapeHtml(order.product_name)}</b> x${order.quantity}\n💰 Total: <b>${Number(order.total_price).toFixed(2)} USDT</b>\n📅 ${date}\n\nDeliver from source bot, then tap below.`;
    await editOrSend(chatId, msgId, msg, { inline_keyboard: [
      [{ text: "📦 Deliver", callback_data: `mdlvr_${orderShort}` }],
      [{ text: "❌ Cancel & Refund", callback_data: `mdcancel_${orderShort}` }],
      [{ text: "◀️ Back", callback_data: "adm_pending_deliveries" }],
    ] });
    return;
  }

  if ((data === "adm_products" || data.startsWith("adm_products_p") || data === "adm_products_all" || data.startsWith("adm_products_all_p")) && isAdmin(chatId)) {
    const PAGE_SIZE = 8;
    const showAll = data === "adm_products_all" || data.startsWith("adm_products_all_p");
    const pagePrefix = showAll ? "adm_products_all_p" : "adm_products_p";
    let page = 0;
    if (data.startsWith(pagePrefix)) {
      const parsed = parseInt(data.replace(pagePrefix, ""), 10);
      if (!isNaN(parsed) && parsed >= 0) page = parsed;
    }
    const { data: allProducts } = await supabase.from("bot_products").select("*").order("sort_order");
    const products = showAll ? (allProducts || []) : (allProducts || []).filter((p) => p.is_active);
    const disabledCount = (allProducts || []).filter((p) => !p.is_active).length;
    if (!products || products.length === 0) {
      const emptyButtons = [];
      if (!showAll && disabledCount > 0) emptyButtons.push([{ text: `👁️ Show disabled (${disabledCount})`, callback_data: "adm_products_all" }]);
      emptyButtons.push([{ text: "🆕 Add Stock Product", callback_data: "padd_stock" }, { text: "✋ Add Manual", callback_data: "padd_manual" }]);
      emptyButtons.push([{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]);
      await editOrSend(chatId, msgId, "📦 No active products.", { inline_keyboard: emptyButtons });
      return;
    }
    const totalPages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
    if (page >= totalPages) page = totalPages - 1;
    const startIdx = page * PAGE_SIZE;
    const endIdx = Math.min(startIdx + PAGE_SIZE, products.length);
    const header = showAll ? `📦 <b>Products (${products.length}, all)</b>` : `📦 <b>Products (${products.length} active)</b>`;
    let msg = `${header} — Page ${page + 1}/${totalPages}\n\n`;
    const buttons = [];
    for (let idx = startIdx; idx < endIdx; idx++) {
      const p = products[idx];
      const type = p.is_manual_delivery ? "✋" : "📦";
      const status = p.is_active ? "✅" : "❌";
      msg += `${status} ${type} <b>${p.name}</b> — $${Number(p.price).toFixed(2)}\n`;
      buttons.push([productSelectButton(p, `${status} ${type} ${p.name}`, `pedit_${p.id.slice(0, 8)}`)]);
      const actions = [];
      if (idx > 0) actions.push({ text: "⬆️ Up", callback_data: `psortup_${p.id.slice(0, 8)}` });
      if (idx < products.length - 1) actions.push({ text: "⬇️ Down", callback_data: `psortdown_${p.id.slice(0, 8)}` });
      actions.push({ text: "🗑️ Delete", callback_data: `premove_${p.id.slice(0, 8)}` });
      buttons.push(actions);
    }
    if (totalPages > 1) {
      const nav = [];
      if (page > 0) nav.push({ text: "◀️ Prev", callback_data: `${pagePrefix}${page - 1}` });
      nav.push({ text: `${page + 1}/${totalPages}`, callback_data: "noop" });
      if (page < totalPages - 1) nav.push({ text: "Next ▶️", callback_data: `${pagePrefix}${page + 1}` });
      buttons.push(nav);
    }
    if (showAll) {
      buttons.push([{ text: "🙈 Hide disabled", callback_data: "adm_products" }]);
    } else if (disabledCount > 0) {
      buttons.push([{ text: `👁️ Show disabled (${disabledCount})`, callback_data: "adm_products_all" }]);
    }
    buttons.push([{ text: "🆕 Add Stock Product", callback_data: "padd_stock" }, { text: "✋ Add Manual", callback_data: "padd_manual" }]);
    buttons.push([{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]);
    await editOrSend(chatId, msgId, msg, { inline_keyboard: buttons });
    return;
  }

  if (data === "adm_stats" && isAdmin(chatId)) {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayISO = todayStart.toISOString();

    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);
    const weekISO = weekStart.toISOString();

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthISO = monthStart.toISOString();

    const [custRes, wdRes, newCustTodayRes, newCustWeekRes, newCustMonthRes, statsRpc] = await Promise.all([
      supabase.from("bot_customers").select("id", { count: "exact", head: true }),
      supabase.from("bot_withdrawals").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("bot_customers").select("id", { count: "exact", head: true }).gte("created_at", todayISO),
      supabase.from("bot_customers").select("id", { count: "exact", head: true }).gte("created_at", weekISO),
      supabase.from("bot_customers").select("id", { count: "exact", head: true }).gte("created_at", monthISO),
      supabase.rpc("get_bot_quick_stats", { _today: todayISO, _week: weekISO, _month: monthISO }),
    ]);

    const stats = statsRpc.data || {};
    const rev = stats.rev || {};
    const totalRevenue = Number(rev.total_revenue || 0);
    const todayRevenue = Number(rev.today_revenue || 0);
    const weekRevenue = Number(rev.week_revenue || 0);
    const monthRevenue = Number(rev.month_revenue || 0);
    const ordRes = { count: Number(rev.total_orders || 0) };
    const todayOrdRes = { count: Number(rev.today_orders || 0) };
    const weekOrdRes = { count: Number(rev.week_orders || 0) };
    const monthOrdRes = { count: Number(rev.month_orders || 0) };
    const firstOrderDate = rev.first_order_at || null;

    function formatTopProducts(list) {
      let text = "";
      (list || []).forEach((info, i) => {
        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
        text += `${medal} ${info.product_name || "Unknown"}\n   📦 ${Number(info.qty)} sold • 💵 ${Number(info.revenue).toFixed(2)} USDT\n`;
      });
      return text;
    }

    const topProducts = stats.top_all || [];
    const weeklyTopProducts = stats.top_week || [];
    const monthlyTopProducts = stats.top_month || [];

    let topProductsText = "";
    if (topProducts.length > 0) {
      topProductsText = `\n━━━━━━━━━━━━━━━\n🏆 <b>Top Selling (All Time)</b>\n` + formatTopProducts(topProducts);
    }
    if (weeklyTopProducts.length > 0) {
      topProductsText += `\n📆 <b>Top Selling (This Week)</b>\n` + formatTopProducts(weeklyTopProducts);
    }
    if (monthlyTopProducts.length > 0) {
      topProductsText += `\n📅 <b>Top Selling (This Month)</b>\n` + formatTopProducts(monthlyTopProducts);
    }

    function formatTopBuyers(list) {
      let text = "";
      (list || []).forEach((info, i) => {
        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
        const displayName = info.first_name || info.username || `ID:${String(info.chat_id || info.customer_id || "").slice(0,8)}`;
        const uname = info.username ? ` (@${info.username})` : "";
        text += `${medal} ${displayName}${uname}\n   🛒 ${Number(info.orders)} orders • 📦 ${Number(info.qty)} items • 💵 ${Number(info.spent).toFixed(2)} USDT\n`;
      });
      return text;
    }

    const topBuyers = stats.buyers_all || [];
    const monthlyTopBuyers = stats.buyers_month || [];

    let topBuyersText = "";
    if (topBuyers.length > 0) {
      topBuyersText = `\n━━━━━━━━━━━━━━━\n👑 <b>Top Buyers (All Time)</b>\n` + formatTopBuyers(topBuyers);
    }
    if (monthlyTopBuyers.length > 0) {
      topBuyersText += `\n📅 <b>Top Buyers (This Month)</b>\n` + formatTopBuyers(monthlyTopBuyers);
    }

    // firstOrderDate already set from RPC above
    const botStartedStr = firstOrderDate ? new Date(firstOrderDate).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "N/A";

    const statsMsg = `📊 <b>Quick Stats</b>\n\n` +
      `🚀 Bot Started: <b>${botStartedStr}</b>\n` +
      `👥 Total Customers: <b>${custRes.count || 0}</b>\n` +
      `📦 Total Orders: <b>${ordRes.count || 0}</b>\n` +
      `💰 Total Revenue: <b>${totalRevenue.toFixed(2)} USDT</b>\n\n` +
      `━━━━━━━━━━━━━━━\n` +
      `📅 <b>Today</b>\n` +
      `🛒 Orders: <b>${todayOrdRes.count || 0}</b>\n` +
      `💵 Revenue: <b>${todayRevenue.toFixed(2)} USDT</b>\n` +
      `👤 New Users: <b>${newCustTodayRes.count || 0}</b>\n\n` +
      `📆 <b>This Week (7 days)</b>\n` +
      `🛒 Orders: <b>${weekOrdRes.count || 0}</b>\n` +
      `💵 Revenue: <b>${weekRevenue.toFixed(2)} USDT</b>\n` +
      `👤 New Users: <b>${newCustWeekRes.count || 0}</b>\n\n` +
      `🗓 <b>This Month</b>\n` +
      `🛒 Orders: <b>${monthOrdRes.count || 0}</b>\n` +
      `💵 Revenue: <b>${monthRevenue.toFixed(2)} USDT</b>\n` +
      `👤 New Users: <b>${newCustMonthRes.count || 0}</b>` +
      topProductsText + topBuyersText + `\n\n` +
      `━━━━━━━━━━━━━━━\n` +
      `💸 Pending Withdrawals: <b>${wdRes.count || 0}</b>`;

    await editOrSend(chatId, msgId, statsMsg, { inline_keyboard: [[{ text: "🔄 Refresh", callback_data: "adm_stats" }, { text: "◀️ Admin Menu", callback_data: "adm_menu" }]] });
    return;
  }

  if (data === "adm_deposits" && isAdmin(chatId)) {
    const { data: pendingDeps } = await supabase.from("bot_deposits").select("*, customer:bot_customers(*), product:bot_products(name)").eq("status", "pending").order("created_at", { ascending: false }).limit(20);
    if (!pendingDeps || pendingDeps.length === 0) {
      await editOrSend(chatId, msgId, "✅ No pending deposits.", { inline_keyboard: [[{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]] });
      return;
    }
    let msg = `💰 <b>Pending Deposits (${pendingDeps.length})</b>\n\n`;
    const buttons = [];
    for (const dep of pendingDeps) {
      const cust = dep.customer;
      const prod = dep.product;
      const custLabel = cust ? (cust.username ? `@${cust.username}` : cust.first_name || `#${cust.chat_id}`) : "Unknown";
      const depShort = dep.id.slice(0, 8);
      const date = new Date(dep.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
      msg += `👤 ${custLabel} — <code>${dep.txn_hash ? dep.txn_hash.slice(0, 12) + "..." : "N/A"}</code> — ${date}`;
      if (dep.pending_product_id && prod) msg += ` — 📦 ${prod.name} x${dep.pending_quantity || 1}`;
      msg += `\n`;
      buttons.push([{ text: `✅ Verify ${custLabel}`, callback_data: `dep_approve_${depShort}` }, { text: `❌ Reject`, callback_data: `dep_reject_${depShort}` }]);
    }
    buttons.push([{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]);
    await editOrSend(chatId, msgId, msg, { inline_keyboard: buttons });
    return;
  }

  if (data === "adm_withdrawals" && isAdmin(chatId)) { await showAdminWithdrawals(chatId, emojiMap, msgId); return; }

  if ((data === "adm_customers" || data.startsWith("adm_customers_p")) && isAdmin(chatId)) {
    const PAGE_SIZE = 15;
    const page = data.startsWith("adm_customers_p") ? parseInt(data.replace("adm_customers_p", "")) || 0 : 0;
    const from = page * PAGE_SIZE;

    const { data: custs, count } = await supabase.from("bot_customers").select("*", { count: "exact" }).order("updated_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
    if (!custs || custs.length === 0) { await editOrSend(chatId, msgId, "No customers yet.", { inline_keyboard: [[{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]] }); return; }
    const totalCount = count || custs.length;
    const totalPages = Math.ceil(totalCount / PAGE_SIZE);
    let msg = `👥 <b>Customers (${from + 1}-${from + custs.length} of ${totalCount}):</b>\n\n`;
    const buttons = [];
    for (const c of custs) {
      const label = c.username ? `@${c.username}` : c.first_name || `#${c.chat_id}`;
      const plTag = c.pay_later_enabled ? ` 🏷️` : "";
      msg += `• ${label} — <b>${Number(c.balance).toFixed(2)} USDT</b>${plTag}\n`;
      buttons.push([
        { text: `💬 ${label}`, callback_data: `cmsg_${c.id.slice(0, 8)}` },
        { text: `💰 Edit Bal`, callback_data: `ceditbal_${c.id.slice(0, 8)}` },
        { text: `🏷️ Credit`, callback_data: `cpl_${c.id.slice(0, 8)}` },
      ]);
    }
    // Pagination buttons
    const navRow = [];
    if (page > 0) navRow.push({ text: `⬅️ Prev`, callback_data: `adm_customers_p${page - 1}` });
    navRow.push({ text: `📄 ${page + 1}/${totalPages}`, callback_data: "noop" });
    if (page < totalPages - 1) navRow.push({ text: `Next ➡️`, callback_data: `adm_customers_p${page + 1}` });
    if (navRow.length > 0) buttons.push(navRow);
    buttons.push([{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]);
    await editOrSend(chatId, msgId, msg, { inline_keyboard: buttons });
    return;
  }

  // Send personal message to customer
  if (data.startsWith("cmsg_") && isAdmin(chatId)) {
    const custShort = data.replace("cmsg_", "");
    const { data: custs } = await supabase.from("bot_customers").select("id, chat_id, username, first_name");
    const cust = custs?.find(c => c.id.startsWith(custShort));
    if (!cust) { await editOrSend(chatId, msgId, "❌ Customer not found."); return; }
    const label = cust.username ? `@${cust.username}` : cust.first_name || `#${cust.chat_id}`;
    await supabase.from("bot_customers").update({ pending_action: `admin_dm_${custShort}` }).eq("chat_id", chatId);
    await editOrSend(chatId, msgId, `💬 <b>Send Message to ${label}</b>\n\nType your message now. HTML formatting supported.\n\n❌ /cancel to cancel`);
    return;
  }

  // Edit customer balance
  if (data.startsWith("ceditbal_") && isAdmin(chatId)) {
    const custShort = data.replace("ceditbal_", "");
    const { data: custs } = await supabase.from("bot_customers").select("id, chat_id, username, first_name, balance");
    const cust = custs?.find(c => c.id.startsWith(custShort));
    if (!cust) { await editOrSend(chatId, msgId, "❌ Customer not found."); return; }
    const label = cust.username ? `@${cust.username}` : cust.first_name || `#${cust.chat_id}`;
    await supabase.from("bot_customers").update({ pending_action: `admin_editbal_${custShort}` }).eq("chat_id", chatId);
    await editOrSend(chatId, msgId, `💰 <b>Edit Balance — ${label}</b>\n\nCurrent Balance: <b>${Number(cust.balance).toFixed(2)} USDT</b>\n\nEnter the new balance amount:\n\n❌ /cancel to cancel`);
    return;
  }

  // ── Pay Later admin management ──
  if (data.startsWith("cpl_") && isAdmin(chatId)) {
    const custShort = data.replace("cpl_", "");
    const { data: custs } = await supabase.from("bot_customers").select("id, chat_id, username, first_name, pay_later_enabled, pay_later_limit, pay_later_used");
    const cust = custs?.find(c => c.id.startsWith(custShort));
    if (!cust) { await editOrSend(chatId, msgId, "❌ Customer not found."); return; }
    const label = cust.username ? `@${cust.username}` : cust.first_name || `#${cust.chat_id}`;
    const enabled = cust.pay_later_enabled;
    const limit = Number(cust.pay_later_limit);
    const used = Number(cust.pay_later_used);
    const available = Math.max(0, limit - used);

    let msg = `🏷️ <b>Pay Later — ${label}</b>\n\n`;
    msg += `Status: <b>${enabled ? "✅ Enabled" : "❌ Disabled"}</b>\n`;
    msg += `💳 Limit: <b>${limit.toFixed(2)} USDT</b>\n`;
    msg += `📊 Used: <b>${used.toFixed(2)} USDT</b>\n`;
    msg += `✅ Available: <b>${available.toFixed(2)} USDT</b>\n`;

    const buttons = [
      [{ text: enabled ? "❌ Disable Pay Later" : "✅ Enable Pay Later", callback_data: `cpltoggle_${custShort}` }],
      [{ text: "💳 Set Limit", callback_data: `cplsetlimit_${custShort}` }],
      [{ text: "🔄 Reset Used to 0", callback_data: `cplreset_${custShort}` }],
      [{ text: "👥 Back to Customers", callback_data: "adm_customers" }],
    ];
    await editOrSend(chatId, msgId, msg, { inline_keyboard: buttons });
    return;
  }

  if (data.startsWith("cpltoggle_") && isAdmin(chatId)) {
    const custShort = data.replace("cpltoggle_", "");
    const { data: custs } = await supabase.from("bot_customers").select("id, pay_later_enabled");
    const cust = custs?.find(c => c.id.startsWith(custShort));
    if (!cust) { await editOrSend(chatId, msgId, "❌ Customer not found."); return; }
    const newVal = !cust.pay_later_enabled;
    await supabase.from("bot_customers").update({ pay_later_enabled: newVal, updated_at: new Date().toISOString() }).eq("id", cust.id);
    // Re-show the pay later panel
    await editOrSend(chatId, msgId, `✅ Pay Later ${newVal ? "enabled" : "disabled"}.`);
    // Trigger re-show
    const fakeData = `cpl_${custShort}`;
    const { data: custs2 } = await supabase.from("bot_customers").select("id, chat_id, username, first_name, pay_later_enabled, pay_later_limit, pay_later_used");
    const cust2 = custs2?.find(c => c.id.startsWith(custShort));
    if (cust2) {
      const label = cust2.username ? `@${cust2.username}` : cust2.first_name || `#${cust2.chat_id}`;
      const limit = Number(cust2.pay_later_limit);
      const used = Number(cust2.pay_later_used);
      const available = Math.max(0, limit - used);
      let msg = `🏷️ <b>Pay Later — ${label}</b>\n\n`;
      msg += `Status: <b>${cust2.pay_later_enabled ? "✅ Enabled" : "❌ Disabled"}</b>\n`;
      msg += `💳 Limit: <b>${limit.toFixed(2)} USDT</b>\n📊 Used: <b>${used.toFixed(2)} USDT</b>\n✅ Available: <b>${available.toFixed(2)} USDT</b>`;
      await editOrSend(chatId, msgId, msg, { inline_keyboard: [
        [{ text: cust2.pay_later_enabled ? "❌ Disable Pay Later" : "✅ Enable Pay Later", callback_data: `cpltoggle_${custShort}` }],
        [{ text: "💳 Set Limit", callback_data: `cplsetlimit_${custShort}` }],
        [{ text: "🔄 Reset Used to 0", callback_data: `cplreset_${custShort}` }],
        [{ text: "👥 Back to Customers", callback_data: "adm_customers" }],
      ] });
    }
    return;
  }

  if (data.startsWith("cplsetlimit_") && isAdmin(chatId)) {
    const custShort = data.replace("cplsetlimit_", "");
    await supabase.from("bot_customers").update({ pending_action: `admin_pllimit_${custShort}` }).eq("chat_id", chatId);
    await editOrSend(chatId, msgId, `💳 Enter the new Pay Later limit (USDT):\n\n❌ /cancel to cancel`);
    return;
  }

  if (data.startsWith("cplreset_") && isAdmin(chatId)) {
    const custShort = data.replace("cplreset_", "");
    const { data: custs } = await supabase.from("bot_customers").select("id");
    const cust = custs?.find(c => c.id.startsWith(custShort));
    if (cust) {
      await supabase.from("bot_customers").update({ pay_later_used: 0, updated_at: new Date().toISOString() }).eq("id", cust.id);
    }
    await editOrSend(chatId, msgId, `✅ Pay Later used amount reset to 0.`, { inline_keyboard: [[{ text: "🏷️ Back", callback_data: `cpl_${custShort}` }]] });
    return;
  }

  if (data === "adm_dm_user" && isAdmin(chatId)) {
    await supabase.from("bot_customers").update({ pending_action: "admin_dm_byuser" }).eq("chat_id", chatId);
    await editOrSend(chatId, msgId, `📩 <b>DM by Username</b>\n\nType the customer's @username, name, or chat ID:\n\n❌ /cancel to cancel`);
    return;
  }

  if (data === "adm_editmsg" && isAdmin(chatId)) {
    const buttons = Object.entries(PAGE_MSG_KEYS).map(([key, label]) => [{ text: `✏️ ${label}`, callback_data: `editmsg_${key}` }]);
    buttons.push([{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]);
    await editOrSend(chatId, msgId, `✏️ <b>Edit Page Messages</b>\n\nSelect a page to edit its message.\nSend the new message with premium emojis & formatting — it will be saved as-is.\n\n<b>Available placeholders:</b>\n• Welcome: <code>{name}</code>\n• Profile: <code>{id}</code> <code>{balance}</code> <code>{joined}</code>\n• Balance: <code>{balance}</code>\n• Withdraw: <code>{balance}</code>\n• Referral: <code>{ref_24h}</code> <code>{ref_7d}</code> <code>{ref_total}</code> <code>{earned}</code> <code>{available}</code> <code>{transferred}</code> <code>{commission}</code> <code>{bonus}</code> <code>{link}</code>\n• Stock Alert: <code>{product}</code> <code>{added}</code> <code>{stock}</code> <code>{price}</code>\n• Pay with Balance Confirm: <code>{product}</code> <code>{quantity}</code> <code>{subtotal}</code> <code>{final}</code> <code>{balance}</code> <code>{after}</code> <code>{currency}</code> <code>{price}</code>\n• Order Summary: <code>{product}</code> <code>{quantity}</code> <code>{price}</code> <code>{total}</code> <code>{currency}</code> <code>{balance_section}</code> <code>{payment_hint}</code> <code>{pay_later_section}</code>`, { inline_keyboard: buttons });
    return;
  }

  if (data.startsWith("editmsg_") && isAdmin(chatId)) {
    const msgKey = data.replace("editmsg_", "");
    const label = PAGE_MSG_KEYS[msgKey] || msgKey;
    await supabase.from("bot_customers").update({ pending_action: `admin_editmsg_${msgKey}` }).eq("chat_id", chatId);
    // Fetch fresh from DB to show actual saved message
    await fetchPageMsgs();
    const refSettings = await getRefSettings();
    const defaultMsgs = {
      welcome_message: cachedWelcomeMsg,
      msg_shop: `🛒 <b>Available Products:</b>`,
      msg_deposit: `💳 <b>Deposit USDT</b>\n\n💡 You can send <b>any amount</b> — it will be added to your balance.\n\nSelect a payment method below:`,
      msg_support: `🆘 <b>Need Help?</b>\n\nContact our support team directly:`,
      msg_profile: `👤 <b>User Profile</b>\n\n🆔 <b>ID:</b> {id}\n💰 <b>Balance:</b> {balance} USDT\n📅 <b>Joined:</b> {joined}`,
      msg_balance: `💰 <b>Your Balance:</b> {balance} USDT`,
      msg_withdraw: `💸 <b>Withdraw Funds</b>\n\nYour Balance: <b>{balance} USDT</b>\n\nEnter the amount you want to withdraw:`,
      msg_referral: `🎁 <b>Refer & Earn</b>\n\n👥 Referred (24h): {ref_24h}\n👥 Referred (7d): {ref_7d}\n👥 Referred (Total): {ref_total}\n\n💰 Total Earned: <b>{earned} USDT</b>\n💵 Available: <b>{available} USDT</b>\n🔄 Transferred: <b>{transferred} USDT</b>\n\n<blockquote>Earn <b>{commission}%</b> of every purchase/deposit by your referred users.\n<b>+$${refSettings.firstBonus.toFixed(2)}</b> bonus on their first purchase.\n\nTransfer earnings to wallet anytime.</blockquote>\n\n<b>Your Referral Link:</b>\n<code>{link}</code>`,
      msg_notifications: `🔔 <b>Notifications</b>\n\nCustomize your notification preferences:`,
      msg_stock_alert: `📢 <b>{added} new stock added for {product}!</b>\n\n📊 Available: <b>{stock}</b> items\n💰 Price: <b>{price} USDT</b>{bulk_pricing}`,
      msg_new_product: `🆕 <b>New Product Available!</b>\n\n📦 <b>{product}</b>\n💰 Price: <b>{price} USDT</b>\n📊 Stock: <b>{stock}</b>`,
      msg_price_up: `📈 <b>Price Increased</b>\n\n📦 <b>{product}</b>\n💰 Old: <s>{old_price} USDT</s>\n💎 New: <b>{new_price} USDT</b>{bulk_pricing}\n\n<i>Grab it before it goes higher!</i>`,
      msg_price_down: `📉 <b>Price Drop!</b>\n\n📦 <b>{product}</b>\n💰 Was: <s>{old_price} USDT</s>\n🔥 Now: <b>{new_price} USDT</b>{bulk_pricing}\n\n<i>Limited time offer — buy now!</i>`,
      msg_keyword_reply: `✅ <b>Available now!</b> Tap below to buy:`,
      msg_pay_balance_confirm: `💰 <b>Pay with Balance</b>\n\n{product}\n🔢 Quantity: <b>{quantity}</b>\n🧾 Subtotal: <b>{subtotal} {currency}</b>\n💵 Final: <b>{final} {currency}</b>\n\n💰 Balance: <b>{balance}</b>\n📊 After: <b>{after}</b>\n\n⚡ <i>Once confirmed, your items will be delivered instantly.</i>\n\n<b>Confirm balance deduction?</b>`,
      msg_order_summary: `📋 <b>Order Summary</b>\n\n{product}\n🔢 Qty: <b>{quantity}</b>\n💵 Price: <b>\${price}</b> each\n💰 Total: <b>\${total} {currency}</b>{balance_section}{payment_hint}{pay_later_section}`,
      msg_flash_sale: `🔥 <b>FLASH SALE — LIMITED TIME!</b>\n\n{product}\n\n💰 Sale Price: <b>\${price}</b>\n<s>Regular: \${original}</s> — Save \${savings}\n\n⏳ Ends in: <b><code>{countdown}</code></b>\n\n<i>Hurry — grab it before time runs out!</i>`,
      msg_flash_sale_ended: `⏰ <b>FLASH SALE ENDED</b>\n\n{product}\n\n<i>This limited-time offer has expired. Regular pricing is back.</i>`,
      msg_recent_sale: `🛒 Someone just bought <b>{quantity}× {product}</b>`,
      msg_recent_sale_web: `🛍️ Someone just bought <b>{quantity}× {product}</b> from the website`,
    };
    const currentMsg = normalizeTelegramHtml(cachedPageMsgs[msgKey] || defaultMsgs[msgKey] || "(no message)");
    const isCustom = !!cachedPageMsgs[msgKey];
    const currentPreview = `\n\n📝 <b>Current message${isCustom ? '' : ' (default)'}:</b>\n${currentMsg}`;

    const placeholderMap = {
      welcome_message: `<code>{name}</code> — User's first name`,
      msg_shop: `No placeholders — static message`,
      msg_deposit: `<code>{balance}</code> — Current balance`,
      msg_support: `No placeholders — static message`,
      msg_profile: `<code>{id}</code> — Chat ID\n<code>{balance}</code> — Current balance\n<code>{joined}</code> — Join date`,
      msg_balance: `<code>{balance}</code> — Current balance`,
      msg_withdraw: `<code>{balance}</code> — Current balance`,
      msg_referral: `<code>{link}</code> — Referral link\n<code>{ref_24h}</code> — Referrals in 24h\n<code>{ref_7d}</code> — Referrals in 7 days\n<code>{ref_total}</code> — Total referrals\n<code>{earned}</code> — Total earned\n<code>{available}</code> — Available balance\n<code>{transferred}</code> — Transferred amount\n<code>{commission}</code> — Commission %\n<code>{bonus}</code> — First purchase bonus $`,
      msg_notifications: `No placeholders — static message`,
      msg_stock_alert: `<code>{product}</code> — Product name\n<code>{added}</code> — New stock count\n<code>{stock}</code> — Total available\n<code>{price}</code> — Product price\n<code>{bulk_pricing}</code> — Bulk pricing tiers block (empty if none)`,
      msg_new_product: `<code>{product}</code> — Product name\n<code>{stock}</code> — Available stock\n<code>{price}</code> — Product price\n<code>{description}</code> — Product description`,
      msg_price_up: `<code>{product}</code> — Product name\n<code>{old_price}</code> — Previous price\n<code>{new_price}</code> — New higher price\n<code>{bulk_pricing}</code> — Bulk pricing tiers block (empty if none)`,
      msg_price_down: `<code>{product}</code> — Product name\n<code>{old_price}</code> — Previous price\n<code>{new_price}</code> — New lower price\n<code>{bulk_pricing}</code> — Bulk pricing tiers block (empty if none)`,
      msg_keyword_reply: `<code>{product}</code> — First matched product name\n<code>{products}</code> — All matched product names (comma-separated)\n<code>{count}</code> — Number of matched products`,
      msg_pay_balance_confirm: `<code>{product}</code> — Product (with emoji + name)\n<code>{quantity}</code> — Quantity\n<code>{subtotal}</code> — Subtotal $\n<code>{final}</code> — Final $\n<code>{balance}</code> — Current balance $\n<code>{after}</code> — Balance after purchase $\n<code>{currency}</code> — Currency code\n<code>{price}</code> — Unit price $`,
      msg_order_summary: `<code>{product}</code> — Product (with emoji + name)\n<code>{quantity}</code> — Quantity\n<code>{price}</code> — Unit price $\n<code>{total}</code> — Total $\n<code>{currency}</code> — Currency code\n<code>{balance_section}</code> — Auto balance info block (or empty)\n<code>{payment_hint}</code> — "Pay remaining via:" or "Choose method:" hint\n<code>{pay_later_section}</code> — Pay Later info block (or empty)`,
      msg_flash_sale: `<code>{product}</code> — Product (with emoji + name)\n<code>{price}</code> — Sale price\n<code>{original}</code> — Original price\n<code>{savings}</code> — Amount saved\n<code>{countdown}</code> — Live HH:MM:SS countdown`,
      msg_flash_sale_ended: `<code>{product}</code> — Product (with emoji + name)`,
      msg_recent_sale: `<code>{product}</code> — Product (with emoji + name)\n<code>{quantity}</code> — Quantity bought`,
      msg_recent_sale_web: `<code>{product}</code> — Product (with emoji + name)\n<code>{quantity}</code> — Quantity bought`,
    };
    const placeholderInfo = placeholderMap[msgKey] || "No placeholders";

    const timeLineHint = (msgKey === "msg_flash_sale" || msgKey === "msg_flash_sale_ended")
      ? `\n\n⏱ <b>Premium emoji on the time / {countdown} line is fully supported.</b>\nPlace any premium emoji next to <code>{countdown}</code> (e.g. <code>🕐 {countdown}</code> with a premium clock). The raw <code>custom_emoji_id</code> is captured byte-aware and rendered via <code>&lt;tg-emoji&gt;</code> when broadcast.`
      : "";
    await editOrSend(chatId, msgId, `✏️ <b>Edit: ${label}</b>${currentPreview}\n\n📌 <b>Available Placeholders:</b>\n${placeholderInfo}${timeLineHint}\n\n👇 Send the new message now (with premium emojis & formatting).\n\n❌ /cancel to cancel`);
    return;
  }

  // ── Channel Join settings (admin) ──
  if (data === "adm_channel_join" && isAdmin(chatId)) {
    const s = await fetchChannelJoinSettings(true);
    const status = s.enabled ? "🟢 ON" : "🔴 OFF";
    const usernameDisplay = s.username ? `<code>${escapeHtml(s.username)}</code>` : "<i>not set</i>";
    const messagePreview = s.message ? s.message.slice(0, 300) + (s.message.length > 300 ? "…" : "") : "<i>not set</i>";
    const text =
      `📢 <b>Channel Join Requirement</b>\n\n` +
      `<b>Status:</b> ${status}\n` +
      `<b>Channel:</b> ${usernameDisplay}\n` +
      `<b>Join button emoji:</b> ${s.buttonEmoji || "<i>none</i>"}\n` +
      `<b>Done button emoji:</b> ${s.doneEmoji || "<i>none</i>"}\n\n` +
      `<b>Current message:</b>\n${messagePreview}`;
    const buttons = [
      [{ text: s.enabled ? "🔴 Disable" : "🟢 Enable", callback_data: "cj_toggle" }],
      [{ text: "🔗 Edit Channel", callback_data: "cj_edit_username" }],
      [{ text: "✏️ Edit Join Message", callback_data: "cj_edit_msg" }],
      [{ text: "📢 Edit Join Emoji", callback_data: "cj_edit_join_emoji" }, { text: "✅ Edit Done Emoji", callback_data: "cj_edit_done_emoji" }],
      [{ text: "◀️ Admin Menu", callback_data: "adm_menu" }],
    ];
    await editOrSend(chatId, msgId, text, { inline_keyboard: buttons });
    return;
  }

  if (data === "cj_toggle" && isAdmin(chatId)) {
    const s = await fetchChannelJoinSettings(true);
    const newVal = s.enabled ? "false" : "true";
    const { data: existing } = await supabase.from("bot_settings").select("id").eq("key", "channel_join_enabled").maybeSingle();
    if (existing) await supabase.from("bot_settings").update({ value: newVal, updated_at: new Date().toISOString() }).eq("key", "channel_join_enabled");
    else await supabase.from("bot_settings").insert({ key: "channel_join_enabled", value: newVal });
    cachedChannelJoin.enabled = newVal === "true";
    channelJoinLastFetch = Date.now();
    await sendMessage(chatId, `✅ Channel join requirement is now <b>${newVal === "true" ? "ON" : "OFF"}</b>.`);
    await showAdminMenu(chatId, emojiMap);
    return;
  }

  if (data === "cj_edit_msg" && isAdmin(chatId)) {
    await supabase.from("bot_customers").update({ pending_action: "admin_cj_msg" }).eq("chat_id", chatId);
    await editOrSend(chatId, msgId, `✏️ <b>Edit Join Message</b>\n\nSend the new message text now. HTML formatting and premium/custom emojis are supported.\n\n❌ /cancel to cancel`);
    return;
  }

  if (data === "cj_edit_join_emoji" && isAdmin(chatId)) {
    await supabase.from("bot_customers").update({ pending_action: "admin_cj_join_emoji" }).eq("chat_id", chatId);
    await editOrSend(chatId, msgId, `📢 <b>Edit Join Button Emoji</b>\n\nSend a single emoji (premium/custom emojis supported).\n\n❌ /cancel to cancel`);
    return;
  }

  if (data === "cj_edit_done_emoji" && isAdmin(chatId)) {
    await supabase.from("bot_customers").update({ pending_action: "admin_cj_done_emoji" }).eq("chat_id", chatId);
    await editOrSend(chatId, msgId, `✅ <b>Edit Done Button Emoji</b>\n\nSend a single emoji (premium/custom emojis supported).\n\n❌ /cancel to cancel`);
    return;
  }

  if (data === "cj_edit_username" && isAdmin(chatId)) {
    await supabase.from("bot_customers").update({ pending_action: "admin_cj_username" }).eq("chat_id", chatId);
    await editOrSend(chatId, msgId, `🔗 <b>Edit Channel</b>\n\nSend the channel username (e.g. <code>@mychannel</code>) or numeric ID (e.g. <code>-1001234567890</code>).\n\n⚠️ The bot must be an <b>admin</b> in the channel for verification to work.\n\n❌ /cancel to cancel`);
    return;
  }

  // ── 🎁 Referral Join-Bonus Campaign admin ──
  if (data === "adm_refcamp" && isAdmin(chatId)) {
    const c = await getCampaignSettings(true);
    const status = c.active ? "🟢 ON" : "🔴 OFF";
    const msgPreview = c.message ? c.message.slice(0, 300) + (c.message.length > 300 ? "…" : "") : "<i>not set</i>";
    const btnDisplay = c.buttonText ? escapeHtml(c.buttonText) : "<i>not set</i>";
    const btnEmojiDisplay = c.buttonEmoji ? escapeHtml(c.buttonEmoji) + (c.buttonEmojiId ? " 🌟" : "") : "<i>none</i>";
    const groupBtnEmojiDisplay = c.groupButtonEmoji ? escapeHtml(c.groupButtonEmoji) + (c.groupButtonEmojiId ? " 🌟" : "") : "<i>none</i>";
    const groupBtnTextDisplay = c.groupButtonText ? escapeHtml(c.groupButtonText) : "<i>Get My Referral Link</i> (default)";
    const text =
      `🎁 <b>Referral Join-Bonus Campaign</b>\n\n` +
      `<b>Status:</b> ${status}\n` +
      `<b>Reward per join:</b> <code>${Number(c.reward).toFixed(2)} USDT</code>\n` +
      `<b>Button text (user DM):</b> ${btnDisplay}\n` +
      `<b>Button emoji (user DM):</b> ${btnEmojiDisplay}\n` +
      `<b>Group version button text:</b> ${groupBtnTextDisplay}\n` +
      `<b>Group version button emoji:</b> ${groupBtnEmojiDisplay}\n` +
      `<b>Group version button color:</b> <code>${escapeHtml(c.groupButtonStyle || "primary")}</code>\n\n` +
      `<i>ℹ️ If a group button emoji is set, the group broadcast button shows only that emoji. Otherwise it shows the group button text. Color requires Telegram client supporting Bot API 9.4+.</i>\n\n` +
      `<b>Current message template:</b>\n${msgPreview}\n\n` +
      `<i>ℹ️ This campaign only controls the limited-time join bonus. The permanent first-purchase bonus + commission % referral system always stays active regardless of this toggle.</i>`;
    const buttons = [
      [{ text: c.active ? "🔴 Disable" : "🟢 Enable", callback_data: "rc_toggle" }],
      [{ text: "💰 Edit Reward", callback_data: "rc_edit_reward" }],
      [{ text: "✏️ Edit Message", callback_data: "rc_edit_msg" }],
      [{ text: "🔘 Edit Button Text", callback_data: "rc_edit_btn" }, { text: "✨ Edit Button Emoji", callback_data: "rc_edit_btn_emoji" }],
      [{ text: "👥 Edit Group Btn Text", callback_data: "rc_edit_group_btn_text" }, { text: "✨ Edit Group Btn Emoji", callback_data: "rc_edit_group_btn_emoji" }],
      [{ text: "🎨 Edit Group Btn Color", callback_data: "rc_edit_group_btn_style" }],
      [{ text: "👁 Preview Message", callback_data: "rc_preview" }],
      [{ text: "📢 Broadcast", callback_data: "rc_broadcast" }],
      [{ text: "◀️ Admin Menu", callback_data: "adm_menu" }],
    ];

    await editOrSend(chatId, msgId, text, { inline_keyboard: buttons });
    return;
  }

  if (data === "rc_preview" && isAdmin(chatId)) {
    await editOrSend(chatId, msgId, "👁 Sending preview to your Telegram…");
    try {
      const resp = await fetch(`${process.env.SUPABASE_URL}/functions/v1/referral-campaign-broadcast`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ target: "preview", preview_chat_id: chatId }),
      });
      const out = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const details = out?.details ? ` | details: ${JSON.stringify(out.details)}` : "";
        const warnings = Array.isArray(out?.warnings) && out.warnings.length ? ` | warnings: ${out.warnings.join(" | ")}` : "";
        console.error("[referral-campaign-preview] failed", JSON.stringify({ status: resp.status, error: out?.error, warnings: out?.warnings, details: out?.details }));
        throw new Error(`${out?.error || `HTTP ${resp.status}`}${warnings}${details}`);
      }
      const warnLine = Array.isArray(out?.warnings) && out.warnings.length
        ? `\n\n⚠️ <b>Warnings:</b>\n${out.warnings.map((w) => "• " + escapeHtml(String(w))).join("\n")}`
        : "";
      await sendMessage(chatId, `✅ Preview sent (${out?.sent ?? 0} messages). Check the messages above to see exactly how the campaign will look.${warnLine}`, {
        inline_keyboard: [[{ text: "🎁 Refer Campaign", callback_data: "adm_refcamp" }, { text: "◀️ Admin Menu", callback_data: "adm_menu" }]],
      });
    } catch (e) {
      await sendMessage(chatId, `❌ Preview failed: ${e.message}`, {
        inline_keyboard: [[{ text: "🎁 Refer Campaign", callback_data: "adm_refcamp" }]],
      });
    }
    return;
  }

  if (data === "rc_broadcast" && isAdmin(chatId)) {
    await editOrSend(chatId, msgId,
      "📢 <b>Broadcast Campaign</b>\n\nChoose where to send the referral campaign message:\n\n" +
      "• <b>Users</b> — each user gets a DM with their own personal referral link\n" +
      "• <b>Groups</b> — sent to all connected groups with a CTA button (no personal links)\n\n" +
      "⚠️ Tip: use <b>👁 Preview Message</b> first to verify the content.",
      { inline_keyboard: [
        [{ text: "👤 Broadcast to Users", callback_data: "rc_bcast_users" }],
        [{ text: "👥 Broadcast to Groups", callback_data: "rc_bcast_groups" }],
        [{ text: "◀️ Back", callback_data: "adm_refcamp" }],
      ] }
    );
    return;
  }

  if ((data === "rc_bcast_users" || data === "rc_bcast_groups") && isAdmin(chatId)) {
    const target = data === "rc_bcast_users" ? "users" : "groups";
    const label = target === "users" ? "👤 users" : "👥 groups";
    await editOrSend(chatId, msgId, `📢 Broadcasting to ${label}… this may take a while.`);
    try {
      const resp = await fetch(`${process.env.SUPABASE_URL}/functions/v1/referral-campaign-broadcast`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ target }),
      });
      const out = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(out?.error || `HTTP ${resp.status}`);
      await sendMessage(chatId,
        `✅ <b>Broadcast Complete!</b>\n\n📤 Sent: <b>${out?.sent ?? 0}</b>\n❌ Failed: <b>${out?.failed ?? 0}</b>\n👥 Total: <b>${out?.total ?? 0}</b>`,
        { inline_keyboard: [[{ text: "🎁 Refer Campaign", callback_data: "adm_refcamp" }, { text: "◀️ Admin Menu", callback_data: "adm_menu" }]] }
      );
    } catch (e) {
      await sendMessage(chatId, `❌ Broadcast failed: ${e.message}`, {
        inline_keyboard: [[{ text: "🎁 Refer Campaign", callback_data: "adm_refcamp" }]],
      });
    }
    return;
  }

  if (data === "rc_toggle" && isAdmin(chatId)) {
    const c = await getCampaignSettings(true);
    const newVal = c.active ? "false" : "true";
    const { data: existing } = await supabase.from("bot_settings").select("id").eq("key", "referral_campaign_active").maybeSingle();
    if (existing) await supabase.from("bot_settings").update({ value: newVal, updated_at: new Date().toISOString() }).eq("key", "referral_campaign_active");
    else await supabase.from("bot_settings").insert({ key: "referral_campaign_active", value: newVal });
    cachedCampaign.active = newVal === "true";
    campaignLastFetch = Date.now();
    await sendMessage(chatId, `✅ Join-bonus campaign is now <b>${newVal === "true" ? "ON" : "OFF"}</b>.`);
    return;
  }

  if (data === "rc_edit_reward" && isAdmin(chatId)) {
    await supabase.from("bot_customers").update({ pending_action: "admin_rc_reward" }).eq("chat_id", chatId);
    await editOrSend(chatId, msgId, `💰 <b>Edit Join Reward</b>\n\nSend the new reward amount in USDT (e.g. <code>0.1</code>).\n\n❌ /cancel to cancel`);
    return;
  }

  if (data === "rc_edit_msg" && isAdmin(chatId)) {
    const c = await getCampaignSettings(true);
    await supabase.from("bot_customers").update({ pending_action: "admin_rc_msg" }).eq("chat_id", chatId);
    await editOrSend(chatId, msgId, `✏️ <b>Edit Campaign Message</b>\n\nSend the new message text now. HTML formatting and premium/custom emojis are supported.\n\n❌ /cancel to cancel`);
    if (c.message) {
      try {
        await sendMessage(chatId, `📄 <b>Current saved message:</b>\n\n${c.message}`);
      } catch (e) {
        await sendMessage(chatId, `📄 <b>Current saved message (raw):</b>\n\n<code>${escapeHtml(c.message)}</code>`);
      }
    } else {
      await sendMessage(chatId, `📄 <i>No campaign message is set yet.</i>`);
    }
    return;
  }

  if (data === "rc_edit_btn" && isAdmin(chatId)) {
    const c = await getCampaignSettings(true);
    await supabase.from("bot_customers").update({ pending_action: "admin_rc_btn" }).eq("chat_id", chatId);
    await editOrSend(chatId, msgId, `🔘 <b>Edit Campaign Button Text</b>\n\nSend the new button text (e.g. <code>🎁 Join &amp; Earn 0.1 USDT</code>).\n\n❌ /cancel to cancel`);
    const curText = c.buttonText || "";
    const curEmoji = c.buttonEmoji || "";
    const previewLabel = (curEmoji ? curEmoji + " " : "") + (curText || "Refer & Earn");
    await sendMessage(
      chatId,
      `📄 <b>Current button text:</b> ${curText ? escapeHtml(curText) : "<i>not set</i>"}\n<b>Current emoji:</b> ${curEmoji ? escapeHtml(curEmoji) : "<i>none</i>"}\n\n👇 <b>User preview:</b>`,
      { inline_keyboard: [[{ text: previewLabel, callback_data: "noop_preview" }]] }
    );
    return;
  }

  if (data === "rc_edit_btn_emoji" && isAdmin(chatId)) {
    const c = await getCampaignSettings(true);
    await supabase.from("bot_customers").update({ pending_action: "admin_rc_btn_emoji" }).eq("chat_id", chatId);
    await editOrSend(chatId, msgId, `✨ <b>Edit Campaign Button Emoji</b>\n\nSend a single emoji (premium/custom emojis supported).\n\n❌ /cancel to cancel`);
    const curText = c.buttonText || "Refer & Earn";
    const curEmoji = c.buttonEmoji || "";
    const previewLabel = (curEmoji ? curEmoji + " " : "") + curText;
    const idNote = c.buttonEmojiId ? `\n🌟 Premium emoji document_id: <code>${escapeHtml(c.buttonEmojiId)}</code>` : "";
    await sendMessage(
      chatId,
      `📄 <b>Current emoji:</b> ${curEmoji ? escapeHtml(curEmoji) : "<i>none</i>"}${idNote}\n\n👇 <b>User preview:</b>\n<i>Note: inline button labels show the fallback character only; premium emoji animation is not rendered on buttons.</i>`,
      { inline_keyboard: [[{ text: previewLabel, callback_data: "noop_preview" }]] }
    );
    return;
  }

  if (data === "rc_edit_group_btn_emoji" && isAdmin(chatId)) {
    const c = await getCampaignSettings(true);
    await supabase.from("bot_customers").update({ pending_action: "admin_rc_group_btn_emoji" }).eq("chat_id", chatId);
    await editOrSend(chatId, msgId, `👥 <b>Edit Group Version Button Emoji</b>\n\nSend a single emoji (premium/custom emojis supported). The premium emoji renders <b>alongside the button text</b>.\n\nSend <code>clear</code> to remove the emoji.\n\n❌ /cancel to cancel`);
    const curEmoji = c.groupButtonEmoji || "";
    const idNote = c.groupButtonEmojiId ? `\n🌟 Premium emoji document_id: <code>${escapeHtml(c.groupButtonEmojiId)}</code>` : "";
    const btnLabel = c.groupButtonText || "Get My Referral Link";
    const previewBtn = { text: btnLabel, callback_data: "noop_preview" };
    if (c.groupButtonEmojiId) previewBtn.icon_custom_emoji_id = c.groupButtonEmojiId;
    if (c.groupButtonStyle) previewBtn.style = c.groupButtonStyle;
    await sendMessage(
      chatId,
      `📄 <b>Current group button emoji:</b> ${curEmoji ? escapeHtml(curEmoji) : "<i>none</i>"}${idNote}\n\n👇 <b>Group preview:</b>\n<i>Note: inline button labels show the fallback character only; premium emoji animation is not rendered on buttons.</i>`,
      { inline_keyboard: [[previewBtn]] }
    );
    return;
  }

  if (data === "rc_edit_group_btn_text" && isAdmin(chatId)) {
    const c = await getCampaignSettings(true);
    await supabase.from("bot_customers").update({ pending_action: "admin_rc_group_btn_text" }).eq("chat_id", chatId);
    const cur = c.groupButtonText || "";
    await editOrSend(chatId, msgId, `👥 <b>Edit Group Version Button Text</b>\n\nSend the text for the group broadcast button (shown when no group button emoji is set).\n\n<b>Current:</b> ${cur ? escapeHtml(cur) : "<i>Get My Referral Link</i> (default)"}\n\nSend <code>clear</code> to restore the default.\n\n❌ /cancel to cancel`);
    return;
  }

  if (data === "rc_edit_group_btn_style" && isAdmin(chatId)) {
    const c = await getCampaignSettings(true);
    const cur = c.groupButtonStyle || "primary";
    const styles = [
      { key: "primary", label: "🔵 Primary (Blue)" },
      { key: "success", label: "🟢 Success (Green)" },
      { key: "danger", label: "🔴 Danger (Red)" },
    ];
    const kb = styles.map(s => [{ text: (s.key === cur ? "✅ " : "") + s.label, callback_data: `rc_set_group_style:${s.key}` }]);
    kb.push([{ text: "◀️ Back", callback_data: "adm_refcamp" }]);
    await editOrSend(chatId, msgId, `🎨 <b>Group Version Button Color</b>\n\nSelect the button style (Bot API 9.4+: only primary/success/danger are valid).\n\n<b>Current:</b> <code>${escapeHtml(cur)}</code>`, { inline_keyboard: kb });
    return;
  }

  if (data.startsWith("rc_set_group_style:") && isAdmin(chatId)) {
    const style = data.split(":")[1];
    if (!["primary","success","danger"].includes(style)) { answerCallbackQuery(callbackQuery.id, "Invalid style"); return; }
    const { data: existing } = await supabase.from("bot_settings").select("id").eq("key", "referral_campaign_group_button_style").maybeSingle();
    if (existing) await supabase.from("bot_settings").update({ value: style, updated_at: new Date().toISOString() }).eq("key", "referral_campaign_group_button_style");
    else await supabase.from("bot_settings").insert({ key: "referral_campaign_group_button_style", value: style });
    cachedCampaign.groupButtonStyle = style;
    campaignLastFetch = Date.now();
    answerCallbackQuery(callbackQuery.id, `✅ Color set to ${style}`);
    await editOrSend(chatId, msgId, `✅ <b>Group button color updated to:</b> <code>${escapeHtml(style)}</code>`, { inline_keyboard: [[{ text: "🎁 Refer Campaign", callback_data: "adm_refcamp" }]] });
    return;
  }





  if (data === "adm_broadcast" && isAdmin(chatId)) {
    await supabase.from("bot_customers").update({ pending_action: "admin_broadcast", pending_inputs: null }).eq("chat_id", chatId);
    await editOrSend(chatId, msgId, `📢 <b>Broadcast Mode</b>\n\nType your broadcast message now. After that you can attach product buttons.\n\nHTML formatting: <code>&lt;b&gt;bold&lt;/b&gt;</code>, <code>&lt;i&gt;italic&lt;/i&gt;</code>\n\n❌ /cancel to cancel`);
    return;
  }

  if (data.startsWith("adm_bcast_toggle_") && isAdmin(chatId)) {
    const pid = data.replace("adm_bcast_toggle_", "");
    const pending = customer.pending_inputs && typeof customer.pending_inputs === "object" ? customer.pending_inputs : {};
    const ids = Array.isArray(pending.productIds) ? pending.productIds.slice() : [];
    const idx = ids.indexOf(pid);
    if (idx >= 0) ids.splice(idx, 1); else ids.push(pid);
    await supabase.from("bot_customers").update({ pending_inputs: { ...pending, productIds: ids } }).eq("id", customer.id);
    await showBroadcastProductPicker(chatId, msgId, ids);
    return;
  }

  if ((data === "adm_bcast_send" || data === "adm_bcast_skip") && isAdmin(chatId)) {
    const pending = customer.pending_inputs && typeof customer.pending_inputs === "object" ? customer.pending_inputs : {};
    const htmlText = pending.text || "";
    const ids = data === "adm_bcast_send" && Array.isArray(pending.productIds) ? pending.productIds : [];
    await supabase.from("bot_customers").update({ pending_action: null, pending_inputs: null }).eq("id", customer.id);
    if (!htmlText) { await editOrSend(chatId, msgId, "❌ Broadcast text missing.", { inline_keyboard: [[{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]] }); return; }
    let replyMarkup;
    if (ids.length > 0) {
      const { data: prods } = await supabase.from("bot_products").select("id, name, short_code, custom_emoji_id").in("id", ids);
      const botUser = await getBotUsername();
      const rows = (prods || []).map((p) => {
        const code = p.short_code || p.id.slice(0, 4).toUpperCase();
        return [buyNowButton({ text: `Buy ${p.name}`, url: `https://t.me/${botUser}?start=p_${code}` }, emojiMap)];
      });
      if (rows.length > 0) replyMarkup = { inline_keyboard: rows };
    }
    await editOrSend(chatId, msgId, `📢 Broadcasting...`);
    const { total, sent, failed } = await broadcastToAll(htmlText, replyMarkup);
    await sendMessage(chatId, `✅ <b>Broadcast Complete!</b>\n\n📤 Sent: <b>${sent}</b>\n❌ Failed: <b>${failed}</b>\n👥 Total: <b>${total}</b>${ids.length ? `\n🔘 Buttons: <b>${ids.length}</b>` : ""}`, { inline_keyboard: [[{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]] });
    return;
  }

  if (data === "adm_bcast_cancel" && isAdmin(chatId)) {
    await supabase.from("bot_customers").update({ pending_action: null, pending_inputs: null }).eq("id", customer.id);
    await editOrSend(chatId, msgId, "❌ Broadcast cancelled.", { inline_keyboard: [[{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]] });
    return;
  }


  if (data === "adm_newstock" && isAdmin(chatId)) {
    const { data: prods } = await supabase.from("bot_products").select("id, name, custom_emoji_id").eq("is_active", true).order("sort_order");
    if (!prods || prods.length === 0) { await editOrSend(chatId, msgId, "❌ No active products.", { inline_keyboard: [[{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]] }); return; }
    const buttons = prods.map((p) => {
      const btn = productSelectButton(p, `📦 ${p.name}`, `newstock_${p.id}`);
      return [btn];
    });
    buttons.push([{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]);
    await editOrSend(chatId, msgId, "📦 <b>New Stock Broadcast</b>\n\nSelect the product:", { inline_keyboard: buttons });
    return;
  }

  // New Product Announcement - select product
  if (data === "adm_newproduct" && isAdmin(chatId)) {
    const { data: prods } = await supabase.from("bot_products").select("id, name, custom_emoji_id").eq("is_active", true).order("sort_order");
    if (!prods || prods.length === 0) { await editOrSend(chatId, msgId, "❌ No active products.", { inline_keyboard: [[{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]] }); return; }
    const buttons = prods.map((p) => {
      const btn = productSelectButton(p, `🆕 ${p.name}`, `newprod_${p.id}`);
      return [btn];
    });
    buttons.push([{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]);
    await editOrSend(chatId, msgId, "🆕 <b>New Product Announcement</b>\n\nSelect the product to announce:", { inline_keyboard: buttons });
    return;
  }

  // Price Change - select product
  if (data === "adm_pricechange" && isAdmin(chatId)) {
    const { data: prods } = await supabase.from("bot_products").select("id, name, price, custom_emoji_id").eq("is_active", true).order("sort_order");
    if (!prods || prods.length === 0) { await editOrSend(chatId, msgId, "❌ No active products.", { inline_keyboard: [[{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]] }); return; }
    const buttons = prods.map((p) => {
      const btn = productSelectButton(p, `💱 ${p.name} ($${Number(p.price).toFixed(2)})`, `pricech_${p.id}`);
      return [btn];
    });
    buttons.push([{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]);
    await editOrSend(chatId, msgId, "💱 <b>Price Change Announcement</b>\n\nSelect a product. The bot will compare current price vs last broadcast and announce up/down automatically.\n\n<i>Tip: update the product price in the dashboard first, then trigger this.</i>", { inline_keyboard: buttons });
    return;
  }

  // Price Change - confirm broadcast
  if (data.startsWith("pricech_") && isAdmin(chatId)) {
    const productId = data.replace("pricech_", "");
    const { data: product } = await supabase.from("bot_products").select("*").eq("id", productId).single();
    if (!product) { await editOrSend(chatId, msgId, "❌ Product not found."); return; }
    const newPrice = Number(product.price);
    // Last broadcast price stored in bot_settings
    const settingKey = `last_price_${productId}`;
    const { data: lastRow } = await supabase.from("bot_settings").select("value").eq("key", settingKey).maybeSingle();
    const oldPrice = lastRow ? Number(lastRow.value) : newPrice;
    if (oldPrice === newPrice) {
      await supabase.from("bot_customers").update({ pending_action: `force_pricech_${productId}` }).eq("chat_id", chatId);
      await editOrSend(chatId, msgId, `⚠️ Current price (<b>$${newPrice.toFixed(2)}</b>) matches the last broadcast.\n\n📦 <b>${escapeHtml(product.name)}</b>\n\n👉 Reply with the <b>old price</b> (USDT) you want to show as the previous price in the announcement.\n\n<i>Type /cancel to abort.</i>`, { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "adm_menu" }]] });
      return;
    }
    const isUp = newPrice > oldPrice;
    await fetchPageMsgs();
    const tplKey = isUp ? "msg_price_up" : "msg_price_down";
    const bulkPricing = await formatBulkPricingBlock(productId);
    const defaultUp = `📈 <b>Price Increased</b>\n\n📦 <b>{product}</b>\n💰 Old: <s>${oldPrice.toFixed(2)} USDT</s>\n💎 New: <b>{new_price} USDT</b>{bulk_pricing}\n\n<i>Grab it before it goes higher!</i>`;
    const defaultDown = `📉 <b>Price Drop!</b>\n\n📦 <b>{product}</b>\n💰 Was: <s>${oldPrice.toFixed(2)} USDT</s>\n🔥 Now: <b>{new_price} USDT</b>{bulk_pricing}\n\n<i>Limited time offer — buy now!</i>`;
    let tpl = cachedPageMsgs[tplKey] || (isUp ? defaultUp : defaultDown);
    const productIcon = product.custom_emoji_id ? `<tg-emoji emoji-id="${product.custom_emoji_id}">📦</tg-emoji> ` : "";
    if (productIcon) tpl = tpl.replace(/📦\s*(<[^>]+>)?\s*\{product\}/g, "$1{product}");
    const broadcastMsg = replacePlaceholders(tpl, {
      product: `${productIcon}${product.name}`,
      old_price: oldPrice.toFixed(2),
      new_price: newPrice.toFixed(2),
      price: newPrice.toFixed(2),
      bulk_pricing: bulkPricing,
    });
    const botUser = await getBotUsername();
    const code = product.short_code || product.id.slice(0, 4).toUpperCase();
    const { data: buyNowEmoji } = await supabase.from("bot_button_emojis").select("custom_emoji_id").eq("button_key", "buy_now").maybeSingle();
    const buyBtn = buyNowButton({ text: `Buy ${product.name}`, url: `https://t.me/${botUser}?start=p_${code}` }, { buy_now: { emoji: buyNowEmoji?.custom_emoji_id || null } });
    const broadcastKeyboard = { inline_keyboard: [[buyBtn]] };
    await sendMessage(chatId, `${isUp ? '📈' : '📉'} Broadcasting price ${isUp ? 'increase' : 'drop'}...`);
    const { total, sent, failed } = await broadcastToAll(broadcastMsg, broadcastKeyboard);
    // Update last_price record
    if (lastRow) {
      await supabase.from("bot_settings").update({ value: String(newPrice), updated_at: new Date().toISOString() }).eq("key", settingKey);
    } else {
      await supabase.from("bot_settings").insert({ key: settingKey, value: String(newPrice) });
    }
    await sendMessage(chatId, `✅ <b>Price ${isUp ? 'Up' : 'Down'} Broadcast Complete!</b>\n\n📦 <b>${product.name}</b>\n💰 ${oldPrice.toFixed(2)} → <b>${newPrice.toFixed(2)} USDT</b>\n📤 Sent: <b>${sent}</b>\n❌ Failed: <b>${failed}</b>\n👥 Total: <b>${total}</b>`, { inline_keyboard: [[{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]] });
    return;
  }

  // ── Flash Sales menu ──
  if (data === "adm_flashsales" && isAdmin(chatId)) {
    const nowIso = new Date().toISOString();
    const { data: activeRaw, error: fsErr } = await supabase
      .from("bot_flash_sales")
      .select("*")
      .eq("is_active", true)
      .gt("ends_at", nowIso)
      .order("ends_at");
    if (fsErr) console.error("[adm_flashsales] query error:", fsErr);
    const active = Array.isArray(activeRaw) ? activeRaw : [];
    const productIds = [...new Set(active.map((s) => s.product_id).filter(Boolean))];
    const productMap = {};
    if (productIds.length > 0) {
      const { data: prods } = await supabase.from("bot_products").select("id, name").in("id", productIds);
      for (const p of prods || []) productMap[p.id] = p.name;
    }
    let txt = "🔥 <b>Flash Sales</b>\n\n";
    if (active.length > 0) {
      txt += "<b>Active sales:</b>\n";
      for (const s of active) {
        const name = productMap[s.product_id] || "Product";
        txt += `• <b>${escapeHtml(name)}</b> — $${Number(s.sale_price).toFixed(2)} • ⏳ ${formatCountdown(s.ends_at)}\n`;
      }
      txt += "\n";
    } else {
      txt += "<i>No active flash sales.</i>\n\n";
    }
    txt += "Tap a button below to manage:";
    const buttons = [
      [{ text: "➕ Create Flash Sale", callback_data: "adm_fs_new" }],
    ];
    for (const s of active) {
      const name = productMap[s.product_id] || "Product";
      buttons.push([
        { text: `♻️ Re-edit: ${name}`, callback_data: `adm_fs_reedit_${s.id}` },
        { text: `❌ End`, callback_data: `adm_fs_end_${s.id}` },
      ]);
    }
    buttons.push([{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]);
    await editOrSend(chatId, msgId, txt, { inline_keyboard: buttons });
    return;
  }

  if (data === "adm_fs_new" && isAdmin(chatId)) {
    const { data: prods } = await supabase.from("bot_products").select("id, name, custom_emoji_id, price").eq("is_active", true).order("sort_order");
    if (!prods || prods.length === 0) { await editOrSend(chatId, msgId, "❌ No active products.", { inline_keyboard: [[{ text: "◀️ Back", callback_data: "adm_flashsales" }]] }); return; }
    const buttons = prods.map((p) => [productSelectButton(p, `🔥 ${p.name} ($${Number(p.price).toFixed(2)})`, `adm_fs_pick_${p.id}`)]);
    buttons.push([{ text: "◀️ Back", callback_data: "adm_flashsales" }]);
    await editOrSend(chatId, msgId, "🔥 <b>Create Flash Sale</b>\n\nSelect the product:", { inline_keyboard: buttons });
    return;
  }

  if (data.startsWith("adm_fs_pick_") && isAdmin(chatId)) {
    const productId = data.replace("adm_fs_pick_", "");
    await supabase.from("bot_customers").update({ pending_action: `fs_price_${productId}` }).eq("chat_id", chatId);
    await editOrSend(chatId, msgId, `🔥 <b>Flash Sale — Sale Price</b>\n\nReply with the <b>sale price</b> in USDT (e.g. <code>1.99</code>).\n\n❌ /cancel to abort.`);
    return;
  }

  if (data.startsWith("adm_fs_reedit_") && isAdmin(chatId)) {
    const saleId = data.replace("adm_fs_reedit_", "");
    const { data: sale } = await supabase.from("bot_flash_sales").select("*").eq("id", saleId).maybeSingle();
    if (!sale) { await editOrSend(chatId, msgId, "❌ Sale not found.", { inline_keyboard: [[{ text: "◀️ Back", callback_data: "adm_flashsales" }]] }); return; }
    const { data: product } = await supabase.from("bot_products").select("*").eq("id", sale.product_id).maybeSingle();
    const text = await buildFlashSaleMessage(sale, product || { name: "Product", custom_emoji_id: null, id: sale.product_id }, false);
    const keyboard = await buildFlashSaleKeyboard(product || { id: sale.product_id });
    const msgs = Array.isArray(sale.announcement_messages) ? sale.announcement_messages : [];
    let ok = 0, fail = 0;
    for (const m of msgs) {
      const res = await editMessageText(m.chat_id, m.message_id, text, keyboard).catch((e) => ({ ok: false, description: e?.message }));
      if (res?.ok || res?.skipped) ok++; else fail++;
    }
    await editOrSend(chatId, msgId, `♻️ <b>Re-edit complete</b>\n\n✅ Updated: ${ok}\n❌ Failed: ${fail}\n📤 Total: ${msgs.length}\n\n<i>Current template re-applied with premium emoji formatting.</i>`, { inline_keyboard: [[{ text: "◀️ Back", callback_data: "adm_flashsales" }]] });
    return;
  }

  if (data.startsWith("adm_fs_end_") && isAdmin(chatId)) {
    const saleId = data.replace("adm_fs_end_", "");
    const { data: sale } = await supabase.from("bot_flash_sales").select("*").eq("id", saleId).maybeSingle();
    if (sale) {
      const { data: product } = await supabase.from("bot_products").select("*").eq("id", sale.product_id).maybeSingle();
      const text = await buildFlashSaleMessage(sale, product || { name: "Product", custom_emoji_id: null, id: sale.product_id }, true);
      const msgs = Array.isArray(sale.announcement_messages) ? sale.announcement_messages : [];
      for (const m of msgs) { try { await editMessageText(m.chat_id, m.message_id, text, null); } catch (e) {} }
      try { await unpinFlashSaleMessages(msgs); } catch (_) {}
      await supabase.from("bot_flash_sales").update({ is_active: false, ends_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", saleId);
    }
    await editOrSend(chatId, msgId, "✅ Flash sale ended.", { inline_keyboard: [[{ text: "◀️ Back", callback_data: "adm_flashsales" }]] });
    return;
  }

  // ── Sales Feed menu (hub: Bot + Web) ──
  if (data === "adm_salesfeed" && isAdmin(chatId)) {
    const { data: settings } = await supabase.from("bot_settings").select("key, value").in("key", ["recent_sales_group_id", "recent_sales_group_id_web"]);
    const map = Object.fromEntries((settings || []).map((s) => [s.key, s.value]));
    const botId = map.recent_sales_group_id || "";
    const webId = map.recent_sales_group_id_web || "";
    const { data: groups } = await supabase.from("bot_broadcast_groups").select("chat_id, title").eq("is_active", true);
    const titleFor = (id) => (groups || []).find((g) => String(g.chat_id) === String(id))?.title || id;
    let txt = `📰 <b>Recent Sales Feed</b>\n\nAnonymous "Someone just bought ..." messages broadcast to the chosen groups. Bot orders and Web orders are tracked separately.\n\n`;
    txt += `🤖 <b>Bot orders → </b>${botId ? `<b>${escapeHtml(titleFor(botId))}</b>` : "<i>Disabled</i>"}\n`;
    txt += `🌐 <b>Web orders → </b>${webId ? `<b>${escapeHtml(titleFor(webId))}</b>` : "<i>Disabled</i>"}\n\n`;
    txt += `Use <b>Edit Messages</b> in the admin menu to customize the templates (premium emojis supported).`;
    const buttons = [
      [{ text: "🤖 Configure Bot Feed", callback_data: "adm_sf_pick_bot" }],
      [{ text: "🌐 Configure Web Feed", callback_data: "adm_sf_pick_web" }],
      [{ text: "◀️ Admin Menu", callback_data: "adm_menu" }],
    ];
    await editOrSend(chatId, msgId, txt, { inline_keyboard: buttons });
    return;
  }

  if ((data === "adm_sf_pick_bot" || data === "adm_sf_pick_web") && isAdmin(chatId)) {
    const source = data === "adm_sf_pick_web" ? "web" : "bot";
    const settingKey = source === "web" ? "recent_sales_group_id_web" : "recent_sales_group_id";
    const { data: setting } = await supabase.from("bot_settings").select("value").eq("key", settingKey).maybeSingle();
    const currentId = setting?.value || "";
    const { data: groups } = await supabase.from("bot_broadcast_groups").select("chat_id, title").eq("is_active", true);
    const label = source === "web" ? "🌐 Web Orders Feed" : "🤖 Bot Orders Feed";
    let txt = `📰 <b>${label}</b>\n\nPick which group receives the anonymous purchase notifications for ${source} orders.\n\n`;
    if (currentId) {
      const cur = (groups || []).find((g) => String(g.chat_id) === String(currentId));
      txt += `Current group: <b>${escapeHtml(cur?.title || currentId)}</b>\n\n`;
    } else {
      txt += `<i>No group selected yet.</i>\n\n`;
    }
    const buttons = [];
    if (groups && groups.length > 0) {
      for (const g of groups) {
        const isCur = String(g.chat_id) === String(currentId);
        buttons.push([{ text: `${isCur ? "✅ " : ""}${g.title || g.chat_id}`, callback_data: `adm_sf_set_${source}_${g.chat_id}` }]);
      }
    } else {
      txt += `⚠️ Add the bot to a group first (Groups menu).\n`;
    }
    if (currentId) buttons.push([{ text: "🚫 Disable", callback_data: `adm_sf_clear_${source}` }]);
    buttons.push([{ text: "◀️ Back", callback_data: "adm_salesfeed" }]);
    await editOrSend(chatId, msgId, txt, { inline_keyboard: buttons });
    return;
  }

  if (data.startsWith("adm_sf_set_") && isAdmin(chatId)) {
    const rest = data.replace("adm_sf_set_", "");
    const source = rest.startsWith("web_") ? "web" : rest.startsWith("bot_") ? "bot" : "bot";
    const gid = rest.replace(/^(web_|bot_)/, "");
    const settingKey = source === "web" ? "recent_sales_group_id_web" : "recent_sales_group_id";
    const { data: existing } = await supabase.from("bot_settings").select("id").eq("key", settingKey).maybeSingle();
    if (existing) {
      await supabase.from("bot_settings").update({ value: gid, updated_at: new Date().toISOString() }).eq("key", settingKey);
    } else {
      await supabase.from("bot_settings").insert({ key: settingKey, value: gid });
    }
    await editOrSend(chatId, msgId, `✅ ${source === "web" ? "Web" : "Bot"} sales feed group updated.`, { inline_keyboard: [[{ text: "◀️ Back", callback_data: `adm_sf_pick_${source}` }]] });
    return;
  }

  if ((data === "adm_sf_clear_bot" || data === "adm_sf_clear_web") && isAdmin(chatId)) {
    const source = data === "adm_sf_clear_web" ? "web" : "bot";
    const settingKey = source === "web" ? "recent_sales_group_id_web" : "recent_sales_group_id";
    await supabase.from("bot_settings").update({ value: "", updated_at: new Date().toISOString() }).eq("key", settingKey);
    await editOrSend(chatId, msgId, `🚫 ${source === "web" ? "Web" : "Bot"} sales feed disabled.`, { inline_keyboard: [[{ text: "◀️ Back", callback_data: `adm_sf_pick_${source}` }]] });
    return;
  }

  if (data === "adm_emojis" && isAdmin(chatId)) {
    const adminOnlyKeys = ["admin_panel", "approve_wd_notify", "approve_withdrawal", "reject_deposit", "reject_wd_notify", "reject_withdrawal", "verify_deposit", "back_to_emoji_list", "remove_emoji", "send_emoji"];
    const { data: allEmojis } = await supabase.from("bot_button_emojis").select("*").order("button_key");
    const customerEmojis = (allEmojis || []).filter((e) => !adminOnlyKeys.includes(e.button_key));
    if (customerEmojis.length === 0) { await editOrSend(chatId, msgId, "❌ No customer-facing button emojis found.", { inline_keyboard: [[{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]] }); return; }
    const buttons = [];
    for (const e of customerEmojis) {
      const emojiStatus = e.custom_emoji_id ? "✅" : "⬜";
      const styleLabel = e.style ? { primary: "🔵", success: "🟢", danger: "🔴" }[e.style] || "⚪" : "⚪";
      buttons.push([{ text: `${emojiStatus}${styleLabel} ${e.button_label}`, callback_data: `emoji_sel_${e.button_key}` }]);
    }
    buttons.push([{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]);
    await editOrSend(chatId, msgId, `✨ <b>Button Emoji Manager</b>\n\nCustomer-facing buttons:`, { inline_keyboard: buttons });
    return;
  }

  if (data === "adm_pemojis" && isAdmin(chatId)) {
    const { data: methods } = await supabase.from("bot_payment_methods").select("*").eq("is_active", true).order("sort_order");
    if (!methods || methods.length === 0) { await editOrSend(chatId, msgId, "❌ No active payment methods.", { inline_keyboard: [[{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]] }); return; }
    const buttons = [];
    for (const m of methods) { const status = m.custom_emoji_id ? "✅" : "⬜"; buttons.push([{ text: `${status} ${m.emoji} ${m.name}`, callback_data: `pm_esel_${m.id.slice(0, 8)}` }]); }
    buttons.push([{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]);
    await editOrSend(chatId, msgId, `💳 <b>Payment Method Emoji Manager</b>\n\nSet premium emojis for deposit buttons:`, { inline_keyboard: buttons });
    return;
  }

  // ── Product management callbacks ──

  if (data.startsWith("pedit_") && isAdmin(chatId)) {
    const prodShort = data.replace("pedit_", "");
    const { data: prods } = await supabase.from("bot_products").select("*");
    const prod = prods?.find(p => p.id.startsWith(prodShort));
    if (!prod) { await editOrSend(chatId, msgId, "❌ Product not found."); return; }
    const type = prod.is_manual_delivery ? "✋ Manual" : "📦 Internal Stock";
    const status = prod.is_active ? "✅ Active" : "❌ Inactive";
    const descPlain = stripHtmlTags(prod.description || "");
    const descPreview = descPlain ? `\n📝 Desc: ${descPlain.substring(0, 50)}${descPlain.length > 50 ? "..." : ""}` : "\n📝 Desc: —";
    const instrPlain = stripHtmlTags(prod.delivery_instruction || "");
    const instrPreview = instrPlain ? `\n📋 Instruction: ${instrPlain.substring(0, 50)}${instrPlain.length > 50 ? "..." : ""}` : "\n📋 Instruction: —";
    const botUser = await getBotUsername();
    const shareLink = `https://t.me/${botUser}?start=p_${prod.short_code || prod.id.slice(0,4).toUpperCase()}`;
    const emojiStatus = prod.custom_emoji_id ? `✅ Set` : `❌ Not set`;
    const buttons = [
      [{ text: "✏️ Name", callback_data: `peditname_${prodShort}` }, { text: "💵 Price", callback_data: `peditprice_${prodShort}` }],
      [{ text: "📝 Description", callback_data: `peditdesc_${prodShort}` }, { text: "📋 Instruction", callback_data: `peditinstr_${prodShort}` }],
      [{ text: "📷 Media", callback_data: `pmedia_${prodShort}` }, { text: "💰 Pricing Tiers", callback_data: `ptiers_${prodShort}` }],
      [{ text: `✨ Emoji (${emojiStatus})`, callback_data: `pemoji_${prodShort}` }, { text: "🔗 Share Link", callback_data: `pshare_${prodShort}` }],
      [{ text: prod.is_active ? "🔴 Deactivate" : "🟢 Activate", callback_data: `ptoggle_${prodShort}` }],
      [{ text: "🗑️ Delete", callback_data: `pconfirm_del_${prodShort}` }],
      [{ text: "◀️ Products", callback_data: "adm_products" }],
    ];
    let mediaItems = [];
    try { mediaItems = typeof prod.delivery_media === 'string' ? JSON.parse(prod.delivery_media) : prod.delivery_media || []; } catch {}
    const mediaCount = mediaItems.length;
    const emojiInfo = prod.custom_emoji_id ? `\n✨ Emoji: <code>${prod.custom_emoji_id}</code>` : "\n✨ Emoji: —";
    await editOrSend(chatId, msgId, `📦 <b>${prod.name}</b>\n\n📊 Type: ${type}\n💵 Price: $${Number(prod.price).toFixed(2)}\n📊 Status: ${status}${descPreview}${instrPreview}\n📷 Media: ${mediaCount} item(s)${emojiInfo}`, { inline_keyboard: buttons });
    return;
  }

  if (data.startsWith("peditname_") && isAdmin(chatId)) {
    const prodShort = data.replace("peditname_", "");
    await supabase.from("bot_customers").update({ pending_action: `admin_editprod_name_${prodShort}` }).eq("id", customer.id);
    await editOrSend(chatId, msgId, "✏️ Enter the new product name:\n\n❌ /cancel to cancel");
    return;
  }

  if (data.startsWith("peditprice_") && isAdmin(chatId)) {
    const prodShort = data.replace("peditprice_", "");
    await supabase.from("bot_customers").update({ pending_action: `admin_editprod_price_${prodShort}` }).eq("id", customer.id);
    await editOrSend(chatId, msgId, "💵 Enter the new price (USDT):\n\n❌ /cancel to cancel");
    return;
  }

  if (data.startsWith("peditdesc_") && isAdmin(chatId)) {
    const prodShort = data.replace("peditdesc_", "");
    const { data: prods } = await supabase.from("bot_products").select("id, name, description");
    const prod = prods?.find(p => p.id.startsWith(prodShort));
    if (!prod) { await editOrSend(chatId, msgId, "❌ Not found."); return; }
    let msg = `📝 <b>Edit Description — ${prod.name}</b>\n\n`;
    if (prod.description) msg += `Current:\n${stripHtmlTags(prod.description).substring(0, 100)}${stripHtmlTags(prod.description).length > 100 ? "..." : ""}\n\n`;
    msg += `Send the new description (HTML supported: &lt;b&gt;, &lt;i&gt;, &lt;u&gt;, &lt;s&gt;, &lt;code&gt;).\n\nSend <b>-</b> to clear.\n❌ /cancel to cancel`;
    await supabase.from("bot_customers").update({ pending_action: `admin_editprod_desc_${prodShort}` }).eq("id", customer.id);
    await editOrSend(chatId, msgId, msg);
    return;
  }

  if (data.startsWith("peditinstr_") && isAdmin(chatId)) {
    const prodShort = data.replace("peditinstr_", "");
    const { data: prods } = await supabase.from("bot_products").select("id, name, delivery_instruction");
    const prod = prods?.find(p => p.id.startsWith(prodShort));
    if (!prod) { await editOrSend(chatId, msgId, "❌ Not found."); return; }
    let msg = `📋 <b>Edit Delivery Instruction — ${prod.name}</b>\n\n`;
    if (prod.delivery_instruction) msg += `Current:\n${stripHtmlTags(prod.delivery_instruction).substring(0, 100)}${stripHtmlTags(prod.delivery_instruction).length > 100 ? "..." : ""}\n\n`;
    msg += `Send the new instruction (HTML supported).\nThis is shown to customers after purchase.\n\nSend <b>-</b> to clear.\n❌ /cancel to cancel`;
    await supabase.from("bot_customers").update({ pending_action: `admin_editprod_instr_${prodShort}` }).eq("id", customer.id);
    await editOrSend(chatId, msgId, msg);
    return;
  }

  if (data.startsWith("ptiers_") && isAdmin(chatId)) {
    const prodShort = data.replace("ptiers_", "");
    const { data: prods } = await supabase.from("bot_products").select("id, name, price");
    const prod = prods?.find(p => p.id.startsWith(prodShort));
    if (!prod) { await editOrSend(chatId, msgId, "❌ Not found."); return; }
    const { data: tiers } = await supabase.from("bot_product_pricing").select("*").eq("product_id", prod.id).order("min_quantity");
    let msg = `💰 <b>Pricing Tiers — ${prod.name}</b>\n\n`;
    msg += `Base price: <b>$${Number(prod.price).toFixed(2)}</b>\n\n`;
    const buttons = [];
    if (tiers && tiers.length > 0) {
      for (const t of tiers) {
        const range = t.max_quantity ? `${t.min_quantity}-${t.max_quantity}` : `${t.min_quantity}+`;
        msg += `• ${range} → <b>$${Number(t.price).toFixed(2)}</b> each\n`;
        buttons.push([{ text: `🗑️ Remove: ${range} → $${Number(t.price).toFixed(2)}`, callback_data: `ptier_del_${t.id.slice(0, 8)}` }]);
      }
    } else {
      msg += `<i>No tiers set. Base price applies to all quantities.</i>\n`;
    }
    buttons.push([{ text: "➕ Add Tier", callback_data: `ptier_add_${prodShort}` }]);
    buttons.push([{ text: "◀️ Back to Product", callback_data: `pedit_${prodShort}` }]);
    await editOrSend(chatId, msgId, msg, { inline_keyboard: buttons });
    return;
  }

  if (data.startsWith("ptier_add_") && isAdmin(chatId)) {
    const prodShort = data.replace("ptier_add_", "");
    await supabase.from("bot_customers").update({ pending_action: `admin_tier_min_${prodShort}` }).eq("id", customer.id);
    await editOrSend(chatId, msgId, "➕ <b>Add Pricing Tier</b>\n\nEnter the <b>minimum quantity</b> for this tier (e.g. 5):\n\n❌ /cancel to cancel");
    return;
  }

  if (data.startsWith("ptier_del_") && isAdmin(chatId)) {
    const tierShort = data.replace("ptier_del_", "");
    const { data: allTiers } = await supabase.from("bot_product_pricing").select("id, product_id");
    const tier = allTiers?.find(t => t.id.startsWith(tierShort));
    if (!tier) { await editOrSend(chatId, msgId, "❌ Tier not found."); return; }
    await supabase.from("bot_product_pricing").delete().eq("id", tier.id);
    const { data: prod } = await supabase.from("bot_products").select("id").eq("id", tier.product_id).single();
    const prodShort = prod ? prod.id.slice(0, 8) : "";
    await editOrSend(chatId, msgId, `✅ Pricing tier removed.`, { inline_keyboard: [[{ text: "◀️ Pricing Tiers", callback_data: `ptiers_${prodShort}` }]] });
    return;
  }

  if (data.startsWith("pshare_") && isAdmin(chatId)) {
    const prodShort = data.replace("pshare_", "");
    const { data: prods } = await supabase.from("bot_products").select("id, name, short_code");
    const prod = prods?.find(p => p.id.startsWith(prodShort));
    if (!prod) { await editOrSend(chatId, msgId, "❌ Product not found."); return; }
    const botUser = await getBotUsername();
    const shareLink = `https://t.me/${botUser}?start=p_${prod.short_code || prod.id.slice(0,4).toUpperCase()}`;
    await editOrSend(chatId, msgId, `🔗 <b>Share Link for ${prod.name}</b>\n\n<code>${shareLink}</code>\n\nUsers clicking this link will directly see this product's details.`, {
      inline_keyboard: [[{ text: "◀️ Back", callback_data: `pedit_${prodShort}` }]]
    });
    return;
  }

  if (data.startsWith("ptoggle_") && isAdmin(chatId)) {
    const prodShort = data.replace("ptoggle_", "");
    const { data: prods } = await supabase.from("bot_products").select("id, name, is_active");
    const prod = prods?.find(p => p.id.startsWith(prodShort));
    if (!prod) { await editOrSend(chatId, msgId, "❌ Not found."); return; }
    await supabase.from("bot_products").update({ is_active: !prod.is_active }).eq("id", prod.id);
    await editOrSend(chatId, msgId, `${prod.is_active ? "🔴" : "🟢"} <b>${prod.name}</b> ${prod.is_active ? "deactivated" : "activated"}.`, { inline_keyboard: [[{ text: "◀️ Products", callback_data: "adm_products" }]] });
    return;
  }

  // Sort order up/down
  if (data.startsWith("psortup_") && isAdmin(chatId)) {
    const prodShort = data.replace("psortup_", "");
    const { data: allProds } = await supabase.from("bot_products").select("id, sort_order").order("sort_order");
    const idx = allProds?.findIndex(p => p.id.startsWith(prodShort));
    if (idx == null || idx <= 0) { await editOrSend(chatId, msgId, "❌ Already at top."); return; }
    const current = allProds[idx], above = allProds[idx - 1];
    await Promise.all([
      supabase.from("bot_products").update({ sort_order: above.sort_order }).eq("id", current.id),
      supabase.from("bot_products").update({ sort_order: current.sort_order }).eq("id", above.id),
    ]);
    await editOrSend(chatId, msgId, `⬆️ Moved up.`, { inline_keyboard: [[{ text: "◀️ Products", callback_data: "adm_products" }]] });
    return;
  }

  if (data.startsWith("psortdown_") && isAdmin(chatId)) {
    const prodShort = data.replace("psortdown_", "");
    const { data: allProds } = await supabase.from("bot_products").select("id, sort_order").order("sort_order");
    const idx = allProds?.findIndex(p => p.id.startsWith(prodShort));
    if (idx == null || idx >= allProds.length - 1) { await editOrSend(chatId, msgId, "❌ Already at bottom."); return; }
    const current = allProds[idx], below = allProds[idx + 1];
    await Promise.all([
      supabase.from("bot_products").update({ sort_order: below.sort_order }).eq("id", current.id),
      supabase.from("bot_products").update({ sort_order: current.sort_order }).eq("id", below.id),
    ]);
    await editOrSend(chatId, msgId, `⬇️ Moved down.`, { inline_keyboard: [[{ text: "◀️ Products", callback_data: "adm_products" }]] });
    return;
  }

  // Media management
  if (data.startsWith("pmedia_") && !data.startsWith("pmedia_add_") && !data.startsWith("pmedia_del_") && isAdmin(chatId)) {
    const prodShort = data.replace("pmedia_", "");
    const { data: prods } = await supabase.from("bot_products").select("id, name, delivery_media");
    const prod = prods?.find(p => p.id.startsWith(prodShort));
    if (!prod) { await editOrSend(chatId, msgId, "❌ Not found."); return; }
    let mediaItems = [];
    try { mediaItems = typeof prod.delivery_media === 'string' ? JSON.parse(prod.delivery_media) : prod.delivery_media || []; } catch {}
    let msg = `📷 <b>Delivery Media — ${prod.name}</b>\n\n`;
    const buttons = [];
    if (mediaItems.length > 0) {
      for (let i = 0; i < mediaItems.length; i++) {
        const m = mediaItems[i];
        msg += `${i + 1}. ${m.type === 'video' ? '🎥' : '🖼️'} ${m.type}\n`;
        buttons.push([{ text: `🗑️ Remove #${i + 1} (${m.type})`, callback_data: `pmedia_del_${prodShort}_${i}` }]);
      }
    } else {
      msg += `<i>No media attached.</i>\n`;
    }
    msg += `\n<i>Send a photo or video while in upload mode to add media.</i>`;
    buttons.push([{ text: "📷 Upload Photo/Video", callback_data: `pmedia_add_${prodShort}` }]);
    buttons.push([{ text: "◀️ Back to Product", callback_data: `pedit_${prodShort}` }]);
    await editOrSend(chatId, msgId, msg, { inline_keyboard: buttons });
    return;
  }

  if (data.startsWith("pmedia_add_") && isAdmin(chatId)) {
    const prodShort = data.replace("pmedia_add_", "");
    await supabase.from("bot_customers").update({ pending_action: `admin_media_upload_${prodShort}` }).eq("id", customer.id);
    await editOrSend(chatId, msgId, `📷 <b>Upload Media</b>\n\nSend a <b>photo</b> or <b>video</b> now.\nIt will be attached to the product's delivery instructions.\n\n❌ /cancel to cancel`);
    return;
  }

  if (data.startsWith("pmedia_del_") && isAdmin(chatId)) {
    const rest = data.replace("pmedia_del_", "");
    const lastUnderscore = rest.lastIndexOf("_");
    const prodShort = rest.substring(0, lastUnderscore);
    const mediaIdx = parseInt(rest.substring(lastUnderscore + 1));
    const { data: prods } = await supabase.from("bot_products").select("id, name, delivery_media");
    const prod = prods?.find(p => p.id.startsWith(prodShort));
    if (!prod) { await editOrSend(chatId, msgId, "❌ Not found."); return; }
    let mediaItems = [];
    try { mediaItems = typeof prod.delivery_media === 'string' ? JSON.parse(prod.delivery_media) : prod.delivery_media || []; } catch {}
    if (mediaIdx >= 0 && mediaIdx < mediaItems.length) {
      mediaItems.splice(mediaIdx, 1);
      await supabase.from("bot_products").update({ delivery_media: mediaItems }).eq("id", prod.id);
      await editOrSend(chatId, msgId, `✅ Media #${mediaIdx + 1} removed.`, { inline_keyboard: [[{ text: "◀️ Media", callback_data: `pmedia_${prodShort}` }]] });
    } else {
      await editOrSend(chatId, msgId, "❌ Invalid media index.");
    }
    return;
  }

  if (data.startsWith("premove_") && isAdmin(chatId)) {
    const prodShort = data.replace("premove_", "");
    const { data: prods } = await supabase.from("bot_products").select("id, name");
    const prod = prods?.find(p => p.id.startsWith(prodShort));
    if (!prod) { await editOrSend(chatId, msgId, "❌ Not found."); return; }
    await editOrSend(chatId, msgId, `⚠️ Delete <b>${prod.name}</b>?\n\nThis cannot be undone!`, {
      inline_keyboard: [[{ text: "✅ Yes, Delete", callback_data: `pconfirm_del_${prodShort}` }, { text: "❌ Cancel", callback_data: "adm_products" }]]
    });
    return;
  }

  if (data.startsWith("pconfirm_del_") && isAdmin(chatId)) {
    const prodShort = data.replace("pconfirm_del_", "");
    const { data: prods } = await supabase.from("bot_products").select("id, name");
    const prod = prods?.find(p => p.id.startsWith(prodShort));
    if (!prod) { await editOrSend(chatId, msgId, "❌ Not found."); return; }
    await supabase.from("bot_product_pricing").delete().eq("product_id", prod.id);
    await supabase.from("bot_products").delete().eq("id", prod.id);
    await editOrSend(chatId, msgId, `🗑️ <b>${prod.name}</b> deleted.`, { inline_keyboard: [[{ text: "◀️ Products", callback_data: "adm_products" }]] });
    return;
}

  // Product emoji management
  if (data.startsWith("pemoji_") && isAdmin(chatId)) {
    const prodShort = data.replace("pemoji_", "");
    const { data: prods } = await supabase.from("bot_products").select("id, name, custom_emoji_id");
    const prod = prods?.find(p => p.id.startsWith(prodShort));
    if (!prod) { await editOrSend(chatId, msgId, "❌ Not found."); return; }
    const current = prod.custom_emoji_id ? `\n\nCurrent emoji ID: <code>${prod.custom_emoji_id}</code>` : "";
    const buttons = [];
    if (prod.custom_emoji_id) {
      buttons.push([{ text: "🗑️ Remove Emoji", callback_data: `premoji_${prodShort}` }]);
    }
    buttons.push([{ text: "◀️ Back to Product", callback_data: `pedit_${prodShort}` }]);
    await supabase.from("bot_customers").update({ pending_action: `set_prod_emoji_${prodShort}` }).eq("id", customer.id);
    await editOrSend(chatId, msgId, `✨ <b>Set Product Emoji — ${prod.name}</b>${current}\n\nSend a <b>premium/custom emoji</b> to set it as the button icon.\nThis emoji will appear on the product button in the shop.\n\n💡 To get an emoji ID, send it to @RawDataBot\n\n❌ /cancel to cancel`, { inline_keyboard: buttons });
    return;
  }

  // Remove product emoji
  if (data.startsWith("premoji_") && isAdmin(chatId)) {
    const prodShort = data.replace("premoji_", "");
    const { data: prods } = await supabase.from("bot_products").select("id, name");
    const prod = prods?.find(p => p.id.startsWith(prodShort));
    if (!prod) { await editOrSend(chatId, msgId, "❌ Not found."); return; }
    await supabase.from("bot_products").update({ custom_emoji_id: null }).eq("id", prod.id);
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
    await editOrSend(chatId, msgId, `✅ Emoji removed for <b>${prod.name}</b>.`, { inline_keyboard: [[{ text: "◀️ Back to Product", callback_data: `pedit_${prodShort}` }]] });
    return;
  }


  if (data === "padd_stock" && isAdmin(chatId)) {
    await supabase.from("bot_customers").update({ pending_action: "admin_addstock_name" }).eq("id", customer.id);
    await editOrSend(chatId, msgId, "📦 <b>Add Stock Product</b>\n\nEnter the product name:\n\n❌ /cancel to cancel");
    return;
  }

  if (data === "padd_manual" && isAdmin(chatId)) {
    await supabase.from("bot_customers").update({ pending_action: "admin_addmanual_name" }).eq("id", customer.id);
    await editOrSend(chatId, msgId, "✋ <b>Add Manual Product</b>\n\nEnter the product name:\n\n❌ /cancel to cancel");
    return;
  }

  if (data.startsWith("emoji_sel_") && isAdmin(chatId)) {
    const buttonKey = data.replace("emoji_sel_", "");
    const { data: emojiRow } = await supabase.from("bot_button_emojis").select("*").eq("button_key", buttonKey).single();
    if (!emojiRow) { await editOrSend(chatId, msgId, "❌ Button not found."); return; }
    const currentEmoji = emojiRow.custom_emoji_id ? `✅ Emoji: <code>${emojiRow.custom_emoji_id}</code>` : `⬜ No premium emoji`;
    const styleMap = { primary: "🔵 Primary (Blue)", success: "🟢 Success (Green)", danger: "🔴 Danger (Red)" };
    const currentStyle = emojiRow.style ? styleMap[emojiRow.style] || emojiRow.style : "⚪ Default (Transparent)";
    const buttons = [
      [applyEmoji({ text: "✏️ Set Emoji", callback_data: `emoji_wait_${buttonKey}` }, "send_emoji", emojiMap)],
      [{ text: "🎨 Change Color", callback_data: `escolor_${buttonKey}` }],
    ];
    if (emojiRow.custom_emoji_id) buttons.push([applyEmoji({ text: "🗑️ Remove Emoji", callback_data: `emoji_clr_${buttonKey}` }, "remove_emoji", emojiMap)]);
    buttons.push([applyEmoji({ text: "◀️ Back to List", callback_data: "emoji_list" }, "back_to_emoji_list", emojiMap)]);
    await editOrSend(chatId, msgId, `✨ <b>${emojiRow.button_label}</b>\n🔑 Key: <code>${buttonKey}</code>\n\n${currentEmoji}\n🎨 Color: ${currentStyle}\n\nChoose an action:`, { inline_keyboard: buttons });
    return;
  }

  // Button style/color selection
  if (data.startsWith("escolor_") && isAdmin(chatId)) {
    const buttonKey = data.replace("escolor_", "");
    const { data: emojiRow } = await supabase.from("bot_button_emojis").select("button_label, style").eq("button_key", buttonKey).single();
    if (!emojiRow) { await editOrSend(chatId, msgId, "❌ Not found."); return; }
    const current = emojiRow.style || "default";
    const options = [
      { label: "⚪ Default (Transparent)", value: "default" },
      { label: "🟢 Success (Green)", value: "success" },
      { label: "🔵 Primary (Blue)", value: "primary" },
      { label: "🔴 Danger (Red)", value: "danger" },
    ];
    const buttons = options.map(o => {
      const check = current === o.value || (!emojiRow.style && o.value === "default") ? " ✓" : "";
      return [{ text: `${o.label}${check}`, callback_data: `esstyle_${buttonKey}_${o.value}` }];
    });
    buttons.push([{ text: "◀️ Back", callback_data: `emoji_sel_${buttonKey}` }]);
    await editOrSend(chatId, msgId, `🎨 <b>Set Color — ${emojiRow.button_label}</b>\n\nSelect a button color:`, { inline_keyboard: buttons });
    return;
  }

  // Apply button style
  if (data.startsWith("esstyle_") && isAdmin(chatId)) {
    const parts = data.replace("esstyle_", "").split("_");
    const styleValue = parts.pop();
    const buttonKey = parts.join("_");
    const newStyle = styleValue === "default" ? null : styleValue;
    await supabase.from("bot_button_emojis").update({ style: newStyle }).eq("button_key", buttonKey);
    _emojiCache = null;
    const styleNames = { primary: "🔵 Primary (Blue)", success: "🟢 Success (Green)", danger: "🔴 Danger (Red)" };
    const label = newStyle ? styleNames[newStyle] || newStyle : "⚪ Default (Transparent)";
    await editOrSend(chatId, msgId, `✅ Color updated to <b>${label}</b>!`, { inline_keyboard: [[{ text: "◀️ Back", callback_data: `emoji_sel_${buttonKey}` }]] });
    return;
  }

  if (data.startsWith("emoji_wait_") && isAdmin(chatId)) {
    const buttonKey = data.replace("emoji_wait_", "");
    await supabase.from("bot_customers").update({ pending_action: `set_emoji_${buttonKey}` }).eq("id", customer.id);
    await editOrSend(chatId, msgId, `✨ Now send me a <b>premium emoji</b> for the <b>${buttonKey}</b> button.\n\nJust tap and send any premium/custom emoji from your Telegram sticker packs.\n\n❌ /cancel to cancel`);
    return;
  }

  if (data.startsWith("emoji_clr_") && isAdmin(chatId)) {
    const buttonKey = data.replace("emoji_clr_", "");
    await supabase.from("bot_button_emojis").update({ custom_emoji_id: null }).eq("button_key", buttonKey);
    _emojiCache = null;
    await editOrSend(chatId, msgId, `🗑️ Premium emoji removed from <b>${buttonKey}</b>. Default emoji will be used.`, { inline_keyboard: [[{ text: "◀️ Emojis", callback_data: "adm_emojis" }]] });
    return;
  }

  if (data === "emoji_list" && isAdmin(chatId)) {
    const { data: allEmojis } = await supabase.from("bot_button_emojis").select("*").order("button_key");
    if (!allEmojis || allEmojis.length === 0) return;
    const buttons = [];
    for (const e of allEmojis) {
      const emojiStatus = e.custom_emoji_id ? "✅" : "⬜";
      const styleLabel = e.style ? { primary: "🔵", success: "🟢", danger: "🔴" }[e.style] || "⚪" : "⚪";
      buttons.push([{ text: `${emojiStatus}${styleLabel} ${e.button_label}`, callback_data: `emoji_sel_${e.button_key}` }]);
    }
    await editOrSend(chatId, msgId, `✨ <b>Button Emoji Manager</b>\n\nSelect a button to set/change its premium emoji:`, { inline_keyboard: buttons });
    return;
  }

  // Payment method emoji callbacks
  if (data.startsWith("pm_esel_") && isAdmin(chatId)) {
    const pmShortId = data.replace("pm_esel_", "");
    const { data: allMethods } = await supabase.from("bot_payment_methods").select("*").eq("is_active", true);
    const method = allMethods?.find((m) => m.id.startsWith(pmShortId));
    if (!method) { await editOrSend(chatId, msgId, "❌ Not found."); return; }
    const currentStatus = method.custom_emoji_id ? `\n✅ Current emoji ID: <code>${method.custom_emoji_id}</code>` : `\n⬜ No premium emoji set`;
    const buttons = [[{ text: "✏️ Send Premium Emoji", callback_data: `pm_ewait_${pmShortId}` }]];
    if (method.custom_emoji_id) buttons.push([{ text: "🗑️ Remove Premium Emoji", callback_data: `pm_eclr_${pmShortId}` }]);
    buttons.push([{ text: "◀️ Back to List", callback_data: "pm_elist" }]);
    await editOrSend(chatId, msgId, `💳 <b>${method.emoji} ${method.name}</b>${currentStatus}\n\nChoose an action:`, { inline_keyboard: buttons });
    return;
  }

  if (data.startsWith("pm_ewait_") && isAdmin(chatId)) {
    const pmShortId = data.replace("pm_ewait_", "");
    await supabase.from("bot_customers").update({ pending_action: `set_pm_emoji_${pmShortId}` }).eq("id", customer.id);
    await editOrSend(chatId, msgId, `✨ Now send me a <b>premium emoji</b> for this payment method.\n\n❌ /cancel to cancel`);
    return;
  }

  if (data.startsWith("pm_eclr_") && isAdmin(chatId)) {
    const pmShortId = data.replace("pm_eclr_", "");
    const { data: allMethods } = await supabase.from("bot_payment_methods").select("*").eq("is_active", true);
    const method = allMethods?.find((m) => m.id.startsWith(pmShortId));
    if (method) await supabase.from("bot_payment_methods").update({ custom_emoji_id: null }).eq("id", method.id);
    await editOrSend(chatId, msgId, `🗑️ Premium emoji removed.`, { inline_keyboard: [[{ text: "◀️ Payment Emojis", callback_data: "adm_pemojis" }]] });
    return;
  }

  if (data === "pm_elist" && isAdmin(chatId)) {
    const { data: methods } = await supabase.from("bot_payment_methods").select("*").eq("is_active", true).order("sort_order");
    if (!methods || methods.length === 0) return;
    const buttons = [];
    for (const m of methods) { const status = m.custom_emoji_id ? "✅" : "⬜"; buttons.push([{ text: `${status} ${m.emoji} ${m.name}`, callback_data: `pm_esel_${m.id.slice(0, 8)}` }]); }
    await editOrSend(chatId, msgId, `💳 <b>Payment Method Emoji Manager</b>\n\nSet premium emojis for deposit payment buttons:`, { inline_keyboard: buttons });
    return;
  }




  // Buy product
  if (data.startsWith("buy_")) {
    const productId = data.replace("buy_", "");
    const messageId = callbackQuery.message?.message_id;
    await handleBuyProduct(chatId, customer, productId, emojiMap, messageId);
    return;
  }

  if (data.startsWith("buynow_")) {
    const productId = data.replace("buynow_", "");
    const messageId = callbackQuery.message?.message_id;
    untrackFlashSaleProductMessage(chatId, messageId);
    await showQuantitySelection(chatId, productId, emojiMap, messageId);
    return;
  }

  if (data.startsWith("qty_")) {
    const parts = data.replace("qty_", "").split("_");
    const productId = parts[0];
    const qty = parseInt(parts[1] || "1");
    const messageId = callbackQuery.message?.message_id;
    untrackFlashSaleProductMessage(chatId, messageId);
    const { data: prod } = await supabase.from("bot_products").select("*").eq("id", productId).single();
    const fields = getProductInputFields(prod);
    if (prod && fields.length > 0) {
      // Reset any prior pending inputs for a fresh start
      await supabase.from("bot_customers").update({ pending_inputs: { productId, qty, values: {} } }).eq("id", customer.id);
      const fresh = { ...customer, pending_inputs: { productId, qty, values: {} } };
      await promptCustomerInput(chatId, fresh, prod, qty, 0, emojiMap, messageId);
      return;
    }
    await showBuyConfirmation(chatId, customer, productId, qty, emojiMap, messageId);
    return;
  }

  if (data.startsWith("cancelinput_")) {
    const productId = data.replace("cancelinput_", "");
    await supabase.from("bot_customers").update({ pending_action: null, pending_inputs: null }).eq("id", customer.id);
    const messageId = callbackQuery.message?.message_id;
    await handleBuyProduct(chatId, customer, productId, emojiMap, messageId);
    return;
  }

  // ── Pay Later callback ──
  if (data.startsWith("paylater_")) {
    const parts = data.replace("paylater_", "").split("_");
    const shortProductId = parts[0];
    const qty = parseInt(parts[1] || "1");
    const { data: prods } = await supabase.from("bot_products").select("id");
    const prod = prods?.find((item) => item.id.startsWith(shortProductId));
    if (!prod) { await sendMessage(chatId, "❌ Product not found.", mainMenuKeyboard()); return; }
    const summaryMsgId = callbackQuery.message?.message_id;
    if (summaryMsgId) {
      await editMessageText(chatId, summaryMsgId, "⏳ <b>Processing Pay Later order...</b>", { inline_keyboard: [] }).catch(() => {});
    }
    await executePayLaterPurchase(chatId, customer, prod.id, qty, emojiMap);
    if (summaryMsgId) {
      try { await tgFetch("deleteMessage", { chat_id: chatId, message_id: summaryMsgId }); } catch(e) {}
    }
    return;
  }

  if (data.startsWith("bp_")) {
    const parts = data.replace("bp_", "").split("_");
    const shortProductId = parts[0];
    const qty = parseInt(parts[1] || "1");
    const { data: prods } = await supabase.from("bot_products").select("id, name, price, currency, custom_emoji_id");
    const prod = prods?.find((item) => item.id.startsWith(shortProductId));
    if (!prod) { await sendMessage(chatId, "❌ Product not found.", mainMenuKeyboard()); return; }

    const { data: fresh } = await supabase.from("bot_customers").select("balance").eq("id", customer.id).single();
    const balance = fresh ? Number(fresh.balance) : 0;
    const unitPrice = await getTieredPrice(prod.id, qty, Number(prod.price), customer.id);
    const total = Math.round(unitPrice * qty * 10000) / 10000;
    if (balance < total) {
      await sendMessage(chatId, `❌ Insufficient balance. Need <b>$${total.toFixed(2)}</b>, you have <b>$${balance.toFixed(2)}</b>.`, mainMenuKeyboard());
      return;
    }
    const after = balance - total;
    const productEmoji = prod.custom_emoji_id ? `<tg-emoji emoji-id="${prod.custom_emoji_id}">📦</tg-emoji>` : "📦";
    const currency = prod.currency || "USDT";
    const defaultConfirmMsg = `💰 <b>Pay with Balance</b>\n\n` +
      `{product}\n` +
      `🔢 Quantity: <b>{quantity}</b>\n` +
      `🧾 Subtotal: <b>{subtotal} {currency}</b>\n` +
      `💵 Final: <b>{final} {currency}</b>\n\n` +
      `💰 Balance: <b>{balance}</b>\n` +
      `📊 After: <b>{after}</b>\n\n` +
      `⚡ <i>Once confirmed, your items will be delivered instantly.</i>\n\n` +
      `<b>Confirm balance deduction?</b>`;
    const msg = replacePlaceholders(getPageMsg("msg_pay_balance_confirm", defaultConfirmMsg), {
      product: `${productEmoji} <b>${escapeHtml(prod.name)}</b>`,
      quantity: String(qty),
      subtotal: `$${total.toFixed(2)}`,
      final: `$${total.toFixed(2)}`,
      balance: `$${balance.toFixed(2)}`,
      after: `$${after.toFixed(2)}`,
      currency,
      price: `$${unitPrice.toFixed(2)}`,
    });
    const confirmBtn = applyEmoji({ text: "✅ Confirm Payment", callback_data: `cbp_${shortProductId}_${qty}` }, "confirm_payment", emojiMap);
    confirmBtn.style = "success";
    const cancelBtn = applyEmoji({ text: "❌ Cancel Order", callback_data: "cancel_order" }, "cancel_order", emojiMap);
    cancelBtn.style = "danger";
    const buttons = [[confirmBtn], [cancelBtn]];
    const messageId = callbackQuery.message?.message_id;
    if (messageId) await editMessageText(chatId, messageId, msg, { inline_keyboard: buttons });
    else await sendMessage(chatId, msg, { inline_keyboard: buttons });
    return;
  }

  if (data.startsWith("cbp_")) {
    const parts = data.replace("cbp_", "").split("_");
    const shortProductId = parts[0];
    const qty = parseInt(parts[1] || "1");
    const { data: prods } = await supabase.from("bot_products").select("id");
    const prod = prods?.find((item) => item.id.startsWith(shortProductId));
    if (!prod) { await sendMessage(chatId, "❌ Product not found.", mainMenuKeyboard()); return; }
    const summaryMsgId = callbackQuery.message?.message_id;
    if (summaryMsgId) {
      await editMessageText(chatId, summaryMsgId, "⏳ <b>Processing your order...</b>", { inline_keyboard: [] }).catch(() => {});
    }
    await executePurchase(chatId, customer, prod.id, qty, emojiMap);
    if (summaryMsgId) {
      try { await tgFetch("deleteMessage", { chat_id: chatId, message_id: summaryMsgId }); } catch(e) {}
    }
    return;
  }

  if (data.startsWith("pm_") && !data.startsWith("pm_esel_") && !data.startsWith("pm_ewait_") && !data.startsWith("pm_eclr_") && data !== "pm_elist") {
    const parts = data.replace("pm_", "").split("_");
    const shortMethodId = parts[0];
    const shortProductId = parts[1];
    const qty = parseInt(parts[2] || "1");
    const [{ data: methods }, { data: prods }] = await Promise.all([
      supabase.from("bot_payment_methods").select("id, name, payment_type"),
      supabase.from("bot_products").select("id"),
    ]);
    const method = methods?.find((item) => item.id.startsWith(shortMethodId));
    const prod = prods?.find((item) => item.id.startsWith(shortProductId));
    if (!method || !prod) { await sendMessage(chatId, "❌ Error finding payment method.", mainMenuKeyboard()); return; }

    const methodName = String(method.name || "").toLowerCase();
    const paymentType = String(method.payment_type || "").toLowerCase();
    const isBkashMethod = methodName.includes("bkash") || methodName.includes("বিকাশ") || paymentType === "bkash";
    const pendingPrefix = isBkashMethod ? "bkashpay" : "directpay";

    await supabase.from("bot_deposits")
      .update({ status: "rejected" })
      .eq("customer_id", customer.id)
      .not("pending_product_id", "is", null)
      .in("status", ["pending", "bkash_pending"]);

    const messageId = callbackQuery.message?.message_id;
    const midSuffix = messageId ? `_mid_${messageId}` : "";
    await supabase.from("bot_customers").update({ pending_action: `${pendingPrefix}_${prod.id}_qty_${qty}_pm_${method.id}${midSuffix}` }).eq("id", customer.id);
    await showPaymentDetails(chatId, method.id, prod.id, qty, emojiMap, messageId);
    return;
  }

  if (data.startsWith("backpay_")) {
    const parts = data.replace("backpay_", "").split("_qty_");
    const shortProductId = parts[0];
    const qty = parseInt(parts[1] || "1");
    const { data: prods } = await supabase.from("bot_products").select("id");
    const prod = prods?.find((item) => item.id.startsWith(shortProductId));
    if (!prod) { await sendMessage(chatId, "❌ Product not found.", mainMenuKeyboard()); return; }
    const messageId = callbackQuery.message?.message_id;
    await showPaymentMethodSelection(chatId, customer, prod.id, qty, emojiMap, messageId);
    return;
  }

  if (data.startsWith("dpm_")) {
    const shortMethodId = data.replace("dpm_", "");
    const { data: methods } = await supabase.from("bot_payment_methods").select("id");
    const method = methods?.find((item) => item.id.startsWith(shortMethodId));
    if (!method) { await sendMessage(chatId, "❌ Payment method not found.", mainMenuKeyboard()); return; }
    const messageId = callbackQuery.message?.message_id;
    const midSuffix = messageId ? `_mid_${messageId}` : "";
    await supabase.from("bot_customers").update({ pending_action: `deposit_pm_${method.id}${midSuffix}` }).eq("id", customer.id);
    await showDepositPaymentDetails(chatId, method.id, emojiMap, messageId);
    return;
  }

  if (data === "dep_back") { const messageId = callbackQuery.message?.message_id; await showDepositInfo(chatId, emojiMap, messageId); return; }

  if (data.startsWith("confirm_buy_")) {
    // Dedupe: prevent double-tap / Telegram retry from creating two orders
    const dedupeKey = `${chatId}:${data}`;
    if (_recentConfirmBuy.has(dedupeKey)) {
      answerCallbackQuery(callbackQuery.id, "Processing your order…");
      return;
    }
    _recentConfirmBuy.add(dedupeKey);
    setTimeout(() => _recentConfirmBuy.delete(dedupeKey), 15000);

    const parts = data.replace("confirm_buy_", "").split("_qty_");
    const productId = parts[0];
    const qty = parseInt(parts[1] || "1");
    try {
      await executePurchase(chatId, customer, productId, qty, emojiMap);
    } finally {
      // Keep the key for a short cool-down even after completion to swallow late retries
    }
    return;
  }

  if (data.startsWith("directpay_")) {
    const parts = data.replace("directpay_", "").split("_qty_");
    const productId = parts[0];
    const qty = parseInt(parts[1] || "1");
    const messageId = callbackQuery.message?.message_id;
    await showPaymentMethodSelection(chatId, customer, productId, qty, emojiMap, messageId);
    return;
  }

  if (data === "refresh_shop") { const messageId = callbackQuery.message?.message_id; untrackFlashSaleProductMessage(chatId, messageId); clearStockCache(); await showShop(chatId, emojiMap, messageId, true); return; }

  // ── Inline main menu callbacks ──
  if (data === "menu_shop") { await showShop(chatId, emojiMap, msgId); return; }
  if (data === "menu_balance") { await showBalance(chatId, customer, emojiMap, msgId); return; }
  if (data === "menu_deposit") { await showDepositInfo(chatId, emojiMap, msgId); return; }
  if (data === "menu_orders") { await showOrders(chatId, customer, 0, emojiMap, msgId); return; }
  if (data === "menu_withdraw") { await handleWithdrawStart(chatId, customer, emojiMap, msgId); return; }
  if (data === "menu_profile") { await showProfile(chatId, customer, emojiMap, msgId); return; }
  if (data === "profile_stats") { await showMyStats(chatId, customer, emojiMap, msgId); return; }
  if (data === "profile_notifications") { await showNotifications(chatId, customer, emojiMap, msgId); return; }
  if (data === "api_dashboard") { await showDeveloperApi(chatId, customer, emojiMap, msgId); return; }
  if (data === "api_generate") { await generateCustomerApiKey(chatId, customer, emojiMap, msgId); return; }
  if (data === "api_docs") { await showApiDocs(chatId, customer, emojiMap, msgId); return; }
  if (data === "api_delete_confirm") {
    await editOrSend(chatId, msgId, `${premiumEmojiText("⚠️", "api_delete", emojiMap)} <b>Delete Developer API Key?</b>\n\nYour current API key will stop working immediately.`, {
      inline_keyboard: [
        [applyEmoji({ text: "✅ Yes, Delete", callback_data: "api_delete" }, "api_delete", emojiMap)],
        [applyEmoji({ text: "🛢️ Back", callback_data: "api_dashboard" }, "api_dashboard", emojiMap)],
      ],
    });
    return;
  }
  if (data === "api_delete") { await deleteCustomerApiKey(chatId, customer, emojiMap, msgId); return; }
  if (data.startsWith("notif_toggle_")) {
    const field = data.replace("notif_toggle_", "");
    const fieldMap = { stock: "stock_alerts", info: "info_alerts", referral: "referral_bonus" };
    const col = fieldMap[field];
    if (col) {
      const settings = await getNotifSettings(customer.id);
      await supabase.from("bot_notification_settings").update({ [col]: !settings[col], updated_at: new Date().toISOString() }).eq("customer_id", customer.id);
      await showNotifications(chatId, customer, emojiMap, msgId);
    }
    return;
  }
  if (data === "menu_support") {
    const supportMsg = getPageMsg("msg_support", `🆘 <b>Need Help?</b>\n\nContact our support team directly:`);
    await editOrSend(chatId, msgId, supportMsg, { inline_keyboard: [[applyEmoji({ text: "💬 Contact Support", url: "https://t.me/VenexOG" }, "contact_support", emojiMap)], [applyEmoji({ text: "◀️ Back", callback_data: "menu_main" }, "back", emojiMap)]] });
    return;
  }
  if (data === "menu_referral") {
    await showReferralMenu(chatId, customer, emojiMap, msgId);
    return;
  }
  if (data === "ref_copy") {
    const refCode = generateReferralCode(customer.chat_id);
    const botUser = await getBotUsername();
    const referralLink = `https://t.me/${botUser}?start=ref_${refCode}`;
    await tgFetch("answerCallbackQuery", { callback_query_id: callbackQuery.id, text: "Link copied! Share it with friends.", show_alert: false });
    await sendMessage(chatId, `📋 <b>Your Referral Link:</b>\n\n<code>${referralLink}</code>\n\n👆 Tap to copy and share with your friends!`, { inline_keyboard: [[applyEmoji({ text: "◀️ Back to Referral", callback_data: "menu_referral" }, "back", emojiMap)]] });
    return;
  }
  if (data === "ref_transfer") {
    const { data: fresh } = await supabase.from("bot_customers").select("referral_balance, referral_transferred, balance").eq("id", customer.id).single();
    const refBal = fresh ? Number(fresh.referral_balance) : 0;
    if (refBal <= 0) {
      await tgFetch("answerCallbackQuery", { callback_query_id: callbackQuery.id, text: "No referral balance to transfer!", show_alert: true });
      return;
    }
    const newMainBal = Number(fresh.balance) + refBal;
    const newTransferred = Number(fresh.referral_transferred) + refBal;
    await supabase.from("bot_customers").update({
      balance: newMainBal,
      referral_balance: 0,
      referral_transferred: newTransferred,
      updated_at: new Date().toISOString(),
    }).eq("id", customer.id);
    await editOrSend(chatId, msgId, `✅ <b>Transfer Successful!</b>\n\n💰 Transferred: <b>${refBal.toFixed(2)} USDT</b> to your main wallet.\n💳 New Balance: <b>${newMainBal.toFixed(2)} USDT</b>`, { inline_keyboard: [[applyEmoji({ text: "◀️ Back to Referral", callback_data: "menu_referral" }, "back", emojiMap)]] });
    return;
  }
  if (data === "menu_main") {
    const welcomeMsg = await getWelcomeMsg(customer.first_name || "there");
    await editOrSend(chatId, msgId, welcomeMsg, mainMenuKeyboard(emojiMap));
    return;
  }

  if (data.startsWith("customqty_")) {
    const productId = data.replace("customqty_", "");
    await supabase.from("bot_customers").update({ pending_action: `customqty_${productId}` }).eq("id", customer.id);
    await sendMessage(chatId, "✏️ Type the quantity you want to buy:", { force_reply: true, selective: true });
    return;
  }

  if (data.startsWith("dl_txt_") || data.startsWith("dl_csv_")) {
    const isCsv = data.startsWith("dl_csv_");
    const orderId = data.replace(isCsv ? "dl_csv_" : "dl_txt_", "");
    await deleteMessage(chatId, msgId);
    await handleDownloadOrder(chatId, orderId, isCsv);
    return;
  }

  if (data.startsWith("vord_")) {
    const shortId = data.replace("vord_", "");
    await handleViewOrder(chatId, customer, shortId, emojiMap, msgId);
    return;
  }

  if (data.startsWith("ordpg_")) {
    const page = parseInt(data.replace("ordpg_", ""), 10);
    await showOrders(chatId, customer, page, emojiMap, msgId);
    return;
  }

  if (data.startsWith("newstock_") && isAdmin(chatId)) {
    const productId = data.replace("newstock_", "");
    const { data: product } = await supabase.from("bot_products").select("name").eq("id", productId).single();
    if (!product) { await editOrSend(chatId, msgId, "❌ Product not found."); return; }
    await supabase.from("bot_customers").update({ pending_action: `newstock_count_${productId}` }).eq("id", customer.id);
    await editOrSend(chatId, msgId, `📦 <b>${product.name}</b> selected.\n\nEnter the number of new items added:\n\n❌ Type /cancel to cancel`);
    return;
  }

  // New Product Announcement - confirm broadcast
  if (data.startsWith("newprod_") && isAdmin(chatId)) {
    const productId = data.replace("newprod_", "");
    const { data: product } = await supabase.from("bot_products").select("*").eq("id", productId).single();
    if (!product) { await editOrSend(chatId, msgId, "❌ Product not found."); return; }
    const totalStock = product.is_manual_delivery ? "∞" : await getProductStock(product);
    
    // Use new_product emoji if configured
    const alertEmoji = emojiMap["new_product"];
    let alertIcon = "🆕";
    if (alertEmoji?.emoji) alertIcon = `<tg-emoji emoji-id="${alertEmoji.emoji}">🆕</tg-emoji>`;
    
    await fetchPageMsgs();
    const newProductTemplate = cachedPageMsgs["msg_new_product"] || `${alertIcon} <b>New Product Available!</b>\n\n📦 <b>{product}</b>\n💰 Price: <b>{price} USDT</b>\n📊 Stock: <b>{stock}</b>`;
    // Build product name with its own premium emoji if configured
    let productDisplay = product.name;
    if (product.custom_emoji_id) {
      productDisplay = `<tg-emoji emoji-id="${product.custom_emoji_id}">📦</tg-emoji> ${product.name}`;
    }
    const bulkPricingNew = await formatBulkPricingBlock(product.id);
    const broadcastMsg = replacePlaceholders(newProductTemplate, { 
      product: productDisplay, 
      stock: String(totalStock), 
      price: Number(product.price).toFixed(2),
      description: product.description || "",
      bulk_pricing: bulkPricingNew
    });
    
    const botUser = await getBotUsername();
    const code = product.short_code || product.id.slice(0, 4).toUpperCase();
    const buyBtn = buyNowButton({ text: `Buy ${product.name}`, url: `https://t.me/${botUser}?start=p_${code}` }, emojiMap);
    const broadcastKeyboard = { inline_keyboard: [[buyBtn]] };

    await sendMessage(chatId, `🆕 Broadcasting new product...`);
    const { total, sent, failed } = await broadcastToAll(broadcastMsg, broadcastKeyboard);
    await sendMessage(chatId, `✅ <b>New Product Broadcast Complete!</b>\n\n🆕 Product: <b>${product.name}</b>\n📤 Sent: <b>${sent}</b>\n❌ Failed: <b>${failed}</b>\n👥 Total: <b>${total}</b>`, { inline_keyboard: [[{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]] });
    return;
  }


  if (data.startsWith("dep_approve_") && isAdmin(chatId)) {
    const depShortId = data.replace("dep_approve_", "");
    const dep = await resolvePendingDepositByShortId(depShortId);
    if (!dep) { await editOrSend(chatId, msgId, "⚠️ Deposit not found or already processed."); return; }
    await supabase.from("bot_customers").update({ pending_action: `dep_amount_${dep.id}` }).eq("chat_id", chatId);
    await editOrSend(chatId, msgId, `💰 <b>Verify Deposit</b>\n\n🔗 TxID: <code>${dep.txn_hash || "N/A"}</code>\n\nEnter the verified amount (in USDT):`);
    return;
  }

  if (data.startsWith("dep_reject_") && isAdmin(chatId)) {
    const depShortId = data.replace("dep_reject_", "");
    const dep = await resolvePendingDepositByShortId(depShortId);
    if (!dep) { await editOrSend(chatId, msgId, "⚠️ Deposit not found or already processed."); return; }
    await supabase.from("bot_deposits").update({ status: "rejected", verified_at: new Date().toISOString() }).eq("id", dep.id);
    const cust = dep.customer;
    if (cust) {
      Promise.all([
        supabase.from("bot_customers").update({ pending_action: null }).eq("id", cust.id),
        sendMessage(cust.chat_id, `❌ <b>Deposit Rejected</b>\n\nYour deposit (TxID: <code>${dep.txn_hash || "N/A"}</code>) could not be verified.\n\nIf you believe this is an error, please contact support.`, mainMenuKeyboard()),
      ]).catch(() => {});
    }
    const custLabel = cust ? (cust.username ? `@${cust.username}` : cust.first_name || `#${cust.chat_id}`) : "Unknown";
    await editOrSend(chatId, msgId, `❌ <b>Deposit Rejected</b>\n\n🔗 TxID: <code>${dep.txn_hash || "N/A"}</code>\n👤 ${custLabel}`, { inline_keyboard: [[{ text: "◀️ Deposits", callback_data: "adm_deposits" }]] });
    return;
  }

  // Withdrawal method selection callback
  if (data.startsWith("wd_method_")) {
    const rest = data.replace("wd_method_", "");
    const lastUnderscore = rest.lastIndexOf("_");
    const shortId = rest.substring(0, lastUnderscore);
    const amt = parseFloat(rest.substring(lastUnderscore + 1));
    if (isNaN(amt)) { await editOrSend(chatId, msgId, "❌ Invalid request."); return; }
    const { data: allMethods } = await supabase.from("bot_payment_methods").select("id, name").eq("is_active", true);
    const method = (allMethods || []).find(m => m.id.startsWith(shortId));
    if (!method) { await editOrSend(chatId, msgId, "❌ Payment method not found."); return; }
    await supabase.from("bot_customers").update({ pending_action: `withdraw_details_${amt}_${method.name}` }).eq("id", customer.id);
    await editOrSend(chatId, msgId, `💸 Withdrawing <b>${amt.toFixed(2)} USDT</b> via <b>${method.name}</b>\n\nNow send your <b>${method.name}</b> payment details (e.g. address, ID, number):`);
    return;
  }

  if (data.startsWith("wd_approve_") && isAdmin(chatId)) {
    const wdId = data.replace("wd_approve_", "");
    const { data: wd } = await supabase.from("bot_withdrawals").select("*, customer:bot_customers(*)").eq("id", wdId).single();
    if (!wd || wd.status !== "pending") { await editOrSend(chatId, msgId, "⚠️ Withdrawal already processed or not found."); return; }
    await supabase.from("bot_withdrawals").update({ status: "completed", processed_at: new Date().toISOString() }).eq("id", wdId);
    const cust = wd.customer;
    if (cust) sendMessage(cust.chat_id, `✅ <b>Withdrawal Approved!</b>\n\nAmount: <b>${Number(wd.amount).toFixed(2)} USDT</b>\nPayment: <b>${wd.payment_details}</b>\n\nYour funds are being sent.`, mainMenuKeyboard()).catch(() => {});
    await editOrSend(chatId, msgId, `✅ Withdrawal approved for ${Number(wd.amount).toFixed(2)} USDT.`, { inline_keyboard: [[{ text: "◀️ Withdrawals", callback_data: "adm_withdrawals" }]] });
    return;
  }

  if (data.startsWith("wd_reject_") && isAdmin(chatId)) {
    const wdId = data.replace("wd_reject_", "");
    const { data: wd } = await supabase.from("bot_withdrawals").select("*, customer:bot_customers(*)").eq("id", wdId).single();
    if (!wd || wd.status !== "pending") { await editOrSend(chatId, msgId, "⚠️ Withdrawal already processed or not found."); return; }
    const cust = wd.customer;
    if (cust) {
      const newBal = Number(cust.balance) + Number(wd.amount);
      await Promise.all([
        supabase.from("bot_customers").update({ balance: newBal, updated_at: new Date().toISOString() }).eq("id", cust.id),
        supabase.from("bot_withdrawals").update({ status: "rejected", processed_at: new Date().toISOString() }).eq("id", wdId),
      ]);
      sendMessage(cust.chat_id, `❌ <b>Withdrawal Rejected</b>\n\nYour withdrawal request of <b>${Number(wd.amount).toFixed(2)} USDT</b> has been rejected.\nThe amount has been returned to your balance.\n\n💰 Current Balance: <b>${newBal.toFixed(2)} USDT</b>\n\nIf you have any questions, please contact support.`, mainMenuKeyboard()).catch(() => {});
    } else {
      await supabase.from("bot_withdrawals").update({ status: "rejected", processed_at: new Date().toISOString() }).eq("id", wdId);
    }
    await editOrSend(chatId, msgId, `❌ Withdrawal rejected & ${Number(wd.amount).toFixed(2)} USDT refunded.`, { inline_keyboard: [[{ text: "◀️ Withdrawals", callback_data: "adm_withdrawals" }]] });
    return;
  }

  if (data === "cancel_order") {
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
    const cancelMsg = `❌ <b>Order Cancelled</b>\n\nYour order has been cancelled. No payment is required.`;
    await editOrSend(chatId, msgId, cancelMsg, mainMenuKeyboard(emojiMap));
    return;
  }

  // Admin: manual delivery — deliver order
  if (data.startsWith("mdlvr_") && isAdmin(chatId)) {
    const orderShort = data.replace("mdlvr_", "");
    const { data: orders } = await supabase.from("bot_orders").select("*, customer:bot_customers(*)").eq("status", "pending_delivery").order("created_at", { ascending: false }).limit(100);
    const order = orders?.find((o) => o.id.startsWith(orderShort));
    if (!order) { await editOrSend(chatId, msgId, "⚠️ Order not found or already processed."); return; }
    await supabase.from("bot_customers").update({ pending_action: `manual_deliver_${order.id}` }).eq("chat_id", chatId);
    await editOrSend(chatId, msgId,
      `📦 <b>Manual Delivery</b>\n\n👤 Customer: ${getCustomerLabel(order.customer)}\n🛒 Product: <b>${order.product_name}</b> x${order.quantity}\n💰 Total: <b>${Number(order.total_price).toFixed(2)} USDT</b>\n\n✏️ <b>Type the delivery details</b> to send to the customer:\n\n❌ /cancel to cancel`
    );
    return;
  }

  // Admin: manual delivery — cancel & refund (atomic claim + atomic refund)
  if (data.startsWith("mdcancel_") && isAdmin(chatId)) {
    const orderShort = data.replace("mdcancel_", "");
    // Find the order id (still pending) — short-id resolution
    const { data: orders } = await supabase.from("bot_orders").select("id").eq("status", "pending_delivery").order("created_at", { ascending: false }).limit(200);
    const match = orders?.find((o) => o.id.startsWith(orderShort));
    if (!match) { await editOrSend(chatId, msgId, "⚠️ Order not found or already processed."); return; }

    // Atomically claim the order — only one admin click wins; second click sees claimed=false
    const { data: claimRows, error: claimErr } = await supabase.rpc("claim_pending_delivery_order", { _order_id: match.id, _new_status: "cancelled" });
    if (claimErr) { console.error("claim_pending_delivery_order err:", claimErr); await editOrSend(chatId, msgId, "⚠️ Could not cancel order. Please retry."); return; }
    const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
    if (!claim?.claimed) { await editOrSend(chatId, msgId, "⚠️ Order already processed by another admin."); return; }

    const { data: cust } = await supabase.from("bot_customers").select("*").eq("id", claim.customer_id).single();
    if (!cust) { await editOrSend(chatId, msgId, "⚠️ Customer not found (order cancelled, no refund applied)."); return; }

    const refundAmount = Number(claim.total_price);
    const paymentMethod = (claim.payment_method || "").toLowerCase();
    const custEmojiMap = await loadButtonEmojis().catch(() => ({}));

    let refundLine = "";
    let userMsgLine = "";
    if (paymentMethod === "pay later") {
      const { data: refRows, error: refErr } = await supabase.rpc("refund_pay_later_credit", { _customer_id: cust.id, _amount: refundAmount });
      if (refErr) console.error("refund_pay_later_credit err:", refErr);
      const r = Array.isArray(refRows) ? refRows[0] : refRows;
      const newUsed = Number(r?.new_used ?? Math.max(0, Number(cust.pay_later_used || 0) - refundAmount));
      const remainingCredit = Math.max(0, Number(r?.limit_amount ?? cust.pay_later_limit ?? 0) - newUsed);
      refundLine = `🏷️ Pay Later credit restored: ${refundAmount.toFixed(2)} USDT`;
      userMsgLine = `🏷️ Pay Later Credit Restored: <b>${refundAmount.toFixed(2)} USDT</b>\n💳 Available Credit: <b>${remainingCredit.toFixed(2)} USDT</b>`;
    } else {
      const { data: refRows, error: refErr } = await supabase.rpc("refund_customer_balance", { _customer_id: cust.id, _amount: refundAmount });
      if (refErr) console.error("refund_customer_balance err:", refErr);
      const r = Array.isArray(refRows) ? refRows[0] : refRows;
      const newBalance = Number(r?.new_balance ?? (Number(cust.balance || 0) + refundAmount));
      refundLine = `💰 Balance refunded: ${refundAmount.toFixed(2)} USDT (was: ${claim.payment_method || "Balance"})`;
      userMsgLine = `💰 Refunded to Balance: <b>${refundAmount.toFixed(2)} USDT</b>\n💳 New Balance: <b>${newBalance.toFixed(2)} USDT</b>`;
    }

    sendMessage(cust.chat_id, `❌ <b>Order Cancelled</b>\n\nProduct: <b>${claim.product_name}</b> x${claim.quantity}\n${userMsgLine}`, mainMenuKeyboard(custEmojiMap)).catch(() => {});
    await editOrSend(chatId, msgId, `❌ <b>Order Cancelled & Refunded</b>\n\n👤 ${getCustomerLabel(cust)}\n📦 ${claim.product_name} x${claim.quantity}\n${refundLine}`, { inline_keyboard: [[{ text: "◀️ Admin Menu", callback_data: "adm_menu" }]] });
    return;
  }

  if (data === "go_main") {
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
    const welcomeMsg = await getWelcomeMsg(customer.first_name || "there");
    await editOrSend(chatId, msgId, welcomeMsg, mainMenuKeyboard(emojiMap));
    return;
  }

  if (data === "cancel") {
    await supabase.from("bot_customers").update({ pending_action: null }).eq("id", customer.id);
    const welcomeMsg = await getWelcomeMsg(customer.first_name || "there");
    await editOrSend(chatId, msgId, welcomeMsg, mainMenuKeyboard(emojiMap));
    return;
  }
}

// ── Group/Channel: my_chat_member (bot added/removed) ──
async function handleMyChatMember(event) {
  try {
    const chat = event.chat;
    if (!chat) return;
    const isGroup = chat.type === "group" || chat.type === "supergroup";
    const isChannel = chat.type === "channel";
    if (!isGroup && !isChannel) return;
    const newStatus = event.new_chat_member?.status;
    // Channels: bot must be administrator to post. Groups: member or admin works.
    const isMember = isChannel
      ? newStatus === "administrator"
      : (newStatus === "administrator" || newStatus === "member");
    if (isMember) {
      await supabase.from("bot_broadcast_groups").upsert(
        { chat_id: chat.id, title: chat.title || null, chat_type: chat.type, is_active: true, updated_at: new Date().toISOString() },
        { onConflict: "chat_id" }
      );
      console.log(`✅ Bot joined ${chat.type}: ${chat.title} (${chat.id})`);
      if (isGroup) {
        try {
          await sendMessage(chat.id, `✅ <b>Bot connected!</b>\n\nThis ${chat.type} will now receive product updates, stock alerts, price changes, and announcements automatically.`);
        } catch {}
      }
    } else {
      await supabase.from("bot_broadcast_groups").update({ is_active: false, chat_type: chat.type, updated_at: new Date().toISOString() }).eq("chat_id", chat.id);
      console.log(`❌ Bot removed from ${chat.type}: ${chat.title} (${chat.id})`);
    }
  } catch (e) {
    console.error("handleMyChatMember error:", e.message);
  }
}

// ── Group: keyword auto-reply ──
// In-memory map: `${chat_id}:${original_message_id}` -> { bot_message_id, productIds: string }
const keywordReplyMap = new Map();
const KEYWORD_REPLY_MAX = 2000;

async function handleGroupMessage(message, emojiMap, isEdit = false) {
  const chatId = message.chat.id;
  const text = (message.text || message.caption || "").toLowerCase();
  if (!text) return;

  // Ensure group is tracked
  try {
    await supabase.from("bot_broadcast_groups").upsert(
      { chat_id: chatId, title: message.chat.title || null, is_active: true, updated_at: new Date().toISOString() },
      { onConflict: "chat_id" }
    );
  } catch {}

  const { data: triggers } = await supabase
    .from("bot_keyword_triggers")
    .select("keyword, product_id, bot_products(id, name, short_code, custom_emoji_id, is_active)")
    .eq("is_active", true);
  if (!triggers || triggers.length === 0) return;

  const matched = new Map();
  for (const t of triggers) {
    const kw = (t.keyword || "").toLowerCase().trim();
    if (!kw) continue;
    if (text.includes(kw)) {
      const p = t.bot_products;
      if (p && p.is_active && !matched.has(p.id)) matched.set(p.id, p);
    }
  }
  if (matched.size === 0) return;

  // Filter: only keep products that currently have stock available
  const candidateIds = Array.from(matched.keys());
  const inStock = new Set();
  await Promise.all(candidateIds.map(async (pid) => {
    const { count } = await supabase
      .from("bot_product_stock_items")
      .select("id", { count: "exact", head: true })
      .eq("product_id", pid)
      .eq("status", "available");
    if ((count || 0) > 0) inStock.add(pid);
  }));
  for (const pid of candidateIds) if (!inStock.has(pid)) matched.delete(pid);
  if (matched.size === 0) return;

  const botUser = await getBotUsername();
  const buttons = [];
  const productIdsKey = Array.from(matched.keys()).sort().join(",");
  for (const p of matched.values()) {
    const code = p.short_code || p.id.slice(0, 4).toUpperCase();
    const btn = buyNowButton({ text: `Buy ${p.name}`, url: `https://t.me/${botUser}?start=p_${code}` }, emojiMap);
    buttons.push([btn]);
  }

  const replyKey = `${chatId}:${message.message_id}`;
  const existing = keywordReplyMap.get(replyKey);

  const matchedArr = Array.from(matched.values());
  const formatProductWithEmoji = (p) => {
    const tag = p.custom_emoji_id
      ? `<tg-emoji emoji-id="${p.custom_emoji_id}">📦</tg-emoji>`
      : "📦";
    return `${tag} ${p.name}`;
  };
  const productLabels = matchedArr.map(formatProductWithEmoji);
  const replyText = replacePlaceholders(
    getPageMsg("msg_keyword_reply", `✅ <b>Available now!</b> Tap below to buy:`),
    {
      product: productLabels[0] || "",
      products: productLabels.join(", "),
      count: String(matchedArr.length),
    }
  );

  // If this is an edit and we have a previous reply for this message, try to edit it
  if (isEdit && existing) {
    try {
      const editRes = await tgFetch("editMessageText", {
        chat_id: chatId,
        message_id: existing.bot_message_id,
        text: replyText,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: buttons },
      });
      if (editRes && editRes.ok !== false) {
        keywordReplyMap.set(replyKey, { bot_message_id: existing.bot_message_id, productIds: productIdsKey });
        return;
      }
    } catch (e) { /* fall through to send new */ }
  }

  const sent = await tgFetch("sendMessage", {
    chat_id: chatId,
    text: replyText,
    parse_mode: "HTML",
    reply_to_message_id: message.message_id,
    allow_sending_without_reply: true,
    reply_markup: { inline_keyboard: buttons },
  });

  const botMsgId = sent?.result?.message_id;
  if (botMsgId) {
    if (keywordReplyMap.size >= KEYWORD_REPLY_MAX) {
      const firstKey = keywordReplyMap.keys().next().value;
      keywordReplyMap.delete(firstKey);
    }
    keywordReplyMap.set(replyKey, { bot_message_id: botMsgId, productIds: productIdsKey });
  }
}

// ── Main polling loop ──

async function pollUpdates() {
  let offset = 0;

  // Try to load offset from DB
  try {
    const { data: state } = await supabase.from("telegram_bot_state").select("update_offset").eq("id", 1).single();
    if (state) offset = Number(state.update_offset);
  } catch (e) {
    console.log("No saved offset, starting from 0");
  }

  // Keep Telegram's bottom menu button disabled; navigation is handled by inline keyboards.
  try {
    await fetch(`${TELEGRAM_API}/deleteMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    console.log("✅ Bot menu commands disabled!");
  } catch (e) {
    console.error("Failed to disable menu commands:", e.message);
  }

  console.log(`🤖 Bot started! Polling with offset ${offset}...`);

  while (true) {
    try {
      const controller = new AbortController();
      const fetchTimeout = setTimeout(() => controller.abort(), (POLL_TIMEOUT + 10) * 1000);
      let res;
      try {
        res = await fetch(`${TELEGRAM_API}/getUpdates`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offset, timeout: POLL_TIMEOUT, allowed_updates: ["message", "edited_message", "callback_query", "my_chat_member", "channel_post", "edited_channel_post"] }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(fetchTimeout);
      }

      const data = await res.json();
      if (!data.ok) { console.error("getUpdates error:", data); await new Promise((r) => setTimeout(r, 5000)); continue; }

      const updates = data.result || [];
      if (updates.length === 0) continue;

      const emojiMap = await loadButtonEmojis();

      // Process updates concurrently for speed
      await Promise.allSettled(updates.map(async (update) => {
        try {
          if (update.my_chat_member) await handleMyChatMember(update.my_chat_member);
          else if (update.callback_query) await handleCallback(update.callback_query, emojiMap);
          else if (update.edited_message?.chat?.type === "group" || update.edited_message?.chat?.type === "supergroup") {
            await handleGroupMessage(update.edited_message, emojiMap, true);
          }
          else if (update.message?.chat?.type === "group" || update.message?.chat?.type === "supergroup") {
            await handleGroupMessage(update.message, emojiMap);
          }
          else if (update.message?.photo || update.message?.video) await handleMediaMessage(update.message, emojiMap);
          else if (update.message?.text) await handleMessage(update.message, emojiMap);
        } catch (err) {
          console.error("Error processing update", update.update_id, err);
        }
      }));

      offset = Math.max(...updates.map((u) => u.update_id)) + 1;

      // Save offset
      await supabase.from("telegram_bot_state").update({ update_offset: offset, updated_at: new Date().toISOString() }).eq("id", 1);
    } catch (err) {
      console.error("Polling error:", err);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// Start with crash recovery
process.on("uncaughtException", (err) => { console.error("Uncaught exception:", err); });
process.on("unhandledRejection", (err) => { console.error("Unhandled rejection:", err); });

// ── Background Pending Deposit Auto-Verifier ──
async function backgroundDepositChecker() {
  const CHECK_INTERVAL = 30 * 1000; // check every 30s
  const MAX_AGE_HOURS = 2; // only check deposits less than 2 hours old

  while (true) {
    await new Promise(r => setTimeout(r, CHECK_INTERVAL));
    try {
      const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();
      const { data: pendingDeps } = await supabase
        .from("bot_deposits")
        .select("*, customer:bot_customers(id, chat_id, username, first_name, balance, pending_action)")
        .eq("status", "pending")
        .gte("created_at", cutoff)
        .not("txn_hash", "is", null)
        .order("created_at", { ascending: true })
        .limit(10);

      if (!pendingDeps || pendingDeps.length === 0) continue;
      console.log(`[BG-Verify] Checking ${pendingDeps.length} pending deposits...`);

      const binanceApiKey = envGet("BINANCE_API_KEY"), binanceApiSecret = envGet("BINANCE_API_SECRET");
      const bybitApiKey = envGet("BYBIT_API_KEY"), bybitApiSecret = envGet("BYBIT_API_SECRET");

      for (const dep of pendingDeps) {
        try {
          const txn = dep.txn_hash;
          if (!txn) continue;
          const customer = dep.customer;
          if (!customer) continue;

          // Derive payment method hint from customer's pending_action (e.g. "bkashpay_...")
          const pendingAction = String(customer.pending_action || "");
          const methodHint = pendingAction.startsWith("bkashpay") ? "bkash" : "";
          const targets = inferVerificationTargets(txn, methodHint);
          let amount = 0, verified = false, verifiedVia = "", ltcRawAmount = 0;

          // Exchange checks
          const exchangeChecks = [];
          if (targets.binance && binanceApiKey && binanceApiSecret) {
            exchangeChecks.push(verifyBinanceTransfer(txn, binanceApiKey, binanceApiSecret).then(r => ({ source: "Binance", ...r })).catch(() => ({ source: "Binance", verified: false, amount: 0 })));
          }
          if (targets.bybit && bybitApiKey && bybitApiSecret) {
            exchangeChecks.push(verifyBybitTransfer(txn, bybitApiKey, bybitApiSecret).then(r => ({ source: "Bybit", ...r })).catch(() => ({ source: "Bybit", verified: false, amount: 0 })));
          }
          if (targets.bkash) {
            exchangeChecks.push(verifyBkashPayment(txn).then(r => ({ source: "bKash", ...r })).catch(() => ({ source: "bKash", verified: false, amount: 0 })));
          }
          if (exchangeChecks.length > 0) {
            const results = await Promise.all(exchangeChecks);
            for (const r of results) {
              if (r.verified && r.amount > 0) { amount = r.amount; verified = true; verifiedVia = r.via || r.source; break; }
            }
          }

          // Chain checks
          if (!verified && (targets.bep20 || targets.trc20 || targets.ton || targets.ltc)) {
            const [bep20, trc20, ton, ltc] = await Promise.all([
              targets.bep20 ? verifyBep20Transfer(txn).catch(() => ({ verified: false, amount: 0 })) : Promise.resolve({ verified: false, amount: 0 }),
              targets.trc20 ? verifyTrc20Transfer(txn).catch(() => ({ verified: false, amount: 0 })) : Promise.resolve({ verified: false, amount: 0 }),
              targets.ton ? verifyTonTransfer(txn).catch(() => ({ verified: false, amount: 0 })) : Promise.resolve({ verified: false, amount: 0 }),
              targets.ltc ? verifyLtcTransfer(txn).catch(() => ({ verified: false, amount: 0, ltcAmount: 0 })) : Promise.resolve({ verified: false, amount: 0, ltcAmount: 0 }),
            ]);
            if (bep20.verified && bep20.amount > 0) { amount = bep20.amount; verified = true; verifiedVia = "BEP20"; }
            else if (trc20.verified && trc20.amount > 0) { amount = trc20.amount; verified = true; verifiedVia = "TRC20"; }
            else if (ton.verified && ton.amount > 0) { amount = ton.amount; verified = true; verifiedVia = "TON"; }
            else if (ltc.verified && ltc.amount > 0) { amount = ltc.amount; verified = true; verifiedVia = "LTC"; ltcRawAmount = ltc.ltcAmount || 0; }
          }

          if (!verified || amount <= 0) continue;

          console.log(`[BG-Verify] ✅ Deposit ${dep.id} verified: ${amount} USDT via ${verifiedVia}`);

          // Update deposit status
          await supabase.from("bot_deposits").update({
            status: "verified", amount, verified_at: new Date().toISOString(),
          }).eq("id", dep.id);

          const chatId = customer.chat_id;

          // Check if this was a direct pay deposit with pending product
          if (dep.pending_product_id && dep.pending_quantity) {
            const { data: product } = await supabase.from("bot_products").select("*").eq("id", dep.pending_product_id).single();
            if (product) {
              const qty = dep.pending_quantity;
              const unitPrice = await getTieredPrice(dep.pending_product_id, qty, Number(product.price), dep.customer_id);
              const expectedTotal = Math.round(unitPrice * qty * 10000) / 10000;

              {
                const emojiMap = await loadButtonEmojis();
                await processDirectPayPurchase({ chatId, customer, product, qty, expectedTotal, amount, verifiedVia, ltcRawAmount, normalizedTxn: txn, emojiMap, receiptPrefix: "✅ <b>Payment Verified!</b> — Background Check" });
              }
            } else {
              // Product not found — just add to balance
              const { data: freshBal } = await supabase.from("bot_customers").select("balance").eq("id", customer.id).single();
              const newBal = (freshBal ? Number(freshBal.balance) : 0) + amount;
              await supabase.from("bot_customers").update({ balance: newBal, updated_at: new Date().toISOString() }).eq("id", customer.id);
              await sendMessage(chatId, `✅ <b>Deposit Verified!</b> — Background Check\n\n${formatPaymentResultLine(amount, verifiedVia, ltcRawAmount, txn)}💳 New Balance: <b>${newBal.toFixed(2)} USDT</b>`, mainMenuKeyboard());
            }
          } else {
            // Regular deposit — auto-deduct pay later first, then add to balance
            const plResult = await autoDeductPayLater(customer.id, amount);
            const creditAmount = plResult.remaining;
            const { data: freshBal } = await supabase.from("bot_customers").select("balance").eq("id", customer.id).single();
            const newBal = (freshBal ? Number(freshBal.balance) : 0) + creditAmount;
            await supabase.from("bot_customers").update({ balance: newBal, updated_at: new Date().toISOString() }).eq("id", customer.id);
            let receiptMsg = `✅ <b>Deposit Verified!</b> — Background Check\n\n${formatPaymentResultLine(amount, verifiedVia, ltcRawAmount, txn)}`;
            if (plResult.deducted > 0) {
              receiptMsg += `🏷️ Pay Later Deducted: <b>-${plResult.deducted.toFixed(2)} USDT</b>\n💳 Remaining Due: <b>${(plResult.newUsed || 0).toFixed(2)} USDT</b>\n`;
            }
            receiptMsg += `💳 New Balance: <b>${newBal.toFixed(2)} USDT</b>`;
            await sendMessage(chatId, receiptMsg, mainMenuKeyboard());
          }

          notifyAdmin(`✅ <b>BG Auto-Verified Deposit</b>\n\n👤 ${getCustomerLabel(customer)}\n${formatPaymentResultLine(amount, verifiedVia, ltcRawAmount, txn)}`);
        } catch (depErr) {
          console.error(`[BG-Verify] Error processing deposit ${dep.id}:`, depErr.message);
        }
      }
    } catch (err) {
      console.error("[BG-Verify] Background checker error:", err.message);
    }
  }
}

// ── Background Auto Stock Alert ──
async function backgroundStockAlertChecker() {
  const CHECK_INTERVAL = 2 * 60 * 1000; // check every 2 minutes

  // Initialize last_known_stock on first run
  try {
    // Initial source sync so source-backed products have fresh last_known_stock
    try {
      await fetch(`${process.env.SUPABASE_URL}/functions/v1/product-sources`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
        },
        body: JSON.stringify({ action: "sync_all" }),
      });
    } catch (e) {
      console.error("[Stock-Alert] Initial source sync error:", e.message);
    }
    const { data: products } = await supabase.from("bot_products").select("*").eq("is_active", true).eq("is_manual_delivery", false).order("sort_order");
    if (products && products.length > 0) {
      const stocks = await getAllProductStocks(products);
      for (let i = 0; i < products.length; i++) {
        // Always sync last_known_stock on startup without broadcasting
        if (stocks[i] !== products[i].last_known_stock) {
          await supabase.from("bot_products").update({ last_known_stock: stocks[i] }).eq("id", products[i].id);
        }
      }
      console.log("✅ Stock alert checker initialized (synced all stocks silently)");
    }
  } catch (e) {
    console.error("[Stock-Alert] Init error:", e.message);
  }

  while (true) {
    await new Promise(r => setTimeout(r, CHECK_INTERVAL));
    try {
      // Clear stock cache to get fresh data
      clearStockCache();

      // Refresh source-backed products' last_known_stock from upstream sources
      try {
        await fetch(`${process.env.SUPABASE_URL}/functions/v1/product-sources`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
          },
          body: JSON.stringify({ action: "sync_all" }),
        });
      } catch (e) {
        console.error("[Stock-Alert] Source sync error:", e.message);
      }

      const { data: products } = await supabase.from("bot_products").select("*").eq("is_active", true).eq("is_manual_delivery", false).order("sort_order");
      if (!products || products.length === 0) continue;

      const stocks = await getAllProductStocks(products, { force: true });
      const emojiMap = await loadButtonEmojis();

      for (let i = 0; i < products.length; i++) {
        const product = products[i];
        const currentStock = stocks[i];
        const previousStock = product.last_known_stock || 0;

        if (currentStock > previousStock && previousStock >= 0) {
          const addedCount = currentStock - previousStock;
          console.log(`[Stock-Alert] ${product.name}: ${previousStock} → ${currentStock} (+${addedCount})`);

          // Build broadcast message
          const alertEmoji = emojiMap["stock_alert"];
          let alertIcon = "📢";
          let alertEmojiHtml = "";
          if (alertEmoji?.emoji) {
            alertEmojiHtml = `<tg-emoji emoji-id="${alertEmoji.emoji}">📢</tg-emoji>`;
            alertIcon = alertEmojiHtml;
          }

          await fetchPageMsgs();
          const stockAlertTpl = cachedPageMsgs["msg_stock_alert"] || `${alertIcon} <b>{added} new stock added for {product}!</b>\n\n📊 Available: <b>{stock}</b> items\n💰 Price: <b>{price} USDT</b>`;
          const productIconBg = product.custom_emoji_id ? `<tg-emoji emoji-id="${product.custom_emoji_id}">📦</tg-emoji> ` : "";
          const bulkPricingBg = await formatBulkPricingBlock(product.id);
          const broadcastMsg = replacePlaceholders(stockAlertTpl, { product: `${productIconBg}${product.name}`, added: String(addedCount), stock: String(currentStock), price: Number(product.price).toFixed(2), bulk_pricing: bulkPricingBg });

          const botUser = await getBotUsername();
          const code = product.short_code || product.id.slice(0, 4).toUpperCase();
          const buyBtn = buyNowButton({ text: `Buy ${product.name}`, url: `https://t.me/${botUser}?start=p_${code}` }, emojiMap);
          const broadcastKeyboard = { inline_keyboard: [[buyBtn]] };

          const { total, sent, failed } = await broadcastToAll(broadcastMsg, broadcastKeyboard);
          console.log(`[Stock-Alert] Broadcast for ${product.name}: total=${total}, sent=${sent}, failed=${failed}`);
        }

        // Always update last_known_stock
        if (currentStock !== previousStock) {
          await supabase.from("bot_products").update({ last_known_stock: currentStock }).eq("id", products[i].id);
        }
      }
    } catch (err) {
      console.error("[Stock-Alert] Background checker error:", err.message);
    }
  }
}

(async function startBot() {
  // Warm-up: pre-cache bot username and internal stock data on startup
  console.log("🔥 Warming up: pre-caching access token, bot username, and stock data...");
  await getBotUsername().then(u => console.log(`🤖 Bot username: @${u}`)).catch(() => {});
  try {
    const { data: products } = await supabase.from("bot_products").select("*").eq("is_active", true).order("sort_order");
    if (products && products.length > 0) {
      await getAllProductStocks(products);
      console.log(`✅ Warm-up complete: cached stock for ${products.length} products`);
    }
  } catch (e) {
    console.error("Warm-up failed (non-fatal):", e.message);
  }

  // Start background deposit checker (non-blocking)
  backgroundDepositChecker().catch(err => console.error("[BG-Verify] Fatal error:", err));
  console.log("🔄 Background deposit checker started (every 60s)");

  // Start background auto stock alert checker (non-blocking)
  backgroundStockAlertChecker().catch(err => console.error("[Stock-Alert] Fatal error:", err));
  console.log("📦 Background stock alert checker started (every 5 min)");

  flashSaleTickerLoop().catch(err => console.error("[FlashSale] Fatal error:", err));
  console.log("🔥 Flash sale countdown ticker started (every 5s)");

  while (true) {
    try {
      await pollUpdates();
    } catch (err) {
      console.error("Bot crashed, restarting in 5s...", err);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
})();
