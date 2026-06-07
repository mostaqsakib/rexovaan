import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Loader2, Tag, Trash2, Pencil, UserPlus, Search } from 'lucide-react';
import { toast } from 'sonner';
import SpecialPricingDialog from './SpecialPricingDialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface Row {
  id: string;
  customer_id: string;
  product_id: string;
  price: number;
  min_quantity: number;
  is_active: boolean;
  note: string | null;
  customer_label: string;
  product_name: string;
  product_price: number;
}


const SpecialPricingTab = () => {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState('');
  const [openCustomer, setOpenCustomer] = useState<{ id: string; label: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [custQuery, setCustQuery] = useState('');
  const [custResults, setCustResults] = useState<Array<{ id: string; first_name: string | null; username: string | null; chat_id: number }>>([]);
  const [custSearching, setCustSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!addOpen) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setCustSearching(true);
      const q = custQuery.trim();
      let query = supabase.from('bot_customers').select('id, first_name, username, chat_id').limit(20);
      if (q) {
        const isNumeric = /^\d+$/.test(q);
        if (isNumeric) {
          query = query.or(`username.ilike.%${q}%,first_name.ilike.%${q}%,chat_id.eq.${q}`);
        } else {
          query = query.or(`username.ilike.%${q}%,first_name.ilike.%${q}%`);
        }
      } else {
        query = query.order('updated_at', { ascending: false });
      }
      const { data } = await query;
      setCustResults((data || []) as any);
      setCustSearching(false);
    }, 250);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [custQuery, addOpen]);

  const pickCustomer = (c: { id: string; first_name: string | null; username: string | null; chat_id: number }) => {
    const label = c.username ? '@' + c.username : (c.first_name || `chat ${c.chat_id}`);
    setAddOpen(false);
    setCustQuery('');
    setOpenCustomer({ id: c.id, label });
  };

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('bot_customer_pricing')
      .select('id, customer_id, product_id, price, min_quantity, is_active, note')
      .order('created_at', { ascending: false });

    const custIds = Array.from(new Set((data || []).map((r) => r.customer_id)));
    const prodIds = Array.from(new Set((data || []).map((r) => r.product_id)));

    const [{ data: custs }, { data: prods }] = await Promise.all([
      custIds.length
        ? supabase.from('bot_customers').select('id, first_name, username, chat_id').in('id', custIds)
        : Promise.resolve({ data: [] as any[] }),
      prodIds.length
        ? supabase.from('bot_products').select('id, name, price').in('id', prodIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const cmap = new Map((custs || []).map((c: any) => [c.id, c]));
    const pmap = new Map((prods || []).map((p: any) => [p.id, p]));

    setRows((data || []).map((r: any) => {
      const c = cmap.get(r.customer_id);
      const p = pmap.get(r.product_id);
      const label = c ? (c.username ? '@' + c.username : (c.first_name || `chat ${c.chat_id}`)) : 'Unknown customer';
      return {
        id: r.id,
        customer_id: r.customer_id,
        product_id: r.product_id,
        price: Number(r.price),
        min_quantity: Number(r.min_quantity ?? 1),
        is_active: r.is_active !== false,
        note: r.note,
        customer_label: label,
        product_name: p?.name || 'Unknown product',
        product_price: Number(p?.price ?? 0),
      };

    }));
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('bot_customer_pricing').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Removed');
    void load();
  };

  const handleToggleProductActive = async (productId: string, is_active: boolean) => {
    const { error } = await supabase
      .from('bot_customer_pricing')
      .update({ is_active, updated_at: new Date().toISOString() })
      .eq('product_id', productId);
    if (error) { toast.error(error.message); return; }
    toast.success(is_active ? 'Special price enabled for product' : 'Disabled — all customers see regular price for this product');
    setRows((prev) => prev.map((r) => r.product_id === productId ? { ...r, is_active } : r));
  };


  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.customer_label.toLowerCase().includes(q) ||
      r.product_name.toLowerCase().includes(q) ||
      (r.note || '').toLowerCase().includes(q)
    );
  }, [rows, search]);

  // Group by product for the top toggle section (uses all rows, not filtered)
  const productGroups = useMemo(() => {
    const m = new Map<string, { name: string; price: number; customer_count: number; is_active: boolean }>();
    for (const r of rows) {
      const existing = m.get(r.product_id);
      if (existing) {
        existing.customer_count += 1;
        if (!r.is_active) existing.is_active = false;
      } else {
        m.set(r.product_id, { name: r.product_name, price: r.product_price, customer_count: 1, is_active: r.is_active });
      }
    }
    return Array.from(m.entries()).sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [rows]);

  // Group by customer for nicer display
  const grouped = useMemo(() => {
    const m = new Map<string, { label: string; items: Row[] }>();
    for (const r of filtered) {
      if (!m.has(r.customer_id)) m.set(r.customer_id, { label: r.customer_label, items: [] });
      m.get(r.customer_id)!.items.push(r);
    }
    return Array.from(m.entries());
  }, [filtered]);

  if (loading) {
    return <div className="py-20 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Tag className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground font-medium">
            {rows.length} special price entr{rows.length === 1 ? 'y' : 'ies'} across {grouped.length} customer{grouped.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Popover open={addOpen} onOpenChange={setAddOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" className="gap-1"><UserPlus className="h-4 w-4" /> Add Customer</Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="end">
              <div className="p-2 border-b border-border">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    autoFocus
                    placeholder="Search username, name or chat id…"
                    value={custQuery}
                    onChange={(e) => setCustQuery(e.target.value)}
                    className="pl-8 h-9"
                  />
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {custSearching ? (
                  <div className="py-6 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" /></div>
                ) : custResults.length === 0 ? (
                  <div className="py-6 text-center text-xs text-muted-foreground">No customers found.</div>
                ) : (
                  custResults.map((c) => {
                    const label = c.username ? '@' + c.username : (c.first_name || `chat ${c.chat_id}`);
                    const sub = c.username && c.first_name ? c.first_name : `chat ${c.chat_id}`;
                    return (
                      <button
                        key={c.id}
                        onClick={() => pickCustomer(c)}
                        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/60 text-left"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{label}</div>
                          <div className="text-[11px] text-muted-foreground truncate">{sub}</div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </PopoverContent>
          </Popover>
          <Input
            placeholder="Search customer, product, note…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
        </div>
      </div>

      <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground mb-4">
        These prices override regular and tiered/bulk pricing for the listed customer only.
        Flash sale wins only if it is cheaper. Use <span className="font-semibold">Add Customer</span> above to set a special price for any user.
      </div>

      {productGroups.length > 0 && (
        <div className="mb-4 rounded-lg border border-border bg-card">
          <div className="px-4 py-2 border-b border-border bg-muted/30 flex items-center justify-between">
            <div className="text-sm font-semibold">Product-wise Special Pricing</div>
            <div className="text-[11px] text-muted-foreground">Toggle off to make ALL customers see regular price for that product</div>
          </div>
          <div className="divide-y divide-border">
            {productGroups.map(([pid, p]) => (
              <div key={pid} className={`flex items-center gap-3 px-4 py-2.5 ${!p.is_active ? 'opacity-60' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 flex-wrap">
                    <div className="font-medium text-sm break-words">{p.name}</div>
                    {!p.is_active && <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">OFF</span>}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Reg ${p.price.toFixed(2)} • {p.customer_count} customer{p.customer_count === 1 ? '' : 's'}
                  </div>
                </div>
                <Switch checked={p.is_active} onCheckedChange={(v) => handleToggleProductActive(pid, !!v)} />
              </div>
            ))}
          </div>
        </div>
      )}

      {grouped.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-lg text-muted-foreground">No special prices set.</p>
          <p className="text-sm text-muted-foreground mt-1">Click <span className="font-semibold">Add Customer</span> above to start.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([custId, g]) => (
            <div key={custId} className="rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
                <div className="font-semibold text-sm">{g.label}</div>
                <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => setOpenCustomer({ id: custId, label: g.label })}>
                  <Pencil className="h-3 w-3" /> Manage
                </Button>
              </div>
              <div className="divide-y divide-border">
                {g.items.map((r) => {
                  const diff = r.price - r.product_price;
                  const pct = r.product_price > 0 ? (diff / r.product_price) * 100 : 0;
                  return (
                    <div key={r.id} className={`flex flex-wrap items-center gap-2 px-4 py-2.5 ${!r.is_active ? 'opacity-60' : ''}`}>
                      <div className="w-full sm:flex-1 sm:min-w-[140px] min-w-0">
                        <div className="flex items-start gap-2 flex-wrap">
                          <div className="font-medium text-sm break-words">{r.product_name}</div>
                          {!r.is_active && <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">OFF</span>}
                        </div>
                        {r.note && <div className="text-xs text-muted-foreground italic break-words">{r.note}</div>}
                      </div>
                      <Badge variant="outline" className="font-mono text-xs">
                        Reg ${r.product_price.toFixed(2)}
                      </Badge>
                      <Badge variant="secondary" className="font-mono">
                        ${r.price.toFixed(2)}
                      </Badge>
                      <Badge variant="outline" className="font-mono text-xs">
                        MOQ {r.min_quantity}{r.min_quantity > 1 ? '+' : ''}
                      </Badge>
                      {r.product_price > 0 && (
                        <span className={`text-xs font-medium ${diff < 0 ? 'text-green-500' : diff > 0 ? 'text-orange-500' : 'text-muted-foreground'}`}>
                          {diff >= 0 ? '+' : ''}{pct.toFixed(0)}%
                        </span>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(r.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <SpecialPricingDialog
        customerId={openCustomer?.id || null}
        customerLabel={openCustomer?.label || ''}
        onClose={() => { setOpenCustomer(null); void load(); }}
      />
    </>
  );
};

export default SpecialPricingTab;
