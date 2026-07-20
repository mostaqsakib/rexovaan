import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Search, Smartphone, TrendingUp, CheckCircle2, XCircle, Clock, Package } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

type BkashDeposit = {
  id: string;
  customer_id: string;
  amount: number;
  status: string;
  via: string | null;
  payment_method: string | null;
  txn_hash: string | null;
  source: string;
  pending_product_id: string | null;
  pending_quantity: number | null;
  created_at: string;
  verified_at: string | null;
  customer?: {
    chat_id: number | null;
    username: string | null;
    first_name: string | null;
    balance: number | null;
  } | null;
  order?: {
    id: string;
    product_name: string;
    quantity: number;
    total_price: number;
    status: string;
  } | null;
  product_name?: string | null;
};

const fmtDate = (s: string) => {
  const d = new Date(s);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ', ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
};

const STATUS_META: Record<string, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  verified: { label: 'Verified', cls: 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10', icon: CheckCircle2 },
  pending: { label: 'Pending', cls: 'border-amber-500/40 text-amber-300 bg-amber-500/10', icon: Clock },
  bkash_pending: { label: 'Awaiting Pay', cls: 'border-sky-500/40 text-sky-300 bg-sky-500/10', icon: Clock },
  rejected: { label: 'Rejected', cls: 'border-destructive/40 text-destructive bg-destructive/10', icon: XCircle },
  bkash_cancelled: { label: 'Cancelled', cls: 'border-muted-foreground/30 text-muted-foreground bg-muted/30', icon: XCircle },
};

const BkashActivityTab = () => {
  const [rows, setRows] = useState<BkashDeposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'verified' | 'pending' | 'rejected'>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'web' | 'bot'>('all');

  const load = async () => {
    setLoading(true);
    // Fetch anything that is/was a bKash flow
    const { data, error } = await supabase
      .from('bot_deposits')
      .select('id, customer_id, amount, status, via, payment_method, txn_hash, source, pending_product_id, pending_quantity, created_at, verified_at')
      .or('payment_method.eq.bKash,txn_hash.like.bkash_%,via.ilike.%bkash%')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) {
      toast.error('bKash records could not be loaded');
      setRows([]);
      setLoading(false);
      return;
    }
    const custIds = Array.from(new Set((data || []).map((r: any) => r.customer_id).filter(Boolean)));
    const productIds = Array.from(new Set((data || []).map((r: any) => r.pending_product_id).filter(Boolean)));

    const [{ data: customers }, { data: products }, { data: orders }] = await Promise.all([
      custIds.length ? supabase.from('bot_customers').select('id, chat_id, username, first_name, balance').in('id', custIds as string[]) : Promise.resolve({ data: [] } as any),
      productIds.length ? supabase.from('bot_products').select('id, name').in('id', productIds as string[]) : Promise.resolve({ data: [] } as any),
      // Orders that reference these deposits via bKash trxID appear in bot_orders through details; we pull by customer+created window
      custIds.length ? supabase.from('bot_orders').select('id, customer_id, product_name, quantity, total_price, status, created_at').in('customer_id', custIds as string[]).order('created_at', { ascending: false }).limit(1000) : Promise.resolve({ data: [] } as any),
    ]);

    const custMap: Record<string, BkashDeposit['customer']> = {};
    (customers || []).forEach((c: any) => { custMap[c.id] = c; });
    const prodMap: Record<string, string> = {};
    (products || []).forEach((p: any) => { prodMap[p.id] = p.name; });

    // Match deposit → order by nearest bot_order created within +/- 3 min of deposit created_at
    const enriched: BkashDeposit[] = (data || []).map((r: any) => {
      let matchedOrder: BkashDeposit['order'] | null = null;
      if (r.pending_product_id) {
        const depTime = new Date(r.created_at).getTime();
        const candidates = (orders || []).filter((o: any) => o.customer_id === r.customer_id);
        let best: any = null;
        let bestDiff = Infinity;
        for (const o of candidates) {
          const d = Math.abs(new Date(o.created_at).getTime() - depTime);
          if (d < bestDiff && d < 10 * 60 * 1000) { best = o; bestDiff = d; }
        }
        if (best) matchedOrder = { id: best.id, product_name: best.product_name, quantity: best.quantity, total_price: Number(best.total_price), status: best.status };
      }
      return {
        ...r,
        customer: custMap[r.customer_id] || null,
        order: matchedOrder,
        product_name: r.pending_product_id ? prodMap[r.pending_product_id] || null : null,
      };
    });
    setRows(enriched);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => rows.filter((r) => {
    if (sourceFilter !== 'all' && (r.source || 'bot') !== sourceFilter) return false;
    if (statusFilter !== 'all') {
      if (statusFilter === 'pending' && !(r.status === 'pending' || r.status === 'bkash_pending')) return false;
      if (statusFilter === 'verified' && r.status !== 'verified') return false;
      if (statusFilter === 'rejected' && !(r.status === 'rejected' || r.status === 'bkash_cancelled')) return false;
    }
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (
      (r.customer?.username || '').toLowerCase().includes(s) ||
      (r.customer?.first_name || '').toLowerCase().includes(s) ||
      String(r.customer?.chat_id || '').includes(s) ||
      (r.txn_hash || '').toLowerCase().includes(s) ||
      (r.product_name || '').toLowerCase().includes(s) ||
      (r.order?.product_name || '').toLowerCase().includes(s) ||
      r.id.toLowerCase().includes(s)
    );
  }), [rows, q, sourceFilter, statusFilter]);

  const stats = useMemo(() => {
    const verified = rows.filter((r) => r.status === 'verified');
    const total = verified.reduce((s, r) => s + Number(r.amount || 0), 0);
    const today = verified.filter((r) => new Date(r.created_at).toDateString() === new Date().toDateString());
    const todayAmt = today.reduce((s, r) => s + Number(r.amount || 0), 0);
    const pending = rows.filter((r) => r.status === 'pending' || r.status === 'bkash_pending').length;
    return { total, count: verified.length, todayAmt, todayCount: today.length, pending };
  }, [rows]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-lg border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 p-3">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-400/80"><TrendingUp className="h-3 w-3" /> Total Received</div>
          <div className="mt-1 font-mono text-xl font-bold text-emerald-300">${stats.total.toFixed(2)}</div>
          <div className="text-[10px] text-muted-foreground">{stats.count} verified</div>
        </div>
        <div className="rounded-lg border border-pink-500/20 bg-gradient-to-br from-pink-500/10 to-pink-500/5 p-3">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-pink-400/80"><Smartphone className="h-3 w-3" /> Today</div>
          <div className="mt-1 font-mono text-xl font-bold text-pink-300">${stats.todayAmt.toFixed(2)}</div>
          <div className="text-[10px] text-muted-foreground">{stats.todayCount} deposits</div>
        </div>
        <div className="rounded-lg border border-amber-500/20 bg-gradient-to-br from-amber-500/10 to-amber-500/5 p-3">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-amber-400/80"><Clock className="h-3 w-3" /> Pending</div>
          <div className="mt-1 font-mono text-xl font-bold text-amber-300">{stats.pending}</div>
          <div className="text-[10px] text-muted-foreground">Awaiting completion</div>
        </div>
        <div className="rounded-lg border border-sky-500/20 bg-gradient-to-br from-sky-500/10 to-sky-500/5 p-3">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-sky-400/80"><Package className="h-3 w-3" /> Total Records</div>
          <div className="mt-1 font-mono text-xl font-bold text-sky-300">{rows.length}</div>
          <div className="text-[10px] text-muted-foreground">All time</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by customer, chat ID, TrxID, product…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
          {(['all', 'web', 'bot'] as const).map((s) => (
            <button key={s} type="button" onClick={() => setSourceFilter(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded capitalize transition-colors ${sourceFilter === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
          {(['all', 'verified', 'pending', 'rejected'] as const).map((s) => (
            <button key={s} type="button" onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded capitalize transition-colors ${statusFilter === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {s}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      <div className="text-xs text-muted-foreground px-1">
        {filtered.length} of {rows.length} records
      </div>

      {filtered.length === 0 ? (
        <div className="py-20 text-center">
          <Smartphone className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">No bKash records found.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const isOpen = expanded === r.id;
            const cust = r.customer;
            const custLabel = cust?.username
              ? `@${cust.username}`
              : cust?.first_name || (cust?.chat_id ? `#${cust.chat_id}` : 'Unknown');
            const meta = STATUS_META[r.status] || { label: r.status, cls: 'border-muted-foreground/30 text-muted-foreground', icon: Clock };
            const Icon = meta.icon;
            const src = (r.source || 'bot') as 'web' | 'bot';
            return (
              <div key={r.id} className="rounded-lg border border-border bg-card overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : r.id)}
                  className="flex w-full items-center gap-2 flex-wrap px-4 py-3 text-left transition-colors hover:bg-muted/50"
                >
                  {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  <Smartphone className="h-4 w-4 text-pink-400 shrink-0" />
                  <span className="text-sm font-mono font-semibold">${Number(r.amount || 0).toFixed(2)}</span>
                  <Badge variant="outline" className={`text-[10px] uppercase gap-1 ${meta.cls}`}>
                    <Icon className="h-3 w-3" />{meta.label}
                  </Badge>
                  <Badge variant="outline" className={`text-[10px] uppercase ${src === 'web' ? 'border-primary/40 text-primary' : 'border-muted-foreground/30 text-muted-foreground'}`}>{src}</Badge>
                  {(r.product_name || r.order?.product_name) && (
                    <Badge variant="secondary" className="text-[10px] gap-1"><Package className="h-3 w-3" />{r.product_name || r.order?.product_name} {r.pending_quantity ? `×${r.pending_quantity}` : ''}</Badge>
                  )}
                  <span className="ml-auto flex items-center gap-2 flex-wrap justify-end text-xs text-muted-foreground">
                    <span className="hidden sm:inline">{custLabel}</span>
                    <span className="whitespace-nowrap">{fmtDate(r.created_at)}</span>
                  </span>
                </button>

                {isOpen && (
                  <div className="border-t border-border bg-muted/30 px-4 py-4 space-y-4">
                    <div className="grid gap-2 sm:grid-cols-2 text-xs">
                      <div><span className="text-muted-foreground">Customer: </span><span className="font-medium">{custLabel}</span></div>
                      {cust?.chat_id && <div><span className="text-muted-foreground">Chat ID: </span><span className="font-mono">{cust.chat_id}</span></div>}
                      {cust?.balance != null && <div><span className="text-muted-foreground">Current Balance: </span><span className="font-mono font-semibold">${Number(cust.balance).toFixed(2)}</span></div>}
                      <div><span className="text-muted-foreground">Amount (USDT): </span><span className="font-mono font-semibold">${Number(r.amount || 0).toFixed(2)}</span></div>
                      <div><span className="text-muted-foreground">Method: </span><span className="font-medium">{r.payment_method || 'bKash'}</span></div>
                      {r.via && <div><span className="text-muted-foreground">Via: </span><span className="font-medium">{r.via}</span></div>}
                      {r.txn_hash && (
                        <div className="sm:col-span-2">
                          <span className="text-muted-foreground">TrxID: </span>
                          <span className="font-mono break-all">{r.txn_hash}</span>
                        </div>
                      )}
                      <div><span className="text-muted-foreground">Created: </span><span>{fmtDate(r.created_at)}</span></div>
                      {r.verified_at && <div><span className="text-muted-foreground">Verified: </span><span>{fmtDate(r.verified_at)}</span></div>}
                      <div className="sm:col-span-2">
                        <span className="text-muted-foreground">Deposit ID: </span>
                        <span className="font-mono text-[10px] break-all">{r.id}</span>
                      </div>
                    </div>

                    {(r.order || r.product_name) && (
                      <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary mb-2">
                          <Package className="h-3 w-3" /> Linked Order
                        </div>
                        <div className="grid gap-1.5 sm:grid-cols-2 text-xs">
                          <div><span className="text-muted-foreground">Product: </span><span className="font-medium">{r.order?.product_name || r.product_name}</span></div>
                          <div><span className="text-muted-foreground">Quantity: </span><span className="font-mono">{r.order?.quantity || r.pending_quantity || 1}</span></div>
                          {r.order && (
                            <>
                              <div><span className="text-muted-foreground">Total: </span><span className="font-mono font-semibold">${Number(r.order.total_price).toFixed(2)}</span></div>
                              <div><span className="text-muted-foreground">Order status: </span><Badge variant="outline" className="text-[10px]">{r.order.status}</Badge></div>
                              <div className="sm:col-span-2"><span className="text-muted-foreground">Order ID: </span><span className="font-mono text-[10px] break-all">{r.order.id}</span></div>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BkashActivityTab;
