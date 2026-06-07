import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

export function Countdown({ to, compact = false }: { to: string; compact?: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const diff = Math.max(0, new Date(to).getTime() - now);
  const d = Math.floor(diff / 8.64e7);
  const h = Math.floor((diff % 8.64e7) / 3.6e6);
  const m = Math.floor((diff % 3.6e6) / 6e4);
  const s = Math.floor((diff % 6e4) / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');

  if (compact) {
    return (
      <span className="font-mono tabular-nums">
        {d > 0 && `${d}d `}{pad(h)}:{pad(m)}:{pad(s)}
      </span>
    );
  }

  const Cell = ({ v, l }: { v: number; l: string }) => (
    <div className="flex flex-col items-center min-w-[42px] rounded-lg bg-gradient-to-b from-warning/15 to-warning/5 border border-warning/30 px-2 py-1.5">
      <span className="font-mono font-bold text-lg leading-none tabular-nums text-warning">{pad(v)}</span>
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">{l}</span>
    </div>
  );
  return (
    <div className="inline-flex items-center gap-1.5">
      <Clock className="h-4 w-4 text-warning mr-0.5" />
      {d > 0 && <Cell v={d} l="d" />}
      <Cell v={h} l="hr" />
      <span className="text-warning/60 font-bold">:</span>
      <Cell v={m} l="min" />
      <span className="text-warning/60 font-bold">:</span>
      <Cell v={s} l="sec" />
    </div>
  );
}
