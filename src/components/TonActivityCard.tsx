import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, ExternalLink, Gem } from 'lucide-react';

type TonRow = {
  id: string;
  customer_id: string | null;
  deposit_id: string | null;
  memo: string;
  expected_amount: number | null;
  received_amount: number | null;
  asset: string | null;
  asset_amount: number | null;
  status: string;
  tx_hash: string | null;
  from_address: string | null;
  paid_at: string | null;
  created_at: string;
};

type CustomerLite = { id: string; chat_id: number | null; username: string | null; first_name: string | null };

const short = (s?: string | null, n = 6) => (s ? `${s.slice(0, n)}…${s.slice(-4)}` : '—');

const statusTone = (s: string) => {
  if (s === 'paid') return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
  if (s === 'late_paid') return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
  if (s === 'pending') return 'bg-sky-500/15 text-sky-400 border-sky-500/30';
  return 'bg-muted text-muted-foreground border-border/60';
};

const TonActivityCard = () => {
  const [rows, setRows] = useState<TonRow[]>([]);
  const [customers, setCustomers] = useState<Record<string, CustomerLite>>({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('ton_reserved_deposits')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    const list = (data || []) as unknown as TonRow[];
    setRows(list);
    const ids = Array.from(new Set(list.map((r) => r.customer_id).filter(Boolean))) as string[];
    if (ids.length) {
      const { data: cd } = await supabase
        .from('bot_customers')
        .select('id, chat_id, username, first_name')
        .in('id', ids);
      const map: Record<string, CustomerLite> = {};
      (cd || []).forEach((c: any) => { map[c.id] = c; });
      setCustomers(map);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Gem className="h-4 w-4 text-sky-400" />
            TON gateway activity
          </CardTitle>
          <p className="text-[11px] text-muted-foreground">
            Memo-based TON deposits. Shows the actual coin received (TON or USDT) and its USD value.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-border/60 bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Memo</th>
                <th className="px-3 py-2">Coin received</th>
                <th className="px-3 py-2 text-right">USD</th>
                <th className="px-3 py-2 text-right">Expected</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Tx</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No TON deposits yet</td></tr>
              )}
              {rows.map((r) => {
                const c = r.customer_id ? customers[r.customer_id] : null;
                const label = c ? (c.username ? `@${c.username}` : c.first_name || `#${c.chat_id ?? '—'}`) : '—';
                const coin = (r.asset || 'USDT').toUpperCase();
                const coinAmt = Number(r.asset_amount || 0);
                return (
                  <tr key={r.id} className="border-b border-border/40 hover:bg-muted/30">
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {new Date(r.paid_at || r.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">{label}</td>
                    <td className="px-3 py-2 font-mono">{r.memo}</td>
                    <td className="px-3 py-2">
                      {coinAmt > 0 ? (
                        <span className="font-medium">
                          {coin === 'TON' ? coinAmt.toFixed(4) : coinAmt.toFixed(2)}{' '}
                          <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{coin}</Badge>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {Number(r.received_amount || 0) > 0 ? `$${Number(r.received_amount).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      ${Number(r.expected_amount || 0).toFixed(2)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className={statusTone(r.status)}>{r.status}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      {r.tx_hash ? (
                        <a
                          href={`https://tonviewer.com/transaction/${r.tx_hash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-primary hover:underline"
                        >
                          {short(r.tx_hash)} <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : '—'}
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
};

export default TonActivityCard;
