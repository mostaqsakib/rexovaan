import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, CheckCircle2, Copy, Wallet, CreditCard, Zap, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useCustomerAuth } from '@/contexts/CustomerAuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { toast } from 'sonner';
import DeliveryInstructions from '@/components/customer/DeliveryInstructions';
import PaymentFlow from '@/components/customer/PaymentFlow';

export default function Checkout() {
  const [params] = useSearchParams();
  const productId = params.get('product');
  const qty = Math.max(1, parseInt(params.get('qty') || '1'));
  const autoPay = params.get('auto') === '1';
  const navigate = useNavigate();
  const { user, customer, refreshCustomer } = useCustomerAuth();
  const { format } = useCurrency();
  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [result, setResult] = useState<{ details: any[]; total: number; orderId: string } | null>(null);
  const [autoAttempted, setAutoAttempted] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const payRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!user) { navigate(`/login?next=/checkout?product=${productId}&qty=${qty}`); return; }
    if (!productId) { navigate('/'); return; }
    (async () => {
      const { data } = await supabase.from('bot_products').select('*').eq('id', productId).maybeSingle();
      setProduct(data);
      setLoading(false);
    })();
  }, [productId, user]);

  const total = useMemo(() => (product ? Number(product.price) * qty : 0), [product, qty]);

  const place = async () => {
    setPlacing(true);
    try {
      const { data, error } = await supabase.functions.invoke('customer-checkout', {
        body: { productId, quantity: qty, paymentMethod: 'balance' },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Checkout failed');
      setResult({ details: data.details, total: data.totalPrice, orderId: data.orderId });
      await refreshCustomer();
      toast.success('Order placed!');

      // Send delivery email (best-effort, don't block UX)
      if (user?.email) {
        const items = (data.details || []).map((d: any) =>
          typeof d === 'string' ? d : Object.values(d).join(' | ')
        );
        supabase.functions.invoke('send-transactional-email', {
          body: {
            templateName: 'order-delivery',
            recipientEmail: user.email,
            idempotencyKey: `order-delivery-${data.orderId}`,
            templateData: {
              customerName: customer?.first_name || undefined,
              productName: product.name,
              quantity: qty,
              totalPrice: data.totalPrice,
              orderId: data.orderId.substring(0, 4).toUpperCase(),
              items,
            },
          },
        }).catch((err) => console.warn('order email failed', err));
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPlacing(false);
    }
  };

  const balance = Number(customer?.balance || 0);
  const insufficient = balance < total;
  const shortBy = Math.max(0, total - balance);

  // Auto-place order after returning from deposit flow once balance is sufficient
  useEffect(() => {
    if (!autoPay || autoAttempted || loading || !product || !customer) return;
    if (!insufficient && !placing && !result) {
      setAutoAttempted(true);
      place();
    }
  }, [autoPay, autoAttempted, loading, product, customer, insufficient, placing, result]);

  if (loading) return <div className="grid place-items-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!product) return <div className="premium-card p-8 text-center text-muted-foreground">Product unavailable.</div>;

  if (result) {
    const text = result.details.map((d, i) =>
      result.details.length > 1 ? `${i + 1}. ${Object.values(d).join(' | ')}` : Object.values(d).join(' | ')
    ).join('\n');
    return (
      <div className="space-y-6 max-w-2xl mx-auto">
        <div className="premium-card gradient-border p-6 text-center space-y-3">
          <div className="mx-auto h-14 w-14 rounded-full bg-success/15 grid place-items-center"><CheckCircle2 className="h-7 w-7 text-success" /></div>
          <h2 className="text-2xl font-heading font-bold">Order complete</h2>
          <p className="text-muted-foreground text-sm">{result.details.length} item(s) delivered — total {format(result.total)}</p>
          <div className="mx-auto inline-flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Order ID</span>
            <span className="font-mono text-xs">{result.orderId.substring(0, 4).toUpperCase()}</span>
            <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => { navigator.clipboard.writeText(result.orderId.substring(0, 4).toUpperCase()); toast.success('Order ID copied'); }}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Save this — share with support if you need help with this order.</p>
        </div>
        <div className="premium-card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold">Your items</div>
            <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard.writeText(text); toast.success('Copied'); }}><Copy className="h-4 w-4 mr-1" /> Copy all</Button>
          </div>
          <pre className="bg-muted/40 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap break-all max-h-96 overflow-auto">{text}</pre>
        </div>
        <DeliveryInstructions instruction={product.delivery_instruction} media={product.delivery_media} />
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => navigate('/')}>Continue shopping</Button>
          <Button className="flex-1" onClick={() => navigate('/account/orders')}>View orders</Button>
        </div>
      </div>
    );
  }

  const openPay = () => {
    setShowPay(true);
    setTimeout(() => payRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back</Button>

      <div className="premium-card gradient-border p-6 space-y-4">
        <h1 className="font-heading text-2xl font-bold">Checkout</h1>

        <div className="flex justify-between py-3 border-b border-border">
          <div>
            <div className="font-medium">{product.name}</div>
            <div className="text-sm text-muted-foreground">{format(product.price)} × {qty}</div>
          </div>
          <div className="text-xl font-bold">{format(total)}</div>
        </div>

        <div className="space-y-3">
          <div className="text-sm font-semibold">Payment method</div>

          {/* Balance option */}
          <div
            className={`w-full text-left rounded-xl border p-3.5 flex items-center justify-between transition-colors ${
              !insufficient
                ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/30'
                : 'border-white/[0.08] bg-white/[0.02] opacity-70'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 ring-1 ring-primary/30"><Wallet className="h-4 w-4 text-primary" /></div>
              <div>
                <div className="font-semibold text-sm">Account balance</div>
                <div className="text-[11px] text-muted-foreground">Instant — no extra steps</div>
              </div>
            </div>
            <div className="font-mono font-semibold text-sm">{format(balance)}</div>
          </div>

          {/* Direct pay option */}
          {insufficient && (
            <button
              type="button"
              onClick={openPay}
              className={`w-full text-left rounded-xl border p-3.5 flex items-center justify-between transition-colors ${
                showPay
                  ? 'border-emerald-500/60 bg-gradient-to-br from-emerald-500/15 to-emerald-500/[0.06] ring-1 ring-emerald-500/40'
                  : 'border-emerald-500/40 bg-gradient-to-br from-emerald-500/10 to-emerald-500/[0.04] hover:border-emerald-500/60 hover:from-emerald-500/15'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/30"><CreditCard className="h-4 w-4 text-emerald-400" /></div>
                <div>
                  <div className="font-semibold text-sm flex items-center gap-1.5">
                    Pay directly
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                      <Zap className="h-2.5 w-2.5" /> Instant
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">Binance, Bybit, bKash, USDT, LTC and more — order auto-completes after payment</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Pay</div>
                <div className="font-mono font-semibold text-sm text-emerald-300">{format(shortBy)}</div>
              </div>
            </button>
          )}
        </div>

        {insufficient ? (
          !showPay && (
            <Button className="w-full bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white" size="lg" onClick={openPay}>
              <CreditCard className="h-4 w-4 mr-2" />
              Pay {format(shortBy)} and complete order
            </Button>
          )
        ) : (
          <Button className="w-full" size="lg" onClick={() => setConfirmOpen(true)} disabled={placing}>
            {placing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Place order — {format(total)}
          </Button>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Confirm your order
            </AlertDialogTitle>
            <AlertDialogDescription>
              Please review the details below before we charge your balance.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Product</span>
              <span className="font-medium text-right">{product.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Unit price</span>
              <span className="font-mono">{format(product.price)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Quantity</span>
              <span className="font-mono">× {qty}</span>
            </div>
            <div className="border-t border-border pt-3 flex justify-between">
              <span className="text-muted-foreground">Order total</span>
              <span className="font-bold">{format(total)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Current balance</span>
              <span className="font-mono">{format(balance)}</span>
            </div>
            <div className="flex justify-between text-destructive">
              <span>Amount to deduct</span>
              <span className="font-mono font-semibold">− {format(total)}</span>
            </div>
            <div className="border-t border-border pt-3 flex justify-between">
              <span className="text-muted-foreground">Balance after order</span>
              <span className="font-mono font-semibold text-emerald-400">{format(balance - total)}</span>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={placing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={placing}
              onClick={(e) => {
                e.preventDefault();
                setConfirmOpen(false);
                place();
              }}
            >
              {placing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Confirm & pay {format(total)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Inline payment flow — pay directly, no redirect */}
      {insufficient && showPay && (
        <div ref={payRef} className="premium-card p-5 space-y-3">
          <div>
            <div className="font-heading text-lg font-bold">Complete payment</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Pay <span className="font-mono font-semibold text-emerald-300">{format(shortBy)}</span> — once verified, your order is delivered instantly.
            </div>
          </div>
          <PaymentFlow
            prefillAmount={shortBy.toFixed(2)}
            compact
            onVerified={async () => {
              await refreshCustomer();
              if (!result && !placing) {
                toast.success('Payment verified — completing your order…');
                place();
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
