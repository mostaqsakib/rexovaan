import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Loader2, TrendingUp, DollarSign, ShoppingBag, Users, Calendar, Trophy, Clock, Sparkles, Package } from 'lucide-react';
import { cn } from '@/lib/utils';

type Order = {
  id: string;
  product_name: string | null;
  product_id: string | null;
  quantity: number | null;
  total_price: number | null;
  status: string | null;
  payment_method: string | null;
  source: string | null;
  customer_id: string | null;
  created_at: string;
};

const DELIVERED = new Set(['delivered', 'completed']);

function startOf(daysAgo: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d;
}

function fmtUSD(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

const DashboardTab = () => {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [firstOrderAt, setFirstOrderAt] = useState<string | null>(null);
  const [customerCount, setCustomerCount] = useState(0);
  const [productCount, setProductCount] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      // Pull last ~180 days of delivered orders in pages of 1000
      const sinceISO = startOf(180).toISOString();
      const all: Order[] = [];
      let from = 0;
      const PAGE = 1000;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await supabase
          .from('bot_orders')
          .select('id,product_name,product_id,quantity,total_price,status,payment_method,source,customer_id,created_at')
          .in('status', ['delivered', 'completed'])
          .gte('created_at', sinceISO)
          .order('created_at', { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) break;
        if (!data || data.length === 0) break;
        all.push(...(data as Order[]));
        if (data.length < PAGE) break;
        from += PAGE;
      }
      setOrders(all);

      const [{ data: first }, { count: cCount }, { count: pCount }] = await Promise.all([
        supabase
          .from('bot_orders')
          .select('created_at')
          .in('status', ['delivered', 'completed'])
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle(),
        supabase.from('bot_customers').select('id', { count: 'exact', head: true }),
        supabase.from('bot_products').select('id', { count: 'exact', head: true }),
      ]);
      setFirstOrderAt(first?.created_at ?? null);
      setCustomerCount(cCount || 0);
      setProductCount(pCount || 0);
      setLoading(false);
    })();
  }, []);

  const stats = useMemo(() => {
    const today = startOf(0);
    const d7 = startOf(6);
    const d30 = startOf(29);
    const buckets = {
      today: { rev: 0, count: 0 },
      d7: { rev: 0, count: 0 },
      d30: { rev: 0, count: 0 },
      all: { rev: 0, count: 0 },
    };
    for (const o of orders) {
      const rev = Number(o.total_price) || 0;
      const at = new Date(o.created_at);
      buckets.all.rev += rev;
      buckets.all.count += 1;
      if (at >= d30) { buckets.d30.rev += rev; buckets.d30.count += 1; }
      if (at >= d7) { buckets.d7.rev += rev; buckets.d7.count += 1; }
      if (at >= today) { buckets.today.rev += rev; buckets.today.count += 1; }
    }
    return buckets;
  }, [orders]);

  const chart = useMemo(() => {
    const days: { date: Date; rev: number; count: number; label: string }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = startOf(i);
      days.push({ date: d, rev: 0, count: 0, label: d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) });
    }
    const map = new Map(days.map(d => [d.date.toDateString(), d]));
    for (const o of orders) {
      const key = new Date(o.created_at); key.setHours(0, 0, 0, 0);
      const b = map.get(key.toDateString());
      if (b) { b.rev += Number(o.total_price) || 0; b.count += 1; }
    }
    const maxRev = Math.max(1, ...days.map(d => d.rev));
    return { days, maxRev };
  }, [orders]);

  const topProducts = useMemo(() => {
    const m = new Map<string, { name: string; qty: number; rev: number }>();
    for (const o of orders) {
      const key = o.product_name || 'Unknown';
      const cur = m.get(key) || { name: key, qty: 0, rev: 0 };
      cur.qty += Number(o.quantity) || 0;
      cur.rev += Number(o.total_price) || 0;
      m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => b.rev - a.rev).slice(0, 6);
  }, [orders]);

  const paymentBreakdown = useMemo(() => {
    const m = new Map<string, { method: string; rev: number; count: number }>();
    for (const o of orders) {
      const k = (o.payment_method || 'Other').trim() || 'Other';
      const cur = m.get(k) || { method: k, rev: 0, count: 0 };
      cur.rev += Number(o.total_price) || 0;
      cur.count += 1;
      m.set(k, cur);
    }
    const total = [...m.values()].reduce((s, x) => s + x.rev, 0) || 1;
    return [...m.values()].sort((a, b) => b.rev - a.rev).map(x => ({ ...x, pct: (x.rev / total) * 100 }));
  }, [orders]);

  const recent = orders.slice(0, 8);

  const daysSinceStart = firstOrderAt
    ? Math.max(1, Math.floor((Date.now() - new Date(firstOrderAt).getTime()) / 86400000))
    : 0;

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hero header */}
      <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background p-5 sm:p-6">
        <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/20 blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> Admin Overview
            </div>
            <h2 className="mt-1 font-heading text-2xl font-bold gradient-text sm:text-3xl">
              Welcome back, Boss 👑
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {firstOrderAt ? (
                <>Business running since <span className="font-medium text-foreground">{fmtDate(new Date(firstOrderAt))}</span> · <span className="text-primary">{daysSinceStart} days</span></>
              ) : 'No orders yet'}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center sm:text-right">
            <MiniPill label="Customers" value={customerCount.toLocaleString()} icon={Users} />
            <MiniPill label="Products" value={productCount.toLocaleString()} icon={Package} />
            <MiniPill label="Lifetime" value={fmtUSD(stats.all.rev)} icon={TrendingUp} />
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Today"
          revenue={stats.today.rev}
          orders={stats.today.count}
          icon={Clock}
          tint="from-emerald-500/20 to-emerald-500/0"
          accent="text-emerald-400"
        />
        <KpiCard
          label="Last 7 days"
          revenue={stats.d7.rev}
          orders={stats.d7.count}
          icon={Calendar}
          tint="from-blue-500/20 to-blue-500/0"
          accent="text-blue-400"
        />
        <KpiCard
          label="Last 30 days"
          revenue={stats.d30.rev}
          orders={stats.d30.count}
          icon={TrendingUp}
          tint="from-violet-500/20 to-violet-500/0"
          accent="text-violet-400"
        />
        <KpiCard
          label="All time"
          revenue={stats.all.rev}
          orders={stats.all.count}
          icon={DollarSign}
          tint="from-amber-500/20 to-amber-500/0"
          accent="text-amber-400"
        />
      </div>

      {/* Chart + Top products */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="font-heading text-base font-semibold">Revenue · Last 30 days</h3>
              <p className="text-xs text-muted-foreground">Daily delivered orders</p>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold">{fmtUSD(stats.d30.rev)}</div>
              <div className="text-[11px] text-muted-foreground">{stats.d30.count} orders</div>
            </div>
          </div>
          <div className="flex h-52 items-end gap-1.5">
            {chart.days.map((d, i) => {
              const h = (d.rev / chart.maxRev) * 100;
              const isToday = i === chart.days.length - 1;
              return (
                <div key={i} className="group relative flex flex-1 flex-col items-center justify-end">
                  <div
                    className={cn(
                      'w-full rounded-t-md transition-all',
                      isToday
                        ? 'bg-gradient-to-t from-primary to-primary/40 shadow-[0_0_10px_hsl(var(--primary)/0.4)]'
                        : 'bg-gradient-to-t from-primary/70 to-primary/20 hover:from-primary hover:to-primary/50',
                    )}
                    style={{ height: `${Math.max(2, h)}%` }}
                  />
                  <div className="pointer-events-none absolute -top-10 z-10 hidden rounded-md border border-border bg-popover px-2 py-1 text-[10px] shadow-lg group-hover:block">
                    <div className="font-semibold">{fmtUSD(d.rev)}</div>
                    <div className="text-muted-foreground">{d.count} orders · {d.label}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
            <span>{chart.days[0].label}</span>
            <span>{chart.days[Math.floor(chart.days.length / 2)].label}</span>
            <span>Today</span>
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-400" />
            <h3 className="font-heading text-base font-semibold">Top Selling</h3>
          </div>
          <div className="space-y-3">
            {topProducts.length === 0 && <div className="text-sm text-muted-foreground">No sales yet</div>}
            {topProducts.map((p, i) => {
              const max = topProducts[0]?.rev || 1;
              const w = (p.rev / max) * 100;
              return (
                <div key={p.name}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                        i === 0 ? 'bg-amber-500/20 text-amber-400' :
                        i === 1 ? 'bg-slate-400/20 text-slate-300' :
                        i === 2 ? 'bg-orange-700/20 text-orange-400' :
                        'bg-muted text-muted-foreground'
                      )}>{i + 1}</span>
                      <span className="truncate text-sm font-medium">{p.name}</span>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-primary">{fmtUSD(p.rev)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary to-primary/50"
                      style={{ width: `${w}%` }}
                    />
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{p.qty} units sold</div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Payment breakdown + recent activity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <h3 className="mb-4 font-heading text-base font-semibold">Payment Methods</h3>
          <div className="space-y-3">
            {paymentBreakdown.length === 0 && <div className="text-sm text-muted-foreground">No data</div>}
            {paymentBreakdown.map((p) => (
              <div key={p.method}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium">{p.method}</span>
                  <span className="text-muted-foreground">{fmtUSD(p.rev)} · {p.count}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500"
                    style={{ width: `${p.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="lg:col-span-2 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-heading text-base font-semibold">Recent Orders</h3>
            <ShoppingBag className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            {recent.length === 0 && <div className="text-sm text-muted-foreground">No orders yet</div>}
            {recent.map((o) => (
              <div
                key={o.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card/50 px-3 py-2 transition-colors hover:border-primary/30 hover:bg-card"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{o.product_name || 'Unknown'}</div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{new Date(o.created_at).toLocaleString('en-US', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    <span>·</span>
                    <span>{o.payment_method || o.source || '—'}</span>
                    <span>·</span>
                    <span>Qty {o.quantity}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-primary">{fmtUSD(Number(o.total_price) || 0)}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};

const MiniPill = ({ label, value, icon: Icon }: { label: string; value: string; icon: any }) => (
  <div className="rounded-xl border border-border/50 bg-card/60 px-3 py-2 backdrop-blur">
    <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground sm:justify-end">
      <Icon className="h-3 w-3" /> {label}
    </div>
    <div className="mt-0.5 text-sm font-bold sm:text-base">{value}</div>
  </div>
);

const KpiCard = ({
  label, revenue, orders, icon: Icon, tint, accent,
}: { label: string; revenue: number; orders: number; icon: any; tint: string; accent: string }) => (
  <Card className={cn('relative overflow-hidden p-5')}>
    <div className={cn('absolute inset-0 bg-gradient-to-br', tint)} />
    <div className="relative">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={cn('rounded-lg bg-background/60 p-1.5', accent)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-3 font-heading text-2xl font-bold">{fmtUSD(revenue)}</div>
      <div className="mt-1 text-xs text-muted-foreground">{orders.toLocaleString()} orders</div>
    </div>
  </Card>
);

export default DashboardTab;
