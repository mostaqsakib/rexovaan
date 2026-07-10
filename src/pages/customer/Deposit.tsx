import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Wallet, ShieldCheck, Clock, Zap, Sparkles, Info, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCustomerAuth } from '@/contexts/CustomerAuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { toast } from 'sonner';
import PaymentFlow from '@/components/customer/PaymentFlow';

export default function Deposit() {
  const { user, customer, loading: authLoading, refreshCustomer } = useCustomerAuth();
  const { format } = useCurrency();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const prefillAmount = searchParams.get('amount');
  const nextUrl = searchParams.get('next');

  // Handle bKash callback redirect (?bkash=success|cancel|failed&msg=...)
  useEffect(() => {
    const bkash = searchParams.get('bkash');
    if (!bkash) return;
    const msg = searchParams.get('msg') || '';
    (async () => {
      if (bkash === 'success') {
        try { await refreshCustomer(); } catch { /* ignore */ }
        toast.success('bKash payment successful! Balance updated.', { description: msg || undefined, duration: 6000 });
      } else if (bkash === 'cancel') {
        toast.warning('bKash payment cancelled', { description: msg || 'You cancelled the payment.', duration: 6000 });
      } else {
        toast.error('bKash payment failed', { description: msg || 'Please try again.', duration: 6000 });
      }
    })();
    const next = new URLSearchParams(searchParams);
    ['bkash', 'msg', 'amount', 'trx'].forEach((k) => next.delete(k));
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!authLoading && !user) navigate('/login?next=/account/deposit');
  }, [user, authLoading, navigate]);

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-10">
      <Button variant="ghost" size="sm" onClick={() => navigate('/account')} className="gap-1.5 -ml-2">
        <ArrowLeft className="h-4 w-4" /> Back to account
      </Button>

      {/* HERO */}
      <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-primary/20 via-[hsl(245_85%_62%)]/10 to-[hsl(280_75%_60%)]/10 p-6 sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-primary/30 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-[hsl(280_75%_60%)]/20 blur-3xl" />
        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-primary mb-3">
              <Sparkles className="h-3 w-3" /> Add funds
            </div>
            <h1 className="font-heading text-3xl sm:text-4xl font-bold tracking-tight">Top up your balance</h1>
            <p className="text-sm text-muted-foreground mt-2 max-w-md">Pick a payment method below, follow the simple steps, and your balance updates instantly after verification.</p>
          </div>
          <div className="shrink-0 rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 p-4 min-w-[180px]">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-emerald-400/80 font-bold">
              <Wallet className="h-3 w-3" /> Current balance
            </div>
            <div className="mt-1 font-mono text-2xl font-bold text-emerald-300">{format(customer?.balance || 0)}</div>
          </div>
        </div>

        <div className="relative mt-6 grid grid-cols-3 gap-3 text-[11px] sm:text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> Secure & encrypted</div>
          <div className="flex items-center gap-1.5 text-muted-foreground"><Zap className="h-3.5 w-3.5 text-amber-400" /> Auto-verified deposits</div>
          <div className="flex items-center gap-1.5 text-muted-foreground"><Clock className="h-3.5 w-3.5 text-sky-400" /> 24/7 support</div>
        </div>
      </div>

      {/* Unified payment flow — auto-generates on-chain addresses, handles bKash, Binance Pay, etc. */}
      <PaymentFlow
        prefillAmount={prefillAmount}
        onVerified={(info) => {
          if (nextUrl) {
            toast.success(`Payment of $${info.amount.toFixed(2)} received — completing your order…`);
            setTimeout(() => navigate(nextUrl), 1500);
          } else {
            toast.success(`Payment of $${info.amount.toFixed(2)} received! Balance updated.`, { duration: 6000 });
          }
        }}
      />

      {/* FAQ / help */}
      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-3">
        <h3 className="font-heading text-sm font-bold flex items-center gap-2"><Info className="h-4 w-4 text-primary" /> Need help?</h3>
        <div className="grid sm:grid-cols-2 gap-3 text-xs text-muted-foreground">
          <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3">
            <div className="font-semibold text-foreground mb-1">How long does it take?</div>
            bKash deposits credit instantly. Crypto deposits are auto-verified within a few minutes once the network confirms your transaction.
          </div>
          <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3">
            <div className="font-semibold text-foreground mb-1">Wrong amount or TxID?</div>
            Reach out on Telegram support and an admin will reconcile the deposit for you. Always send from a wallet you control.
          </div>
        </div>
        <a href="https://t.me/VenexOG" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline">
          <Send className="h-3.5 w-3.5" /> Contact support on Telegram
        </a>
      </section>
    </div>
  );
}
