import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Trash2, Plus, Loader2, Server, Download, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface Source {
  id: string; name: string; kind: string; base_url: string; api_key: string;
  auth_header: string; auth_prefix: string; is_active: boolean;
  last_balance: number | null; last_checked_at: string | null;
}
interface RemoteProduct { id: string; name: string; price: number; currency: string; stock: number; description: string | null; }

const empty = { name: '', kind: 'lovable', base_url: '', api_key: '', auth_header: 'Authorization', auth_prefix: 'Bearer ', is_active: true };

const SourcesTab = () => {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<any>(empty);
  const [browseSource, setBrowseSource] = useState<Source | null>(null);
  const [remoteProducts, setRemoteProducts] = useState<RemoteProduct[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('bot_product_sources' as any).select('*').order('created_at', { ascending: false });
    setSources((data as any) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const callFn = (body: any) => supabase.functions.invoke('product-sources', { body });

  const testAndSave = async () => {
    if (!form.name || !form.base_url || !form.api_key) { toast.error('Fill all required fields'); return; }
    setBusy(true);
    const { data, error } = await callFn({ action: 'test', source: form });
    if (error || !(data as any)?.ok) {
      toast.error((data as any)?.error || error?.message || 'Connection failed');
      setBusy(false); return;
    }
    const { error: insErr } = await supabase.from('bot_product_sources' as any).insert(form);
    if (insErr) toast.error(insErr.message);
    else { toast.success(`Connected — ${(data as any).products.length} products available`); setForm(empty); setAdding(false); load(); }
    setBusy(false);
  };

  const removeSource = async (s: Source) => {
    if (!confirm(`Remove "${s.name}"? Products imported from it will keep working but lose live sync.`)) return;
    await supabase.from('bot_product_sources' as any).delete().eq('id', s.id);
    toast.success('Removed');
    load();
  };

  const toggleSource = async (s: Source) => {
    await supabase.from('bot_product_sources' as any).update({ is_active: !s.is_active }).eq('id', s.id);
    load();
  };

  const browse = async (s: Source) => {
    setBrowseSource(s); setRemoteProducts([]); setSelected(new Set()); setBusy(true);
    const { data, error } = await callFn({ action: 'list', source_id: s.id });
    if (error || !(data as any)?.ok) toast.error((data as any)?.error || 'Failed to fetch');
    else setRemoteProducts((data as any).products || []);
    setBusy(false);
  };

  const importSelected = async () => {
    if (!browseSource || selected.size === 0) return;
    setBusy(true);
    const { data, error } = await callFn({ action: 'import', source_id: browseSource.id, product_ids: Array.from(selected) });
    if (error || !(data as any)?.ok) toast.error((data as any)?.error || 'Import failed');
    else {
      toast.success(`Imported ${(data as any).imported.length} products. Set their prices in the Pricing tab.`);
      setBrowseSource(null);
    }
    setBusy(false);
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3 flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg"><Server className="h-5 w-5 text-primary" />Product Sources</CardTitle>
            <CardDescription>Connect to other bots' APIs and import their products. Auto-syncs every 2 min — use Sync Now to refresh instantly.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={async () => {
              setBusy(true);
              const { data, error } = await callFn({ action: 'sync_all' });
              if (error || !(data as any)?.ok) toast.error((data as any)?.error || error?.message || 'Sync failed');
              else {
                const r = (data as any).results || [];
                const ok = r.filter((x: any) => x.ok).length;
                toast.success(`Synced ${ok}/${r.length} sources`);
                load();
              }
              setBusy(false);
            }} disabled={busy} className="gap-1.5"><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Sync Now</Button>
            <Button size="sm" onClick={() => setAdding(true)} className="gap-1.5"><Plus className="h-4 w-4" />Add Source</Button>
          </div>
        </CardHeader>
        <CardContent>
          {sources.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No sources connected yet.</p>
          ) : (
            <div className="space-y-2">
              {sources.map(s => (
                <div key={s.id} className="flex items-center gap-3 p-3 rounded-md border border-border">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{s.name} <span className="text-xs text-muted-foreground">({s.kind})</span></p>
                    <p className="text-xs text-muted-foreground truncate">{s.base_url}</p>
                    {s.last_balance !== null && <p className="text-xs text-muted-foreground">Balance: <b>{Number(s.last_balance).toFixed(2)} USDT</b></p>}
                  </div>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => browse(s)}><Download className="h-3.5 w-3.5" />Browse</Button>
                  <Switch checked={s.is_active} onCheckedChange={() => toggleSource(s)} />
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeSource(s)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add source dialog */}
      <Dialog open={adding} onOpenChange={(o) => !o && setAdding(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Product Source</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Main Supplier Bot" /></div>
            <div><Label>Type</Label>
              <Select value={form.kind} onValueChange={v => setForm({ ...form, kind: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lovable">Lovable bot (same system as mine)</SelectItem>
                  <SelectItem value="custom">Custom API (manual endpoint)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Base URL</Label><Input value={form.base_url} onChange={e => setForm({ ...form, base_url: e.target.value })} placeholder={form.kind === 'lovable' ? 'https://xxx.supabase.co/functions/v1/reseller-api' : 'https://api.example.com/products'} /></div>
            <div><Label>API Key</Label><Input type="password" value={form.api_key} onChange={e => setForm({ ...form, api_key: e.target.value })} /></div>
            {form.kind === 'custom' && (
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">Auth header</Label><Input value={form.auth_header} onChange={e => setForm({ ...form, auth_header: e.target.value })} /></div>
                <div><Label className="text-xs">Prefix</Label><Input value={form.auth_prefix} onChange={e => setForm({ ...form, auth_prefix: e.target.value })} /></div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
            <Button onClick={testAndSave} disabled={busy} className="gap-1.5">{busy && <Loader2 className="h-4 w-4 animate-spin" />}Test & Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Browse & import dialog */}
      <Dialog open={!!browseSource} onOpenChange={(o) => !o && setBrowseSource(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2 pr-6">
              <span>Products from {browseSource?.name}</span>
              <Button variant="ghost" size="sm" onClick={() => browseSource && browse(browseSource)} disabled={busy} className="gap-1.5"><RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />Refresh</Button>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-1 -mx-2 px-2">
            {busy && remoteProducts.length === 0 && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
            {remoteProducts.map(p => (
              <label key={p.id} className="flex items-center gap-3 p-2.5 rounded-md border border-border hover:bg-muted/40 cursor-pointer">
                <Checkbox checked={selected.has(p.id)} onCheckedChange={(c) => { const n = new Set(selected); if (c) n.add(p.id); else n.delete(p.id); setSelected(n); }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="text-xs text-muted-foreground">Cost: <b>{p.price.toFixed(2)} {p.currency}</b> · Stock: <b>{p.stock}</b></p>
                </div>
              </label>
            ))}
            {!busy && remoteProducts.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No products available.</p>}
          </div>
          <DialogFooter className="border-t border-border pt-3">
            <p className="text-xs text-muted-foreground mr-auto self-center">{selected.size} selected · prices set after import</p>
            <Button onClick={importSelected} disabled={selected.size === 0 || busy} className="gap-1.5"><Download className="h-4 w-4" />Import Selected</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SourcesTab;
