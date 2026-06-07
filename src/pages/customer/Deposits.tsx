import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ArrowDownToLine, Hash, CreditCard, Calendar, CheckCircle2, Search, X, Copy, Clock, XCircle, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useCustomerAuth } from '@/contexts/CustomerAuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { toast } from 'sonner';

interface Deposit {
  id: string;
  amount: number;
  txn_hash: string | null;
  status: string;
  created_at: string;
  verified_at: string | null;
  payment_method: string | null;
  via: string | null;
}

function shortId(id: string) {
  return id.replace(/-/g, '').slice(0, 8).toUpperCase();
}

const statusMeta: Record<string, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  verified: { label: 'Verified', cls: 'bg-success/15 text-success border-success/30', icon: CheckCircle2 },
  pending: { label: 'Pending', cls: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30', icon: Clock },
  rejected: { label: 'Rejected', cls: 'bg-destructive/15 text-destructive border-destructive/30', icon: XCircle },
};

export default function Deposits() {
  const { user, customer, loading: authLoading } = useCustomerAuth();
  const { format } = useCurrency();
  const navigate = useNavigate();
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!authLoading && !user) { navigate('/login?next=/account/deposits'); return; }
    if (!customer) return;
    supabase
      .from('bot_deposits')
      .select('id,amount,txn_hash,status,created_at,verified_at,payment_method,via')
      .eq('customer_id', customer.id)
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        setDeposits((data || []) as Deposit[]);
        setLoading(false);
      });
  }, [customer, user, authLoading, navigate]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, '');
    if (!q) return deposits;
    return deposits.filter(d => {
      const no = shortId(d.id).toLowerCase();
      return no.includes(q)
        || (d.txn_hash || '').toLowerCase().includes(q)
        || (d.payment_method || '').toLowerCase().includes(q)
        || (d.via || '').toLowerCase().includes(q)
        || d.status.toLowerCase().includes(q);
    });
  }, [deposits, query]);

  const totalVerified = useMemo(
    () => deposits.filter(d => d.status === 'verified').reduce((s, d) => s + Number(d.amount), 0),
    [deposits]
  );
  const pendingCount = useMemo(() => deposits.filter(d => d.status === 'pending').length, [deposits]);

  if (loading || authLoading) {
    return <div className="grid place-items-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (deposits.length === 0) {
    return (
      <div className="premium-card p-12 text-center space-y-3">
        <ArrowDownToLine className="h-10 w-10 mx-auto text-muted-foreground" />
        <p className="text-muted-foreground">No deposits yet.</p>
        <Button onClick={() => navigate('/account/deposit')}>Make a deposit</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="font-heading text-2xl font-bold">Deposit history</h1>
        <Button size="sm" onClick={() => navigate('/account/deposit')} className="gap-1.5">
          <ArrowDownToLine className="h-4 w-4" /> New deposit
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-muted/30 p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total deposited</div>
          <div className="font-mono font-bold text-success mt-1">{format(totalVerified)}</div>
        </div>
        <div className="rounded-xl border border-border bg-muted/30 p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Pending</div>
          <div className="font-mono font-bold text-yellow-400 mt-1">{pendingCount}</div>
        </div>
        <div className="rounded-xl border border-border bg-muted/30 p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total entries</div>
          <div className="font-mono font-bold mt-1">{deposits.length}</div>
        </div>
      </div>

      <div className="relative">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by # / TxID / network / status…"
          className="pl-9 pr-9"
        />
        {query && (
          <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {filtered.length === 0 && (
        <div className="premium-card p-8 text-center text-sm text-muted-foreground">No deposits match "{query}".</div>
      )}

      <div className="space-y-2">
        {filtered.map((d) => {
          const meta = statusMeta[d.status] || { label: d.status, cls: 'bg-muted text-muted-foreground border-border', icon: Clock };
          const Icon = meta.icon;
          const depNo = shortId(d.id);
          return (
            <div key={d.id} className="premium-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-300 border border-amber-400/30">#{depNo}</span>
                    <Badge variant="outline" className={`gap-1 text-[10px] ${meta.cls}`}>
                      <Icon className="h-3 w-3" /> {meta.label}
                    </Badge>
                    {d.via && (
                      <Badge variant="outline" className="text-[10px] font-mono border-primary/40 text-primary gap-1">
                        <Globe className="h-3 w-3" /> {d.via}
                      </Badge>
                    )}
                    {d.payment_method && !d.via && (
                      <Badge variant="outline" className="text-[10px] font-mono gap-1">
                        <CreditCard className="h-3 w-3" /> {d.payment_method}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> {new Date(d.created_at).toLocaleString()}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-mono font-bold text-lg">{Number(d.amount).toFixed(2)} <span className="text-xs text-muted-foreground">USDT</span></div>
                  <div className="text-[10px] text-muted-foreground">{format(Number(d.amount))}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs pt-2 border-t border-border/60">
                <div className="space-y-0.5">
                  <div className="text-muted-foreground flex items-center gap-1"><Hash className="h-3 w-3" /> Deposit #</div>
                  <button onClick={() => { navigator.clipboard.writeText(depNo); toast.success('Copied'); }} className="font-mono font-semibold hover:text-primary">{depNo}</button>
                </div>
                {d.payment_method && (
                  <div className="space-y-0.5">
                    <div className="text-muted-foreground flex items-center gap-1"><CreditCard className="h-3 w-3" /> Method</div>
                    <div className="font-medium">{d.payment_method}</div>
                  </div>
                )}
                {d.verified_at && (
                  <div className="space-y-0.5">
                    <div className="text-muted-foreground flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Verified</div>
                    <div className="font-medium">{new Date(d.verified_at).toLocaleString()}</div>
                  </div>
                )}
                {d.txn_hash && (
                  <div className="space-y-0.5 col-span-2 sm:col-span-3">
                    <div className="text-muted-foreground flex items-center gap-1"><Hash className="h-3 w-3" /> Transaction</div>
                    <button
                      onClick={() => { navigator.clipboard.writeText(d.txn_hash!); toast.success('Copied'); }}
                      className="font-mono text-[11px] break-all hover:text-primary text-left inline-flex items-start gap-1"
                    >
                      <span className="flex-1">{d.txn_hash}</span>
                      <Copy className="h-3 w-3 shrink-0 mt-0.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
