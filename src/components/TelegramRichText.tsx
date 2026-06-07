import { Fragment, lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';

const Lottie = lazy(() => import('lottie-react'));

type EmojiInfo = { url: string | null; fallback: string | null };

// ---- Tiny in-memory + sessionStorage cache to avoid refetching ----
const memCache = new Map<string, EmojiInfo>();
const pending = new Map<string, Promise<EmojiInfo>>();
const SESSION_CACHE_VERSION = 2;

function loadSession(id: string): EmojiInfo | undefined {
  try {
    const raw = sessionStorage.getItem(`tg-emoji:${id}`);
    const parsed = raw ? JSON.parse(raw) as EmojiInfo & { version?: number } : undefined;
    if (parsed?.version !== SESSION_CACHE_VERSION) return undefined;
    return parsed?.url || parsed?.fallback ? parsed : undefined;
  } catch { return undefined; }
}
function saveSession(id: string, v: EmojiInfo) {
  try { sessionStorage.setItem(`tg-emoji:${id}`, JSON.stringify({ ...v, version: SESSION_CACHE_VERSION })); } catch {}
}

// ---- Lottie JSON cache so identical emojis share data ----
const lottieJsonCache = new Map<string, any>();
const lottieJsonPending = new Map<string, Promise<any>>();

function prefetchLottie(url: string) {
  if (lottieJsonCache.has(url) || lottieJsonPending.has(url)) return lottieJsonPending.get(url);
  const p = fetch(url).then(r => r.json()).then(j => { lottieJsonCache.set(url, j); return j; }).catch(() => null);
  lottieJsonPending.set(url, p);
  return p;
}

function prefetchMedia(url: string) {
  // Warm the browser cache for webp/webm
  try { fetch(url, { mode: 'no-cors' }).catch(() => {}); } catch {}
}

async function fetchEmojis(ids: string[]): Promise<Record<string, EmojiInfo>> {
  if (ids.length === 0) return {};
  const { data, error } = await supabase.functions.invoke('get-custom-emojis', { body: { ids } });
  if (error) throw error;
  return (data as any)?.emojis || {};
}

function warmAsset(info: EmojiInfo) {
  if (!info.url) return;
  if (info.url.endsWith('.json')) prefetchLottie(info.url);
  else prefetchMedia(info.url);
}

function resolve(id: string): Promise<EmojiInfo> {
  if (memCache.has(id)) return Promise.resolve(memCache.get(id)!);
  const fromSession = loadSession(id);
  if (fromSession) { memCache.set(id, fromSession); warmAsset(fromSession); return Promise.resolve(fromSession); }
  if (pending.has(id)) return pending.get(id)!;
  const p = new Promise<EmojiInfo>((resolveOuter) => {
    setTimeout(async () => {
      const batch = Array.from(pending.keys());
      try {
        const map = await fetchEmojis(batch);
        for (const bid of batch) {
          const info = map[bid] || { url: null, fallback: null };
          memCache.set(bid, info);
          saveSession(bid, info);
          warmAsset(info);
        }
      } catch {
        for (const bid of batch) memCache.delete(bid);
      }
      pending.clear();
      resolveOuter(memCache.get(id) || { url: null, fallback: null });
    }, 30);
  });
  pending.set(id, p);
  return p;
}

// ---- Public preload API: call once at site load with all known emoji ids ----
export async function preloadCustomEmojis(ids: (string | null | undefined)[]) {
  const unique = Array.from(new Set(ids.filter(Boolean) as string[]));
  const toFetch: string[] = [];
  for (const id of unique) {
    if (memCache.has(id)) { warmAsset(memCache.get(id)!); continue; }
    const fromSession = loadSession(id);
    if (fromSession) { memCache.set(id, fromSession); warmAsset(fromSession); continue; }
    toFetch.push(id);
  }
  if (toFetch.length === 0) return;
  try {
    const map = await fetchEmojis(toFetch);
    for (const id of toFetch) {
      const info = map[id] || { url: null, fallback: null };
      memCache.set(id, info);
      saveSession(id, info);
      warmAsset(info);
    }
  } catch {
    // ignore — TgEmoji will retry on render
  }
}

// ---- The emoji component ----
export function TgEmoji({ id, fallback, size = '1em' }: { id: string; fallback?: string; size?: string | number }) {
  const [info, setInfo] = useState<EmojiInfo | null>(memCache.get(id) || loadSession(id) || null);
  const [lottieData, setLottieData] = useState<any>(info?.url?.endsWith('.json') ? lottieJsonCache.get(info.url) || null : null);

  useEffect(() => {
    let cancel = false;
    if (!info) resolve(id).then(v => { if (!cancel) setInfo(v); });
    return () => { cancel = true; };
  }, [id, info]);

  useEffect(() => {
    let cancel = false;
    if (info?.url?.endsWith('.json') && !lottieData) {
      const cached = lottieJsonCache.get(info.url);
      if (cached) { setLottieData(cached); return; }
      prefetchLottie(info.url)?.then(j => { if (!cancel && j) setLottieData(j); });
    }
  }, [info?.url, lottieData]);

  const text = info?.fallback ?? fallback ?? '';
  const dim = typeof size === 'number' ? `${size}px` : size;
  const style = { width: dim, height: dim, display: 'inline-block', verticalAlign: 'text-bottom' as const };

  if (info?.url) {
    if (info.url.endsWith('.json')) {
      if (lottieData) {
        return (
          <Suspense fallback={<span className="tg-emoji-fallback" aria-label={text}>{text}</span>}>
            <span style={style} aria-label={text}>
              <Lottie animationData={lottieData} loop autoplay style={{ width: '100%', height: '100%' }} />
            </span>
          </Suspense>
        );
      }
    } else if (info.url.endsWith('.webm') || info.url.endsWith('.mp4')) {
      return (
        <video
          src={info.url}
          autoPlay loop muted playsInline
          aria-label={text}
          style={style}
        />
      );
    } else {
      return <img src={info.url} alt={text} style={style} loading="eager" decoding="async" />;
    }
  }
  return <span className="tg-emoji-fallback" aria-label={text}>{text}</span>;
}

// ---- Parser: Telegram-flavored HTML -> React nodes ----
const ALLOWED = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'code', 'pre', 'blockquote', 'br', 'a', 'span']);

interface Node { tag: string | null; attrs: Record<string, string>; children: any[]; text?: string }

function tokenize(html: string): Node {
  const root: Node = { tag: null, attrs: {}, children: [] };
  const stack: Node[] = [root];
  const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const [, tagName, rawAttrs, text] = m;
    if (text) {
      stack[stack.length - 1].children.push({ tag: null, attrs: {}, children: [], text });
      continue;
    }
    const tag = tagName.toLowerCase();
    const isClose = m[0].startsWith('</');
    if (isClose) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      continue;
    }
    const attrs: Record<string, string> = {};
    const attrRe = /([a-zA-Z-]+)\s*=\s*"([^"]*)"|([a-zA-Z-]+)\s*=\s*'([^']*)'/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(rawAttrs)) !== null) {
      attrs[(am[1] || am[3]).toLowerCase()] = am[2] ?? am[4] ?? '';
    }
    const node: Node = { tag, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    const selfClosing = tag === 'br' || /\/\s*>$/.test(m[0]);
    if (!selfClosing) stack.push(node);
  }
  return root;
}

function decode(s: string) {
  return s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' }[e]!));
}

function renderTextWithBreaks(text: string, key: number): ReactNode {
  const decoded = decode(text).replace(/\r\n/g, '\n');
  const parts = decoded.split('\n');
  if (parts.length === 1) return decoded;
  return (
    <Fragment key={key}>
      {parts.map((part, i) => (
        <Fragment key={i}>{i > 0 && <br />}{part}</Fragment>
      ))}
    </Fragment>
  );
}

function render(node: Node, key: number): ReactNode {
  if (node.text !== undefined) return renderTextWithBreaks(node.text, key);
  const kids = node.children.map((c, i) => render(c, i));
  const tag = node.tag;

  if (tag === 'tg-emoji') {
    const id = node.attrs['emoji-id'] || node.attrs['data-emoji-id'];
    const fallback = node.children.map(c => c.text || '').join('').trim() || undefined;
    if (!id) return <>{fallback}</>;
    return <TgEmoji key={key} id={id} fallback={fallback} />;
  }
  if (tag === 'br') return <br key={key} />;
  if (tag === 'a') {
    const href = node.attrs.href || '#';
    const safe = /^(https?:|mailto:|tel:)/i.test(href) ? href : '#';
    return <a key={key} href={safe} target="_blank" rel="noopener noreferrer">{kids}</a>;
  }
  if (tag && ALLOWED.has(tag)) {
    const Tag = tag as any;
    return <Tag key={key}>{kids}</Tag>;
  }
  return <span key={key}>{kids}</span>;
}

function renderInline(node: Node, key: number): ReactNode {
  if (node.text !== undefined) return renderTextWithBreaks(node.text, key);
  if (node.tag === 'tg-emoji') {
    const id = node.attrs['emoji-id'] || node.attrs['data-emoji-id'];
    const fallback = node.children.map(c => c.text || '').join('').trim() || undefined;
    if (!id) return fallback || null;
    return <TgEmoji key={key} id={id} fallback={fallback} />;
  }
  if (node.tag === 'br') return <br key={key} />;
  return <>{node.children.map((c, i) => renderInline(c, i))}</>;
}

export function TelegramRichText({ html, className, inline }: { html: string | null | undefined; className?: string; inline?: boolean }) {
  const tree = useMemo(() => tokenize(html || ''), [html]);
  if (inline) {
    return (
      <span className={`tg-content-inline ${className || ''}`}>
        {tree.children.map((c, i) => renderInline(c, i))}
      </span>
    );
  }
  return (
    <div className={`tg-content ${className || ''}`}>
      {tree.children.map((c, i) => render(c, i))}
    </div>
  );
}
