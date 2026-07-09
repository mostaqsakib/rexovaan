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
  ShieldAlert, Wallet, ArrowRight, CheckCircle2, Clock,
} from 'lucide-react';


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
  reason: string;
  created_at: string;
};

type CustomerLite = { id: string; chat_id: number | null; username: string | null; first_name: string | null };

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
  if (n >= 1e6) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return n.toLocaleString();
};

const copy = (text: string) => {
  navigator.clipboard.writeText(text);
  toast.success('Copied');
};

const OnChainActivityTab = () => {
  const [registry, setRegistry] = useState<RegistryRow[]>([]);
  const [reserved, setReserved] = useState<ReservedRow[]>([]);
  const [fakes, setFakes] = useState<FakeRow[]>([]);
  const [customers, setCustomers] = useState<Record<string, CustomerLite>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [tab, setTab] = useState<'ledger' | 'addresses' | 'fake'>('ledger');
  const [q, setQ] = useState('');
  const [tokenFilter, setTokenFilter] = useState<'all' | 'USDT' | 'USDC'>('all');
  const [sweepFilter, setSweepFilter] = useState<'all' | 'swept' | 'pending' | 'error'>('all');
  const [lookupHash, setLookupHash] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupResult, setLookupResult] = useState<string | null>(null);

  const load = async () => {
    setRefreshing(true);
    const [reg, res, fk] = await Promise.all([
      supabase.from('bep20_payment_registry').select('*').order('credited_at', { ascending: false }).limit(500),
      supabase.from('bep20_reserved_addresses').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('bep20_fake_transactions').select('*').order('created_at', { ascending: false }).limit(500),
    ]);
    if (reg.error) toast.error(reg.error.message);
    setRegistry((reg.data || []) as RegistryRow[]);
    setReserved((res.data || []) as ReservedRow[]);
    setFakes((fk.data || []) as FakeRow[]);

    const custIds = new Set<string>();
    (res.data || []).forEach((r: any) => r.customer_id && custIds.add(r.customer_id));
    (fk.data || []).forEach((r: any) => r.customer_id && custIds.add(r.customer_id));
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

  useEffect(() => { void load(); }, []);

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
    const credited: any[] = registry.map((r) => ({
      id: r.id,
      kind: 'credited' as const,
      date: r.credited_at,
      token: r.token,
      address: r.address,
      tx_hash: r.tx_hash,
      amount: Number(r.amount || 0),
    }));
    const ignored: any[] = fakes.map((r) => ({
      id: r.id,
      kind: 'ignored' as const,
      date: r.created_at,
      token: sanitizeSymbol(r.token_symbol),
      address: r.address,
      tx_hash: r.tx_hash,
      amount: Number(r.amount || 0),
      contract: r.contract,
    }));
    const combined = [...credited, ...ignored].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    return combined.filter((r) => {
      if (tokenFilter !== 'all' && r.kind === 'credited' && r.token !== tokenFilter) return false;
      if (!q) return true;
      const n = q.toLowerCase();
      return (
        r.tx_hash.toLowerCase().includes(n) ||
        r.address.toLowerCase().includes(n) ||
        (r.token || '').toLowerCase().includes(n)
      );
    });
  }, [registry, fakes, q, tokenFilter]);


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
    return { totalCredited, activeAddrs, awaitingSweep, swept, fakeCount: fakes.length };
  }, [registry, reserved, fakes]);

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
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
            <Button size="sm" onClick={runScan} disabled={scanning}>
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              <span className="ml-1.5">Scan now</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 pt-0 md:grid-cols-4">
          <Stat label="Total credited" value={`$${stats.totalCredited.toFixed(2)}`} accent="text-success" />
          <Stat label="Active addresses" value={String(stats.activeAddrs)} />
          <Stat label="Auto-swept → main" value={`$${stats.swept.toFixed(2)}`} accent="text-primary" />
          <Stat label="Awaiting sweep" value={`$${stats.awaitingSweep.toFixed(2)}`} accent="text-warning" />
        </CardContent>
      </Card>

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

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        <TabPill active={tab === 'ledger'} onClick={() => setTab('ledger')}
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          label="On-chain log" count={registry.length} />
        <TabPill active={tab === 'addresses'} onClick={() => setTab('addresses')}
          icon={<Wallet className="h-3.5 w-3.5" />}
          label="Per-order addresses" count={reserved.length} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search tx, address, contract, deposit id…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {tab === 'ledger' && (
          <Select value={tokenFilter} onValueChange={(v: any) => setTokenFilter(v)}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tokens</SelectItem>
              <SelectItem value="USDT">USDT</SelectItem>
              <SelectItem value="USDC">USDC</SelectItem>
            </SelectContent>
          </Select>
        )}
        {tab === 'addresses' && (
          <Select value={sweepFilter} onValueChange={(v: any) => setSweepFilter(v)}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sweep states</SelectItem>
              <SelectItem value="swept">Swept</SelectItem>
              <SelectItem value="pending">Awaiting sweep</SelectItem>
              <SelectItem value="error">Sweep error</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Content */}
      {tab === 'ledger' && <LedgerTable rows={filteredRegistry} />}
      {tab === 'addresses' && <AddressesTable rows={filteredReserved} customers={customers} />}
      {tab === 'fake' && <FakeTable rows={filteredFakes} customers={customers} />}
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
  tx_hash: string;
  amount: number;
  contract?: string;
};

const LedgerTable = ({ rows }: { rows: LedgerRow[] }) => (
  <Card>
    <CardContent className="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="border-b border-border/60 bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Token</th>
              <th className="px-3 py-2">Destination</th>
              <th className="px-3 py-2">Tx hash</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No records</td></tr>
            )}
            {rows.map((r) => {
              const isIgnored = r.kind === 'ignored';
              return (
                <tr key={`${r.kind}-${r.id}`} className="border-b border-border/40 hover:bg-muted/30">
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {new Date(r.date).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    {isIgnored ? (
                      <div className="flex flex-col gap-0.5">
                        <Badge variant="outline" className="w-fit border-warning/40 bg-warning/10 text-warning">
                          {r.token}
                        </Badge>
                        {r.contract && (
                          <a
                            href={`${BSCSCAN}/token/${r.contract}`}
                            target="_blank" rel="noreferrer"
                            className="font-mono text-[10px] text-muted-foreground hover:text-primary"
                            title={r.contract}
                          >
                            {short(r.contract, 6)}
                          </a>
                        )}
                      </div>
                    ) : (
                      <Badge variant="outline" className="border-primary/40 bg-primary/5 text-primary">
                        {r.token} · BEP20
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    <button onClick={() => copy(r.address)} className="hover:text-primary">
                      {short(r.address, 8)} <Copy className="ml-1 inline h-3 w-3" />
                    </button>
                  </td>
                  <td className="px-3 py-2 font-mono">
                    <a
                      href={`${BSCSCAN}/tx/${r.tx_hash}`}
                      target="_blank" rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      {short(r.tx_hash, 8)}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {isIgnored ? (
                      <div className="flex flex-col items-end leading-tight">
                        <span className="font-semibold text-warning" title="Raw token units — decimals unknown for unsupported tokens">
                          {formatRaw(r.amount)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">raw units</span>
                      </div>
                    ) : (
                      <span className="font-semibold text-success">
                        {Number(r.amount).toFixed(2)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {isIgnored ? (
                      <Badge variant="outline" className="border-muted-foreground/30 bg-muted/30 text-muted-foreground">
                        spam · ignored
                      </Badge>
                    ) : (
                      <Badge className="bg-success/10 text-success ring-1 ring-success/30">credited</Badge>
                    )}
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
