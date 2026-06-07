import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, ShoppingCart, Loader2, Zap, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useCustomerAuth } from '@/contexts/CustomerAuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { TelegramRichText, TgEmoji } from '@/components/TelegramRichText';
import { Countdown } from '@/components/customer/Countdown';

export default function ProductDetail() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { user, customer } = useCustomerAuth();
  const { format } = useCurrency();
  const [product, setProduct] = useState<any>(null);
  const [tiers, setTiers] = useState<any[]>([]);
  const [flash, setFlash] = useState<any>(null);
  const [special, setSpecial] = useState<any>(null);
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      let query = supabase.from('bot_products').select('*').eq('is_active', true).limit(1);
      // try short_code first, then id
      const { data: byCode } = await query.eq('short_code', (code || '').toUpperCase()).maybeSingle();
      let p = byCode;
      if (!p) {
        const { data: byId } = await supabase.from('bot_products').select('*').eq('id', code).maybeSingle();
        p = byId;
      }
      setProduct(p);
      if (p) {
        const [{ data: tier }, { data: f }, { data: s }] = await Promise.all([
          supabase.from('bot_product_pricing').select('*').eq('product_id', p.id).order('min_quantity'),
          supabase.from('bot_flash_sales').select('*').eq('product_id', p.id).eq('is_active', true).gte('ends_at', new Date().toISOString()).order('sale_price').limit(1).maybeSingle(),
          customer ? supabase.from('bot_customer_pricing').select('*').eq('product_id', p.id).eq('customer_id', customer.id).eq('is_active', true).maybeSingle() : Promise.resolve({ data: null }),
        ]);
        setTiers(tier || []);
        setFlash(f);
        setSpecial(s);
      }
      setLoading(false);
    })();
  }, [code, customer?.id]);

  if (loading) return <div className="grid place-items-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!product) return <div className="premium-card p-12 text-center"><p className="text-muted-foreground">Product not found.</p><Button asChild className="mt-4"><Link to="/">Back to shop</Link></Button></div>;

  // Resolve unit price
  let unit = Number(product.price);
  if (special && qty >= special.min_quantity) unit = Number(special.price);
  else {
    const tier = [...tiers].reverse().find(t => qty >= t.min_quantity && (!t.max_quantity || qty <= t.max_quantity));
    if (tier) unit = Number(tier.price);
  }
  if (flash && Number(flash.sale_price) < unit) unit = Number(flash.sale_price);
  const total = +(unit * qty).toFixed(2);

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate('/')} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back</Button>

      <div className="premium-card gradient-border p-6 md:p-8 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-heading text-2xl md:text-3xl font-bold inline-flex items-center gap-2 flex-wrap">{product.custom_emoji_id && <TgEmoji id={product.custom_emoji_id} size="1.1em" />}<span>{product.name}</span></h1>
            
          </div>
          <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium ${product.last_known_stock > 0 || product.is_manual_delivery ? 'bg-success/10 text-success border-success/30' : 'bg-destructive/10 text-destructive border-destructive/30'}`}>
            <Package className="h-4 w-4" /> {product.is_manual_delivery ? 'In stock' : product.last_known_stock > 0 ? `${product.last_known_stock} in stock` : 'Out of stock'}
          </div>
        </div>

        {product.description && (
          <div className="text-foreground/90 leading-relaxed break-words">
            <TelegramRichText html={product.description} />
          </div>
        )}

        {flash && (
          <div className="relative overflow-hidden rounded-xl border border-warning/40 bg-gradient-to-br from-warning/15 via-warning/5 to-transparent p-4">
            <div className="absolute -top-8 -right-8 h-32 w-32 rounded-full bg-warning/20 blur-3xl" />
            <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-warning/20 grid place-items-center ring-1 ring-warning/40">
                  <Zap className="h-5 w-5 text-warning" />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-warning/80 font-semibold">Flash sale</div>
                  <div className="text-lg font-bold gradient-text">{format(flash.sale_price)}</div>
                </div>
              </div>
              <div className="sm:text-right">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Ends in</div>
                <Countdown to={flash.ends_at} />
              </div>
            </div>
          </div>
        )}

        {tiers.length > 1 && (
          <div className="rounded-2xl border border-success/40 bg-gradient-to-b from-success/10 via-success/[0.03] to-transparent p-4 sm:p-5 shadow-[0_0_40px_-12px_hsl(var(--success)/0.35)]">
            <div className="text-center text-success font-bold tracking-[0.2em] text-sm mb-4">
              WHOLESALE PRICING
            </div>
            <div className="space-y-2.5">
              {tiers.map(t => (
                <div key={t.id} className="flex items-center justify-between rounded-xl border border-border/60 bg-background/40 px-4 py-3">
                  <div className="font-semibold text-base">
                    {t.min_quantity}{t.max_quantity ? `-${t.max_quantity}` : '+'} items
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-bold text-lg">{format(t.price)}</span>
                    <span className="text-xs text-muted-foreground">for each</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-[linear-gradient(135deg,hsl(var(--primary)/0.12),hsl(var(--background)/0.6)_55%,hsl(var(--background)/0.4))] shadow-[0_20px_60px_-30px_hsl(var(--primary)/0.6)]">
          <div className="pointer-events-none absolute -top-24 -right-20 h-56 w-56 rounded-full bg-primary/20 blur-3xl" />
          <div className="relative p-4 sm:p-5 space-y-4">
            {/* Unit price row */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] font-semibold text-muted-foreground">Unit price</div>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className="text-xl font-bold tabular-nums">{format(unit)}</span>
                  <span className="text-xs text-muted-foreground">/ item</span>
                </div>
              </div>
              <div className="flex items-stretch h-10 rounded-lg border border-border bg-background/70 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setQty(Math.max(1, qty - 1))}
                  disabled={qty <= 1}
                  className="w-9 grid place-items-center text-base font-bold text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-40 transition"
                  aria-label="Decrease"
                >−</button>
                <Input
                  type="number"
                  min={1}
                  max={product.last_known_stock}
                  value={qty === 0 ? '' : qty}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '') { setQty(0); return; }
                    const n = parseInt(v);
                    if (isNaN(n)) return;
                    setQty(Math.min(product.last_known_stock || n, Math.max(0, n)));
                  }}
                  onBlur={() => { if (!qty || qty < 1) setQty(1); }}
                  className="w-12 h-full border-0 bg-transparent text-center text-sm font-semibold tabular-nums px-0 focus-visible:ring-0 focus-visible:ring-offset-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  type="button"
                  onClick={() => setQty(Math.min(product.last_known_stock || qty + 1, qty + 1))}
                  disabled={!!product.last_known_stock && qty >= product.last_known_stock}
                  className="w-9 grid place-items-center text-base font-bold text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-40 transition"
                  aria-label="Increase"
                >+</button>
              </div>
            </div>

            {/* Divider with breakdown */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-dashed border-border/70" /></div>
              <div className="relative flex justify-center">
                <span className="bg-card px-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground tabular-nums">
                  {format(unit)} × {qty}
                </span>
              </div>
            </div>

            {/* Total row */}
            <div className="flex items-end justify-between">
              <div className="text-[11px] uppercase tracking-[0.2em] font-semibold text-muted-foreground">Total payable</div>
              <div className="text-2xl sm:text-3xl font-extrabold gradient-text tabular-nums leading-none">{format(total)}</div>
            </div>

            {!user ? (
              <Button className="w-full h-11 text-sm font-semibold" onClick={() => navigate(`/login?next=/p/${code}`)}>
                <ShoppingCart className="h-4 w-4 mr-2" /> Sign in to buy
              </Button>
            ) : (
              <Button
                className="w-full h-11 text-sm font-semibold shadow-[0_10px_30px_-10px_hsl(var(--primary)/0.8)] hover:shadow-[0_14px_36px_-8px_hsl(var(--primary)/0.95)] transition-shadow"
                onClick={() => navigate(`/checkout?product=${product.id}&qty=${qty}`)}
                disabled={product.last_known_stock === 0 || product.is_manual_delivery}
              >
                <ShoppingCart className="h-4 w-4 mr-2" /> {product.is_manual_delivery ? 'Available only via Telegram bot' : `Checkout · ${format(total)}`}
              </Button>
            )}
          </div>
        </div>


      </div>
    </div>
  );
}
