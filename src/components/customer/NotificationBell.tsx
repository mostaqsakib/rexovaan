import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Info, AlertTriangle, Flame, CheckCircle2, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useCustomerAuth } from '@/contexts/CustomerAuthContext';
import { TelegramRichText, preloadCustomEmojis } from '@/components/TelegramRichText';

interface Announcement {
  id: string;
  title: string;
  body: string | null;
  body_html: string | null;
  media_url: string | null;
  media_type: string | null;
  severity: string;
  link_url: string | null;
  created_at: string;
}

const META: Record<string, { icon: typeof Info; cls: string }> = {
  info:    { icon: Info,          cls: 'text-sky-400 bg-sky-500/10' },
  warning: { icon: AlertTriangle, cls: 'text-yellow-400 bg-yellow-500/10' },
  sale:    { icon: Flame,         cls: 'text-orange-400 bg-orange-500/10' },
  success: { icon: CheckCircle2,  cls: 'text-emerald-400 bg-emerald-500/10' },
};

const GUEST_KEY = 'read_announcements_guest';

export function NotificationBell() {
  const { customer } = useCustomerAuth();
  const [items, setItems] = useState<Announcement[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const loadReads = async () => {
    if (customer?.id) {
      const { data } = await supabase.from('customer_announcement_reads').select('announcement_id').eq('customer_id', customer.id);
      setReadIds(new Set((data || []).map((r: any) => r.announcement_id)));
    } else {
      try { setReadIds(new Set(JSON.parse(localStorage.getItem(GUEST_KEY) || '[]'))); } catch { setReadIds(new Set()); }
    }
  };

  useEffect(() => {
    supabase.from('site_announcements')
      .select('id,title,body,body_html,media_url,media_type,severity,link_url,created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        const rows = (data || []) as Announcement[];
        setItems(rows);
        // Preload premium emoji info from any tg-emoji tags
        const ids: string[] = [];
        const re = /<tg-emoji[^>]*emoji-id=["']([^"']+)["'][^>]*>/gi;
        for (const r of rows) {
          const src = `${r.title || ''}\n${r.body_html || ''}`;
          let m: RegExpExecArray | null;
          while ((m = re.exec(src)) !== null) ids.push(m[1]);
        }
        if (ids.length) void preloadCustomEmojis(ids);
      });
    void loadReads();
  }, [customer?.id]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (open && ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const markRead = async (id: string) => {
    if (readIds.has(id)) return;
    const next = new Set(readIds); next.add(id);
    setReadIds(next);
    if (customer?.id) {
      await supabase.from('customer_announcement_reads').insert({ customer_id: customer.id, announcement_id: id });
    } else {
      try { localStorage.setItem(GUEST_KEY, JSON.stringify([...next])); } catch {}
    }
  };

  const markAllRead = async () => {
    const ids = items.map(i => i.id).filter(id => !readIds.has(id));
    if (ids.length === 0) return;
    const next = new Set(readIds); ids.forEach(id => next.add(id));
    setReadIds(next);
    if (customer?.id) {
      await supabase.from('customer_announcement_reads').insert(ids.map(id => ({ customer_id: customer.id, announcement_id: id })));
    } else {
      try { localStorage.setItem(GUEST_KEY, JSON.stringify([...next])); } catch {}
    }
  };

  const unread = items.filter(i => !readIds.has(i.id)).length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.08] hover:border-primary/40 transition-all"
        title="Notifications"
      >
        <Bell className="h-4 w-4 text-muted-foreground" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center ring-2 ring-background">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[320px] sm:w-[380px] max-h-[70vh] overflow-hidden rounded-2xl border border-white/[0.08] bg-[hsl(var(--background))]/95 backdrop-blur-2xl shadow-2xl z-50 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
            <div className="font-semibold text-sm">Notifications</div>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                <Check className="h-3 w-3" /> Mark all read
              </button>
            )}
          </div>
          <div className="overflow-y-auto flex-1">
            {items.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No notifications yet.</div>
            ) : (
              items.map(it => {
                const meta = META[it.severity] || META.info;
                const Icon = meta.icon;
                const isRead = readIds.has(it.id);
                const isExternal = it.link_url && /^https?:\/\//.test(it.link_url);
                const inner = (
                  <div className={`flex gap-3 px-4 py-3 border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors ${!isRead ? 'bg-primary/[0.04]' : ''}`}>
                    <div className={`h-8 w-8 shrink-0 rounded-lg flex items-center justify-center ${meta.cls}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium leading-snug flex items-start gap-2">
                        <TelegramRichText html={it.title} inline className="flex-1" />
                        {!isRead && <span className="mt-1 h-2 w-2 rounded-full bg-primary shrink-0" />}
                      </div>
                      {it.media_url && (
                        it.media_type === 'video' ? (
                          <video src={it.media_url} className="mt-2 max-h-40 w-full rounded-md border border-white/10 object-cover" controls preload="metadata" />
                        ) : (
                          <img src={it.media_url} alt="" className="mt-2 max-h-40 w-full rounded-md border border-white/10 object-cover" loading="lazy" />
                        )
                      )}
                      {(it.body_html || it.body) && (
                        <div className="text-xs text-muted-foreground mt-1">
                          <TelegramRichText html={it.body_html || it.body || ''} className="tg-content-sm" />
                        </div>
                      )}
                      <div className="text-[10px] text-muted-foreground/70 mt-1">{new Date(it.created_at).toLocaleString()}</div>
                    </div>
                  </div>
                );
                const handle = () => { void markRead(it.id); setOpen(false); };
                if (it.link_url) {
                  return isExternal ? (
                    <a key={it.id} href={it.link_url} target="_blank" rel="noopener noreferrer" onClick={handle}>{inner}</a>
                  ) : (
                    <Link key={it.id} to={it.link_url} onClick={handle}>{inner}</Link>
                  );
                }
                return <button key={it.id} onClick={handle} className="w-full text-left">{inner}</button>;
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
