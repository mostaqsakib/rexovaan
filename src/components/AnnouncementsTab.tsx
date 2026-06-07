import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Megaphone, Loader2, Trash2, Plus, Power, Info, AlertTriangle, Flame, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

interface Announcement {
  id: string;
  title: string;
  body: string | null;
  body_html: string | null;
  media_url: string | null;
  media_type: string | null;
  severity: string;
  show_as_banner: boolean;
  link_url: string | null;
  is_active: boolean;
  created_at: string;
  expires_at: string | null;
}

const SEVERITY_META: Record<string, { label: string; icon: typeof Info; cls: string }> = {
  info: { label: 'Info', icon: Info, cls: 'text-sky-500 bg-sky-500/10 border-sky-500/30' },
  warning: { label: 'Warning', icon: AlertTriangle, cls: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/30' },
  sale: { label: 'Sale', icon: Flame, cls: 'text-orange-500 bg-orange-500/10 border-orange-500/30' },
  success: { label: 'Success', icon: CheckCircle2, cls: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30' },
};

const AnnouncementsTab = () => {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState('info');
  const [showAsBanner, setShowAsBanner] = useState(true);
  const [linkUrl, setLinkUrl] = useState('');
  const [expiresHours, setExpiresHours] = useState('');

  const load = async () => {
    const { data } = await supabase.from('site_announcements').select('*').order('created_at', { ascending: false }).limit(100);
    setItems((data || []) as Announcement[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const handleCreate = async () => {
    if (!title.trim()) return toast.error('Title required');
    setSaving(true);
    const expires_at = expiresHours ? new Date(Date.now() + parseFloat(expiresHours) * 3600 * 1000).toISOString() : null;
    const raw = body.trim();
    const plain = raw
      .replace(/<tg-emoji[^>]*>([\s\S]*?)<\/tg-emoji>/gi, '$1')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .trim();
    const { error } = await supabase.from('site_announcements').insert({
      title: title.trim(),
      body: plain || null,
      body_html: raw || null,
      severity,
      show_as_banner: showAsBanner,
      link_url: linkUrl.trim() || null,
      expires_at,
      is_active: true,
    });
    if (error) toast.error(error.message);
    else {
      toast.success('Announcement posted to site');
      setTitle(''); setBody(''); setLinkUrl(''); setExpiresHours(''); setSeverity('info'); setShowAsBanner(true);
      void load();
    }
    setSaving(false);
  };

  const toggleActive = async (id: string, next: boolean) => {
    const { error } = await supabase.from('site_announcements').update({ is_active: next }).eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success(next ? 'Activated' : 'Deactivated'); void load(); }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this announcement permanently?')) return;
    const { error } = await supabase.from('site_announcements').delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success('Deleted'); void load(); }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Megaphone className="h-5 w-5 text-primary" /> New Site Announcement</CardTitle>
          <CardDescription>Notify website customers about updates, price changes, sales, or maintenance. Active items appear in the top banner and notification bell.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="🔥 50% off Netflix this weekend!" maxLength={120} />
            </div>
            <div className="space-y-2">
              <Label>Severity</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">ℹ️ Info (blue)</SelectItem>
                  <SelectItem value="success">✅ Success (green)</SelectItem>
                  <SelectItem value="sale">🔥 Sale (orange)</SelectItem>
                  <SelectItem value="warning">⚠️ Warning (yellow)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Body (optional)</Label>
            <Textarea value={body} onChange={e => setBody(e.target.value)} rows={4} placeholder={'Full details. HTML supported: <b>bold</b>, <i>italic</i>, <a href="...">link</a>, <tg-emoji emoji-id="ID">😀</tg-emoji>'} maxLength={2000} className="font-mono text-sm" />
            <p className="text-[11px] text-muted-foreground">Same format as bot broadcasts — supports premium custom emojis via <code>&lt;tg-emoji emoji-id="..."&gt;</code>.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Link URL (optional)</Label>
              <Input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="/p/netflix or https://..." />
            </div>
            <div className="space-y-2">
              <Label>Auto-expire after (hours, optional)</Label>
              <Input type="number" min="0.1" step="0.1" value={expiresHours} onChange={e => setExpiresHours(e.target.value)} placeholder="24" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={showAsBanner} onCheckedChange={c => setShowAsBanner(!!c)} />
            <span>Show as top banner (else only in notification bell)</span>
          </label>
          <Button onClick={handleCreate} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Post Announcement
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>All Announcements ({items.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No announcements yet.</p>
          ) : (
            <div className="space-y-2">
              {items.map(a => {
                const meta = SEVERITY_META[a.severity] || SEVERITY_META.info;
                const Icon = meta.icon;
                const expired = a.expires_at && new Date(a.expires_at).getTime() < Date.now();
                return (
                  <div key={a.id} className={`p-3 border rounded-md flex items-start justify-between gap-3 ${a.is_active && !expired ? 'border-border' : 'border-border/40 opacity-60'}`}>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border ${meta.cls}`}>
                          <Icon className="h-3 w-3" /> {meta.label}
                        </span>
                        {a.show_as_banner && <span className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted-foreground">Banner</span>}
                        {expired && <span className="text-[10px] px-2 py-0.5 rounded-full border border-destructive/30 text-destructive">Expired</span>}
                        {!a.is_active && <span className="text-[10px] px-2 py-0.5 rounded-full border border-muted text-muted-foreground">Inactive</span>}
                      </div>
                      <div className="font-medium text-sm truncate">{a.title}</div>
                      {a.body && <div className="text-xs text-muted-foreground line-clamp-2">{a.body}</div>}
                      <div className="text-[11px] text-muted-foreground">{new Date(a.created_at).toLocaleString()}{a.link_url ? ` • → ${a.link_url}` : ''}</div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => toggleActive(a.id, !a.is_active)} title={a.is_active ? 'Deactivate' : 'Activate'}>
                        <Power className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(a.id)} title="Delete">
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AnnouncementsTab;
