import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { DollarSign, Loader2, Package, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Row {
  id: string;
  name: string;
  price: number;
  stock: number;
}

const fmtUSD = (n: number) =>
  `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const InventoryValueCard = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data: products } = await supabase
        .from('bot_products')
        .select('id,name,price,is_active')
        .eq('is_active', true)
        .order('sort_order');
      const list = products || [];
      const ids = list.map((p) => p.id);
      const stockById = new Map<string, number>();
      if (ids.length > 0) {
        const { data: counts } = await supabase.rpc('get_product_stock_counts', { _product_ids: ids });
        for (const r of (counts || []) as Array<{ product_id: string; available_count: number }>) {
          stockById.set(r.product_id, Number(r.available_count) || 0);
        }
      }
      setRows(
        list.map((p) => ({
          id: p.id,
          name: p.name,
          price: Number(p.price) || 0,
          stock: stockById.get(p.id) ?? 0,
        })),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const onRefresh = () => { void load(); };
    window.addEventListener('dashboard:refresh', onRefresh);
    return () => window.removeEventListener('dashboard:refresh', onRefresh);
  }, []);

  const { total, totalUnits, sorted } = useMemo(() => {
    const withValue = rows.map((r) => ({ ...r, value: r.stock * r.price }));
    return {
      total: withValue.reduce((s, r) => s + r.value, 0),
      totalUnits: withValue.reduce((s, r) => s + r.stock, 0),
      sorted: withValue.sort((a, b) => b.value - a.value),
    };
  }, [rows]);

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-emerald-400" />
          <h3 className="font-heading text-base font-semibold">Inventory Value</h3>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border/40 bg-background/40 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Stock Value</div>
          <div className="font-heading text-xl font-bold text-emerald-400">{fmtUSD(total)}</div>
        </div>
        <div className="rounded-lg border border-border/40 bg-background/40 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Units</div>
          <div className="font-heading text-xl font-bold">{totalUnits.toLocaleString('en-US')}</div>
        </div>
      </div>

      <div className="mt-4 max-h-[280px] space-y-2 overflow-y-auto pr-1">
        {!loading && sorted.length === 0 && <div className="text-sm text-muted-foreground">No active products</div>}
        {sorted.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/40 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{r.name}</div>
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Package className="h-3 w-3" /> {r.stock} × {fmtUSD(r.price)}
              </div>
            </div>
            <div className="shrink-0 text-sm font-bold text-emerald-400">{fmtUSD(r.value)}</div>
          </div>
        ))}
      </div>
    </Card>
  );
};

export default InventoryValueCard;
