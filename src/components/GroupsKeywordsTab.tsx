import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Plus, Loader2, Users, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import type { Product } from '@/types/product';

interface Group { id: string; chat_id: number; title: string | null; is_active: boolean; }
interface Trigger { id: string; keyword: string; product_id: string; is_active: boolean; }

const GroupsKeywordsTab = ({ products }: { products: Product[] }) => {
  const [groups, setGroups] = useState<Group[]>([]);
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyword, setNewKeyword] = useState('');
  const [newProductId, setNewProductId] = useState('');

  const load = async () => {
    setLoading(true);
    const [g, t] = await Promise.all([
      supabase.from('bot_broadcast_groups' as any).select('*').order('created_at', { ascending: false }),
      supabase.from('bot_keyword_triggers' as any).select('*').order('created_at', { ascending: false }),
    ]);
    setGroups((g.data as any) || []);
    setTriggers((t.data as any) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggleGroup = async (g: Group) => {
    await supabase.from('bot_broadcast_groups' as any).update({ is_active: !g.is_active }).eq('id', g.id);
    load();
  };
  const removeGroup = async (g: Group) => {
    await supabase.from('bot_broadcast_groups' as any).delete().eq('id', g.id);
    toast.success('Group removed');
    load();
  };

  const addTrigger = async () => {
    const kw = newKeyword.trim().toLowerCase();
    if (!kw || !newProductId) { toast.error('Enter keyword & select product'); return; }
    const { error } = await supabase.from('bot_keyword_triggers' as any).insert({ keyword: kw, product_id: newProductId });
    if (error) { toast.error(error.message); return; }
    setNewKeyword(''); setNewProductId('');
    toast.success('Keyword added');
    load();
  };
  const toggleTrigger = async (t: Trigger) => {
    await supabase.from('bot_keyword_triggers' as any).update({ is_active: !t.is_active }).eq('id', t.id);
    load();
  };
  const removeTrigger = async (t: Trigger) => {
    await supabase.from('bot_keyword_triggers' as any).delete().eq('id', t.id);
    toast.success('Keyword removed');
    load();
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg"><Users className="h-5 w-5 text-primary" />Broadcast Groups</CardTitle>
          <CardDescription>
            Add the bot as admin to your Telegram group — it will be auto-detected and listed here. All broadcasts (new product, stock alerts, price changes, manual broadcast) will be sent to active groups.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No groups yet. Add the bot to a group as admin.</p>
          ) : (
            <div className="space-y-2">
              {groups.map(g => (
                <div key={g.id} className="flex items-center gap-3 p-3 rounded-md border border-border">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{g.title || 'Untitled group'}</p>
                    <p className="text-xs text-muted-foreground">ID: <code>{g.chat_id}</code></p>
                  </div>
                  <Switch checked={g.is_active} onCheckedChange={() => toggleGroup(g)} />
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeGroup(g)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg"><KeyRound className="h-5 w-5 text-primary" />Keyword Triggers</CardTitle>
          <CardDescription>
            When someone mentions a keyword in a group (case-insensitive, contains-match), the bot replies with a buy button for the linked product. Multiple matches send multiple buttons.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-end">
            <div>
              <Label className="text-xs">Keyword</Label>
              <Input value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} placeholder="e.g. netflix" />
            </div>
            <div>
              <Label className="text-xs">Product</Label>
              <Select value={newProductId} onValueChange={setNewProductId}>
                <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                <SelectContent>
                  {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={addTrigger} className="gap-1.5"><Plus className="h-4 w-4" />Add</Button>
          </div>
          {triggers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No keywords configured yet.</p>
          ) : (
            <div className="space-y-2">
              {triggers.map(t => {
                const prod = products.find(p => p.id === t.product_id);
                return (
                  <div key={t.id} className="flex items-center gap-3 p-3 rounded-md border border-border">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium"><code className="bg-muted px-1.5 py-0.5 rounded">{t.keyword}</code> → {prod?.name || '(deleted)'}</p>
                    </div>
                    <Switch checked={t.is_active} onCheckedChange={() => toggleTrigger(t)} />
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeTrigger(t)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
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

export default GroupsKeywordsTab;
