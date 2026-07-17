import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  RefreshCw, Bot, CheckCircle2, XCircle, AlertTriangle,
  Calendar, TrendingUp, Link2, Users,
} from 'lucide-react';

const BOT_CONCURRENCY_CAP = 50;

type LogRow = {
  id: string;
  tg_user_id: number;
  tg_username: string | null;
  tg_first_name: string | null;
  tg_last_name: string | null;
  total: number;
  valid_count: number;
  invalid_count: number;
  error_count: number;
  duration_ms: number;
  created_at: string;
};

type Totals = { jobs: number; checked: number; valid: number; invalid: number; errors: number };
const emptyTotals: Totals = { jobs: 0, checked: 0, valid: 0, invalid: 0, errors: 0 };

const sumRows = (rows: LogRow[]): Totals => ({
  jobs: rows.length,
  checked: rows.reduce((s, r) => s + (r.total || 0), 0),
  valid: rows.reduce((s, r) => s + (r.valid_count || 0), 0),
  invalid: rows.reduce((s, r) => s + (r.invalid_count || 0), 0),
  errors: rows.reduce((s, r) => s + (r.error_count || 0), 0),
});

type UserAgg = {
  tg_user_id: number;
  tg_username: string | null;
  tg_first_name: string | null;
  tg_last_name: string | null;
  jobs: number;
  checked: number;
  valid: number;
  invalid: number;
  errors: number;
  lastAt: string;
};

export default function WorkersStatusTab() {
  const [today, setToday] = useState<Totals>(emptyTotals);
  const [last7, setLast7] = useState<Totals>(emptyTotals);
  const [allTime, setAllTime] = useState<Totals>(emptyTotals);
  const [users, setUsers] = useState<UserAgg[]>([]);
  const [recent, setRecent] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const load = async () => {
    setLoading(true);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const sevenAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const cols = 'id,tg_user_id,tg_username,tg_first_name,tg_last_name,total,valid_count,invalid_count,error_count,duration_ms,created_at';

    const [todayRes, weekRes, allRes, recentRes] = await Promise.all([
      supabase.from('bot_link_check_logs').select(cols).gte('created_at', startOfDay.toISOString()),
      supabase.from('bot_link_check_logs').select(cols).gte('created_at', sevenAgo.toISOString()),
      supabase.from('bot_link_check_logs').select(cols),
      supabase.from('bot_link_check_logs').select(cols).order('created_at', { ascending: false }).limit(15),
    ]);

    const todayRows = (todayRes.data || []) as LogRow[];
    const weekRows = (weekRes.data || []) as LogRow[];
    const allRows = (allRes.data || []) as LogRow[];

    setToday(sumRows(todayRows));
    setLast7(sumRows(weekRows));
    setAllTime(sumRows(allRows));
    setRecent((recentRes.data || []) as LogRow[]);

    // Aggregate per-user (all time)
    const map = new Map<number, UserAgg>();
    for (const r of allRows) {
      const existing = map.get(r.tg_user_id);
      if (existing) {
        existing.jobs += 1;
        existing.checked += r.total || 0;
        existing.valid += r.valid_count || 0;
        existing.invalid += r.invalid_count || 0;
        existing.errors += r.error_count || 0;
        if (r.created_at > existing.lastAt) existing.lastAt = r.created_at;
      } else {
        map.set(r.tg_user_id, {
          tg_user_id: r.tg_user_id,
          tg_username: r.tg_username,
          tg_first_name: r.tg_first_name,
          tg_last_name: r.tg_last_name,
          jobs: 1,
          checked: r.total || 0,
          valid: r.valid_count || 0,
          invalid: r.invalid_count || 0,
          errors: r.error_count || 0,
          lastAt: r.created_at,
        });
      }
    }
    setUsers([...map.values()].sort((a, b) => b.checked - a.checked));

    setLastUpdate(new Date());
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const t = setInterval(load, 10000);
    const ch = supabase
      .channel('bot-link-check-logs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bot_link_check_logs' }, load)
      .subscribe();
    return () => {
      clearInterval(t);
      supabase.removeChannel(ch);
    };
  }, []);

  const displayName = (u: { tg_first_name: string | null; tg_last_name: string | null }) => {
    const n = [u.tg_first_name, u.tg_last_name].filter(Boolean).join(' ').trim();
    return n || '—';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            tg-link-checker (Bot) Status
          </h2>
          <p className="text-sm text-muted-foreground">
            {lastUpdate ? `Updated ${lastUpdate.toLocaleTimeString()}` : 'Loading...'} · auto-refresh 10s · concurrency cap {BOT_CONCURRENCY_CAP}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<Calendar className="h-4 w-4" />} label="Today" primary={today.checked.toLocaleString()}
          sub={`${today.jobs} jobs · ${today.valid.toLocaleString()} valid · ${today.invalid.toLocaleString()} invalid`} />
        <StatCard icon={<TrendingUp className="h-4 w-4" />} label="Last 7 days" primary={last7.checked.toLocaleString()}
          sub={`${last7.jobs} jobs · ${last7.valid.toLocaleString()} valid · ${last7.invalid.toLocaleString()} invalid`} />
        <StatCard icon={<Link2 className="h-4 w-4" />} label="All time links" primary={allTime.checked.toLocaleString()}
          sub={`${allTime.jobs} jobs total`} />
        <StatCard icon={<Users className="h-4 w-4" />} label="Unique users" primary={users.length.toLocaleString()}
          sub="who used the bot" />
      </div>

      {/* Today health */}
      <div className="grid gap-3 md:grid-cols-3">
        <MiniStat icon={<CheckCircle2 className="h-4 w-4 text-green-500" />} label="Valid (today)" value={today.valid} total={today.checked} />
        <MiniStat icon={<XCircle className="h-4 w-4 text-red-500" />} label="Invalid (today)" value={today.invalid} total={today.checked} />
        <MiniStat icon={<AlertTriangle className="h-4 w-4 text-amber-500" />} label="Errors (today)" value={today.errors} total={today.checked} />
      </div>

      {/* Per-user leaderboard */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-primary" />
            Users Leaderboard
            <Badge variant="outline" className="ml-auto">{users.length} users</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="text-sm text-muted-foreground">এখনো কোনো bot user log নেই।</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Username</TableHead>
                    <TableHead>Telegram ID</TableHead>
                    <TableHead className="text-right">Jobs</TableHead>
                    <TableHead className="text-right">Links</TableHead>
                    <TableHead className="text-right">Valid</TableHead>
                    <TableHead className="text-right">Invalid</TableHead>
                    <TableHead className="text-right">Errors</TableHead>
                    <TableHead>Last used</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.tg_user_id}>
                      <TableCell className="font-medium">{displayName(u)}</TableCell>
                      <TableCell>
                        {u.tg_username ? (
                          <a
                            href={`https://t.me/${u.tg_username}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            @{u.tg_username}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{u.tg_user_id}</TableCell>
                      <TableCell className="text-right font-mono">{u.jobs.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">{u.checked.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono text-green-600">{u.valid.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono text-red-600">{u.invalid.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono text-amber-600">{u.errors.toLocaleString()}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(u.lastAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent jobs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Bot Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">এখনো কোনো recent job নেই।</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Valid</TableHead>
                    <TableHead className="text-right">Invalid</TableHead>
                    <TableHead className="text-right">Errors</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</TableCell>
                      <TableCell className="text-sm">
                        {displayName(r)}{' '}
                        <span className="text-muted-foreground text-xs">
                          {r.tg_username ? `@${r.tg_username}` : `#${r.tg_user_id}`}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono">{r.total.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono text-green-600">{r.valid_count.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono text-red-600">{r.invalid_count.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono text-amber-600">{r.error_count.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {(r.duration_ms / 1000).toFixed(1)}s
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
        <div className="text-2xl font-semibold font-mono">{primary}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}

function MiniStat({ icon, label, value, total }: { icon: React.ReactNode; label: string; value: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">{icon}{label}</span>
          <span className="font-mono font-semibold">{value.toLocaleString()}</span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">{pct}% of today's checks</div>
      </CardContent>
    </Card>
  );
}
