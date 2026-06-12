import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Package, ChevronDown, Copy, Download, FileText, Hash, CreditCard, Calendar, CheckCircle2, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useCustomerAuth } from '@/contexts/CustomerAuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { toast } from 'sonner';
import DeliveryInstructions from '@/components/customer/DeliveryInstructions';

function shortId(id: string) {
  return id.substring(0, 4).toUpperCase();
}

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function detailsToTxt(details: any[]) {
  return details.map((d, i) =>
    details.length > 1 ? `${i + 1}. ${Object.values(d).join(' | ')}` : Object.values(d).join(' | ')
  ).join('\n');
}

function detailsToCsv(details: any[]) {
  if (!details.length) return '';
  const keys = Array.from(details.reduce((s: Set<string>, d: any) => { Object.keys(d || {}).forEach(k => s.add(k)); return s; }, new Set<string>())) as string[];
  const escape = (v: any) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = keys.map(escape).join(',');
  const rows = details.map(d => keys.map((k) => escape(d?.[k])).join(','));
  return [header, ...rows].join('\n');
}

export default function Orders() {
  const { user, customer, loading: authLoading } = useCustomerAuth();
  const { format } = useCurrency();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<any[]>([]);
  const [products, setProducts] = useState<Record<string, { delivery_instruction: string | null; delivery_media: any }>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!authLoading && !user) { navigate('/login?next=/account/orders'); return; }
    if (!customer) return;
    (async () => {
      const { data } = await supabase.from('bot_orders').select('*').eq('customer_id', customer.id).neq('status', 'refunded').order('created_at', { ascending: false }).limit(50);
      setOrders(data || []);
      const ids = Array.from(new Set((data || []).map((o: any) => o.product_id).filter(Boolean)));
      if (ids.length) {
        const { data: prods } = await supabase.from('bot_products').select('id,delivery_instruction,delivery_media').in('id', ids as string[]);
        const map: Record<string, any> = {};
        (prods || []).forEach((p: any) => {
          let media = p.delivery_media;
          if (typeof media === 'string') { try { media = JSON.parse(media); } catch { media = []; } }
          map[p.id] = { delivery_instruction: p.delivery_instruction, delivery_media: media };
        });
        setProducts(map);
      }
      setLoading(false);
    })();
  }, [customer, user, authLoading]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, '');
    if (!q) return orders;
    return orders.filter(o => {
      const name = String(o.product_name || '').toLowerCase();
      const no = shortId(o.id).toLowerCase();
      return name.includes(q) || no.includes(q);
    });
  }, [orders, query]);

  if (loading || authLoading) return <div className="grid place-items-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  if (orders.length === 0) {
    return <div className="premium-card p-12 text-center space-y-3"><Package className="h-10 w-10 mx-auto text-muted-foreground" /><p className="text-muted-foreground">No orders yet.</p><Button onClick={() => navigate('/')}>Start shopping</Button></div>;
  }

  return (
    <div className="space-y-3 max-w-3xl mx-auto">
      <h1 className="font-heading text-2xl font-bold">Order history</h1>
      <div className="relative">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by order # or product name…"
          className="pl-9 pr-9"
        />
        {query && (
          <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {filtered.length === 0 && (
        <div className="premium-card p-8 text-center text-sm text-muted-foreground">No orders match "{query}".</div>
      )}
      {filtered.map(o => {
        const isOpen = open === o.id;
        const details = Array.isArray(o.details) ? o.details : [];
        const txt = detailsToTxt(details);
        const csv = detailsToCsv(details);
        const orderNo = shortId(o.id);
        const unit = o.quantity ? Number(o.total_price) / o.quantity : Number(o.total_price);
        const baseName = `order-${orderNo}-${(o.product_name || 'items').replace(/[^a-z0-9]+/gi, '_').slice(0, 40)}`;
        return (
          <div key={o.id} className="premium-card overflow-hidden">
            <button onClick={() => setOpen(isOpen ? null : o.id)} className="w-full p-4 flex items-center justify-between gap-3 text-left hover:bg-muted/30">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium truncate">{o.product_name}</span>
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-300 border border-amber-400/30">#{orderNo}</span>
                </div>
                <div className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleString()} • Qty {o.quantity}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-mono font-bold">{format(o.total_price)}</div>
                <div className={`text-xs capitalize ${o.status === 'completed' ? 'text-success' : 'text-muted-foreground'}`}>{o.status}</div>
              </div>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
              <div className="border-t border-border p-4 space-y-4 bg-muted/20">
                {/* Order meta grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  <div className="space-y-0.5">
                    <div className="text-muted-foreground flex items-center gap-1"><Hash className="h-3 w-3" /> Order #</div>
                    <button onClick={() => { navigator.clipboard.writeText(orderNo); toast.success('Copied'); }} className="font-mono font-semibold hover:text-primary">{orderNo}</button>
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" /> Placed</div>
                    <div className="font-medium">{new Date(o.created_at).toLocaleString()}</div>
                  </div>
                  {o.delivered_at && (
                    <div className="space-y-0.5">
                      <div className="text-muted-foreground flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Delivered</div>
                      <div className="font-medium">{new Date(o.delivered_at).toLocaleString()}</div>
                    </div>
                  )}
                  <div className="space-y-0.5">
                    <div className="text-muted-foreground">Quantity</div>
                    <div className="font-medium">{o.quantity}</div>
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-muted-foreground">Unit price</div>
                    <div className="font-mono">{format(unit)}</div>
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-muted-foreground">Total paid</div>
                    <div className="font-mono font-bold gradient-text">{format(o.total_price)}</div>
                  </div>
                  {o.payment_method && (
                    <div className="space-y-0.5">
                      <div className="text-muted-foreground flex items-center gap-1"><CreditCard className="h-3 w-3" /> Payment</div>
                      <div className="font-medium capitalize">{o.payment_method}</div>
                    </div>
                  )}
                  {o.txn_hash && (
                    <div className="space-y-0.5 col-span-2">
                      <div className="text-muted-foreground">Transaction</div>
                      <button onClick={() => { navigator.clipboard.writeText(o.txn_hash); toast.success('Copied'); }} className="font-mono text-[11px] break-all hover:text-primary text-left">{o.txn_hash}</button>
                    </div>
                  )}
                </div>

                {/* Items + downloads */}
                <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-border/60">
                  <div className="text-xs text-muted-foreground">{details.length} item(s)</div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Button variant="ghost" size="sm" disabled={!details.length} onClick={() => { navigator.clipboard.writeText(txt); toast.success('Copied'); }}>
                      <Copy className="h-3.5 w-3.5 mr-1" /> Copy
                    </Button>
                    <Button variant="ghost" size="sm" disabled={!details.length} onClick={() => downloadFile(`${baseName}.txt`, txt, 'text/plain')}>
                      <FileText className="h-3.5 w-3.5 mr-1" /> TXT
                    </Button>
                    <Button variant="ghost" size="sm" disabled={!details.length} onClick={() => downloadFile(`${baseName}.csv`, csv, 'text/csv')}>
                      <Download className="h-3.5 w-3.5 mr-1" /> CSV
                    </Button>
                  </div>
                </div>
                <pre className="bg-background/60 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap break-all max-h-64 overflow-auto">{txt || '(no details)'}</pre>
                {products[o.product_id] && (
                  <DeliveryInstructions
                    instruction={products[o.product_id].delivery_instruction}
                    media={products[o.product_id].delivery_media}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
