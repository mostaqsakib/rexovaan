import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Trash2, Download, RefreshCw, Infinity as InfinityIcon } from 'lucide-react';

type Cookie = { id: string; label: string; is_active: boolean; expired: boolean; last_verified_at: string | null; created_at: string };
type Product = { id: string; name: string; is_manual_delivery: boolean | null; link_check_auto?: boolean };
type Job = { id: string; product_id: string; status: string; total: number; checked: number; valid_count: number; invalid_count: number; error_count: number; error_text: string | null; created_at: string; started_at: string | null; finished_at: string | null; concurrency: number; delay_ms: number };
type InvalidStock = { id: string; product_id: string; data: any; invalid_reason: string | null; invalidated_at: string | null; invalidated_job_id: string | null };

export default function LinkCheckerTab() {
  const [cookies, setCookies] = useState<Cookie[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [invalidStock, setInvalidStock] = useState<InvalidStock[]>([]);
  const [productId, setProductId] = useState<string>('');
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
      supabase.from('bot_product_stock_items').select('id, product_id, data, invalid_reason, invalidated_at, invalidated_job_id').eq('status', 'invalid').order('invalidated_at', { ascending: false }).limit(500),
    ]);
    setCookies((c.data as Cookie[]) || []);
    setProducts(((p.data as Product[]) || []).filter(prod => isAllowedProduct(prod.name)));
    setJobs((j.data as Job[]) || []);
    setInvalidStock((inv.data as InvalidStock[]) || []);
  };

  // Light reload — only jobs (used by realtime to avoid hammering heavy queries)
  const loadJobsOnly = async () => {
    const { data } = await supabase
      .from('link_check_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    setJobs((data as Job[]) || []);
  };

  useEffect(() => { void loadAll(); }, []);

  // Realtime job updates — throttled (max 1s) so continuous progress ticks still surface
  useEffect(() => {
    let lastRun = 0;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const trigger = () => {
      const now = Date.now();
      const elapsed = now - lastRun;
      const run = () => { lastRun = Date.now(); pending = null; void loadJobsOnly(); };
      if (elapsed >= 1000) {
        run();
      } else if (!pending) {
        pending = setTimeout(run, 1000 - elapsed);
      }
    };
    const ch = supabase.channel('link-check-jobs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'link_check_jobs' }, trigger)
      .subscribe();
    // Fallback poll every 3s in case realtime events are missed under load
    const poll = setInterval(() => { void loadJobsOnly(); }, 3000);
    return () => { if (pending) clearTimeout(pending); clearInterval(poll); supabase.removeChannel(ch); };
  }, []);

  const startJob = async () => {
    if (!productId) { toast.error('Pick a product'); return; }
    const activeCookie = cookies.find(c => c.is_active && !c.expired);
    setStarting(true);
    const { error } = await supabase.from('link_check_jobs').insert({
      product_id: productId,
      cookie_id: activeCookie?.id ?? null,
      concurrency: 5,
      delay_ms: 800,
      status: 'vps_queued',
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
          <TabsTrigger value="invalid">Invalid Archive ({invalidStock.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="check" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Start New Check</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Product</Label>
                <Select value={productId} onValueChange={setProductId}>
                  <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                  <SelectContent>
                    {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={startJob} disabled={starting}>Start Check</Button>
              <div className="text-xs text-muted-foreground">Worker uses optimized defaults. Bot uses the persistent Google profile.</div>
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


          {jobs.filter(j => j.status === 'running').map(j => {
            const pct = j.total > 0 ? Math.round((j.checked / j.total) * 100) : 0;
            return (
              <Card key={j.id} className="border-primary/50">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><RefreshCw className="h-4 w-4 animate-spin" /> Running Job — {productName(j.product_id)}</CardTitle>
                  <Button size="sm" variant="ghost" onClick={() => cancelJob(j.id)}>Cancel</Button>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Progress value={pct} />
                  <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                    <span>{j.checked}/{j.total} checked</span>
                    <span className="text-success">✓ {j.valid_count} valid</span>
                    <span className="text-destructive">✗ {j.invalid_count} invalid</span>
                    {j.error_count > 0 && <span className="text-warning">! {j.error_count} errors</span>}
                    <span className="ml-auto">{new Date(j.created_at).toLocaleString()}</span>
                  </div>
                  {j.error_text && <div className="text-xs text-destructive">{j.error_text}</div>}
                </CardContent>
              </Card>
            );
          })}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Other Jobs</CardTitle>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={async () => {
                  if (!confirm('Delete ALL completed / cancelled / failed jobs?')) return;
                  const activeStatuses = ['running', 'queued', 'vps_queued'];
                  // Fetch ALL old job IDs from DB (not just loaded ones), in chunks
                  const oldIds: string[] = [];
                  let from = 0;
                  const pageSize = 1000;
                  while (true) {
                    const { data, error } = await supabase
                      .from('link_check_jobs')
                      .select('id')
                      .not('status', 'in', `(${activeStatuses.join(',')})`)
                      .range(from, from + pageSize - 1);
                    if (error) { toast.error(error.message); return; }
                    const rows = (data as { id: string }[]) || [];
                    oldIds.push(...rows.map(r => r.id));
                    if (rows.length < pageSize) break;
                    from += pageSize;
                  }
                  if (oldIds.length === 0) { toast.info('Nothing to clear'); return; }
                  // Delete items + jobs in chunks of 200
                  for (let i = 0; i < oldIds.length; i += 200) {
                    const chunk = oldIds.slice(i, i + 200);
                    await supabase.from('link_check_items').delete().in('job_id', chunk);
                    await supabase.from('link_check_jobs').delete().in('id', chunk);
                  }
                  toast.success(`Cleared ${oldIds.length} old jobs`);
                  void loadAll();
                }}><Trash2 className="h-4 w-4 mr-1" /> Clear Old</Button>
                <Button size="sm" variant="ghost" onClick={loadAll}><RefreshCw className="h-4 w-4" /></Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {jobs.filter(j => j.status !== 'running').length === 0 && <div className="text-sm text-muted-foreground">No other jobs.</div>}
              {jobs.filter(j => j.status !== 'running').map(j => {
                const pct = j.total > 0 ? Math.round((j.checked / j.total) * 100) : 0;
                return (
                  <div key={j.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="font-medium">{productName(j.product_id)}</div>
                      <div className="flex items-center gap-2">
                        <Badge variant={j.status === 'completed' ? 'default' : j.status === 'failed' ? 'destructive' : 'secondary'}>{j.status}</Badge>
                        {(j.status === 'queued' || j.status === 'vps_queued') && <Button size="sm" variant="ghost" onClick={() => cancelJob(j.id)}>Cancel</Button>}
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
              }, {})).map(([pid, rows]) => {
                // Group rows within this product by job (each run)
                const byJob = rows.reduce<Record<string, InvalidStock[]>>((acc, r) => {
                  const key = r.invalidated_job_id || 'unknown';
                  (acc[key] ||= []).push(r); return acc;
                }, {});
                const jobEntries = Object.entries(byJob).sort((a, b) => {
                  const ta = a[1][0]?.invalidated_at ? new Date(a[1][0].invalidated_at!).getTime() : 0;
                  const tb = b[1][0]?.invalidated_at ? new Date(b[1][0].invalidated_at!).getTime() : 0;
                  return tb - ta;
                });
                return (
                  <div key={pid} className="mb-6">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-medium">{productName(pid)} <span className="text-muted-foreground text-sm">({rows.length})</span></div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => downloadInvalidTxt(pid)}><Download className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => clearInvalid(pid)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                    {jobEntries.map(([jobId, jobRows], idx) => {
                      const runLabel = jobId === 'unknown'
                        ? 'Unknown run'
                        : `Run ${jobEntries.length - idx} · ${jobRows[0]?.invalidated_at ? new Date(jobRows[0].invalidated_at!).toLocaleString() : ''}`;
                      return (
                        <div key={jobId} className="mb-3 rounded-lg border border-border/60">
                          <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 bg-muted/30">
                            <div className="text-xs font-medium text-muted-foreground">{runLabel} <span className="ml-2">({jobRows.length})</span></div>
                            <Button size="sm" variant="ghost" onClick={async () => {
                              if (!confirm(`Delete all ${jobRows.length} invalid links from this run?`)) return;
                              const ids = jobRows.map(r => r.id);
                              const { error } = await supabase.from('bot_product_stock_items').delete().in('id', ids);
                              if (error) { toast.error(error.message); return; }
                              toast.success('Run cleared');
                              void loadAll();
                            }}><Trash2 className="h-4 w-4" /></Button>
                          </div>
                          <div className="space-y-1 p-2 max-h-96 overflow-auto">
                            {jobRows.map(r => {
                              const url = Object.values(r.data || {}).find((x: any) => typeof x === 'string' && x.startsWith('http')) as string;
                              return (
                                <div key={r.id} className="text-xs font-mono p-2 rounded bg-muted/50 flex items-start gap-2">
                                  <div className="flex-1 min-w-0 break-all whitespace-pre-wrap">
                                    <div>{url}</div>
                                    {r.invalid_reason && <div className="text-destructive mt-1">{r.invalid_reason}</div>}
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 w-7 p-0 shrink-0"
                                    onClick={async () => {
                                      if (!confirm('Delete this invalid link?')) return;
                                      const { error } = await supabase.from('bot_product_stock_items').delete().eq('id', r.id);
                                      if (error) { toast.error(error.message); return; }
                                      toast.success('Deleted');
                                      void loadAll();
                                    }}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      
    </div>
  );
}
