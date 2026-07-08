import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Sparkles, Trash2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface StickerSet { set_name: string; title: string; emojis: any[]; fetched_at: string }

export default function EmojiPacksSettings() {
  const [sets, setSets] = useState<StickerSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [newName, setNewName] = useState('');

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('bot_emoji_sticker_sets').select('*').order('title');
    if (!error) setSets((data || []) as any);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const syncSets = async (names: string[]) => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('list-my-emoji-sticker-sets', {
        body: { set_names: names },
      });
      if (error) throw error;
      const errs = (data?.sets || []).filter((s: any) => s.error);
      if (errs.length) toast.warning(`Some failed: ${errs.map((e: any) => e.set_name).join(', ')}`);
      else toast.success('Emoji packs synced');
      await load();
    } catch (e: any) {
      toast.error(e.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const addPack = async () => {
    const n = newName.trim().replace(/^https?:\/\/t\.me\/addemoji\//, '').replace(/^@/, '');
    if (!n) return;
    setNewName('');
    await syncSets([n]);
  };

  const removePack = async (name: string) => {
    if (!confirm(`Remove pack "${name}" from picker?`)) return;
    const { error } = await supabase.from('bot_emoji_sticker_sets').delete().eq('set_name', name);
    if (error) toast.error(error.message);
    else { toast.success('Removed'); load(); }
  };

  const refreshAll = () => syncSets(sets.map(s => s.set_name));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          Custom Emoji Packs (Your Telegram)
        </CardTitle>
        <CardDescription>
          Apnar Telegram account e save kora emoji pack er short name diye add korun (e.g. <code>AnimatedEmojies</code>). Ei sob emoji admin editor gulor emoji panel e ashbe.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="Emoji pack short name or t.me/addemoji/... link"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addPack()}
          />
          <Button onClick={addPack} disabled={syncing || !newName.trim()} className="gap-2">
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Add
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : sets.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No packs yet. Add your first emoji pack above.</p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{sets.length} pack{sets.length === 1 ? '' : 's'} synced</p>
              <Button size="sm" variant="ghost" onClick={refreshAll} disabled={syncing} className="gap-1.5 h-7">
                {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Refresh all
              </Button>
            </div>
            <div className="space-y-2">
              {sets.map(s => (
                <div key={s.set_name} className="flex items-center gap-3 rounded-md border p-2">
                  <div className="flex gap-1 shrink-0">
                    {(s.emojis || []).slice(0, 4).map((e: any) => (
                      e.thumb_url
                        ? <img key={e.custom_emoji_id} src={e.thumb_url} className="h-6 w-6 rounded" alt="" loading="lazy" />
                        : <span key={e.custom_emoji_id} className="text-lg leading-none">{e.emoji}</span>
                    ))}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{s.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{s.set_name} · {(s.emojis || []).length} emojis</p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removePack(s.set_name)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
