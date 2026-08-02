import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Search, ExternalLink, Copy, Bitcoin } from 'lucide-react';

type Reserved = {
  id: string;
  order_id: string;
  address: string;
  derivation_index: number;
  customer_telegram_id: number | null;
  deposit_id: string | null;
  expected_amount_ltc: number | null;
  expected_amount_usd: number | null;
  ltc_usd_rate: number | null;
  status: string;
  paid_tx_hash: string | null;
  paid_amount_ltc: number | null;
  paid_at: string | null;
  expires_at: string | null;
  created_at: string;
  sweep_status: string | null;
  sweep_tx_hash: string | null;
  swept_amount_ltc: number | null;
  swept_at: string | null;
  sweep_error: string | null;
};

type Registry = {
  id: string;
  tx_hash: string;
  vout: number;
  address: string;
  amount_ltc: number;
  block_height: number | null;
  confirmations: number | null;
  reserved_address_id: string | null;
  deposit_id: string | null;
  credited_at: string;
};

const LTC_EXPLORER = 'https://litecoinspace.org';
const short = (s: string | null | undefined, len = 10) =>
  !s ? '' : s.length > len + 6 ? `${s.slice(0, len)}…${s.slice(-6)}` : s;
const copy = (t: string) => { navigator.clipboard.writeText(t); toast.success('Copied'); };
const fmtLtc = (n: number | null | undefined) => (Number(n || 0)).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');

const statusBadge = (s: string) => {
  const map: Record<string, string> = {
    paid: 'bg-success/15 text-success border border-success/30',
    reserved: 'bg-primary/10 text-primary border border-primary/20',
    expired: 'bg-muted text-muted-foreground',
    swept: 'bg-primary/10 text-primary border border-primary/20',
    pending: 'bg-warning/15 text-warning border border-warning/30',
    error: 'bg-destructive/15 text-destructive border border-destructive/30',
  };
  return <Badge className={map[s] || 'bg-muted'}>{s}</Badge>;
};

const LtcActivityCard = () => {
  const [reserved, setReserved] = useState<Reserved[]>([]);
  const [registry, setRegistry] = useState<Registry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [tab, setTab] = useState<'ledger' | 'reserved'>('ledger');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'reserved' | 'paid' | 'expired'>('all');

  const load = async () => {
    setRefreshing(true);
    const [r, reg] = await Promise.all([
      supabase.from('ltc_reserved_addresses').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('ltc_payment_registry').select('*').order('credited_at', { ascending: false }).limit(500),
    ]);
    if (r.error) toast.error(r.error.message);
    if (reg.error) toast.error(reg.error.message);
    setReserved((r.data || []) as Reserved[]);
    setRegistry((reg.data || []) as Registry[]);
    setLoading(false);
    setRefreshing(false);
  };

  const runScan = async () => {
    setScanning(true);
    try {
      const { error } = await supabase.functions.invoke('ltc-watcher');
      if (error) throw error;
      toast.success('LTC watcher triggered');
      await load();
    } catch (e: any) {
      toast.error(e.message ?? 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  const runSweep = async () => {
    setScanning(true);
    try {
      // Manual sweep = force: bypasses the min-USD threshold so deferred
      // small deposits (e.g. $0.70) are swept too.
      const { data, error } = await supabase.functions.invoke('ltc-sweep', { body: { force: true } });
      if (error) throw error;
      const swept = (data as any)?.swept ?? 0;
      const skipped = (data as any)?.skipped ?? 0;
      const errs = (data as any)?.errors as string[] | undefined;
      if (errs?.length) toast.error(`Sweep errors: ${errs[0]}`);
      else toast.success(`LTC sweep: ${swept} swept, ${skipped} skipped (dust)`);
      await load();
    } catch (e: any) {
      toast.error(e.message ?? 'Sweep failed');
    } finally {
      setScanning(false);
    }
  };


  useEffect(() => { load(); }, []);

  const stats = useMemo(() => {
    const totalCreditedLtc = registry.reduce((s, r) => s + Number(r.amount_ltc || 0), 0);
    const totalCreditedUsd = reserved
      .filter((r) => r.status === 'paid' || r.paid_at)
      .reduce((s, r) => s + Number(r.expected_amount_usd || 0), 0);
    const active = reserved.filter((r) => r.status === 'reserved').length;
    const swept = reserved.filter((r) => r.sweep_status === 'swept').reduce((s, r) => s + Number(r.swept_amount_ltc || 0), 0);
    const awaiting = reserved.filter((r) => (r.status === 'paid') && r.sweep_status !== 'swept').reduce((s, r) => s + Number(r.paid_amount_ltc || 0), 0);
    return { totalCreditedLtc, totalCreditedUsd, active, swept, awaiting };
  }, [reserved, registry]);

  const filteredLedger = useMemo(() => {
    const term = q.trim().toLowerCase();
    return registry.filter((r) => {
      if (!term) return true;
      return (
        r.tx_hash.toLowerCase().includes(term) ||
        r.address.toLowerCase().includes(term)
      );
    });
  }, [registry, q]);

  const filteredReserved = useMemo(() => {
    const term = q.trim().toLowerCase();
    return reserved.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!term) return true;
      return (
        (r.order_id || '').toLowerCase().includes(term) ||
        r.address.toLowerCase().includes(term) ||
        (r.paid_tx_hash || '').toLowerCase().includes(term) ||
        String(r.customer_telegram_id || '').includes(term)
      );
    });
  }, [reserved, q, statusFilter]);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bitcoin className="h-5 w-5 text-[#345D9D]" />
            Litecoin (LTC) — Native Segwit Gateway
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Per-order derived addresses. Watcher confirms deposits, sweeper auto-forwards to master wallet.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="outline" size="sm" onClick={runScan} disabled={scanning}>
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            <span className="ml-1.5">Watch</span>
          </Button>
          <Button size="sm" onClick={runSweep} disabled={scanning}>
            Sweep
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Total credited" value={`$${stats.totalCreditedUsd.toFixed(2)}`} sub={`${fmtLtc(stats.totalCreditedLtc)} LTC`} accent="text-success" />
          <Stat label="Active addresses" value={String(stats.active)} />
          <Stat label="Auto-swept" value={`${fmtLtc(stats.swept)} LTC`} accent="text-primary" />
          <Stat label="Awaiting sweep" value={`${fmtLtc(stats.awaiting)} LTC`} accent="text-warning" />
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-border/60 bg-muted/30 p-0.5">
            <button
              onClick={() => setTab('ledger')}
              className={`rounded px-3 py-1 text-xs font-medium ${tab === 'ledger' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
            >
              Ledger ({registry.length})
            </button>
            <button
              onClick={() => setTab('reserved')}
              className={`rounded px-3 py-1 text-xs font-medium ${tab === 'reserved' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
            >
              Reserved ({reserved.length})
            </button>
          </div>
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search tx / address / order / telegram id"
              className="h-8 pl-7 text-xs"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {tab === 'reserved' && (
            <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All status</SelectItem>
                <SelectItem value="reserved">Reserved</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Ledger */}
        {tab === 'ledger' && (
          <div className="overflow-hidden rounded-lg border border-border/60">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">When</th>
                  <th className="px-3 py-2 text-left font-medium">Amount</th>
                  <th className="px-3 py-2 text-left font-medium">Address</th>
                  <th className="px-3 py-2 text-left font-medium">Tx</th>
                  <th className="px-3 py-2 text-left font-medium">Conf</th>
                </tr>
              </thead>
              <tbody>
                {filteredLedger.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No credited deposits yet</td></tr>
                )}
                {filteredLedger.map((r) => (
                  <tr key={r.id} className="border-t border-border/40">
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {new Date(r.credited_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-medium text-success">
                      {fmtLtc(r.amount_ltc)} LTC
                    </td>
                    <td className="px-3 py-2 font-mono">
                      <div className="inline-flex items-center gap-1">
                        {short(r.address, 12)}
                        <button onClick={() => copy(r.address)}><Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" /></button>
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono">
                      <a href={`${LTC_EXPLORER}/tx/${r.tx_hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                        {short(r.tx_hash, 10)}<ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.confirmations ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Reserved */}
        {tab === 'reserved' && (
          <div className="overflow-hidden rounded-lg border border-border/60">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Created</th>
                  <th className="px-3 py-2 text-left font-medium">Order</th>
                  <th className="px-3 py-2 text-left font-medium">Customer</th>
                  <th className="px-3 py-2 text-left font-medium">Address</th>
                  <th className="px-3 py-2 text-left font-medium">Expected</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Sweep</th>
                </tr>
              </thead>
              <tbody>
                {filteredReserved.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No reserved addresses</td></tr>
                )}
                {filteredReserved.map((r) => (
                  <tr key={r.id} className="border-t border-border/40 align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-mono">{r.order_id}</td>
                    <td className="px-3 py-2">{r.customer_telegram_id ? `#${r.customer_telegram_id}` : '—'}</td>
                    <td className="px-3 py-2 font-mono">
                      <div className="inline-flex items-center gap-1">
                        {short(r.address, 12)}
                        <button onClick={() => copy(r.address)}><Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" /></button>
                      </div>
                      {r.paid_tx_hash && (
                        <div className="mt-1">
                          <a href={`${LTC_EXPLORER}/tx/${r.paid_tx_hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                            paid tx {short(r.paid_tx_hash, 8)}<ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div>{fmtLtc(r.expected_amount_ltc)} LTC</div>
                      <div className="text-[11px] text-muted-foreground">${Number(r.expected_amount_usd || 0).toFixed(2)}</div>
                    </td>
                    <td className="px-3 py-2">
                      {statusBadge(r.status)}
                      {r.paid_amount_ltc ? (
                        <div className="mt-1 text-[11px] text-muted-foreground">paid {fmtLtc(r.paid_amount_ltc)}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      {r.sweep_status ? statusBadge(r.sweep_status) : <span className="text-muted-foreground">—</span>}
                      {r.sweep_tx_hash && (
                        <div className="mt-1">
                          <a href={`${LTC_EXPLORER}/tx/${r.sweep_tx_hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                            {short(r.sweep_tx_hash, 8)}<ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      )}
                      {r.sweep_error && (
                        <div className="mt-1 text-[11px] text-destructive line-clamp-2">{r.sweep_error}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const Stat = ({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) => (
  <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
    <div className={`mt-1 text-lg font-semibold ${accent || ''}`}>{value}</div>
    {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
  </div>
);

export default LtcActivityCard;
