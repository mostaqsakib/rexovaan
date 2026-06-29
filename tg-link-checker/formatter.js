// Format results into Telegram-friendly outputs.

export function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ${r}s`;
}

export function buildSummary({ total, valid, invalid, errors, durationMs }) {
  const speed = durationMs > 0 ? (total / (durationMs / 1000)).toFixed(2) : '0.00';
  return [
    '📊 <b>Summary</b>',
    `Total: <b>${total}</b>`,
    `✅ Valid: <b>${valid}</b>`,
    `❌ Invalid: <b>${invalid}</b>`,
    errors ? `⚠️ Errors: <b>${errors}</b>` : null,
    `⏱ Duration: <b>${formatDuration(durationMs)}</b>`,
    `⚡ Speed: <b>${speed} links/sec</b>`,
  ].filter(Boolean).join('\n');
}

export function buildProgressText({ checked, total, valid, invalid, errors, elapsedMs, label }) {
  const pct = total > 0 ? Math.floor((checked / total) * 100) : 0;
  const bar = makeBar(pct);
  return [
    label ? `<b>${escapeHtml(label)}</b>` : null,
    `${bar} ${pct}%`,
    `⏳ Checked: <b>${checked}/${total}</b>`,
    `✅ Valid: <b>${valid}</b>`,
    `❌ Invalid: <b>${invalid}</b>`,
    errors ? `⚠️ Errors: <b>${errors}</b>` : null,
    `⏱ ${formatDuration(elapsedMs)}`,
  ].filter(Boolean).join('\n');
}

function makeBar(pct) {
  const total = 14;
  const filled = Math.round((pct / 100) * total);
  return '█'.repeat(filled) + '░'.repeat(total - filled);
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function extractUrls(text) {
  if (!text) return [];
  const re = /https?:\/\/[^\s<>"'`]+/gi;
  const found = text.match(re) || [];
  // Trim trailing punctuation common in pasted text.
  return found.map((u) => u.replace(/[)\].,;:!?]+$/g, ''));
}

export function dedupe(urls) {
  const seen = new Set();
  const out = [];
  for (const u of urls) {
    const k = u.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}
