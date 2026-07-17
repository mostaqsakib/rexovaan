import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, Cpu, ListChecks, Clock, Bot } from 'lucide-react';

// These values mirror the MAX_CONCURRENCY env vars set on the VPS workers.
// Update here if you change the VPS .env values.
const SITE_CONCURRENCY_CAP = 25;
const BOT_CONCURRENCY_CAP = 50;

type Stats = {
  running: number;
  queued: number;
  activeConcurrency: number;
};

export default function WorkersStatusTab() {
  const [site, setSite] = useState<Stats>({ running: 0, queued: 0, activeConcurrency: 0 });
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('link_check_jobs')
      .select('status, concurrency')
      .in('status', ['running', 'queued', 'vps_queued']);
    const rows = data || [];
    const running = rows.filter((r) => r.status === 'running');
    const queued = rows.filter((r) => r.status === 'queued' || r.status === 'vps_queued');
    setSite({
      running: running.length,
      queued: queued.length,
      activeConcurrency: running.reduce((s, r: any) => s + (r.concurrency || 0), 0),
    });
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

      <div className="grid gap-4 md:grid-cols-2">
        {/* Site worker */}
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
              value={`${site.activeConcurrency} / ${SITE_CONCURRENCY_CAP}`}
            />
            <Row icon={<ListChecks className="h-4 w-4" />} label="Active jobs" value={String(site.running)} />
            <Row icon={<Clock className="h-4 w-4" />} label="Queue depth" value={String(site.queued)} />
          </CardContent>
        </Card>

        {/* Bot worker */}
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
            <Row icon={<Clock className="h-4 w-4" />} label="Queue depth" value="ephemeral (no DB queue)" />
            <p className="text-xs text-muted-foreground pt-1">
              Bot worker runs per-request in Telegram; it has no persistent queue. Jobs finish inline and hold priority lock over the site worker.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
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
