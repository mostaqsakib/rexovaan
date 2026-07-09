import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { EMOJI_CATEGORIES, searchEmojis } from './emoji-data';
import { Input } from '@/components/ui/input';
import { Search, Clock, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TgEmoji } from '@/components/TelegramRichText';

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
  const [tab, setTab] = useState<string>('recent');
  const [query, setQuery] = useState('');
  const [sets, setSets] = useState<StickerSet[]>([]);
  const [recent, setRecent] = useState(loadRecent());

  useEffect(() => {
    supabase.from('bot_emoji_sticker_sets').select('*').order('title')
      .then(({ data }) => setSets((data || []) as any));
  }, []);

  const searchResults = useMemo(() => searchEmojis(query), [query]);

  const pickU = (e: string) => { saveRecent({ type: 'u', v: e }); setRecent(loadRecent()); onPickUnicode(e); };
  const pickC = (id: string, f: string) => { saveRecent({ type: 'c', v: id, f }); setRecent(loadRecent()); onPickCustom(id, f); };

  const tabs = [
    { key: 'recent', icon: <Clock className="h-4 w-4" /> },
    ...sets.map(s => ({ key: `set:${s.set_name}`, icon: <Sparkles className="h-4 w-4" /> })),
    ...EMOJI_CATEGORIES.map(c => ({ key: c.key, icon: <span className="text-base leading-none">{c.icon}</span> })),
  ];

  return (
    <div className="w-[340px] h-[380px] flex flex-col bg-popover border rounded-md shadow-lg overflow-hidden">
      {/* Tabs */}
      <div className="flex items-center gap-0.5 overflow-x-auto border-b bg-muted/40 px-1 py-1 scrollbar-none">
        {tabs.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => { setTab(t.key); setQuery(''); }}
            className={cn(
              'shrink-0 h-8 w-8 rounded flex items-center justify-center hover:bg-accent transition-colors',
              tab === t.key && 'bg-accent'
            )}
            aria-label={t.key}
          >
            {t.icon}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-2">
        {query ? (
          <div className="grid grid-cols-8 gap-1">
            {searchResults.slice(0, 200).map((e, i) => (
              <button key={i} type="button" onClick={() => pickU(e)} className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded text-xl leading-none">
                {e}
              </button>
            ))}
            {searchResults.length === 0 && <p className="col-span-8 text-center text-xs text-muted-foreground py-6">No matches</p>}
          </div>
        ) : tab === 'recent' ? (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 px-1">Recently Used</div>
            {recent.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-6">Pick some emojis to see them here</p>
            ) : (
              <div className="grid grid-cols-8 gap-1">
                {recent.map((e, i) =>
                  e.type === 'u' ? (
                    <button key={i} type="button" onClick={() => pickU(e.v)} className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded text-xl leading-none">{e.v}</button>
                  ) : (
                    <CustomEmojiButton key={i} id={e.v} fallback={e.f || ''} onClick={() => pickC(e.v, e.f || '')} />
                  )
                )}
              </div>
            )}
          </div>
        ) : tab.startsWith('set:') ? (
          (() => {
            const set = sets.find(s => `set:${s.set_name}` === tab);
            if (!set) return null;
            return (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 px-1">{set.title}</div>
                <div className="grid grid-cols-8 gap-1">
                  {set.emojis.map(e => (
                    <CustomEmojiButton key={e.custom_emoji_id} id={e.custom_emoji_id} fallback={e.emoji} thumb={e.thumb_url} onClick={() => pickC(e.custom_emoji_id, e.emoji)} />
                  ))}
                </div>
              </div>
            );
          })()
        ) : (
          EMOJI_CATEGORIES.filter(c => c.key === tab).map(cat => (
            <div key={cat.key}>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 px-1">{cat.label}</div>
              <div className="grid grid-cols-8 gap-1">
                {cat.emojis.map((e, i) => (
                  <button key={i} type="button" onClick={() => pickU(e)} className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded text-xl leading-none">{e}</button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Search */}
      <div className="border-t p-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search" className="h-8 pl-7 text-sm" />
        </div>
      </div>
    </div>
  );
}

function CustomEmojiButton({ id, fallback, thumb, onClick }: { id: string; fallback: string; thumb?: string | null; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded" title={id}>
      {thumb ? <img src={thumb} alt={fallback} className="h-6 w-6 object-contain" loading="lazy" /> : <span className="text-xl leading-none">{fallback || '❓'}</span>}
    </button>
  );
}
