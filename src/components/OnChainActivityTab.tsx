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
import {
  Loader2, RefreshCw, Search, ExternalLink, Copy, Link2,
  ShieldAlert, Wallet, ArrowRight, CheckCircle2, Clock, AlertTriangle, Fuel,
} from 'lucide-react';
import LtcActivityCard from './LtcActivityCard';
import TonActivityCard from './TonActivityCard';



type RegistryRow = {
  id: string;
  tx_hash: string;
  log_index: number;
  address: string;
  token: string;
  amount: number;
  block_number: number | null;
  reserved_address_id: string | null;
  deposit_id: string | null;
  credited_at: string;
};

type ReservedRow = {
  id: string;
  address: string;
  token: string;
  expected_amount: number | null;
  received_amount: number | null;
  status: string;
  sweep_status: string | null;
  sweep_tx_hash: string | null;
  gas_tx_hash: string | null;
  customer_id: string | null;
  deposit_id: string | null;
  paid_at: string | null;
  swept_at: string | null;
  created_at: string;
};

type FakeRow = {
  id: string;
  tx_hash: string;
  log_index: number;
  address: string;
  contract: string;
  token_symbol: string | null;
  amount: number | null;
  from_address: string | null;
  block_number: number | null;
  reserved_address_id: string | null;
  customer_id: string | null;
  deposit_id: string | null;
  reason: string;
  created_at: string;
};

type CustomerLite = { id: string; chat_id: number | null; username: string | null; first_name: string | null };
type DepositLite = { id: string; amount: number | null; customer_id: string | null };

const BSCSCAN = 'https://bscscan.com';
const short = (s: string | null | undefined, len = 10) =>
  !s ? '' : s.length > len + 6 ? `${s.slice(0, len)}…${s.slice(-6)}` : s;

// Fake/scam tokens often have mojibake symbols (UTF-8 read as latin-1).
// Strip unprintable chars; if nothing usable is left, fall back to "Unknown".
const sanitizeSymbol = (raw: string | null | undefined): string => {
  if (!raw) return 'Unknown';
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\x00-\x1F\x7F]/g, '').trim();
  const printable = cleaned.replace(/[^\x20-\x7E]/g, '').trim();
  if (printable.length >= 2) return printable.slice(0, 12);
  return 'Unknown';
};

const formatRaw = (n: number): string => {
  if (!isFinite(n)) return '—';
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
};

const copy = (text: string) => {
  navigator.clipboard.writeText(text);
  toast.success('Copied');
};

type GasChain = {
  chain: string; name: string; native: string;
  balance?: string; min?: string; topUp?: string;
  usdPrice?: number | null; balanceUsd?: number | null; minUsd?: number | null;
  sweepsRemaining?: number;
  ok?: boolean; status?: 'ok' | 'warn' | 'critical'; error?: string;
};
type GasStatus = { master: string; destination: string | null; chains: GasChain[]; criticalCount?: number; warnCount?: number };


const OnChainActivityTab = () => {
  const [registry, setRegistry] = useState<RegistryRow[]>([]);
  const [reserved, setReserved] = useState<ReservedRow[]>([]);
  const [fakes, setFakes] = useState<FakeRow[]>([]);
  const [customers, setCustomers] = useState<Record<string, CustomerLite>>({});
  const [deposits, setDeposits] = useState<Record<string, DepositLite>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [tab, setTab] = useState<'ledger' | 'fake'>('ledger');
  const [q, setQ] = useState('');
  const [tokenFilter, setTokenFilter] = useState<'all' | 'USDT' | 'USDC'>('all');
  const [sweepFilter, setSweepFilter] = useState<'all' | 'swept' | 'pending' | 'error'>('all');
  const [lookupHash, setLookupHash] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupResult, setLookupResult] = useState<string | null>(null);
  const [gas, setGas] = useState<GasStatus | null>(null);
  const [gasLoading, setGasLoading] = useState(false);
  const [ltcGas, setLtcGas] = useState<GasChain & { master?: string } | null>(null);
  const [latePayments, setLatePayments] = useState<any[]>([]);
  const [creditingId, setCreditingId] = useState<string | null>(null);

  const loadLatePayments = async () => {
    const { data } = await supabase
      .from('bot_deposits')
      .select('id, customer_id, amount, payment_method, txn_hash, bep20_tx_hash, bep20_token, ltc_tx_hash, created_at, updated_at')
      .eq('status', 'late_pending')
      .order('updated_at', { ascending: false })
      .limit(50);
    const rows = data || [];
    const custIds = Array.from(new Set(rows.map((r: any) => r.customer_id).filter(Boolean)));
    let custMap: Record<string, any> = {};
    if (custIds.length) {
      const { data: cd } = await supabase.from('bot_customers')
        .select('id, chat_id, username, first_name').in('id', custIds);
      (cd || []).forEach((c: any) => { custMap[c.id] = c; });
    }
    setLatePayments(rows.map((r: any) => ({ ...r, _customer: custMap[r.customer_id] })));
  };

  const creditLatePayment = async (depositId: string) => {
    setCreditingId(depositId);
    try {
      const { data, error } = await supabase.functions.invoke('credit-late-deposit', {
        body: { deposit_id: depositId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`Credited $${Number((data as any)?.credited || 0).toFixed(2)}`);
      await loadLatePayments();
    } catch (e: any) {
      toast.error(e.message ?? 'Credit failed');
    } finally {
      setCreditingId(null);
    }
  };


  const loadGas = async () => {
    setGasLoading(true);
    try {
      const [{ data, error }, ltcRes] = await Promise.all([
        supabase.functions.invoke('bep20-gas-status'),
        supabase.functions.invoke('ltc-gas-status'),
      ]);
      if (error) throw error;
      setGas(data as GasStatus);
      if (!ltcRes.error && ltcRes.data && (ltcRes.data as any).ok !== false) {
        setLtcGas(ltcRes.data as any);
      } else {
        setLtcGas(null);
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Gas status failed');
    } finally {
      setGasLoading(false);
    }
  };



  const load = async () => {
    setRefreshing(true);
    const [reg, recentRes, fk] = await Promise.all([
      supabase.from('bep20_payment_registry').select('*').order('credited_at', { ascending: false }).limit(500),
      supabase.from('bep20_reserved_addresses').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('bep20_fake_transactions').select('*').order('created_at', { ascending: false }).limit(500),
    ]);
    if (reg.error) toast.error(reg.error.message);
    if (recentRes.error) toast.error(recentRes.error.message);
    if (fk.error) toast.error(fk.error.message);

    const regRows = (reg.data || []) as RegistryRow[];
    const fakeRows = (fk.data || []) as FakeRow[];
    const recentReservedRows = (recentRes.data || []) as ReservedRow[];

    const neededReservedIds = new Set<string>();
    const neededAddresses = new Set<string>();
    [...regRows, ...fakeRows].forEach((r: any) => {
      if (r.reserved_address_id) neededReservedIds.add(r.reserved_address_id);
      if (r.address) neededAddresses.add(String(r.address).toLowerCase());
    });

    const [byId, byAddress] = await Promise.all([
      neededReservedIds.size
        ? supabase.from('bep20_reserved_addresses').select('*').in('id', Array.from(neededReservedIds))
        : Promise.resolve({ data: [], error: null }),
      neededAddresses.size
        ? supabase.from('bep20_reserved_addresses').select('*').in('address', Array.from(neededAddresses))
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (byId.error) toast.error(byId.error.message);
    if (byAddress.error) toast.error(byAddress.error.message);

    const reservedMap = new Map<string, ReservedRow>();
    [...recentReservedRows, ...((byId.data || []) as ReservedRow[]), ...((byAddress.data || []) as ReservedRow[])]
      .forEach((r) => reservedMap.set(r.id, r));
    const reservedRows = Array.from(reservedMap.values());

    const depositIds = new Set<string>();
    [...regRows, ...fakeRows, ...reservedRows].forEach((r: any) => {
      if (r.deposit_id) depositIds.add(r.deposit_id);
    });
    if (depositIds.size) {
      const { data: dData, error: dErr } = await supabase
        .from('bot_deposits')
        .select('id, amount, customer_id')
        .in('id', Array.from(depositIds));
      if (dErr) toast.error(dErr.message);
      const dMap: Record<string, DepositLite> = {};
      (dData || []).forEach((d: any) => { dMap[d.id] = { ...d, amount: Number(d.amount || 0) }; });
      setDeposits(dMap);
    } else {
      setDeposits({});
    }

    setRegistry(regRows);
    setReserved(reservedRows);
    setFakes(fakeRows);

    const custIds = new Set<string>();
    reservedRows.forEach((r: any) => r.customer_id && custIds.add(r.customer_id));
    fakeRows.forEach((r: any) => r.customer_id && custIds.add(r.customer_id));
    if (custIds.size) {
      const { data: cData } = await supabase
        .from('bot_customers')
        .select('id, chat_id, username, first_name')
        .in('id', Array.from(custIds));
      const map: Record<string, CustomerLite> = {};
      (cData || []).forEach((c: any) => { map[c.id] = c; });
      setCustomers(map);
    }
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { void load(); void loadGas(); void loadLatePayments(); }, []);

  const runScan = async () => {
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke('bep20-watcher');
      if (error) throw error;
      toast.success(`Watcher: scanned ${data?.scanned ?? 0}, credited ${data?.credited ?? 0}, fakes ${data?.fakes ?? 0}`);
      await load();
    } catch (e: any) {
      toast.error(e.message ?? 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  const lookupTx = async () => {
    const h = lookupHash.trim();
    if (!/^0x[a-fA-F0-9]{64}$/.test(h)) {
      toast.error('Enter a valid 0x… BSC tx hash');
      return;
    }
    setLookupBusy(true);
    setLookupResult(null);
    try {
      const known = registry.find((r) => r.tx_hash.toLowerCase() === h.toLowerCase());
      const fake = fakes.find((r) => r.tx_hash.toLowerCase() === h.toLowerCase());
      if (known) setLookupResult(`✅ Credited: ${known.amount} ${known.token} → ${short(known.address)}`);
      else if (fake) setLookupResult(`⚠️ Unsupported / scam token detected: ${fake.token_symbol || fake.contract}`);
      else setLookupResult('No local record. Open on BscScan for on-chain details.');
    } finally {
      setLookupBusy(false);
    }
  };

  const filteredRegistry = useMemo(() => {
    const reservedById = new Map(reserved.map((r) => [r.id, r]));
    const reservedByAddress = new Map<string, ReservedRow>();
    reserved.forEach((r) => {
      const key = r.address.toLowerCase();
      if (!reservedByAddress.has(key)) reservedByAddress.set(key, r);
    });

    const getDepositUsd = (match: ReservedRow | undefined, depositId: string | null | undefined, fallback = 0) => {
      const fromReserved = Number(match?.expected_amount || 0);
      if (fromReserved > 0) return fromReserved;
      const fromReceived = Number(match?.received_amount || 0);
      if (fromReceived > 0) return fromReceived;
      const fromDeposit = depositId ? Number(deposits[depositId]?.amount || 0) : 0;
      if (fromDeposit > 0) return fromDeposit;
      return Number(fallback || 0);
    };

    const custLabel = (id: string | null | undefined) => {
      if (!id) return '—';
      const c = customers[id];
      if (!c) return '—';
      return c.username ? `@${c.username}` : c.first_name || `#${c.chat_id ?? '—'}`;
    };

    // Hide dust transfers (< 0.01) — these are spam/dusting attacks that
    // occasionally hit reserved addresses and pollute the log even though
    // the credited value is effectively zero.
    const DUST_THRESHOLD = 0.01;
    const credited: any[] = registry
      .filter((r) => Number(r.amount || 0) >= DUST_THRESHOLD)
      .map((r) => {
        const match = r.reserved_address_id
          ? reservedById.get(r.reserved_address_id)
          : reservedByAddress.get(r.address.toLowerCase());
        const perTx = Number(r.amount || 0);
        return {
          id: r.id,
          kind: 'credited' as const,
          date: r.credited_at,
          token: r.token,
          contract: null as string | null,
          address: r.address,
          from: null as string | null,
          tx_hash: r.tx_hash,
          amount: perTx,
          depositAmount: perTx,
          expected: Number(match?.expected_amount || 0),
          // Show the per-tx amount, not the reservation's cumulative received.
          // Otherwise multiple registry rows for the same address all show the
          // same inflated "received" total and look like duplicate payments.
          received: perTx,
          status: match?.status || 'paid',
          sweep_status: match?.sweep_status || null,
          sweep_tx_hash: match?.sweep_tx_hash || null,
          customer: custLabel(match?.customer_id),
        };
      });

    // Only surface scam/ignored rows here if they hit an address that has
    // NO credited row — otherwise we double every real deposit with its
    // airdropped spam token. Real credited txs are the primary log.
    const creditedAddrs = new Set(registry.map((r) => r.address.toLowerCase()));
    const ignored: any[] = fakes
      .filter((r) => !creditedAddrs.has(r.address.toLowerCase()))
      .map((r) => {
        const match = r.reserved_address_id
          ? reservedById.get(r.reserved_address_id)
          : reservedByAddress.get(r.address.toLowerCase());
        const depositAmount = getDepositUsd(match, r.deposit_id);
        return {
          id: r.id,
          kind: 'ignored' as const,
          date: r.created_at,
          token: sanitizeSymbol(r.token_symbol),
          contract: r.contract,
          address: r.address,
          from: r.from_address,
          tx_hash: r.tx_hash,
          amount: Number(r.amount || 0),
          depositAmount,
          expected: Number(match?.expected_amount || 0),
          received: Number(match?.received_amount || 0),
          status: match?.status || 'pending',
          sweep_status: match?.sweep_status || null,
          sweep_tx_hash: match?.sweep_tx_hash || null,
          customer: custLabel(r.customer_id || match?.customer_id || (r.deposit_id ? deposits[r.deposit_id]?.customer_id : null)),
        };
      });

    const combined = [...credited, ...ignored].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    return combined.filter((r) => {
      if (tokenFilter !== 'all' && r.kind === 'credited' && r.token !== tokenFilter) return false;
      if (sweepFilter !== 'all') {
        if (sweepFilter === 'swept' && r.sweep_status !== 'swept') return false;
        if (sweepFilter === 'pending' && r.sweep_status === 'swept') return false;
        if (sweepFilter === 'error' && r.sweep_status !== 'error') return false;
      }
      if (!q) return true;
      const n = q.toLowerCase();
      return (
        r.tx_hash.toLowerCase().includes(n) ||
        r.address.toLowerCase().includes(n) ||
        (r.from || '').toLowerCase().includes(n) ||
        (r.customer || '').toLowerCase().includes(n) ||
        (r.token || '').toLowerCase().includes(n)
      );
    });
  }, [registry, fakes, reserved, customers, deposits, q, tokenFilter, sweepFilter]);




  const filteredReserved = useMemo(() => {
    return reserved.filter((r) => {
      if (sweepFilter !== 'all') {
        if (sweepFilter === 'swept' && r.sweep_status !== 'swept') return false;
        if (sweepFilter === 'pending' && r.sweep_status === 'swept') return false;
        if (sweepFilter === 'error' && r.sweep_status !== 'error') return false;
      }
      if (!q) return true;
      const n = q.toLowerCase();
      return (
        r.address.toLowerCase().includes(n) ||
        (r.customer_id || '').toLowerCase().includes(n) ||
        (r.deposit_id || '').toLowerCase().includes(n)
      );
    });
  }, [reserved, q, sweepFilter]);

  const filteredFakes = useMemo(() => {
    return fakes.filter((r) => {
      if (!q) return true;
      const n = q.toLowerCase();
      return (
        r.tx_hash.toLowerCase().includes(n) ||
        r.address.toLowerCase().includes(n) ||
        r.contract.toLowerCase().includes(n) ||
        (r.token_symbol || '').toLowerCase().includes(n)
      );
    });
  }, [fakes, q]);

  const stats = useMemo(() => {
    const totalCredited = registry.reduce((s, r) => s + Number(r.amount || 0), 0);
    const activeAddrs = reserved.filter((r) => ['pending', 'paid'].includes(r.status)).length;
    const awaitingSweep = reserved
      .filter((r) => (r.received_amount || 0) > 0 && r.sweep_status !== 'swept')
      .reduce((s, r) => s + Number(r.received_amount || 0), 0);
    const swept = reserved
      .filter((r) => r.sweep_status === 'swept')
      .reduce((s, r) => s + Number(r.received_amount || 0), 0);
    const deferredRows = reserved.filter((r) => r.sweep_status === 'deferred');
    const deferredCount = deferredRows.length;
    const deferredUsd = deferredRows.reduce((s, r) => s + Number(r.received_amount || 0), 0);
    return { totalCredited, activeAddrs, awaitingSweep, swept, fakeCount: fakes.length, deferredCount, deferredUsd };
  }, [registry, reserved, fakes]);

  const [batchSweeping, setBatchSweeping] = useState(false);
  const runBatchSweep = async () => {
    if (!confirm(`Force sweep all pending & deferred deposits now?\n\nThis will sweep even small amounts and cost gas per address.`)) return;
    setBatchSweeping(true);
    try {
      const [bep, ltc] = await Promise.all([
        supabase.functions.invoke('bep20-sweep', { body: { force: true } }),
        supabase.functions.invoke('ltc-sweep', { body: { force: true } }),
      ]);
      const bepOk = !bep.error && (bep.data as any)?.ok;
      const ltcOk = !ltc.error && (ltc.data as any)?.ok;
      const bepChains = (bep.data as any)?.chains || [];
      let sweptCount = 0;
      bepChains.forEach((c: any) => (c.results || []).forEach((r: any) => { if (r.action === 'swept') sweptCount++; }));
      const ltcSwept = (ltc.data as any)?.swept || 0;
      toast.success(`Batch sweep done — BEP20: ${sweptCount} swept, LTC: ${ltcSwept} swept`);
      if (!bepOk) toast.error(`BEP20: ${bep.error?.message || (bep.data as any)?.error || 'failed'}`);
      if (!ltcOk) toast.error(`LTC: ${ltc.error?.message || (ltc.data as any)?.error || 'failed'}`);
      await load();
    } catch (e: any) {
      toast.error(e.message ?? 'Batch sweep failed');
    } finally {
      setBatchSweeping(false);
    }
  };


  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">


      {/* Hero / summary */}
      <Card className="border-border/60 bg-gradient-to-br from-primary/5 via-background to-background">
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Link2 className="h-5 w-5 text-primary" />
              On-Chain Transactions
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Live BEP20 gateway — every incoming USDT/USDC transfer to a per-order address is scanned and credited automatically.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
            <Button size="sm" onClick={runScan} disabled={scanning}>
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              <span className="ml-1.5">Scan now</span>
            </Button>
            <Button
              size="sm"
              variant={stats.deferredCount > 0 ? 'default' : 'outline'}
              onClick={runBatchSweep}
              disabled={batchSweeping}
              title="Force sweep all pending + deferred (small) deposits now"
            >
              {batchSweeping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
              <span className="ml-1.5">
                Sweep all now{stats.deferredCount > 0 ? ` (${stats.deferredCount})` : ''}
              </span>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 pt-0 md:grid-cols-4">
          <Stat label="Total credited" value={`$${stats.totalCredited.toFixed(2)}`} accent="text-success" />
          <Stat label="Active addresses" value={String(stats.activeAddrs)} />
          <Stat label="Auto-swept → main" value={`$${stats.swept.toFixed(2)}`} accent="text-primary" />
          <Stat
            label={stats.deferredCount > 0 ? `Deferred (${stats.deferredCount}) + Awaiting` : 'Awaiting sweep'}
            value={`$${(stats.awaitingSweep).toFixed(2)}`}
            accent={stats.deferredCount > 0 ? 'text-warning' : 'text-warning'}
          />
        </CardContent>
      </Card>


      {/* Gas tank emergency alert (only for visible chains) */}
      {(() => {
        if (!gas) return null;
        const visible = gas.chains.filter((c) => ['bsc','polygon','ethereum'].includes(c.chain));
        const crit = visible.filter((c) => (c.status || (c.ok ? 'ok' : 'critical')) === 'critical');
        const warn = visible.filter((c) => c.status === 'warn');
        return (
          <>
            {crit.length > 0 && (
              <Card className="border-destructive/60 bg-destructive/10">
                <CardContent className="flex items-start gap-3 p-4">
                  <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
                  <div className="flex-1 space-y-1">
                    <div className="text-sm font-semibold text-destructive">
                      ⚠️ EMERGENCY: {crit.length} gas tank{crit.length > 1 ? 's' : ''} depleted — sweeps will fail
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Top up native gas immediately: {crit.map((c) => `${c.native} on ${c.name}`).join(', ')}
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 rounded-md bg-background/60 px-2 py-1.5 font-mono text-[11px]">
                      <span className="text-muted-foreground">Send to:</span>
                      <span>{gas.master}</span>
                      <button onClick={() => copy(gas.master)} className="ml-auto text-primary hover:text-primary/80"><Copy className="h-3 w-3" /></button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            {warn.length > 0 && crit.length === 0 && (
              <Card className="border-warning/60 bg-warning/10">
                <CardContent className="flex items-start gap-3 p-4">
                  <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-warning" />
                  <div className="flex-1 space-y-0.5">
                    <div className="text-sm font-semibold text-warning">
                      {warn.length} gas tank{warn.length > 1 ? 's' : ''} running low
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Top up soon: {warn.map((c) => `${c.native} on ${c.name}`).join(', ')}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        );
      })()}


      {/* Gas tanks */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Fuel className="h-4 w-4 text-primary" />
              Gas tanks — native balance per chain
            </CardTitle>
            {gas?.master && (
              <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                Top-up address: {short(gas.master, 14)}
                <button onClick={() => copy(gas.master)} className="hover:text-foreground"><Copy className="h-3 w-3" /></button>
              </div>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={loadGas} disabled={gasLoading}>
            <RefreshCw className={`h-4 w-4 ${gasLoading ? 'animate-spin' : ''}`} />
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          {!gas ? (
            <div className="py-4 text-center text-xs text-muted-foreground">
              {gasLoading ? 'Loading…' : 'No data'}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {gas.chains.filter((c) => ['bsc','polygon','ethereum'].includes(c.chain)).map((c) => {
                const status = c.status || (c.ok ? 'ok' : 'critical');
                const border =
                  c.error ? 'border-border/60 bg-muted/30'
                  : status === 'critical' ? 'border-destructive/50 bg-destructive/5'
                  : status === 'warn' ? 'border-warning/50 bg-warning/5'
                  : 'border-success/40 bg-success/5';
                const badgeLabel = c.error ? '—' : status === 'critical' ? 'REFILL NOW' : status === 'warn' ? 'LOW' : 'OK';
                const badgeVariant: any = status === 'critical' ? 'destructive' : status === 'warn' ? 'secondary' : 'default';
                return (
                  <div key={c.chain} className={`rounded-lg border p-3 ${border}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-medium">{c.name}</div>
                        <div className="text-[10px] text-muted-foreground">Gas: {c.native}</div>
                      </div>
                      {!c.error && (
                        <Badge variant={badgeVariant} className="h-5 px-1.5 text-[10px]">
                          {badgeLabel}
                        </Badge>
                      )}
                    </div>
                    {c.error ? (
                      <div className="mt-2 text-[10px] text-muted-foreground">{c.error}</div>
                    ) : (
                      <>
                        <div className="mt-2 font-mono text-base font-semibold">
                          {Number(c.balance).toFixed(6)}
                          <span className="ml-1 text-[10px] text-muted-foreground">{c.native}</span>
                        </div>
                        {c.balanceUsd !== null && c.balanceUsd !== undefined && (
                          <div className="text-[11px] text-muted-foreground">
                            ≈ ${c.balanceUsd.toFixed(2)} USD
                          </div>
                        )}
                        <div className="mt-2 flex items-center justify-between border-t border-border/40 pt-1.5 text-[10px] text-muted-foreground">
                          <span>~{c.sweepsRemaining ?? 0} sweeps left</span>
                          <span>min {Number(c.min).toFixed(4)}</span>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
              {ltcGas && (() => {
                const c = ltcGas;
                const status = c.status || 'ok';
                const border =
                  status === 'critical' ? 'border-destructive/50 bg-destructive/5'
                  : status === 'warn' ? 'border-warning/50 bg-warning/5'
                  : 'border-success/40 bg-success/5';
                const badgeLabel = status === 'critical' ? 'REFILL NOW' : status === 'warn' ? 'LOW' : 'OK';
                const badgeVariant: any = status === 'critical' ? 'destructive' : status === 'warn' ? 'secondary' : 'default';
                return (
                  <div key="litecoin" className={`rounded-lg border p-3 ${border}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-medium">Litecoin</div>
                        <div className="text-[10px] text-muted-foreground">Gas: LTC (sweep dest)</div>
                      </div>
                      <Badge variant={badgeVariant} className="h-5 px-1.5 text-[10px]">{badgeLabel}</Badge>
                    </div>
                    <div className="mt-2 font-mono text-base font-semibold">
                      {Number(c.balance).toFixed(6)}
                      <span className="ml-1 text-[10px] text-muted-foreground">LTC</span>
                    </div>
                    {c.balanceUsd !== null && c.balanceUsd !== undefined && (
                      <div className="text-[11px] text-muted-foreground">≈ ${c.balanceUsd.toFixed(2)} USD</div>
                    )}
                    <div className="mt-2 flex items-center justify-between border-t border-border/40 pt-1.5 text-[10px] text-muted-foreground">
                      <span>~{c.sweepsRemaining ?? 0} sweeps left</span>
                      <span>min {Number(c.min).toFixed(4)}</span>
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground italic">
                      Note: balance = deposits + fee reserve
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </CardContent>
      </Card>


      {/* Late Payments */}
      {latePayments.length > 0 && (
        <Card className="border-warning/60 bg-warning/5">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm text-warning">
              <Clock className="h-4 w-4" />
              Late Payments — arrived after checkout window ({latePayments.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 p-4 pt-0">
            <p className="text-xs text-muted-foreground">
              These payments hit expired reservations. Review and one-click credit.
            </p>
            {latePayments.map((lp) => {
              const c = lp._customer;
              const label = c ? (c.first_name || c.username || `#${c.chat_id}`) : lp.customer_id?.slice(0, 8);
              const tx = lp.txn_hash || lp.bep20_tx_hash || lp.ltc_tx_hash;
              return (
                <div key={lp.id} className="flex flex-col gap-2 rounded-md border border-warning/40 bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-col gap-1 text-xs">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">{lp.payment_method || 'on-chain'}</Badge>
                      <span className="font-medium">${Number(lp.amount || 0).toFixed(2)}</span>
                      <span className="text-muted-foreground">→ {label}</span>
                    </div>
                    {tx && (
                      <code className="truncate font-mono text-[10px] text-muted-foreground">{short(tx, 14)}</code>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => creditLatePayment(lp.id)}
                      disabled={creditingId === lp.id}
                    >
                      {creditingId === lp.id
                        ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />Crediting…</>
                        : <><CheckCircle2 className="mr-1 h-3 w-3" />Credit Now</>}
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Lookup */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Search className="h-4 w-4" />
            Look up any transaction on-chain
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="Paste a BEP20 tx hash (0x…)"
            value={lookupHash}
            onChange={(e) => setLookupHash(e.target.value)}
            className="font-mono text-xs"
          />
          <div className="flex gap-2">
            <Button onClick={lookupTx} disabled={lookupBusy}>
              {lookupBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Look up'}
            </Button>
            {lookupHash && (
              <Button
                variant="outline"
                onClick={() => window.open(`${BSCSCAN}/tx/${lookupHash.trim()}`, '_blank')}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent>
        {lookupResult && (
          <div className="border-t border-border/50 px-6 py-2 text-xs text-muted-foreground">{lookupResult}</div>
        )}
      </Card>

      {/* Litecoin gateway */}
      <LtcActivityCard />

      {/* TON gateway */}
      <TonActivityCard />



      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search tx, address, customer, token…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select value={tokenFilter} onValueChange={(v: any) => setTokenFilter(v)}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tokens</SelectItem>
            <SelectItem value="USDT">USDT</SelectItem>
            <SelectItem value="USDC">USDC</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sweepFilter} onValueChange={(v: any) => setSweepFilter(v)}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sweep states</SelectItem>
            <SelectItem value="swept">Swept</SelectItem>
            <SelectItem value="pending">Awaiting sweep</SelectItem>
            <SelectItem value="error">Sweep error</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Content */}
      <LedgerTable rows={filteredRegistry} />

      {/* Unsupported / scam tokens (all chains incl. TON jettons like GRAM) */}
      <FakeTable rows={fakes} customers={customers} />

    </div>
  );
};

const Stat = ({ label, value, accent }: { label: string; value: string; accent?: string }) => (
  <div className="rounded-lg border border-border/60 bg-card/50 p-3">
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    <div className={`mt-1 text-lg font-semibold ${accent || ''}`}>{value}</div>
  </div>
);

const TabPill = ({
  active, onClick, icon, label, count, tone,
}: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count: number; tone?: 'destructive';
}) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
      active
        ? 'border-primary bg-primary/10 text-primary'
        : 'border-border/60 bg-card/40 text-muted-foreground hover:text-foreground'
    }`}
  >
    {icon}
    {label}
    <Badge variant={tone === 'destructive' ? 'destructive' : 'secondary'} className="ml-1 h-4 min-w-4 px-1 text-[10px]">
      {count}
    </Badge>
  </button>
);

type LedgerRow = {
  id: string;
  kind: 'credited' | 'ignored';
  date: string;
  token: string;
  address: string;
  from: string | null;
  tx_hash: string;
  amount: number;
  depositAmount?: number;
  expected?: number;
  received?: number;
  status?: string;
  sweep_status?: string | null;
  sweep_tx_hash?: string | null;
  contract?: string | null;
  customer?: string;
};

const LedgerTable = ({ rows }: { rows: LedgerRow[] }) => (
  <Card>
    <CardContent className="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="border-b border-border/60 bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Address</th>
              <th className="px-3 py-2">Token</th>
              <th className="px-3 py-2 text-right">Expected</th>
              <th className="px-3 py-2 text-right">Received</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Sweep</th>
              <th className="px-3 py-2">From</th>
              <th className="px-3 py-2">Tx</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">No records</td></tr>
            )}
            {rows.map((r) => {
              const isIgnored = r.kind === 'ignored';
              return (
                <tr key={`${r.kind}-${r.id}`} className="border-b border-border/40 hover:bg-muted/30">
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {new Date(r.date).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">{r.customer || '—'}</td>
                  <td className="px-3 py-2 font-mono">
                    <a href={`${BSCSCAN}/address/${r.address}`} target="_blank" rel="noreferrer"
                       className="text-primary hover:underline" title={r.address}>
                      {short(r.address, 6)}
                    </a>
                  </td>
                  <td className="px-3 py-2">
                    {isIgnored ? (
                      <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
                        {r.token}
                      </Badge>
                    ) : (
                      <Badge className="bg-success/10 text-success ring-1 ring-success/30">
                        {r.token}
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-muted-foreground">
                    {r.expected && r.expected > 0 ? r.expected.toFixed(2) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {r.received && r.received > 0 ? (
                      <span className={`font-semibold ${isIgnored ? 'text-warning' : 'text-success'}`}>
                        {r.received.toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2"><StatusBadge status={r.status || 'pending'} /></td>
                  <td className="px-3 py-2"><SweepBadge status={r.sweep_status || null} txHash={r.sweep_tx_hash || null} /></td>
                  <td className="px-3 py-2 font-mono">
                    {r.from ? (
                      <a href={`${BSCSCAN}/address/${r.from}`} target="_blank" rel="noreferrer"
                         className="text-muted-foreground hover:text-primary" title={r.from}>
                        {short(r.from, 6)}
                      </a>
                    ) : (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    <a href={`${BSCSCAN}/tx/${r.tx_hash}`} target="_blank" rel="noreferrer"
                       className="inline-flex items-center gap-1 text-primary hover:underline">
                      {short(r.tx_hash, 6)} <ExternalLink className="h-3 w-3" />
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </CardContent>
  </Card>
);



const AddressesTable = ({ rows, customers }: { rows: ReservedRow[]; customers: Record<string, CustomerLite> }) => (
  <Card>
    <CardContent className="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="border-b border-border/60 bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Address</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2 text-right">Expected</th>
              <th className="px-3 py-2 text-right">Received</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Sweep</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No addresses</td></tr>
            )}
            {rows.map((r) => {
              const cust = r.customer_id ? customers[r.customer_id] : null;
              const custLabel = cust
                ? (cust.username ? `@${cust.username}` : cust.first_name || `#${cust.chat_id ?? '—'}`)
                : '—';
              return (
                <tr key={r.id} className="border-b border-border/40 hover:bg-muted/30">
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    <a href={`${BSCSCAN}/address/${r.address}`} target="_blank" rel="noreferrer"
                       className="text-primary hover:underline">
                      {short(r.address, 8)}
                    </a>
                  </td>
                  <td className="px-3 py-2">{custLabel}</td>
                  <td className="px-3 py-2 text-right">{Number(r.expected_amount || 0).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-medium">
                    {Number(r.received_amount || 0).toFixed(2)}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-3 py-2">
                    <SweepBadge status={r.sweep_status} txHash={r.sweep_tx_hash} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </CardContent>
  </Card>
);

const FakeTable = ({ rows, customers }: { rows: FakeRow[]; customers: Record<string, CustomerLite> }) => (
  <Card className="border-destructive/30">
    <CardHeader className="pb-2">
      <CardTitle className="flex items-center gap-2 text-sm text-destructive">
        <ShieldAlert className="h-4 w-4" />
        Unsupported / Scam tokens detected
      </CardTitle>
      <p className="text-[11px] text-muted-foreground">
        These transfers reached a gateway address but the contract is NOT a whitelisted stablecoin (USDT/USDC).
        Usually unsolicited scam-airdrop tokens sent by bots to trick users into interacting with malicious contracts.
        Nothing is credited — listed here for audit only. <strong>Do not interact with these contracts.</strong>
      </p>
    </CardHeader>
    <CardContent className="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="border-b border-border/60 bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Token</th>
              <th className="px-3 py-2">Contract</th>
              <th className="px-3 py-2">To (gateway)</th>
              <th className="px-3 py-2">From</th>
              <th className="px-3 py-2">Tx</th>
              <th className="px-3 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                No unsupported/scam tokens detected 🎉
              </td></tr>
            )}
            {rows.map((r) => {
              const cust = r.customer_id ? customers[r.customer_id] : null;
              const custLabel = cust
                ? (cust.username ? `@${cust.username}` : cust.first_name || `#${cust.chat_id ?? '—'}`)
                : '—';
              return (
                <tr key={r.id} className="border-b border-border/40 hover:bg-destructive/5">
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">{custLabel}</td>
                  <td className="px-3 py-2">
                    <Badge variant="destructive" className="bg-destructive/10 text-destructive ring-1 ring-destructive/30">
                      {r.token_symbol || '?'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 font-mono">
                    <a href={`${BSCSCAN}/token/${r.contract}`} target="_blank" rel="noreferrer"
                       className="hover:text-primary">{short(r.contract, 8)}</a>
                  </td>
                  <td className="px-3 py-2 font-mono">{short(r.address, 8)}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{short(r.from_address, 8)}</td>
                  <td className="px-3 py-2 font-mono">
                    <a href={`${BSCSCAN}/tx/${r.tx_hash}`} target="_blank" rel="noreferrer"
                       className="text-primary hover:underline">
                      {short(r.tx_hash, 8)} <ExternalLink className="ml-1 inline h-3 w-3" />
                    </a>
                  </td>
                  <td className="px-3 py-2">
                    <code className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive">
                      {r.reason}
                    </code>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </CardContent>
  </Card>
);

const StatusBadge = ({ status }: { status: string }) => {
  const map: Record<string, string> = {
    pending: 'bg-warning/10 text-warning ring-1 ring-warning/30',
    paid: 'bg-success/10 text-success ring-1 ring-success/30',
    expired: 'bg-muted text-muted-foreground ring-1 ring-border',
    swept: 'bg-primary/10 text-primary ring-1 ring-primary/30',
  };
  return <Badge className={map[status] || 'bg-muted'}>{status}</Badge>;
};

const SweepBadge = ({ status, txHash }: { status: string | null; txHash: string | null }) => {
  if (!status || status === 'idle') return <span className="text-muted-foreground">—</span>;
  const map: Record<string, string> = {
    swept: 'bg-success/10 text-success ring-1 ring-success/30',
    error: 'bg-destructive/10 text-destructive ring-1 ring-destructive/30',
    funding_gas: 'bg-warning/10 text-warning ring-1 ring-warning/30',
    ready: 'bg-primary/10 text-primary ring-1 ring-primary/30',
  };
  return (
    <div className="flex items-center gap-1.5">
      <Badge className={map[status] || 'bg-muted'}>{status}</Badge>
      {txHash && (
        <a href={`${BSCSCAN}/tx/${txHash}`} target="_blank" rel="noreferrer"
           className="text-muted-foreground hover:text-primary">
          <ArrowRight className="h-3 w-3" />
        </a>
      )}
    </div>
  );
};

export default OnChainActivityTab;
