// Convert Telegram-flavored HTML (used in bot messages) into safe HTML
// for rendering on the customer site, and a plain-text variant for previews.

const ALLOWED = new Set([
  'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del',
  'code', 'pre', 'br', 'a', 'blockquote', 'span'
]);

function escape(str: string) {
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** Convert Telegram HTML to sanitized HTML. Strips tg-emoji wrappers (keeps fallback char). */
export function telegramHtmlToHtml(input: string | null | undefined): string {
  if (!input) return '';
  // Strip <tg-emoji ...>X</tg-emoji> -> X
  let s = input.replace(/<tg-emoji[^>]*>([\s\S]*?)<\/tg-emoji>/gi, '$1');
  // Remove any disallowed tags but keep their inner content
  s = s.replace(/<\/?([a-zA-Z0-9-]+)([^>]*)>/g, (m, tag, attrs) => {
    const t = tag.toLowerCase();
    if (!ALLOWED.has(t)) return '';
    if (t === 'a') {
      // sanitize href
      const href = /href\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] || /href\s*=\s*'([^']*)'/i.exec(attrs)?.[1] || '#';
      const safe = /^(https?:|mailto:|tel:)/i.test(href) ? href : '#';
      if (m.startsWith('</')) return '</a>';
      return `<a href="${escape(safe)}" target="_blank" rel="noopener noreferrer">`;
    }
    return m.startsWith('</') ? `</${t}>` : `<${t}>`;
  });
  return s;
}

/** Plain-text version for truncated previews (cards). */
export function telegramHtmlToText(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(/<tg-emoji[^>]*>([\s\S]*?)<\/tg-emoji>/gi, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|blockquote|li)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
