import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Search, ExternalLink, Copy, CheckCircle2, XCircle, Clock, AlertTriangle, Wallet } from 'lucide-react';

type Deposit = {
  id: string;
  customer_id: string;
  amount: number;
  status: string;
  txn_hash: string | null;
  created_at: string;
  verified_at: string | null;
  via: string | null;
  pending_product_id: string | null;
  pending_quantity: number | null;
};

type Customer = { id: string; chat_id: number | null; username: string | null; first_name: string | null };

const statusStyle = (s: string) => {
  if (s === 'verified') return { icon: CheckCircle2, cls: 'bg-success/10 text-success ring-1 ring-success/30' };
  if (s === 'rejected' || s === 'cancelled') return { icon: XCircle, cls: 'bg-destructive/10 text-destructive ring-1 ring-destructive/30' };
  if (s === 'cryptomus_pending') return { icon: Clock, cls: 'bg-warning/10 text-warning ring-1 ring-warning/30' };
  return { icon: AlertTriangle, cls: 'bg-muted text-muted-foreground ring-1 ring-border' };
};

const copy = (text: string) => {
  navigator.clipboard.writeText(text);
  toast.success('Copied');
};

const short = (s: string, len = 10) => (s && s.length > len ? `${s.slice(0, len)}…` : s);

const CryptomusActivityTab = () => {
  const [rows, setRows] = useState<Deposit[]>([]);
  const [customers, setCustomers] = useState<Record<string, Customer>>({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'verified' | 'rejected'>('all');
  const [detail, setDetail] = useState<{ deposit: Deposit; info: any } | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [totals, setTotals] = useState({ verified_usd: 0, pending_usd: 0, count: 0, verified_count: 0, pending_count: 0 });

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('bot_deposits')
      .select('*')
      .or('via.eq.Cryptomus,txn_hash.ilike.cryptomus_%')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    const list = (data || []) as Deposit[];
    setRows(list);

    // Load related customers
    const ids = Array.from(new Set(list.map((r) => r.customer_id))).filter(Boolean);
    if (ids.length) {
      const { data: cData } = await supabase
        .from('bot_customers')
        .select('id, chat_id, username, first_name')
        .in('id', ids);
      const map: Record<string, Customer> = {};
      (cData || []).forEach((c: any) => { map[c.id] = c; });
      setCustomers(map);
    }

    let vUsd = 0, pUsd = 0, vC = 0, pC = 0;
    for (const r of list) {
      const amt = Number(r.amount || 0);
      if (r.status === 'verified') { vUsd += amt; vC++; }
      else if (r.status === 'cryptomus_pending') { pUsd += amt; pC++; }
    }
    setTotals({ verified_usd: vUsd, pending_usd: pUsd, count: list.length, verified_count: vC, pending_count: pC });
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const filtered = rows.filter((r) => {
    if (filter === 'pending' && r.status !== 'cryptomus_pending') return false;
    if (filter === 'verified' && r.status !== 'verified') return false;
    if (filter === 'rejected' && !['rejected', 'cancelled'].includes(r.status)) return false;
    if (!q) return true;
    const needle = q.toLowerCase();
    const cust = customers[r.customer_id];
    return (
      (r.txn_hash || '').toLowerCase().includes(needle) ||
      (r.id || '').toLowerCase().includes(needle) ||
      String(cust?.chat_id || '').includes(needle) ||
      (cust?.username || '').toLowerCase().includes(needle) ||
      (cust?.first_name || '').toLowerCase().includes(needle)
    );
  });

  const orderId = (txn: string | null) => (txn?.startsWith('cryptomus_') ? txn.slice('cryptomus_'.length) : txn || '');

  const checkOnCryptomus = async (row: Deposit) => {
    setChecking(row.id);
    try {
      const { data, error } = await supabase.functions.invoke('admin-cryptomus-info', {
        body: { deposit_id: row.id, action: 'info' },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setDetail({ deposit: row, info: data });
    } catch (e: any) {
      toast.error(e?.message || 'Check failed');
    } finally {
      setChecking(null);
    }
  };

  const manualVerify = async (row: Deposit) => {
    if (!confirm('Cryptomus theke live check kore verify korte chan?')) return;
    setVerifying(row.id);
    try {
      const { data, error } = await supabase.functions.invoke('admin-cryptomus-info', {
        body: { deposit_id: row.id, action: 'verify' },
      });
      if (error) throw error;
      const d = data as any;
      if (d?.error) throw new Error(d.error);
      if (d?.already_verified) toast.info('Already verified');
      else if (d?.verified) toast.success(`Verified & credited $${Number(d.amount_credited || 0).toFixed(2)}`);
      else toast.warning('Not verified — check the details');
      await load();
      if (detail && detail.deposit.id === row.id) setDetail({ deposit: row, info: d });
    } catch (e: any) {
      toast.error(e?.message || 'Verify failed');
    } finally {
      setVerifying(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Payments</div><div className="text-2xl font-bold mt-1">{totals.count}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Verified</div><div className="text-2xl font-bold mt-1 text-success">{totals.verified_count}</div><div className="text-xs text-muted-foreground">${totals.verified_usd.toFixed(2)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Pending</div><div className="text-2xl font-bold mt-1 text-warning">{totals.pending_count}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Rejected</div><div className="text-2xl font-bold mt-1 text-destructive">{rows.filter((r) => ['rejected','cancelled'].includes(r.status)).length}</div></CardContent></Card>
      </div>

      {/* Toolbar */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="flex items-center gap-2"><Wallet className="h-5 w-5 text-primary" /> Cryptomus Activity</CardTitle>
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-2">Refresh</span>
            </Button>
          </div>
          <div className="flex gap-2 flex-wrap mt-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search by order id, chat id, username…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
            </div>
            {(['all','pending','verified','rejected'] as const).map((f) => (
              <Button key={f} size="sm" variant={filter === f ? 'default' : 'outline'} onClick={() => setFilter(f)}>{f.charAt(0).toUpperCase() + f.slice(1)}</Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No payments found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-semibold">Order ID</th>
                    <th className="text-left px-4 py-2.5 font-semibold">Customer</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Amount</th>
                    <th className="text-left px-4 py-2.5 font-semibold">Status</th>
                    <th className="text-left px-4 py-2.5 font-semibold">Created</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const oid = orderId(r.txn_hash);
                    const st = statusStyle(r.status);
                    const StatusIcon = st.icon;
                    const cust = customers[r.customer_id];
                    return (
                      <tr key={r.id} className="border-t border-border hover:bg-accent/30">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <code className="text-xs">{short(oid, 22)}</code>
                            <button onClick={() => copy(oid)} className="text-muted-foreground hover:text-foreground"><Copy className="h-3 w-3" /></button>
                          </div>
                          {r.pending_product_id && (
                            <div className="text-[10px] text-primary mt-0.5">🛒 product order</div>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="text-xs">{cust?.username ? `@${cust.username}` : cust?.first_name || '—'}</div>
                          <div className="text-[10px] text-muted-foreground">{cust?.chat_id || '—'}</div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono">${Number(r.amount || 0).toFixed(2)}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant="outline" className={`text-[10px] ${st.cls}`}>
                            <StatusIcon className="h-3 w-3 mr-1" />
                            {r.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end gap-1.5">
                            <Button size="sm" variant="outline" onClick={() => checkOnCryptomus(r)} disabled={checking === r.id}>
                              {checking === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                              <span className="ml-1 text-xs">Check</span>
                            </Button>
                            {r.status !== 'verified' && (
                              <Button size="sm" onClick={() => manualVerify(r)} disabled={verifying === r.id}>
                                {verifying === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                                <span className="ml-1 text-xs">Verify</span>
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cryptomus Payment Info</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Order ID</div>
                  <div className="font-mono text-xs break-all">{orderId(detail.deposit.txn_hash)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">DB Status</div>
                  <div>{detail.deposit.status}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">DB Amount</div>
                  <div>${Number(detail.deposit.amount || 0).toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Cryptomus Status</div>
                  <div className="font-semibold">{detail.info?.cryptomus?.status || detail.info?.cryptomus?.result?.status || '—'}</div>
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Full Cryptomus Response</div>
                <pre className="text-[11px] bg-muted p-3 rounded-md overflow-x-auto max-h-96">{JSON.stringify(detail.info?.cryptomus || detail.info, null, 2)}</pre>
              </div>
              <div className="flex justify-end gap-2">
                {detail.deposit.status !== 'verified' && (
                  <Button onClick={() => manualVerify(detail.deposit)} disabled={verifying === detail.deposit.id}>
                    {verifying === detail.deposit.id ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                    Manual Verify
                  </Button>
                )}
                <Button variant="outline" onClick={() => setDetail(null)}>Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CryptomusActivityTab;
