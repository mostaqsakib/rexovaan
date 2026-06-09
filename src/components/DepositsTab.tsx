import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2, RefreshCw, Search, Wallet, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';


type Deposit = {
  id: string;
  customer_id: string;
  amount: number;
  status: string;
  via: string | null;
  payment_method: string | null;
  txn_hash: string | null;
  source: string;
  created_at: string;
  verified_at: string | null;
  customer?: {
    chat_id: number | null;
    username: string | null;
    first_name: string | null;
    auth_user_id: string | null;
  } | null;
};

const fmtDate = (s: string) => {
  const d = new Date(s);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ', ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
};

const STATUS_STYLES: Record<string, string> = {
  verified: 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10',
  pending: 'border-amber-500/40 text-amber-300 bg-amber-500/10',
  bkash_pending: 'border-amber-500/40 text-amber-300 bg-amber-500/10',
  rejected: 'border-destructive/40 text-destructive bg-destructive/10',
  bkash_cancelled: 'border-muted-foreground/30 text-muted-foreground bg-muted/30',
};

const DepositsTab = () => {
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'web' | 'bot'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'verified' | 'pending' | 'rejected'>('all');
  const [actingId, setActingId] = useState<string | null>(null);
  const [amountEdit, setAmountEdit] = useState<Record<string, string>>({});

  const approve = async (d: Deposit) => {
    const raw = amountEdit[d.id];
    const amount = raw !== undefined && raw !== '' ? Number(raw) : Number(d.amount);
    if (!amount || amount <= 0) { toast.error('Enter a valid amount'); return; }
    setActingId(d.id);
    const { data, error } = await supabase.functions.invoke('admin-verify-deposit', { body: { deposit_id: d.id, amount } });
    setActingId(null);
    if (error || (data as any)?.error) { toast.error((data as any)?.error || error?.message || 'Approve failed'); return; }
    toast.success('Deposit approved');
    void load();
  };

  const reject = async (d: Deposit) => {
    if (!confirm('Reject this deposit?')) return;
    setActingId(d.id);
    const { data, error } = await supabase.functions.invoke('admin-reject-deposit', { body: { deposit_id: d.id } });
    setActingId(null);
    if (error || (data as any)?.error) { toast.error((data as any)?.error || error?.message || 'Reject failed'); return; }
    toast.success('Deposit rejected');
    void load();
  };


  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('bot_deposits')
      .select('id, customer_id, amount, status, via, payment_method, txn_hash, source, created_at, verified_at')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) {
      toast.error('Deposits could not be loaded');
      setDeposits([]);
      setLoading(false);
      return;
    }
    const customerIds = Array.from(new Set((data || []).map((r: any) => r.customer_id).filter(Boolean)));
    let customersById: Record<string, Deposit['customer']> = {};
    if (customerIds.length) {
      const { data: customers } = await supabase
        .from('bot_customers')
        .select('id, chat_id, username, first_name, auth_user_id')
        .in('id', customerIds as string[]);
      customersById = (customers || []).reduce((acc: Record<string, Deposit['customer']>, c: any) => {
        acc[c.id] = c;
        return acc;
      }, {});
    }
    const rows: Deposit[] = (data || []).map((r: any) => ({ ...r, customer: customersById[r.customer_id] || null }));
    setDeposits(rows);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const filtered = deposits.filter((d) => {
    if (sourceFilter !== 'all' && (d.source || 'bot') !== sourceFilter) return false;
    if (statusFilter !== 'all') {
      if (statusFilter === 'pending' && !(d.status === 'pending' || d.status === 'bkash_pending')) return false;
      if (statusFilter === 'verified' && d.status !== 'verified') return false;
      if (statusFilter === 'rejected' && !(d.status === 'rejected' || d.status === 'bkash_cancelled')) return false;
    }
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (
      (d.customer?.username || '').toLowerCase().includes(s) ||
      (d.customer?.first_name || '').toLowerCase().includes(s) ||
      String(d.customer?.chat_id || '').includes(s) ||
      (d.txn_hash || '').toLowerCase().includes(s) ||
      (d.via || '').toLowerCase().includes(s) ||
      (d.payment_method || '').toLowerCase().includes(s) ||
      d.id.toLowerCase().includes(s)
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by customer, chat ID, TxID, via, deposit ID…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
          {(['all', 'web', 'bot'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSourceFilter(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded capitalize transition-colors ${
                sourceFilter === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
          {(['all', 'verified', 'pending', 'rejected'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded capitalize transition-colors ${
                statusFilter === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      <div className="text-xs text-muted-foreground px-1">
        {filtered.length} of {deposits.length} deposits
      </div>

      {filtered.length === 0 ? (
        <div className="py-20 text-center">
          <Wallet className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">No deposits found.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((d) => {
            const isOpen = expanded === d.id;
            const cust = d.customer;
            const custLabel = cust?.username
              ? `@${cust.username}`
              : cust?.first_name || (cust?.chat_id ? `#${cust.chat_id}` : 'Unknown');
            const src = (d.source || 'bot') as 'web' | 'bot';
            const statusClass = STATUS_STYLES[d.status] || 'border-muted-foreground/30 text-muted-foreground';
            return (
              <div key={d.id} className="rounded-lg border border-border bg-card overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : d.id)}
                  className="flex w-full items-center gap-2 flex-wrap px-4 py-3 text-left transition-colors hover:bg-muted/50"
                >
                  {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  <span className="text-sm font-mono font-semibold">${Number(d.amount).toFixed(2)}</span>
                  {d.via && <Badge variant="secondary" className="text-[10px]">{d.via}</Badge>}
                  <Badge
                    variant="outline"
                    className={`text-[10px] uppercase ${src === 'web' ? 'border-primary/40 text-primary' : 'border-muted-foreground/30 text-muted-foreground'}`}
                  >
                    {src}
                  </Badge>
                  <Badge variant="outline" className={`text-[10px] uppercase ${statusClass}`}>{d.status}</Badge>
                  <span className="ml-auto flex items-center gap-2 flex-wrap justify-end text-xs text-muted-foreground">
                    <span className="hidden sm:inline">{custLabel}</span>
                    <span className="whitespace-nowrap">{fmtDate(d.created_at)}</span>
                  </span>
                </button>

                {isOpen && (
                  <div className="border-t border-border bg-muted/30 px-4 py-4">
                    <div className="grid gap-2 sm:grid-cols-2 text-xs">
                      <div><span className="text-muted-foreground">Customer: </span><span className="font-medium">{custLabel}</span></div>
                      {cust?.chat_id && <div><span className="text-muted-foreground">Chat ID: </span><span className="font-mono">{cust.chat_id}</span></div>}
                      <div>
                        <span className="text-muted-foreground">Deposit #: </span>
                        <span className="font-mono font-semibold">{d.id.substring(0, 4).toUpperCase()}</span>
                        <span className="text-muted-foreground/60 font-mono text-[10px] break-all ml-2">({d.id})</span>
                      </div>
                      <div><span className="text-muted-foreground">Amount: </span><span className="font-mono font-semibold">${Number(d.amount).toFixed(2)}</span></div>
                      {d.via && <div><span className="text-muted-foreground">Via: </span><span className="font-medium">{d.via}</span></div>}
                      {d.payment_method && <div><span className="text-muted-foreground">Method: </span><span className="font-medium">{d.payment_method}</span></div>}
                      {d.txn_hash && (
                        <div className="sm:col-span-2">
                          <span className="text-muted-foreground">TxID: </span>
                          <span className="font-mono break-all">{d.txn_hash}</span>
                        </div>
                      )}
                      {d.verified_at && <div><span className="text-muted-foreground">Verified: </span><span>{fmtDate(d.verified_at)}</span></div>}
                    </div>
                    {(d.status === 'pending' || d.status === 'bkash_pending') && (
                      <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-2 border-t border-border pt-3">
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-muted-foreground">Credit amount ($)</label>
                          <Input
                            type="number"
                            step="0.01"
                            className="h-8 w-28"
                            value={amountEdit[d.id] ?? String(d.amount)}
                            onChange={(e) => setAmountEdit((m) => ({ ...m, [d.id]: e.target.value }))}
                          />
                        </div>
                        <div className="flex items-center gap-2 sm:ml-auto">
                          <Button size="sm" onClick={() => approve(d)} disabled={actingId === d.id} className="gap-1.5">
                            {actingId === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            Approve
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => reject(d)} disabled={actingId === d.id} className="gap-1.5">
                            <X className="h-3.5 w-3.5" /> Reject
                          </Button>
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

export default DepositsTab;
