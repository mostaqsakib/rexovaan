import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { X, Info, AlertTriangle, Flame, CheckCircle2 } from 'lucide-react';
import { TelegramRichText, preloadCustomEmojis } from '@/components/TelegramRichText';

interface Announcement {
  id: string;
  title: string;
  severity: string;
  link_url: string | null;
  expires_at: string | null;
}

const META: Record<string, { icon: typeof Info; cls: string }> = {
  info:    { icon: Info,           cls: 'from-sky-500/20 via-sky-500/10 to-transparent border-sky-500/30 text-sky-100' },
  warning: { icon: AlertTriangle,  cls: 'from-yellow-500/25 via-yellow-500/10 to-transparent border-yellow-500/40 text-yellow-100' },
  sale:    { icon: Flame,          cls: 'from-orange-500/25 via-orange-500/10 to-transparent border-orange-500/40 text-orange-100' },
  success: { icon: CheckCircle2,   cls: 'from-emerald-500/25 via-emerald-500/10 to-transparent border-emerald-500/40 text-emerald-100' },
};

const DISMISS_KEY = 'dismissed_announcements';

export function AnnouncementBanner() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); } catch { return new Set(); }
  });

  useEffect(() => {
    supabase
      .from('site_announcements')
      .select('id,title,severity,link_url,expires_at')
      .eq('is_active', true)
      .eq('show_as_banner', true)
      .order('created_at', { ascending: false })
      .limit(5)
      .then(({ data }) => {
        const now = Date.now();
        const rows = ((data || []) as Announcement[]).filter(a => !a.expires_at || new Date(a.expires_at).getTime() > now);
        setItems(rows);
        const ids: string[] = [];
        const re = /<tg-emoji[^>]*emoji-id=["']([^"']+)["'][^>]*>/gi;
        for (const r of rows) { let m: RegExpExecArray | null; while ((m = re.exec(r.title || '')) !== null) ids.push(m[1]); }
        if (ids.length) void preloadCustomEmojis(ids);
      });
  }, []);

  const dismiss = (id: string) => {
    const next = new Set(dismissed); next.add(id);
    setDismissed(next);
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...next])); } catch {}
  };

  const visible = items.find(a => !dismissed.has(a.id));
  if (!visible) return null;

  const meta = META[visible.severity] || META.info;
  const Icon = meta.icon;
  const isExternal = visible.link_url && /^https?:\/\//.test(visible.link_url);

  const Content = (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border bg-gradient-to-r ${meta.cls} backdrop-blur-sm`}>
      <Icon className="h-4 w-4 shrink-0" />
      <TelegramRichText html={visible.title} inline className="text-sm font-medium flex-1 truncate" />
      {visible.link_url && <span className="text-xs underline opacity-80 hidden sm:inline">View</span>}
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); dismiss(visible.id); }}
        className="ml-1 p-1 rounded-md hover:bg-white/10 transition-colors shrink-0"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 pt-2">
      {visible.link_url ? (
        isExternal ? (
          <a href={visible.link_url} target="_blank" rel="noopener noreferrer" className="block">{Content}</a>
        ) : (
          <Link to={visible.link_url} className="block">{Content}</Link>
        )
      ) : Content}
    </div>
  );
}
