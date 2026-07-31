import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import InventoryValueCard from '@/components/InventoryValueCard';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import {
  Loader2, TrendingUp, DollarSign, ShoppingBag, Users, Calendar as CalendarIcon, Trophy, Clock,
  Sparkles, Package, Globe, Bot, Hash, Wallet, UserPlus, Repeat, BarChart3, Target, Filter, X,
} from 'lucide-react';
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

function startOf(daysAgo: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d;
}

const fmtUSD = (n: number) =>
  `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtInt = (n: number) => (n || 0).toLocaleString('en-US');
const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });

type Bucket = { rev: number; count: number; qty: number; web: number; bot: number; webCount: number; botCount: number };
const emptyBucket = (): Bucket => ({ rev: 0, count: 0, qty: 0, web: 0, bot: 0, webCount: 0, botCount: 0 });

const DashboardTab = () => {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loadedSince, setLoadedSince] = useState<Date>(() => startOf(180));
  const [firstOrderAt, setFirstOrderAt] = useState<string | null>(null);
  const [customerCount, setCustomerCount] = useState(0);
  const [productCount, setProductCount] = useState(0);
  const [newCustomers7d, setNewCustomers7d] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [depositTotals, setDepositTotals] = useState({ verified: 0, pending: 0 });
  const [range, setRange] = useState<DateRange | undefined>();
  const [rangeLoading, setRangeLoading] = useState(false);
  const [customerMap, setCustomerMap] = useState<Record<string, { username: string | null; first_name: string | null; chat_id: string | null }>>({});

  const fetchOrdersSince = async (since: Date) => {
    const sinceISO = since.toISOString();
    const all: Order[] = [];
    let from = 0;
    const PAGE = 1000;
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
    return all;
  };

  const loadDashboard = async () => {
    setLoading(true);
    const sinceForLoad = rangeBounds ? new Date(Math.min(rangeBounds.from.getTime(), startOf(180).getTime())) : startOf(180);
    const all = await fetchOrdersSince(sinceForLoad);
    setOrders(all);
    setLoadedSince(sinceForLoad);

    const since7 = startOf(6).toISOString();
    const [{ data: first }, { count: cCount }, { count: pCount }, { count: pendCount }, { count: newC }] = await Promise.all([
      supabase.from('bot_orders').select('created_at').in('status', ['delivered', 'completed']).order('created_at', { ascending: true }).limit(1).maybeSingle(),
      supabase.from('bot_customers').select('id', { count: 'exact', head: true }),
      supabase.from('bot_products').select('id', { count: 'exact', head: true }),
      supabase.from('bot_orders').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('bot_customers').select('id', { count: 'exact', head: true }).gte('created_at', since7),
    ]);
    setFirstOrderAt(first?.created_at ?? null);
    setCustomerCount(cCount || 0);
    setProductCount(pCount || 0);
    setPendingCount(pendCount || 0);
    setNewCustomers7d(newC || 0);

    const { data: dep } = await supabase
      .from('bot_deposits')
      .select('amount_usd,status')
      .gte('created_at', startOf(30).toISOString());
    let vSum = 0, pSum = 0;
    (dep || []).forEach((d: any) => {
      const v = Number(d.amount_usd) || 0;
      if (d.status === 'verified' || d.status === 'completed') vSum += v;
      else if (d.status === 'pending') pSum += v;
    });
    setDepositTotals({ verified: vSum, pending: pSum });

    setLoading(false);
  };

  useEffect(() => {
    void loadDashboard();
    const onRefresh = () => { void loadDashboard(); };
    window.addEventListener('dashboard:refresh', onRefresh);
    return () => window.removeEventListener('dashboard:refresh', onRefresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Expand order fetch when custom range extends earlier than what's loaded
  useEffect(() => {
    if (!range?.from) return;
    const from = new Date(range.from); from.setHours(0, 0, 0, 0);
    if (from >= loadedSince) return;
    (async () => {
      setRangeLoading(true);
      const all = await fetchOrdersSince(from);
      setOrders(all);
      setLoadedSince(from);
      setRangeLoading(false);
    })();
  }, [range, loadedSince]);

  // Custom range: inclusive [from 00:00, to 23:59]
  const rangeBounds = useMemo(() => {
    if (!range?.from) return null;
    const from = new Date(range.from); from.setHours(0, 0, 0, 0);
    const to = new Date(range.to ?? range.from); to.setHours(23, 59, 59, 999);
    return { from, to };
  }, [range]);

  const filteredOrders = useMemo(() => {
    if (!rangeBounds) return orders;
    return orders.filter(o => {
      const at = new Date(o.created_at).getTime();
      return at >= rangeBounds.from.getTime() && at <= rangeBounds.to.getTime();
    });
  }, [orders, rangeBounds]);

  const stats = useMemo(() => {
    const today = startOf(0), d7 = startOf(6), d30 = startOf(29);
    const b = {
      today: emptyBucket(), d7: emptyBucket(), d30: emptyBucket(), all: emptyBucket(), custom: emptyBucket(),
    };
    const add = (bk: Bucket, o: Order) => {
      const rev = Number(o.total_price) || 0;
      const q = Number(o.quantity) || 0;
      bk.rev += rev; bk.count += 1; bk.qty += q;
      if (o.source === 'web') { bk.web += rev; bk.webCount += 1; }
      else { bk.bot += rev; bk.botCount += 1; }
    };
    for (const o of orders) {
      const at = new Date(o.created_at);
      add(b.all, o);
      if (at >= d30) add(b.d30, o);
      if (at >= d7) add(b.d7, o);
      if (at >= today) add(b.today, o);
    }
    for (const o of filteredOrders) add(b.custom, o);
    return b;
  }, [orders, filteredOrders]);

  const chart = useMemo(() => {
    // If custom range is set, chart spans that range (capped at 60 buckets); else last 30 days
    let days: { date: Date; web: number; bot: number; count: number; label: string }[] = [];
    if (rangeBounds) {
      const start = rangeBounds.from;
      const end = new Date(rangeBounds.to); end.setHours(0, 0, 0, 0);
      const spanDays = Math.min(60, Math.floor((end.getTime() - start.getTime()) / 86400000) + 1);
      for (let i = 0; i < spanDays; i++) {
        const d = new Date(start); d.setDate(d.getDate() + i);
        days.push({ date: d, web: 0, bot: 0, count: 0, label: d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) });
      }
    } else {
      for (let i = 29; i >= 0; i--) {
        const d = startOf(i);
        days.push({ date: d, web: 0, bot: 0, count: 0, label: d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) });
      }
    }
    const map = new Map(days.map(d => [d.date.toDateString(), d]));
    const source = rangeBounds ? filteredOrders : orders;
    for (const o of source) {
      const key = new Date(o.created_at); key.setHours(0, 0, 0, 0);
      const b = map.get(key.toDateString());
      if (!b) continue;
      const rev = Number(o.total_price) || 0;
      if (o.source === 'web') b.web += rev;
      else b.bot += rev;
      b.count += 1;
    }
    const maxRev = Math.max(1, ...days.map(d => d.web + d.bot));
    return { days, maxRev };
  }, [orders, filteredOrders, rangeBounds]);

  const topProducts = useMemo(() => {
    const m = new Map<string, { name: string; qty: number; rev: number; orders: number }>();
    for (const o of filteredOrders) {
      const key = o.product_name || 'Unknown';
      const cur = m.get(key) || { name: key, qty: 0, rev: 0, orders: 0 };
      cur.qty += Number(o.quantity) || 0;
      cur.rev += Number(o.total_price) || 0;
      cur.orders += 1;
      m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => b.rev - a.rev).slice(0, 8);
  }, [filteredOrders]);

  const paymentBreakdown = useMemo(() => {
    const m = new Map<string, { method: string; rev: number; count: number }>();
    for (const o of filteredOrders) {
      const k = (o.payment_method || 'Other').trim() || 'Other';
      const cur = m.get(k) || { method: k, rev: 0, count: 0 };
      cur.rev += Number(o.total_price) || 0;
      cur.count += 1;
      m.set(k, cur);
    }
    const total = [...m.values()].reduce((s, x) => s + x.rev, 0) || 1;
    return [...m.values()].sort((a, b) => b.rev - a.rev).map(x => ({ ...x, pct: (x.rev / total) * 100 }));
  }, [filteredOrders]);

  const topCustomers = useMemo(() => {
    const m = new Map<string, { id: string; rev: number; orders: number }>();
    for (const o of filteredOrders) {
      if (!o.customer_id) continue;
      const cur = m.get(o.customer_id) || { id: o.customer_id, rev: 0, orders: 0 };
      cur.rev += Number(o.total_price) || 0;
      cur.orders += 1;
      m.set(o.customer_id, cur);
    }
    return [...m.values()].sort((a, b) => b.rev - a.rev).slice(0, 5);
  }, [filteredOrders]);

  useEffect(() => {
    const missing = topCustomers.map(c => c.id).filter(id => id && !customerMap[id]);
    if (missing.length === 0) return;
    (async () => {
      const { data } = await supabase
        .from('bot_customers')
        .select('id,username,first_name,chat_id')
        .in('id', missing);
      if (!data) return;
      setCustomerMap(prev => {
        const next = { ...prev };
        for (const c of data as any[]) {
          next[c.id] = { username: c.username, first_name: c.first_name, chat_id: c.chat_id };
        }
        return next;
      });
    })();
  }, [topCustomers]);

  const recent = filteredOrders.slice(0, 8);
  const uniqueBuyers = useMemo(() => new Set(orders.map(o => o.customer_id).filter(Boolean)).size, [orders]);
  const daysSinceStart = firstOrderAt
    ? Math.max(1, Math.floor((Date.now() - new Date(firstOrderAt).getTime()) / 86400000))
    : 0;
  const avgOrder = stats.all.count ? stats.all.rev / stats.all.count : 0;
  const avgDaily = daysSinceStart ? stats.all.rev / daysSinceStart : 0;
  const repeatRate = uniqueBuyers ? ((stats.all.count - uniqueBuyers) / stats.all.count) * 100 : 0;

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background p-5 sm:p-6">
        <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/20 blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> Admin Overview
            </div>
            <h2 className="mt-1 font-heading text-2xl font-bold gradient-text sm:text-3xl">Welcome back, Boss 👑</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {firstOrderAt ? (
                <>Business running since <span className="font-medium text-foreground">{fmtDate(new Date(firstOrderAt))}</span> · <span className="text-primary">{daysSinceStart} days</span></>
              ) : 'No orders yet'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniPill label="Customers" value={fmtInt(customerCount)} icon={Users} />
            <MiniPill label="Products" value={fmtInt(productCount)} icon={Package} />
            <MiniPill label="Buyers" value={fmtInt(uniqueBuyers)} icon={UserPlus} />
            <MiniPill label="Lifetime" value={fmtUSD(stats.all.rev)} icon={TrendingUp} />
          </div>
        </div>
      </div>

      {/* Custom range picker */}
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary/15 p-1.5 text-primary">
            <Filter className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Custom date range</div>
            <div className="text-sm font-semibold">
              {rangeBounds
                ? `${fmtDate(rangeBounds.from)} → ${fmtDate(rangeBounds.to)}`
                : 'All metrics show default periods'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {rangeLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <CalendarIcon className="h-4 w-4" />
                {range?.from
                  ? range.to && range.to.getTime() !== range.from.getTime()
                    ? `${format(range.from, 'LLL d')} – ${format(range.to, 'LLL d, y')}`
                    : format(range.from, 'LLL d, y')
                  : 'Pick date range'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="range"
                selected={range}
                onSelect={setRange}
                numberOfMonths={2}
                initialFocus
                className={cn('p-3 pointer-events-auto')}
              />
            </PopoverContent>
          </Popover>
          {range && (
            <Button variant="ghost" size="sm" onClick={() => setRange(undefined)} className="gap-1">
              <X className="h-4 w-4" /> Clear
            </Button>
          )}
        </div>
      </Card>

      {/* Source split — Web / Bot / Combined */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SourceCard label="Website Orders" icon={Globe} accent="text-blue-400" tint="from-blue-500/20 to-blue-500/0"
          today={stats.today.web} d7={stats.d7.web} d30={stats.d30.web} all={stats.all.web}
          todayC={stats.today.webCount} d7C={stats.d7.webCount} d30C={stats.d30.webCount} allC={stats.all.webCount} />
        <SourceCard label="Telegram Bot Orders" icon={Bot} accent="text-emerald-400" tint="from-emerald-500/20 to-emerald-500/0"
          today={stats.today.bot} d7={stats.d7.bot} d30={stats.d30.bot} all={stats.all.bot}
          todayC={stats.today.botCount} d7C={stats.d7.botCount} d30C={stats.d30.botCount} allC={stats.all.botCount} />
        <SourceCard label="Combined Total" icon={BarChart3} accent="text-primary" tint="from-primary/25 to-primary/0"
          today={stats.today.rev} d7={stats.d7.rev} d30={stats.d30.rev} all={stats.all.rev}
          todayC={stats.today.count} d7C={stats.d7.count} d30C={stats.d30.count} allC={stats.all.count} />
      </div>

      {/* KPI — revenue cards */}
      <div>
        <SectionTitle icon={DollarSign}>Revenue</SectionTitle>
        <div className={cn('grid grid-cols-2 gap-4', rangeBounds ? 'lg:grid-cols-5' : 'lg:grid-cols-4')}>
          <MetricCard label="Today" value={fmtUSD(stats.today.rev)} sub={`Web ${fmtUSD(stats.today.web)} · Bot ${fmtUSD(stats.today.bot)}`} icon={Clock} tint="from-emerald-500/20 to-emerald-500/0" accent="text-emerald-400" />
          <MetricCard label="Last 7 days" value={fmtUSD(stats.d7.rev)} sub={`Web ${fmtUSD(stats.d7.web)} · Bot ${fmtUSD(stats.d7.bot)}`} icon={CalendarIcon} tint="from-blue-500/20 to-blue-500/0" accent="text-blue-400" />
          <MetricCard label="Last 30 days" value={fmtUSD(stats.d30.rev)} sub={`Web ${fmtUSD(stats.d30.web)} · Bot ${fmtUSD(stats.d30.bot)}`} icon={TrendingUp} tint="from-violet-500/20 to-violet-500/0" accent="text-violet-400" />
          <MetricCard label="All time" value={fmtUSD(stats.all.rev)} sub={`Web ${fmtUSD(stats.all.web)} · Bot ${fmtUSD(stats.all.bot)}`} icon={DollarSign} tint="from-amber-500/20 to-amber-500/0" accent="text-amber-400" />
          {rangeBounds && (
            <MetricCard label="Custom range" value={fmtUSD(stats.custom.rev)} sub={`Web ${fmtUSD(stats.custom.web)} · Bot ${fmtUSD(stats.custom.bot)}`} icon={Filter} tint="from-primary/25 to-primary/0" accent="text-primary" />
          )}
        </div>
      </div>

      {/* KPI — order count cards */}
      <div>
        <SectionTitle icon={Hash}>Orders (count)</SectionTitle>
        <div className={cn('grid grid-cols-2 gap-4', rangeBounds ? 'lg:grid-cols-5' : 'lg:grid-cols-4')}>
          <MetricCard label="Today" value={fmtInt(stats.today.count)} sub={`${fmtInt(stats.today.qty)} units · Web ${stats.today.webCount} · Bot ${stats.today.botCount}`} icon={Clock} tint="from-emerald-500/20 to-emerald-500/0" accent="text-emerald-400" />
          <MetricCard label="Last 7 days" value={fmtInt(stats.d7.count)} sub={`${fmtInt(stats.d7.qty)} units · Web ${stats.d7.webCount} · Bot ${stats.d7.botCount}`} icon={CalendarIcon} tint="from-blue-500/20 to-blue-500/0" accent="text-blue-400" />
          <MetricCard label="Last 30 days" value={fmtInt(stats.d30.count)} sub={`${fmtInt(stats.d30.qty)} units · Web ${stats.d30.webCount} · Bot ${stats.d30.botCount}`} icon={TrendingUp} tint="from-violet-500/20 to-violet-500/0" accent="text-violet-400" />
          <MetricCard label="All time" value={fmtInt(stats.all.count)} sub={`${fmtInt(stats.all.qty)} units · Web ${stats.all.webCount} · Bot ${stats.all.botCount}`} icon={ShoppingBag} tint="from-amber-500/20 to-amber-500/0" accent="text-amber-400" />
          {rangeBounds && (
            <MetricCard label="Custom range" value={fmtInt(stats.custom.count)} sub={`${fmtInt(stats.custom.qty)} units · Web ${stats.custom.webCount} · Bot ${stats.custom.botCount}`} icon={Filter} tint="from-primary/25 to-primary/0" accent="text-primary" />
          )}
        </div>
      </div>


      {/* Business insight strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <InsightPill label="Avg Order" value={fmtUSD(avgOrder)} icon={Target} />
        <InsightPill label="Avg / Day" value={fmtUSD(avgDaily)} icon={TrendingUp} />
        <InsightPill label="Repeat Rate" value={`${repeatRate.toFixed(1)}%`} icon={Repeat} />
        <InsightPill label="Pending" value={fmtInt(pendingCount)} icon={Clock} />
        <InsightPill label="New (7d)" value={fmtInt(newCustomers7d)} icon={UserPlus} />
        <InsightPill label="Deposits 30d" value={fmtUSD(depositTotals.verified)} icon={Wallet} />
      </div>

      {/* Chart + Top products */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 p-0 overflow-hidden border-border/60">
          {/* Header */}
          <div className="px-5 pt-5 pb-3 flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div className="space-y-1">
              <h3 className="font-heading text-base font-semibold tracking-tight">
                Revenue <span className="text-muted-foreground font-normal">· {rangeBounds ? 'Custom range' : 'Last 30 days'}</span>
              </h3>
              <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-medium">
                Stacked: Bot + Web daily revenue
              </p>
            </div>
            <div className="flex items-center gap-5">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
                  <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Bot</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.5)]" />
                  <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Web</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold tracking-tight leading-none">{fmtUSD(rangeBounds ? stats.custom.rev : stats.d30.rev)}</div>
                <div className="text-[11px] text-muted-foreground font-medium mt-1">{fmtInt(rangeBounds ? stats.custom.count : stats.d30.count)} orders</div>
              </div>
            </div>
          </div>

          {/* Chart body */}
          <div className="relative px-5 pt-6 pb-3">
            {/* Gridlines */}
            <div className="pointer-events-none absolute left-5 right-5 top-6 bottom-10 flex flex-col justify-between">
              {[0, 1, 2, 3, 4].map(i => <div key={i} className="w-full border-t border-border/40" />)}
            </div>

            {/* Bars + trend overlay */}
            <div className="relative h-56">
              <div className="absolute inset-0 flex items-end justify-between gap-[3px]">
                {chart.days.map((d, i) => {
                  const total = d.bot + d.web;
                  const totalPct = (total / chart.maxRev) * 100;
                  const botPct = total ? (d.bot / total) * totalPct : 0;
                  const webPct = total ? (d.web / total) * totalPct : 0;
                  const isToday = !rangeBounds && i === chart.days.length - 1;
                  const isPeak = total > 0 && total === chart.maxRev;
                  return (
                    <div key={i} className={cn(
                      'group relative flex h-full flex-1 flex-col justify-end gap-[2px] rounded-t-md transition-all',
                      isPeak && 'bg-emerald-500/[0.06] ring-1 ring-emerald-500/20'
                    )}>
                      <div
                        className={cn('w-full rounded-t-sm bg-blue-400/75 transition-colors group-hover:bg-blue-400', isToday && 'bg-blue-400')}
                        style={{ height: `${Math.max(webPct, total && d.web ? 1.5 : 0)}%` }}
                      />
                      <div
                        className={cn('w-full bg-emerald-400/85 transition-colors group-hover:bg-emerald-400', isToday && 'bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.45)]')}
                        style={{ height: `${Math.max(botPct, total && d.bot ? 1.5 : 0)}%` }}
                      />
                      <div className="pointer-events-none absolute -top-16 left-1/2 z-30 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[10px] shadow-lg group-hover:block">
                        <div className="font-semibold">{fmtUSD(total)} · {d.label}</div>
                        <div className="text-muted-foreground">Bot {fmtUSD(d.bot)} · Web {fmtUSD(d.web)}</div>
                        <div className="text-muted-foreground">{d.count} orders</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Smooth trend line overlay tracking total daily revenue */}
              <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="rev-trend-fill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.18" />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {(() => {
                  const n = chart.days.length;
                  if (n < 2) return null;
                  const pts = chart.days.map((d, i) => {
                    const t = d.bot + d.web;
                    const x = (i / (n - 1)) * 100;
                    const y = 100 - (t / chart.maxRev) * 92 - 2;
                    return [x, y] as const;
                  });
                  let p = `M ${pts[0][0]} ${pts[0][1]}`;
                  for (let i = 1; i < n; i++) {
                    const [px, py] = pts[i - 1];
                    const [cx, cy] = pts[i];
                    const mx = (px + cx) / 2;
                    const my = (py + cy) / 2;
                    p += i === 1 ? ` L ${mx} ${my}` : ` Q ${px} ${py}, ${mx} ${my}`;
                  }
                  p += ` L ${pts[n - 1][0]} ${pts[n - 1][1]}`;
                  const fill = `${p} L 100 100 L 0 100 Z`;
                  return (
                    <>
                      <path d={fill} fill="url(#rev-trend-fill)" />
                      <path d={p} fill="none" stroke="hsl(var(--primary))" strokeOpacity="0.9" strokeWidth="1.4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
                    </>
                  );
                })()}
              </svg>
            </div>

            {/* Axis labels */}
            <div className="mt-3 flex justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <span>{chart.days[0].label}</span>
              <span>{chart.days[Math.floor(chart.days.length / 2)].label}</span>
              <span className={rangeBounds ? '' : 'text-emerald-400'}>{rangeBounds ? chart.days[chart.days.length - 1].label : 'Today'}</span>
            </div>
          </div>

          {/* Footer stats */}
          <div className="flex items-center justify-between border-t border-border/40 bg-white/[0.02] px-5 py-3">
            <div className="flex gap-6">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Avg / Day</p>
                <p className="text-sm font-mono text-foreground">{fmtUSD(avgDaily)}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Avg Order</p>
                <p className="text-sm font-mono text-emerald-400">{fmtUSD(avgOrder)}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Peak Day</p>
                <p className="text-sm font-mono text-foreground">{fmtUSD(chart.maxRev)}</p>
              </div>
            </div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {chart.days.length} days
            </div>
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
                      <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                        i === 0 ? 'bg-amber-500/20 text-amber-400' :
                        i === 1 ? 'bg-slate-400/20 text-slate-300' :
                        i === 2 ? 'bg-orange-700/20 text-orange-400' :
                        'bg-muted text-muted-foreground')}>{i + 1}</span>
                      <span className="truncate text-sm font-medium">{p.name}</span>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-primary">{fmtUSD(p.rev)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-gradient-to-r from-primary to-primary/50" style={{ width: `${w}%` }} />
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{fmtInt(p.qty)} units · {p.orders} orders</div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Payment methods · Top customers · Recent orders */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Payment Methods (compact) */}
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-blue-400" />
              <h3 className="font-heading text-base font-semibold">Payment Methods</h3>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{paymentBreakdown.length}</span>
          </div>
          <div className="space-y-2.5">
            {paymentBreakdown.length === 0 && <div className="text-sm text-muted-foreground">No data</div>}
            {(() => {
              const top = paymentBreakdown.slice(0, 6);
              const rest = paymentBreakdown.slice(6);
              const otherRev = rest.reduce((s, x) => s + x.rev, 0);
              const otherCount = rest.reduce((s, x) => s + x.count, 0);
              const otherPct = rest.reduce((s, x) => s + x.pct, 0);
              const items = rest.length > 0
                ? [...top, { method: `Others (${rest.length})`, rev: otherRev, count: otherCount, pct: otherPct }]
                : top;
              return items.map((p, i) => (
                <div key={p.method} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full',
                        i === 0 ? 'bg-blue-400' : i === 1 ? 'bg-violet-400' : i === 2 ? 'bg-emerald-400' :
                        i === 3 ? 'bg-amber-400' : i === 4 ? 'bg-pink-400' : i === 5 ? 'bg-cyan-400' : 'bg-slate-400')} />
                      <span className="truncate font-medium">{p.method}</span>
                    </div>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{fmtUSD(p.rev)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted/60">
                      <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500" style={{ width: `${Math.max(p.pct, 1.5)}%` }} />
                    </div>
                    <span className="w-14 text-right font-mono text-[10px] text-muted-foreground/80">{p.pct.toFixed(1)}% · {p.count}</span>
                  </div>
                </div>
              ));
            })()}
          </div>
        </Card>

        {/* Top Customers */}
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <h3 className="font-heading text-base font-semibold">Top Customers</h3>
          </div>
          <div className="space-y-2">
            {topCustomers.length === 0 && <div className="text-sm text-muted-foreground">No data</div>}
            {topCustomers.map((c, i) => {
              const info = customerMap[c.id];
              const name = info?.first_name?.trim() || (info?.username ? `@${info.username}` : null);
              const sub = info?.username ? `@${info.username}` : (info?.chat_id ? `ID ${info.chat_id}` : `${c.id.slice(0, 8)}…`);
              return (
                <div key={c.id} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/50 px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{i + 1}</span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{name || sub}</div>
                      {name && <div className="truncate text-[10px] text-muted-foreground">{sub}</div>}
                    </div>
                  </div>
                  <div className="text-right shrink-0 pl-2">
                    <div className="text-sm font-bold text-primary">{fmtUSD(c.rev)}</div>
                    <div className="text-[10px] text-muted-foreground">{c.orders} orders</div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Recent Orders */}
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-emerald-400" />
              <h3 className="font-heading text-base font-semibold">Recent Orders</h3>
            </div>
          </div>
          <div className="space-y-2">
            {recent.length === 0 && <div className="text-sm text-muted-foreground">No orders yet</div>}
            {recent.slice(0, 6).map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-card/50 px-3 py-2 transition-colors hover:border-primary/30 hover:bg-card">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={cn('inline-flex h-4 items-center rounded px-1.5 text-[9px] font-bold uppercase',
                      o.source === 'web' ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400')}>
                      {o.source === 'web' ? 'W' : 'B'}
                    </span>
                    <div className="truncate text-xs font-medium">{o.product_name || 'Unknown'}</div>
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {new Date(o.created_at).toLocaleString('en-US', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · Qty {o.quantity}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs font-bold text-primary">{fmtUSD(Number(o.total_price) || 0)}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Inventory value */}
      <InventoryValueCard />

    </div>

  );
};

const SectionTitle = ({ icon: Icon, children }: { icon: any; children: React.ReactNode }) => (
  <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
    <Icon className="h-3.5 w-3.5" /> {children}
  </div>
);

const MiniPill = ({ label, value, icon: Icon }: { label: string; value: string; icon: any }) => (
  <div className="rounded-xl border border-border/50 bg-card/60 px-3 py-2 backdrop-blur">
    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
      <Icon className="h-3 w-3" /> {label}
    </div>
    <div className="mt-0.5 text-sm font-bold sm:text-base">{value}</div>
  </div>
);

const MetricCard = ({ label, value, sub, icon: Icon, tint, accent }: { label: string; value: string; sub: string; icon: any; tint: string; accent: string }) => (
  <Card className="relative overflow-hidden p-5">
    <div className={cn('absolute inset-0 bg-gradient-to-br', tint)} />
    <div className="relative">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={cn('rounded-lg bg-background/60 p-1.5', accent)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-3 font-heading text-2xl font-bold">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>
    </div>
  </Card>
);

const SourceCard = ({
  label, icon: Icon, accent, tint,
  today, d7, d30, all, todayC, d7C, d30C, allC,
}: {
  label: string; icon: any; accent: string; tint: string;
  today: number; d7: number; d30: number; all: number;
  todayC: number; d7C: number; d30C: number; allC: number;
}) => (
  <Card className="relative overflow-hidden p-5">
    <div className={cn('absolute inset-0 bg-gradient-to-br', tint)} />
    <div className="relative">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Icon className={cn('h-3.5 w-3.5', accent)} /> {label}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <SrcRow k="Today" v={fmtUSD(today)} c={todayC} />
        <SrcRow k="7d" v={fmtUSD(d7)} c={d7C} />
        <SrcRow k="30d" v={fmtUSD(d30)} c={d30C} />
        <SrcRow k="All" v={fmtUSD(all)} c={allC} big />
      </div>
    </div>
  </Card>
);

const SrcRow = ({ k, v, c, big }: { k: string; v: string; c: number; big?: boolean }) => (
  <div className="rounded-lg border border-border/40 bg-background/40 px-2.5 py-2">
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</div>
    <div className={cn('font-heading font-bold', big ? 'text-lg' : 'text-sm')}>{v}</div>
    <div className="text-[10px] text-muted-foreground">{fmtInt(c)} orders</div>
  </div>
);

const InsightPill = ({ label, value, icon: Icon }: { label: string; value: string; icon: any }) => (
  <Card className="p-3">
    <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
      <Icon className="h-3 w-3" /> {label}
    </div>
    <div className="mt-1 font-heading text-base font-bold">{value}</div>
  </Card>
);

export default DashboardTab;
