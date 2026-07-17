import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  RefreshCw, Cpu, ListChecks, Clock, Bot, CheckCircle2, XCircle,
  AlertTriangle, Activity, Calendar, TrendingUp, Link2,
} from 'lucide-react';

const SITE_CONCURRENCY_CAP = 25;
const BOT_CONCURRENCY_CAP = 50;

type JobRow = {
  id: string;
  status: string;
  concurrency: number | null;
  total: number | null;
  checked: number | null;
  valid_count: number | null;
  invalid_count: number | null;
  error_count: number | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

type Totals = {
  jobs: number;
  checked: number;
  valid: number;
  invalid: number;
  errors: number;
};

const emptyTotals: Totals = { jobs: 0, checked: 0, valid: 0, invalid: 0, errors: 0 };

export default function WorkersStatusTab() {
  const [active, setActive] = useState<JobRow[]>([]);
  const [queued, setQueued] = useState<JobRow[]>([]);
  const [today, setToday] = useState<Totals>(emptyTotals);
  const [last7, setLast7] = useState<Totals>(emptyTotals);
  const [allTime, setAllTime] = useState<Totals>(emptyTotals);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const load = async () => {
    setLoading(true);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const sevenAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const cols = 'id,status,concurrency,total,checked,valid_count,invalid_count,error_count,started_at,finished_at,created_at';

    const [activeRes, todayRes, weekRes, allRes] = await Promise.all([
      supabase
        .from('link_check_jobs')
        .select(cols)
        .in('status', ['running', 'queued', 'vps_queued'])
        .order('created_at', { ascending: false }),
      supabase
        .from('link_check_jobs')
        .select(cols)
        .gte('created_at', startOfDay.toISOString()),
      supabase
        .from('link_check_jobs')
        .select(cols)
        .gte('created_at', sevenAgo.toISOString()),
      supabase
        .from('link_check_jobs')
        .select(cols),
    ]);

    const rows = (activeRes.data || []) as JobRow[];
    setActive(rows.filter((r) => r.status === 'running'));
    setQueued(rows.filter((r) => r.status === 'queued' || r.status === 'vps_queued'));

    const sum = (list: JobRow[] | null): Totals => {
      const l = list || [];
      return {
        jobs: l.length,
        checked: l.reduce((s, r) => s + (r.checked || 0), 0),
        valid: l.reduce((s, r) => s + (r.valid_count || 0), 0),
        invalid: l.reduce((s, r) => s + (r.invalid_count || 0), 0),
        errors: l.reduce((s, r) => s + (r.error_count || 0), 0),
      };
    };

    setToday(sum(todayRes.data as JobRow[] | null));
    setLast7(sum(weekRes.data as JobRow[] | null));
    setAllTime(sum(allRes.data as JobRow[] | null));
    setLastUpdate(new Date());
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    const ch = supabase
      .channel('workers-status')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'link_check_jobs' }, load)
      .subscribe();
    return () => {
      clearInterval(t);
      supabase.removeChannel(ch);
    };
  }, []);

  const activeConcurrency = active.reduce((s, r) => s + (r.concurrency || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Workers Status</h2>
          <p className="text-sm text-muted-foreground">
            {lastUpdate ? `Updated ${lastUpdate.toLocaleTimeString()}` : 'Loading...'} · auto-refresh 5s
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Top KPI cards */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Calendar className="h-4 w-4" />}
          label="Today"
          primary={today.checked.toLocaleString()}
          sub={`${today.jobs} jobs · ${today.valid.toLocaleString()} valid · ${today.invalid.toLocaleString()} invalid`}
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Last 7 days"
          primary={last7.checked.toLocaleString()}
          sub={`${last7.jobs} jobs · ${last7.valid.toLocaleString()} valid · ${last7.invalid.toLocaleString()} invalid`}
        />
        <StatCard
          icon={<Link2 className="h-4 w-4" />}
          label="All time links"
          primary={allTime.checked.toLocaleString()}
          sub={`${allTime.jobs} jobs total`}
        />
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Now running"
          primary={`${active.length}`}
          sub={`${activeConcurrency} parallel · ${queued.length} queued`}
        />
      </div>

      {/* Health breakdown */}
      <div className="grid gap-3 md:grid-cols-3">
        <MiniStat
          icon={<CheckCircle2 className="h-4 w-4 text-green-500" />}
          label="Valid (today)"
          value={today.valid.toLocaleString()}
          total={today.checked}
        />
        <MiniStat
          icon={<XCircle className="h-4 w-4 text-red-500" />}
          label="Invalid (today)"
          value={today.invalid.toLocaleString()}
          total={today.checked}
        />
        <MiniStat
          icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
          label="Errors (today)"
          value={today.errors.toLocaleString()}
          total={today.checked}
        />
      </div>

      {/* Worker cards */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-4 w-4 text-primary" />
              link-checker (Site)
              <Badge variant="secondary" className="ml-auto">VPS</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Row icon={<Cpu className="h-4 w-4" />} label="Concurrency cap" value={String(SITE_CONCURRENCY_CAP)} />
            <Row
              icon={<Cpu className="h-4 w-4" />}
              label="Active parallel checks"
              value={`${activeConcurrency} / ${SITE_CONCURRENCY_CAP}`}
            />
            <Row icon={<ListChecks className="h-4 w-4" />} label="Active jobs" value={String(active.length)} />
            <Row icon={<Clock className="h-4 w-4" />} label="Queue depth" value={String(queued.length)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="h-4 w-4 text-primary" />
              tg-link-checker (Bot)
              <Badge variant="secondary" className="ml-auto">VPS</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Row icon={<Cpu className="h-4 w-4" />} label="Concurrency cap" value={String(BOT_CONCURRENCY_CAP)} />
            <Row icon={<ListChecks className="h-4 w-4" />} label="Active jobs" value="on-demand" />
            <Row icon={<Clock className="h-4 w-4" />} label="Queue depth" value="ephemeral" />
            <p className="text-xs text-muted-foreground pt-1">
              Bot চেক গুলো per-request চলে — DB queue নেই। Priority-lock দিয়ে site worker থামায়।
              Bot stats আলাদা করে দেখাতে হলে bot.js এ persistent logging লাগবে।
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Live running jobs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-primary" />
            Live Jobs
            <Badge variant="outline" className="ml-auto">{active.length} running · {queued.length} queued</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {active.length === 0 && queued.length === 0 ? (
            <p className="text-sm text-muted-foreground">এই মুহূর্তে কোনো active job নেই।</p>
          ) : (
            <div className="space-y-3">
              {[...active, ...queued].map((j) => {
                const total = j.total || 0;
                const checked = j.checked || 0;
                const pct = total > 0 ? Math.min(100, Math.round((checked / total) * 100)) : 0;
                return (
                  <div key={j.id} className="border rounded-md p-3 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-mono text-xs text-muted-foreground">{j.id.slice(0, 8)}</span>
                      <Badge variant={j.status === 'running' ? 'default' : 'secondary'}>{j.status}</Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{checked.toLocaleString()} / {total.toLocaleString()} URLs</span>
                      <span>
                        ✓ {(j.valid_count || 0).toLocaleString()} ·
                        ✗ {(j.invalid_count || 0).toLocaleString()} ·
                        ! {(j.error_count || 0).toLocaleString()} ·
                        conc {j.concurrency || 0}
                      </span>
                    </div>
                    <Progress value={pct} className="h-1.5" />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, primary, sub }: { icon: React.ReactNode; label: string; primary: string; sub: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className="text-2xl font-semibold font-mono">{primary}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}

function MiniStat({ icon, label, value, total }: { icon: React.ReactNode; label: string; value: string; total: number }) {
  const pct = total > 0 ? Math.round((Number(value.replace(/,/g, '')) / total) * 100) : 0;
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            {icon}
            {label}
          </span>
          <span className="font-mono font-semibold">{value}</span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">{pct}% of today's checks</div>
      </CardContent>
    </Card>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="font-mono font-medium">{value}</span>
    </div>
  );
}
