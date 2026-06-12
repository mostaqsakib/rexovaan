import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Trash2, Download, Plus, RefreshCw, AlertCircle, CheckCircle2, Infinity as InfinityIcon } from 'lucide-react';

type Cookie = { id: string; label: string; is_active: boolean; expired: boolean; last_verified_at: string | null; created_at: string };
type Product = { id: string; name: string; is_manual_delivery: boolean | null; link_check_auto?: boolean };
type Job = { id: string; product_id: string; status: string; total: number; checked: number; valid_count: number; invalid_count: number; error_count: number; error_text: string | null; created_at: string; started_at: string | null; finished_at: string | null; concurrency: number; delay_ms: number };
type InvalidStock = { id: string; product_id: string; data: any; invalid_reason: string | null; invalidated_at: string | null };

export default function LinkCheckerTab() {
  const [cookies, setCookies] = useState<Cookie[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [invalidStock, setInvalidStock] = useState<InvalidStock[]>([]);
  const [cookieDialogOpen, setCookieDialogOpen] = useState(false);
  const [productId, setProductId] = useState<string>('');
  const [concurrency, setConcurrency] = useState(2);
  const [delayMs, setDelayMs] = useState(5000);
  const [starting, setStarting] = useState(false);

  // Only allow this specific product in the Link Checker UI.
  const isAllowedProduct = (name: string) => {
    const n = (name || '').toLowerCase();
    return n.includes('jio') && n.includes('gemini') && n.includes('18');
  };

  const loadAll = async () => {
    const [c, p, j, inv] = await Promise.all([
      supabase.from('google_account_cookies').select('*').order('created_at', { ascending: false }),
      supabase.from('bot_products').select('id, name, is_manual_delivery, link_check_auto').eq('is_active', true).order('name'),
      supabase.from('link_check_jobs').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('bot_product_stock_items').select('id, product_id, data, invalid_reason, invalidated_at').eq('status', 'invalid').order('invalidated_at', { ascending: false }).limit(500),
    ]);
    setCookies((c.data as Cookie[]) || []);
    setProducts(((p.data as Product[]) || []).filter(prod => isAllowedProduct(prod.name)));
    setJobs((j.data as Job[]) || []);
    setInvalidStock((inv.data as InvalidStock[]) || []);
  };

  useEffect(() => { void loadAll(); }, []);

  // Realtime job updates
  useEffect(() => {
    const ch = supabase.channel('link-check-jobs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'link_check_jobs' }, () => void loadAll())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const startJob = async () => {
    if (!productId) { toast.error('Pick a product'); return; }
    const activeCookie = cookies.find(c => c.is_active && !c.expired);
    if (!activeCookie) { toast.error('Add active Google cookies first'); return; }
    setStarting(true);
    const { error } = await supabase.from('link_check_jobs').insert({
      product_id: productId,
      cookie_id: activeCookie.id,
      concurrency,
      delay_ms: delayMs,
      status: 'queued',
    });
    setStarting(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Job queued. Worker will pick it up shortly.');
    void loadAll();
  };

  const cancelJob = async (id: string) => {
    await supabase.from('link_check_jobs').update({ status: 'cancelled', finished_at: new Date().toISOString() }).eq('id', id);
    void loadAll();
  };

  const productName = (id: string) => products.find(p => p.id === id)?.name || id.slice(0, 8);

  const downloadInvalidTxt = (pid?: string) => {
    const rows = pid ? invalidStock.filter(s => s.product_id === pid) : invalidStock;
    const urls = rows.map(r => {
      const v = Object.values(r.data || {}).find((x: any) => typeof x === 'string' && x.startsWith('http'));
      return v as string;
    }).filter(Boolean);
    const blob = new Blob([urls.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `invalid-links-${pid ? productName(pid).replace(/\s+/g, '_') : 'all'}-${Date.now()}.txt`;
    a.click();
  };

  const clearInvalid = async (pid?: string) => {
    if (!confirm('Permanently delete invalid stock rows? This frees up the slot — re-add fresh links after.')) return;
    let q = supabase.from('bot_product_stock_items').delete().eq('status', 'invalid');
    if (pid) q = q.eq('product_id', pid);
    const { error } = await q;
    if (error) { toast.error(error.message); return; }
    toast.success('Cleared');
    void loadAll();
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="check" className="w-full">
        <TabsList>
          <TabsTrigger value="check">Run Check</TabsTrigger>
          <TabsTrigger value="cookies">Google Cookies ({cookies.length})</TabsTrigger>
          <TabsTrigger value="invalid">Invalid Archive ({invalidStock.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="check" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Start New Check</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <Label>Product</Label>
                  <Select value={productId} onValueChange={setProductId}>
                    <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                    <SelectContent>
                      {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Concurrency (1-2)</Label>
                  <Input type="number" min={1} max={2} value={concurrency} onChange={e => setConcurrency(Number(e.target.value))} />
                </div>
                <div>
                  <Label>Delay between checks (ms)</Label>
                  <Input type="number" min={1000} max={30000} step={500} value={delayMs} onChange={e => setDelayMs(Number(e.target.value))} />
                </div>
              </div>
              <Button onClick={startJob} disabled={starting}>Start Check</Button>
              {!cookies.some(c => c.is_active && !c.expired) && (
                <div className="flex items-center gap-2 text-sm text-warning"><AlertCircle className="h-4 w-4" /> No active cookies. Add Google cookies first.</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><InfinityIcon className="h-4 w-4" /> Auto-Loop (continuous check)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-xs text-muted-foreground mb-2">
                Toggle a product ON — worker will automatically re-check its full stock forever. When one round ends, it immediately starts the next. No manual click needed. (Telegram alert only sent when invalid links are found.)
              </div>
              {products.map(p => (
                <div key={p.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div className="font-medium text-sm">{p.name}</div>
                  <Switch
                    checked={!!p.link_check_auto}
                    onCheckedChange={async (v) => {
                      const { error } = await supabase.from('bot_products').update({ link_check_auto: v }).eq('id', p.id);
                      if (error) { toast.error(error.message); return; }
                      toast.success(v ? 'Auto-loop ON' : 'Auto-loop OFF');
                      void loadAll();
                    }}
                  />
                </div>
              ))}
            </CardContent>
          </Card>


          <Card>
            <CardHeader className="flex flex-row items-center justify-between"><CardTitle>Recent Jobs</CardTitle><Button size="sm" variant="ghost" onClick={loadAll}><RefreshCw className="h-4 w-4" /></Button></CardHeader>
            <CardContent className="space-y-3">
              {jobs.length === 0 && <div className="text-sm text-muted-foreground">No jobs yet.</div>}
              {jobs.map(j => {
                const pct = j.total > 0 ? Math.round((j.checked / j.total) * 100) : 0;
                return (
                  <div key={j.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="font-medium">{productName(j.product_id)}</div>
                      <div className="flex items-center gap-2">
                        <Badge variant={j.status === 'completed' ? 'default' : j.status === 'failed' ? 'destructive' : 'secondary'}>{j.status}</Badge>
                        {(j.status === 'queued' || j.status === 'running') && <Button size="sm" variant="ghost" onClick={() => cancelJob(j.id)}>Cancel</Button>}
                      </div>
                    </div>
                    <Progress value={pct} />
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span>{j.checked}/{j.total} checked</span>
                      <span className="text-success">✓ {j.valid_count} valid</span>
                      <span className="text-destructive">✗ {j.invalid_count} invalid</span>
                      {j.error_count > 0 && <span className="text-warning">! {j.error_count} errors</span>}
                      <span className="ml-auto">{new Date(j.created_at).toLocaleString()}</span>
                    </div>
                    {j.error_text && <div className="text-xs text-destructive">{j.error_text}</div>}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cookies" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Google Account Cookies</CardTitle>
              <Button size="sm" onClick={() => setCookieDialogOpen(true)}><Plus className="h-4 w-4 mr-1" /> Add</Button>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-xs text-muted-foreground mb-2">
                Export cookies from a logged-in Chrome session using the "Cookie-Editor" or "EditThisCookie" extension on <code>one.google.com</code>. Export as JSON, then paste below. Cookies are stored encrypted at rest in Supabase.
              </div>
              {cookies.length === 0 && <div className="text-sm text-muted-foreground">No cookies saved.</div>}
              {cookies.map(c => (
                <div key={c.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {c.label}
                      {c.is_active && !c.expired && <Badge variant="default" className="text-xs"><CheckCircle2 className="h-3 w-3 mr-1" />Active</Badge>}
                      {c.expired && <Badge variant="destructive" className="text-xs">Expired</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">Added {new Date(c.created_at).toLocaleString()}{c.last_verified_at ? ` · Last verified ${new Date(c.last_verified_at).toLocaleString()}` : ''}</div>
                  </div>
                  <div className="flex gap-2">
                    {!c.is_active && <Button size="sm" variant="outline" onClick={async () => {
                      await supabase.from('google_account_cookies').update({ is_active: false }).neq('id', c.id);
                      await supabase.from('google_account_cookies').update({ is_active: true, expired: false }).eq('id', c.id);
                      void loadAll();
                    }}>Set Active</Button>}
                    <Button size="sm" variant="ghost" onClick={async () => {
                      if (!confirm('Delete?')) return;
                      await supabase.from('google_account_cookies').delete().eq('id', c.id);
                      void loadAll();
                    }}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invalid" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Invalid Links Archive</CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => downloadInvalidTxt()}><Download className="h-4 w-4 mr-1" /> Download All</Button>
                <Button size="sm" variant="destructive" onClick={() => clearInvalid()}>Clear All</Button>
              </div>
            </CardHeader>
            <CardContent>
              {invalidStock.length === 0 && <div className="text-sm text-muted-foreground">No invalid links archived.</div>}
              {Object.entries(invalidStock.reduce<Record<string, InvalidStock[]>>((acc, s) => {
                (acc[s.product_id] ||= []).push(s); return acc;
              }, {})).map(([pid, rows]) => (
                <div key={pid} className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-medium">{productName(pid)} <span className="text-muted-foreground text-sm">({rows.length})</span></div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => downloadInvalidTxt(pid)}><Download className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => clearInvalid(pid)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                  <div className="space-y-1 max-h-64 overflow-auto">
                    {rows.slice(0, 50).map(r => {
                      const url = Object.values(r.data || {}).find((x: any) => typeof x === 'string' && x.startsWith('http')) as string;
                      return (
                        <div key={r.id} className="text-xs font-mono p-2 rounded bg-muted/50 break-all">
                          <div className="truncate">{url}</div>
                          {r.invalid_reason && <div className="text-destructive mt-1">{r.invalid_reason}</div>}
                        </div>
                      );
                    })}
                    {rows.length > 50 && <div className="text-xs text-muted-foreground">+{rows.length - 50} more (use Download)</div>}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AddCookieDialog open={cookieDialogOpen} onClose={() => { setCookieDialogOpen(false); void loadAll(); }} />
    </div>
  );
}

function AddCookieDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [label, setLabel] = useState('Main account');
  const [json, setJson] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    let parsed: any;
    try { parsed = JSON.parse(json); } catch { toast.error('Invalid JSON'); return; }
    if (!Array.isArray(parsed)) { toast.error('Expected JSON array of cookies'); return; }
    setSaving(true);
    // deactivate others, insert new as active
    await supabase.from('google_account_cookies').update({ is_active: false }).neq('id', '00000000-0000-0000-0000-000000000000');
    const { error } = await supabase.from('google_account_cookies').insert({ label, cookies_json: parsed, is_active: true });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Cookies saved');
    setJson(''); setLabel('Main account');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Add Google Cookies</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Label</Label>
            <Input value={label} onChange={e => setLabel(e.target.value)} />
          </div>
          <div>
            <Label>Cookies JSON (export from Cookie-Editor extension)</Label>
            <Textarea value={json} onChange={e => setJson(e.target.value)} rows={12} placeholder='[{"name":"SID","value":"...","domain":".google.com",...}]' className="font-mono text-xs" />
            <div className="text-xs text-muted-foreground mt-1">
              Open <code>one.google.com</code> in Chrome (logged in) → Cookie-Editor extension → Export → JSON → paste here.
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !json.trim()}>Save & Activate</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
