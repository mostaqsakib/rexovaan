import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Zap, Package, ShieldCheck, Bolt, Headphones, ArrowRight, Sparkles, TrendingUp, Flame } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useCustomerAuth } from '@/contexts/CustomerAuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { TelegramRichText, TgEmoji } from '@/components/TelegramRichText';
import { Countdown } from '@/components/customer/Countdown';

interface ProductLite {
  id: string;
  name: string;
  description: string | null;
  price: number;
  short_code: string | null;
  last_known_stock: number;
  is_manual_delivery: boolean;
  custom_emoji_id: string | null;
}

interface Flash { product_id: string; sale_price: number; ends_at: string; }



export default function Shop() {
  const { user, customer } = useCustomerAuth();
  const { format } = useCurrency();
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [flashList, setFlashList] = useState<Flash[]>([]);
  const [specialList, setSpecialList] = useState<Array<{ product_id: string; price: number; min_quantity: number }>>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: prods }, { data: flashes }, sp] = await Promise.all([
        supabase.from('bot_products').select('id,name,description,price,short_code,last_known_stock,is_manual_delivery,custom_emoji_id').eq('is_active', true).order('sort_order'),
        supabase.from('bot_flash_sales').select('product_id,sale_price,ends_at').eq('is_active', true).gte('ends_at', new Date().toISOString()),
        customer
          ? supabase.from('bot_customer_pricing').select('product_id,price,min_quantity').eq('customer_id', customer.id).eq('is_active', true)
          : Promise.resolve({ data: [] } as any),
      ]);
      setProducts((prods as any) || []);
      setFlashList((flashes as any) || []);
      setSpecialList(((sp as any)?.data as any) || []);
      setLoading(false);
    })();
  }, [customer?.id]);

  const flashMap = useMemo(() => {
    const m: Record<string, Flash> = {};
    flashList.forEach(f => { if (!m[f.product_id] || f.sale_price < m[f.product_id].sale_price) m[f.product_id] = f; });
    return m;
  }, [flashList]);

  const specialMap = useMemo(() => {
    const m: Record<string, { price: number; min_quantity: number }> = {};
    specialList.forEach(s => { m[s.product_id] = { price: Number(s.price), min_quantity: Number(s.min_quantity || 1) }; });
    return m;
  }, [specialList]);

  // Returns the lowest immediately-applicable price for a product (qty=1).
  const lowestFor = (p: ProductLite) => {
    const candidates: number[] = [Number(p.price)];
    const f = flashMap[p.id];
    if (f) candidates.push(Number(f.sale_price));
    const s = specialMap[p.id];
    if (s && s.min_quantity <= 1) candidates.push(s.price);
    return Math.min(...candidates);
  };

  const filtered = products.filter(p => !q || p.name.toLowerCase().includes(q.toLowerCase()));
  const flashProducts = products.filter(p => flashMap[p.id]);
  const inStockCount = products.filter(p => p.last_known_stock > 0 || p.is_manual_delivery).length;

  return (
    <div className="space-y-12">
      {/* HERO */}
      <section className="relative overflow-hidden rounded-3xl border border-border premium-card p-8 sm:p-12">
        <div className="absolute inset-0 -z-0 opacity-70" style={{
          background: 'radial-gradient(60% 60% at 15% 10%, hsl(244 75% 59% / 0.25), transparent 60%), radial-gradient(50% 50% at 90% 100%, hsl(260 75% 65% / 0.20), transparent 60%)'
        }} />
        <div className="relative z-10 max-w-2xl space-y-5">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-xs text-primary font-medium">
            <Sparkles className="h-3.5 w-3.5" /> Trusted digital marketplace
          </div>
          <h1 className="font-heading text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight">
            Premium digital products,
            <br />
            <span className="gradient-text">delivered instantly.</span>
          </h1>
          <p className="text-muted-foreground text-base sm:text-lg max-w-xl">
            Top up your balance once and unlock fast, automated delivery on every purchase. Secure payments, live stock, and 24/7 support — all in one place.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button size="lg" className="gap-2" onClick={() => document.getElementById('all-products')?.scrollIntoView({ behavior: 'smooth' })}>
              Browse products <ArrowRight className="h-4 w-4" />
            </Button>
            {!user && (
              <Button size="lg" variant="outline" asChild>
                <Link to="/signup">Create account</Link>
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 pt-3 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-success" /> Secure checkout</span>
            <span className="inline-flex items-center gap-1.5"><Bolt className="h-4 w-4 text-warning" /> Instant delivery</span>
            <span className="inline-flex items-center gap-1.5"><Headphones className="h-4 w-4 text-primary" /> 24/7 support</span>
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Products', value: products.length, icon: Package },
          { label: 'In stock', value: inStockCount, icon: TrendingUp },
          { label: 'Flash sales', value: flashProducts.length, icon: Zap },
          { label: 'Auto delivery', value: '24/7', icon: Bolt },
        ].map((s, i) => (
          <div key={i} className="premium-card p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/15 text-primary grid place-items-center">
              <s.icon className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xl font-bold">{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </div>
          </div>
        ))}
      </section>

      {/* FLASH SALES */}
      {flashProducts.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-heading text-2xl font-bold flex items-center gap-2">
              <Zap className="h-5 w-5 text-warning" /> Flash Sales
            </h2>
            <span className="text-xs text-muted-foreground">Limited time</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {flashProducts.slice(0, 6).map(p => {
              const f = flashMap[p.id];
              const off = Math.round(((Number(p.price) - Number(f.sale_price)) / Number(p.price)) * 100);
              return (
                <Link key={p.id} to={`/p/${p.short_code || p.id}`} className="premium-card premium-card-hover p-5 block group relative">
                  <div className="absolute -top-px -right-px bg-gradient-to-br from-warning to-warning/70 text-warning-foreground text-[11px] font-bold px-3 py-1 rounded-bl-xl rounded-tr-xl shadow-lg shadow-warning/30 flex items-center gap-1">
                    <Flame className="h-3 w-3" /> -{off}%
                  </div>
                  <h3 className="font-heading font-semibold text-base group-hover:text-primary transition-colors line-clamp-2 pr-16 mb-3 break-words inline-flex items-center gap-1.5">{p.custom_emoji_id && <TgEmoji id={p.custom_emoji_id} size="1.1em" />}<span>{p.name}</span></h3>
                  <div className="flex items-baseline gap-2 mb-4">
                    <span className="text-3xl font-bold gradient-text">{format(f.sale_price)}</span>
                    <span className="text-sm text-muted-foreground line-through">{format(p.price)}</span>
                  </div>
                  <div className="pt-3 border-t border-border/60">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Ends in</div>
                    <Countdown to={f.ends_at} />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* ALL PRODUCTS */}
      <section id="all-products" className="space-y-5 scroll-mt-20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-heading text-2xl font-bold">All Products</h2>
            <p className="text-sm text-muted-foreground">Browse the full catalog and check out in seconds.</p>
          </div>
          <div className="relative w-full sm:max-w-xs">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products..." className="pl-9" />
          </div>
        </div>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1,2,3,4,5,6].map(i => <div key={i} className="premium-card h-56 animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="premium-card p-16 text-center text-muted-foreground">No products found.</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map(p => {
              const f = flashMap[p.id];
              const effective = lowestFor(p);
              const discounted = effective < Number(p.price);
              const stock = p.last_known_stock;
              const stockBadge = p.is_manual_delivery
                ? { cls: 'bg-success/10 text-success border-success/30', label: 'In stock' }
                : stock > 0
                  ? { cls: 'bg-success/10 text-success border-success/30', label: `${stock} in stock` }
                  : { cls: 'bg-destructive/10 text-destructive border-destructive/30', label: 'Out of stock' };
              return (
                <Link key={p.id} to={`/p/${p.short_code || p.id}`} className="premium-card premium-card-hover p-5 block group flex flex-col">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="font-heading font-semibold text-base sm:text-lg group-hover:text-primary transition-colors line-clamp-2 break-words flex-1 inline-flex items-center gap-1.5">{p.custom_emoji_id && <TgEmoji id={p.custom_emoji_id} size="1.1em" />}<span>{p.name}</span></h3>
                    {f && f.sale_price < p.price && (
                      <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-warning/15 text-warning border border-warning/30 px-2 py-0.5 text-[10px] font-semibold">
                        <Zap className="h-3 w-3" /> SALE
                      </span>
                    )}
                  </div>
                  {p.description && <p className="text-sm text-muted-foreground line-clamp-2 mb-4 break-words"><TelegramRichText inline html={p.description} /></p>}
                  <div className="flex items-end justify-between mt-auto pt-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">Starting at</div>
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-2xl font-bold gradient-text">{format(effective)}</span>
                        {discounted && <span className="text-sm text-muted-foreground line-through">{format(p.price)}</span>}
                      </div>
                    </div>
                    <div className={`shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full border ${stockBadge.cls}`}>
                      <Package className="h-3 w-3" /> {stockBadge.label}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

    </div>
  );
}
