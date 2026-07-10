import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { EMOJI_CATEGORIES, searchEmojis } from './emoji-data';
import { Input } from '@/components/ui/input';
import { Search, Clock, Smile, Sticker, Image as ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TgEmoji, seedCustomEmojiCache } from '@/components/TelegramRichText';

interface CustomEmoji { custom_emoji_id: string; emoji: string; thumb_url: string | null }
interface StickerSet { set_name: string; title: string; emojis: CustomEmoji[] }

interface Props {
  onPickUnicode: (emoji: string) => void;
  onPickCustom: (id: string, fallback: string) => void;
}

const RECENT_KEY = 'tg-editor-recent-emojis';
const RECENT_MAX = 40;

function loadRecent(): Array<{ type: 'u' | 'c'; v: string; f?: string }> {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
export function saveRecent(entry: { type: 'u' | 'c'; v: string; f?: string }) {
  const cur = loadRecent().filter(e => !(e.type === entry.type && e.v === entry.v));
  cur.unshift(entry);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(cur.slice(0, RECENT_MAX))); } catch {}
}

export default function EmojiPicker({ onPickUnicode, onPickCustom }: Props) {
  const [mode, setMode] = useState<'custom' | 'emoji'>('custom');
  const [activeSet, setActiveSet] = useState<string>('recent');
  const [activeUnicode, setActiveUnicode] = useState<string>(EMOJI_CATEGORIES[0]?.key || '');
  const [query, setQuery] = useState('');
  const [sets, setSets] = useState<StickerSet[]>([]);
  const [recent, setRecent] = useState(loadRecent());
  const [assetVersion, setAssetVersion] = useState(0);

  useEffect(() => {
    supabase.from('bot_emoji_sticker_sets').select('*').order('title')
      .then(({ data }) => {
        const normalized = ((data || []) as any[]).map((set) => ({
          set_name: String(set.set_name),
          title: String(set.title || set.set_name),
          emojis: Array.isArray(set.emojis) ? set.emojis : [],
        })).filter((set) => set.emojis.length > 0) as StickerSet[];
        setSets(normalized);
        if (normalized.length > 0) setActiveSet((cur) => cur === 'recent' && loadRecent().length === 0 ? normalized[0].set_name : cur);
      });
  }, []);

  const searchResults = useMemo(() => searchEmojis(query), [query]);
  const customSearchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as Array<CustomEmoji & { setTitle: string }>;
    return sets.flatMap((set) => set.emojis.map((emoji) => ({ ...emoji, setTitle: set.title })))
      .filter((emoji) =>
        emoji.emoji?.includes(query) ||
        emoji.custom_emoji_id.includes(q) ||
        emoji.setTitle.toLowerCase().includes(q)
      )
      .slice(0, 240);
  }, [query, sets]);
  const activeSetData = sets.find((set) => set.set_name === activeSet) || null;
  const activeUnicodeData = EMOJI_CATEGORIES.find((cat) => cat.key === activeUnicode) || EMOJI_CATEGORIES[0];

  useEffect(() => {
    if (mode !== 'custom') return;
    let ids: string[] = [];
    if (query.trim()) {
      ids = customSearchResults.map((emoji) => emoji.custom_emoji_id);
    } else if (activeSet === 'recent') {
      ids = recent.filter((emoji) => emoji.type === 'c').map((emoji) => emoji.v);
    } else if (activeSetData) {
      ids = activeSetData.emojis.map((emoji) => emoji.custom_emoji_id);
    }
    ids = Array.from(new Set(ids)).slice(0, 300);
    if (ids.length === 0) return;
    let cancelled = false;

    (async () => {
      const { data } = await supabase
        .from('bot_custom_emoji_cache')
        .select('emoji_id,lottie_url,fallback,status')
        .in('emoji_id', ids);
      if (cancelled) return;
      const rows = data || [];
      const readyRows = rows.filter((row) => row.status === 'ready' && row.lottie_url);
      if (readyRows.length) {
        seedCustomEmojiCache(readyRows.map((row) => ({ id: row.emoji_id, url: row.lottie_url, fallback: row.fallback })));
        setAssetVersion((v) => v + 1);
      }
      // Resolve any missing / pending emojis via the edge function so premium
      // packs light up instead of showing only the small colored thumb.
      const readySet = new Set(readyRows.map((row) => row.emoji_id));
      const failedSet = new Set(rows.filter((row) => row.status === 'failed').map((row) => row.emoji_id));
      const toResolve = ids.filter((id) => !readySet.has(id) && !failedSet.has(id));
      // Edge function processes 25 per invocation; run a few batches in the background.
      for (let i = 0; i < toResolve.length && i < 200; i += 25) {
        if (cancelled) return;
        const batch = toResolve.slice(i, i + 25);
        try {
          const { data: res } = await supabase.functions.invoke('get-custom-emojis', { body: { ids: batch } });
          if (cancelled) return;
          const emojis = (res as any)?.emojis || {};
          const entries = Object.entries(emojis)
            .filter(([, v]: any) => v?.url)
            .map(([id, v]: any) => ({ id, url: v.url, fallback: v.fallback }));
          if (entries.length) {
            seedCustomEmojiCache(entries);
            setAssetVersion((v) => v + 1);
          }
        } catch { /* ignore, retry on next open */ }
      }
    })();

    return () => { cancelled = true; };
  }, [activeSet, activeSetData, customSearchResults, mode, query, recent]);

  const pickU = (e: string) => { saveRecent({ type: 'u', v: e }); setRecent(loadRecent()); onPickUnicode(e); };
  const pickC = (id: string, f: string) => { saveRecent({ type: 'c', v: id, f }); setRecent(loadRecent()); onPickCustom(id, f); };

  return (
    <div className="telegram-emoji-picker w-[360px] h-[520px] flex flex-col overflow-hidden">
      <div className="telegram-emoji-tabs grid grid-cols-3">
        <PickerModeButton active={mode === 'emoji'} onClick={() => { setMode('emoji'); setQuery(''); }} icon={<Smile className="h-3.5 w-3.5" />} label="Emoji" />
        <PickerModeButton active={mode === 'custom'} onClick={() => { setMode('custom'); setQuery(''); }} icon={<Sticker className="h-3.5 w-3.5" />} label="Stickers" />
        <PickerModeButton active={false} onClick={() => {}} icon={<ImageIcon className="h-3.5 w-3.5" />} label="GIFs" muted />
      </div>

      <div className="telegram-emoji-search px-2.5 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5" />
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search" className="telegram-emoji-search-input h-8 pl-8 text-sm" />
        </div>
      </div>

      <div className="telegram-emoji-body flex-1 overflow-y-auto px-2 pb-2">
        {query ? (
          <div className="space-y-3">
            {mode === 'custom' && customSearchResults.length > 0 && (
              <EmojiSection title="Premium emoji">
                {customSearchResults.map(e => (
                  <CustomEmojiButton key={`${e.custom_emoji_id}:${assetVersion}`} id={e.custom_emoji_id} fallback={e.emoji} thumb={e.thumb_url} onClick={() => pickC(e.custom_emoji_id, e.emoji)} />
                ))}
              </EmojiSection>
            )}
            {searchResults.length > 0 && (
              <EmojiSection title="Emoji">
                {searchResults.slice(0, 160).map((e, i) => <UnicodeEmojiButton key={`${e}-${i}`} emoji={e} onClick={() => pickU(e)} />)}
              </EmojiSection>
            )}
            {customSearchResults.length === 0 && searchResults.length === 0 && <EmptyState text="No emoji found" />}
          </div>
        ) : mode === 'custom' ? (
          activeSet === 'recent' ? (
            recent.length === 0 ? <EmptyState text="Pick emojis to see them here" /> : (
              <EmojiSection title="Recently used">
                {recent.map((e, i) => e.type === 'u'
                  ? <UnicodeEmojiButton key={`${e.v}-${i}`} emoji={e.v} onClick={() => pickU(e.v)} />
                  : <CustomEmojiButton key={`${e.v}-${i}:${assetVersion}`} id={e.v} fallback={e.f || ''} onClick={() => pickC(e.v, e.f || '')} />
                )}
              </EmojiSection>
            )
          ) : activeSetData ? (
            <EmojiSection title={activeSetData.title} subtitle={`${activeSetData.emojis.length} premium emojis`}>
              {activeSetData.emojis.map(e => (
                <CustomEmojiButton key={`${e.custom_emoji_id}:${assetVersion}`} id={e.custom_emoji_id} fallback={e.emoji} thumb={e.thumb_url} onClick={() => pickC(e.custom_emoji_id, e.emoji)} />
              ))}
            </EmojiSection>
          ) : <EmptyState text="No synced premium emoji packs" />
        ) : (
          <EmojiSection title={activeUnicodeData.label}>
            {activeUnicodeData.emojis.map((e, i) => <UnicodeEmojiButton key={`${e}-${i}`} emoji={e} onClick={() => pickU(e)} />)}
          </EmojiSection>
        )}
      </div>

      <div className="telegram-emoji-footer flex items-center gap-1 overflow-x-auto px-2 py-1.5 scrollbar-hide">
        {mode === 'custom' ? (
          <>
            <FooterButton active={activeSet === 'recent'} onClick={() => setActiveSet('recent')} title="Recent"><Clock className="h-4 w-4" /></FooterButton>
            {sets.map((set) => {
              const first = set.emojis[0];
              return (
                <FooterButton key={set.set_name} active={activeSet === set.set_name} onClick={() => setActiveSet(set.set_name)} title={set.title}>
                  {first ? <TgEmoji id={first.custom_emoji_id} fallback={first.emoji || '⭐'} size={18} disableRemoteFetch /> : <Sticker className="h-4 w-4" />}
                </FooterButton>
              );
            })}
          </>
        ) : (
          EMOJI_CATEGORIES.map(cat => (
            <FooterButton key={cat.key} active={activeUnicode === cat.key} onClick={() => setActiveUnicode(cat.key)} title={cat.label}>
              <span className="text-base leading-none">{cat.icon}</span>
            </FooterButton>
          ))
        )}
      </div>
    </div>
  );
}

function CustomEmojiButton({ id, fallback, thumb, onClick }: { id: string; fallback: string; thumb?: string | null; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="telegram-emoji-cell" title={id}>
      {thumb ? <img src={thumb} alt={fallback || ''} className="h-[26px] w-[26px] object-contain" loading="lazy" /> : <TgEmoji id={id} fallback={fallback || '❓'} size={26} disableRemoteFetch />}
    </button>
  );
}

function UnicodeEmojiButton({ emoji, onClick }: { emoji: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="telegram-emoji-cell text-[25px] leading-none">{emoji}</button>;
}

function EmojiSection({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section>
      <div className="telegram-emoji-section-title flex items-center justify-between px-1 pb-1.5 pt-1">
        <span>{title}</span>
        {subtitle && <small>{subtitle}</small>}
      </div>
      <div className="telegram-emoji-grid">{children}</div>
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="telegram-emoji-empty">{text}</p>;
}

function PickerModeButton({ active, muted, onClick, icon, label }: { active: boolean; muted?: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} disabled={muted} className={cn('telegram-emoji-mode', active && 'is-active', muted && 'is-muted')}>
      {icon}<span>{label}</span>
    </button>
  );
}

function FooterButton({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={title} className={cn('telegram-emoji-footer-button', active && 'is-active')}>
      {children}
    </button>
  );
}
