import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, ArrowLeft, Copy, Send, CheckCircle2, ExternalLink, Wallet, ShieldCheck, Clock, Zap, ChevronRight, Sparkles, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useCustomerAuth } from '@/contexts/CustomerAuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { toast } from 'sonner';
import { TelegramRichText, TgEmoji, preloadCustomEmojis } from '@/components/TelegramRichText';
import { QRCodeSVG } from 'qrcode.react';

interface PaymentMethod {
  id: string;
  name: string;
  emoji: string;
  custom_emoji_id: string | null;
  payment_type: string;
  payment_details: string;
  instruction: string | null;
}

function isBkashMethod(m: PaymentMethod | null) {
  if (!m) return false;
  const n = (m.name || '').toLowerCase();
  return n.includes('bkash') || n.includes('বিকাশ') || (m.payment_type || '').toLowerCase() === 'bkash';
}

const VERIFY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

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

  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [selected, setSelected] = useState<PaymentMethod | null>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [bdtAmount, setBdtAmount] = useState('');
  const [txnId, setTxnId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [dollarRate, setDollarRate] = useState<number>(125);

  // verification flow state
  type VState = 'idle' | 'verifying' | 'success' | 'timeout';
  const [vState, setVState] = useState<VState>('idle');
  const [pendingDeposit, setPendingDeposit] = useState<{ id: string; startedAt: number } | null>(null);
  const [verifiedInfo, setVerifiedInfo] = useState<{ amount: number; via?: string; newBalance?: number } | null>(null);
  const [nowTs, setNowTs] = useState<number>(Date.now());

  const isBkash = useMemo(() => isBkashMethod(selected), [selected]);


  useEffect(() => {
    if (!authLoading && !user) { navigate('/login?next=/account/deposit'); return; }
    Promise.all([
      supabase.functions.invoke<{ methods: PaymentMethod[] }>('resolve-payment-methods'),
      supabase.from('bot_settings').select('value').eq('key', 'dollar_rate_bdt').maybeSingle(),
    ]).then(([res, rate]) => {
      if (res.error) throw res.error;
      const rows = res.data?.methods || [];
      setMethods(rows);
      preloadCustomEmojis(rows.map((r) => r.custom_emoji_id));
      if (rate.data?.value) setDollarRate(parseFloat(rate.data.value) || 125);
      setLoading(false);
    }).catch(() => {
      toast.error('Payment details could not be loaded. Please refresh.');
      setMethods([]);
      setLoading(false);
    });
  }, [user, authLoading, navigate]);

  // ticker for countdown display
  useEffect(() => {
    if (vState !== 'verifying') return;
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [vState]);

  // poll deposit status + trigger server recheck while verifying
  useEffect(() => {
    if (vState !== 'verifying' || !pendingDeposit) return;
    let stopped = false;
    let pollIdx = 0;

    const checkStatus = async () => {
      const { data } = await supabase
        .from('bot_deposits')
        .select('id,status,amount')
        .eq('id', pendingDeposit.id)
        .maybeSingle();
      if (stopped) return false;
      if (data?.status === 'verified') {
        await markVerified({ amount: Number(data.amount) });
        return true;
      }
      if (data?.status === 'rejected') {
        setVState('idle');
        setPendingDeposit(null);
        toast.error('Deposit was rejected. Please contact support.');
        return true;
      }
      return false;
    };

    const triggerRecheck = async () => {
      try {
        const { data } = await supabase.functions.invoke('submit-deposit-verification', {
          body: { recheck_deposit_id: pendingDeposit.id },
        });
        if (stopped) return;
        if (data?.verified) {
          await markVerified({ amount: Number(data.amount), via: data.via, newBalance: Number(data.new_balance) });
        }
      } catch { /* ignore */ }
    };

    const tick = async () => {
      if (stopped) return;
      const elapsed = Date.now() - pendingDeposit.startedAt;
      if (elapsed >= VERIFY_WINDOW_MS) {
        setVState('timeout');
        return;
      }
      const done = await checkStatus();
      if (done || stopped) return;
      if (pollIdx > 0 && pollIdx % 3 === 0) {
        await triggerRecheck();
      }
      pollIdx++;
    };

    const initial = setTimeout(() => triggerRecheck(), 5000);
    const interval = setInterval(tick, 10000);
    return () => { stopped = true; clearTimeout(initial); clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vState, pendingDeposit?.id]);

  const chooseMethod = (method: PaymentMethod) => {
    setSelected(method);
    const bk = isBkashMethod(method);
    if (prefillAmount && !bk) {
      setAmount(prefillAmount);
      setBdtAmount('');
    } else if (prefillAmount && bk) {
      // convert USD -> BDT for bkash prefill
      const bdt = Math.ceil(Number(prefillAmount) * dollarRate);
      setBdtAmount(String(bdt));
      setAmount('');
    } else {
      setAmount('');
      setBdtAmount('');
    }
    setTxnId('');
    setVState('idle');
    setPendingDeposit(null);
    setVerifiedInfo(null);
    // scroll to instructions
    setTimeout(() => document.getElementById('deposit-instructions')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const markVerified = async (info: { amount: number; via?: string; newBalance?: number }) => {
    setVerifiedInfo(info);
    setVState('success');
    setPendingDeposit(null);
    try { await refreshCustomer(); } catch { /* ignore */ }
    if (nextUrl) {
      toast.success(`Payment of $${info.amount.toFixed(2)} received — completing your order…`);
      setTimeout(() => navigate(nextUrl), 1500);
    } else {
      toast.success(`Payment of $${info.amount.toFixed(2)} received! Balance updated.`, { duration: 6000 });
    }
  };


  const submitDeposit = async () => {
    const parsedAmount = Number(amount);
    if (!selected) return;
    if (!customer) { toast.error('Customer account is still loading. Try again.'); return; }
    if (!parsedAmount || parsedAmount <= 0) { toast.error('Enter a valid amount'); return; }
    if (!txnId.trim()) { toast.error('Enter your transaction ID'); return; }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('submit-deposit-verification', {
        body: { amount: parsedAmount, txn_hash: txnId.trim(), payment_method: selected.name },
      });
      if (error) {
        let msg = error.message || 'Failed to submit deposit';
        try {
          const ctx: any = (error as any).context;
          if (ctx && typeof ctx.json === 'function') {
            const body = await ctx.json();
            if (body?.error) msg = body.error;
          }
        } catch { /* ignore */ }
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      setAmount('');
      setTxnId('');
      if (data?.verified) {
        await markVerified({ amount: Number(data.amount), via: data.via, newBalance: Number(data.new_balance) });
      } else if (data?.deposit_id) {
        setPendingDeposit({ id: String(data.deposit_id), startedAt: Date.now() });
        setVState('verifying');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit deposit');
    } finally {
      setSubmitting(false);
    }
  };


  const payWithBkash = async () => {
    const bdt = Number(bdtAmount);
    if (!bdt || bdt < 10) { toast.error('Enter at least 10 BDT'); return; }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('bkash-create-payment', {
        body: { amount_bdt: bdt },
      });
      if (error) {
        let msg = error.message || 'Failed to start bKash payment';
        try {
          const ctx: any = (error as any).context;
          if (ctx && typeof ctx.json === 'function') {
            const body = await ctx.json();
            if (body?.error) msg = body.error;
          }
        } catch { /* ignore */ }
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      if (!data?.bkashURL) throw new Error('No payment URL returned');
      window.location.href = data.bkashURL;
    } catch (err: any) {
      toast.error(err.message || 'Failed to start bKash payment');
      setSubmitting(false);
    }
  };

  const copyText = (txt: string, label = 'Copied') => { navigator.clipboard.writeText(txt); toast.success(label); };

  if (loading) return <div className="grid place-items-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

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

        {/* trust strip */}
        <div className="relative mt-6 grid grid-cols-3 gap-3 text-[11px] sm:text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> Secure & encrypted</div>
          <div className="flex items-center gap-1.5 text-muted-foreground"><Zap className="h-3.5 w-3.5 text-amber-400" /> Auto-verified deposits</div>
          <div className="flex items-center gap-1.5 text-muted-foreground"><Clock className="h-3.5 w-3.5 text-sky-400" /> 24/7 support</div>
        </div>
      </div>

      {/* STEP 1 — pick method */}
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="grid h-7 w-7 place-items-center rounded-full bg-primary/15 text-primary text-xs font-bold ring-1 ring-primary/30">1</div>
          <h2 className="font-heading text-lg font-bold">Choose a payment method</h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {methods.map(m => {
            const active = selected?.id === m.id;
            const bk = isBkashMethod(m);
            return (
              <button
                key={m.id}
                onClick={() => chooseMethod(m)}
                className={`group relative overflow-hidden text-left rounded-2xl border p-4 transition-all ${
                  active
                    ? 'border-primary/60 bg-gradient-to-br from-primary/15 to-primary/5 shadow-[0_0_0_1px_hsl(var(--primary)/0.5),0_10px_30px_-15px_hsl(var(--primary)/0.6)]'
                    : 'border-white/[0.06] bg-white/[0.03] hover:border-primary/30 hover:bg-white/[0.05]'
                }`}
              >
                <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                  <Zap className="h-2.5 w-2.5" /> Instant
                </span>
                <div className="flex items-center gap-3 mb-2">
                  <div className={`grid h-11 w-11 place-items-center rounded-xl text-2xl ring-1 transition-colors ${active ? 'bg-primary/20 ring-primary/40' : 'bg-white/[0.04] ring-white/[0.08] group-hover:bg-white/[0.07]'}`}>
                    {m.custom_emoji_id
                      ? <TgEmoji id={m.custom_emoji_id} fallback={m.emoji} size="1.5em" />
                      : <TelegramRichText html={m.emoji} inline />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold leading-tight truncate">{m.name}</div>
                  </div>
                  <ChevronRight className={`h-4 w-4 shrink-0 transition-all ${active ? 'text-primary translate-x-0.5' : 'text-muted-foreground/40 group-hover:text-muted-foreground'}`} />
                </div>
              </button>
            );
          })}
          {methods.length === 0 && (
            <div className="col-span-full rounded-2xl border border-white/[0.06] bg-white/[0.03] p-8 text-center text-muted-foreground">
              No payment methods configured.
            </div>
          )}
        </div>
      </section>

      {/* STEP 2 — instructions + form */}
      {selected && (
        <section id="deposit-instructions" className="space-y-3 scroll-mt-4">
          <div className="flex items-center gap-3">
            <div className="grid h-7 w-7 place-items-center rounded-full bg-primary/15 text-primary text-xs font-bold ring-1 ring-primary/30">2</div>
            <h2 className="font-heading text-lg font-bold">
              {isBkash ? 'Pay with bKash' : `Send via ${selected.name}`}
            </h2>
          </div>

          {isBkash ? (
            <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-br from-pink-500/[0.06] to-white/[0.02] overflow-hidden">
              {/* steps */}
              <div className="grid sm:grid-cols-3 gap-px bg-white/[0.06]">
                {[
                  { n: '1', t: 'Enter BDT amount', d: 'Minimum 10 BDT to start.' },
                  { n: '2', t: 'Pay on bKash', d: 'You will be redirected to bKash checkout.' },
                  { n: '3', t: 'Balance credited', d: 'Auto-credited within seconds of payment.' },
                ].map(s => (
                  <div key={s.n} className="bg-[hsl(var(--background))]/40 p-4">
                    <div className="grid h-6 w-6 place-items-center rounded-full bg-pink-500/20 text-pink-300 text-[11px] font-bold ring-1 ring-pink-500/30 mb-2">{s.n}</div>
                    <div className="text-sm font-semibold">{s.t}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{s.d}</div>
                  </div>
                ))}
              </div>

              <div className="p-5 space-y-4">
                {selected.instruction && (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3 flex gap-2 text-xs text-amber-200/90">
                    <Info className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
                    <p className="whitespace-pre-wrap leading-relaxed">{selected.instruction}</p>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="bkash-bdt" className="text-xs uppercase tracking-wider text-muted-foreground">Amount (BDT)</Label>
                  <div className="relative">
                    <Input
                      id="bkash-bdt"
                      type="number"
                      min="10"
                      step="1"
                      inputMode="decimal"
                      value={bdtAmount}
                      onChange={(e) => setBdtAmount(e.target.value)}
                      placeholder="500"
                      className="h-14 text-2xl font-bold pl-12 pr-20 font-mono"
                    />
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-xl font-bold">৳</span>
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">BDT</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
                    <span>Rate: 1 USD = {dollarRate} BDT</span>
                    {Number(bdtAmount) > 0 && <span className="text-primary font-mono">≈ ${(Number(bdtAmount) / dollarRate).toFixed(2)} USDT</span>}
                  </div>
                  <div className="flex gap-1.5 pt-1 flex-wrap">
                    {[100, 500, 1000, 2000, 5000].map(v => (
                      <button key={v} type="button" onClick={() => setBdtAmount(String(v))} className="text-[11px] px-2.5 py-1 rounded-full border border-white/[0.08] bg-white/[0.03] hover:bg-primary/10 hover:border-primary/30 hover:text-primary transition-colors">
                        ৳{v.toLocaleString()}
                      </button>
                    ))}
                  </div>
                </div>

                <Button onClick={payWithBkash} disabled={submitting || !bdtAmount} className="w-full h-12 text-base gap-2 bg-gradient-to-r from-pink-600 to-pink-500 hover:from-pink-500 hover:to-pink-400 text-white shadow-[0_8px_24px_-8px_rgba(236,72,153,0.6)]">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                  Continue to bKash
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-br from-primary/[0.06] to-white/[0.02] overflow-hidden">
              {/* steps */}
              <div className="grid sm:grid-cols-3 gap-px bg-white/[0.06]">
                {[
                  { n: '1', t: 'Copy the address', d: 'Tap the copy icon below.' },
                  { n: '2', t: 'Send the amount', d: 'From your wallet/exchange.' },
                  { n: '3', t: 'Submit TxID', d: 'Paste and we verify it.' },
                ].map(s => (
                  <div key={s.n} className="bg-[hsl(var(--background))]/40 p-4">
                    <div className="grid h-6 w-6 place-items-center rounded-full bg-primary/20 text-primary text-[11px] font-bold ring-1 ring-primary/30 mb-2">{s.n}</div>
                    <div className="text-sm font-semibold">{s.t}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{s.d}</div>
                  </div>
                ))}
              </div>

              <div className="p-5 space-y-4">
                {/* Address block */}
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">{selected.payment_type === 'wallet' ? 'Wallet address' : 'Payment details'}</Label>
                  <div className="mt-1.5 rounded-xl border border-white/[0.08] bg-[hsl(var(--background))]/60 p-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    {selected.payment_details && (
                      <div className="shrink-0 self-center rounded-lg bg-white p-2">
                        <QRCodeSVG value={selected.payment_details} size={112} level="M" />
                      </div>
                    )}
                    <code className="font-mono text-sm break-all leading-relaxed flex-1 select-all">{selected.payment_details || 'Payment details unavailable'}</code>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={!selected.payment_details}
                      onClick={() => copyText(selected.payment_details, 'Address copied')}
                      className="shrink-0 h-9 w-9 rounded-lg hover:bg-primary/10 hover:text-primary self-end sm:self-center"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
                    <Info className="h-3 w-3" /> Scan the QR or copy the address. Send only on the correct network — wrong network transfers may be lost.
                  </p>
                </div>

                {selected.instruction && (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3 flex gap-2 text-xs text-amber-200/90">
                    <Info className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
                    <p className="whitespace-pre-wrap leading-relaxed">{selected.instruction}</p>
                  </div>
                )}

                {/* Form */}
                <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr] pt-1">
                  <div className="space-y-1.5">
                    <Label htmlFor="deposit-amount" className="text-xs uppercase tracking-wider text-muted-foreground">Amount sent (USDT)</Label>
                    <div className="relative">
                      <Input id="deposit-amount" type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50.00" className="h-11 pl-8 font-mono" />
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">$</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="deposit-txn" className="text-xs uppercase tracking-wider text-muted-foreground">Transaction ID / Hash</Label>
                    <Input id="deposit-txn" value={txnId} onChange={(e) => setTxnId(e.target.value)} placeholder="Paste your payment TxID" className="h-11 font-mono text-sm" />
                  </div>
                </div>

                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3 flex gap-2 text-[11px] text-emerald-200/90 leading-relaxed">
                  <Info className="h-4 w-4 shrink-0 mt-0.5 text-emerald-400" />
                  <p>
                    You can send <span className="font-semibold text-emerald-300">any amount</span> — we auto-detect the real amount from the blockchain / exchange API and credit exactly that to your balance. The amount field above is just for your reference.
                  </p>
                </div>

                {vState === 'idle' && (
                  <Button onClick={submitDeposit} disabled={submitting || !amount || !txnId.trim()} className="w-full h-12 text-base gap-2 bg-gradient-to-r from-primary to-[hsl(245_85%_62%)] hover:opacity-95 text-primary-foreground shadow-[0_8px_24px_-8px_hsl(var(--primary)/0.6)]">
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Submit for verification
                  </Button>
                )}

                {vState === 'verifying' && pendingDeposit && (() => {
                  const elapsed = nowTs - pendingDeposit.startedAt;
                  const remaining = Math.max(0, VERIFY_WINDOW_MS - elapsed);
                  const mm = Math.floor(remaining / 60000);
                  const ss = Math.floor((remaining % 60000) / 1000);
                  const pct = Math.min(100, (elapsed / VERIFY_WINDOW_MS) * 100);
                  return (
                    <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 via-primary/5 to-[hsl(245_85%_62%)]/10 p-5">
                      <div aria-hidden className="pointer-events-none absolute -top-20 -right-20 h-48 w-48 rounded-full bg-primary/30 blur-3xl animate-pulse" />
                      <div className="relative flex items-center gap-4">
                        <div className="relative shrink-0 grid h-16 w-16 place-items-center rounded-full bg-primary/15 ring-1 ring-primary/40">
                          <Loader2 className="h-7 w-7 animate-spin text-primary" />
                          <span className="absolute inset-0 rounded-full ring-2 ring-primary/30 animate-ping" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] uppercase tracking-widest text-primary font-bold mb-1">Verifying payment</div>
                          <div className="font-heading text-lg font-bold leading-tight">Checking blockchain confirmation…</div>
                          <div className="text-xs text-muted-foreground mt-0.5">Auto-credits as soon as the network confirms. Safe to close — we'll keep checking.</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-mono font-bold text-2xl tabular-nums text-primary leading-none">{String(mm).padStart(2,'0')}:{String(ss).padStart(2,'0')}</div>
                          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">remaining</div>
                        </div>
                      </div>
                      <div className="relative mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                        <div className="h-full bg-gradient-to-r from-primary to-[hsl(245_85%_62%)] transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })()}

                {vState === 'success' && verifiedInfo && (
                  <div className="relative overflow-hidden rounded-2xl border border-emerald-500/40 bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-emerald-500/10 p-5">
                    <div aria-hidden className="pointer-events-none absolute -top-20 -right-20 h-48 w-48 rounded-full bg-emerald-500/30 blur-3xl" />
                    <div className="relative flex items-center gap-4">
                      <div className="shrink-0 grid h-16 w-16 place-items-center rounded-full bg-emerald-500/20 ring-1 ring-emerald-500/40">
                        <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold mb-1">Payment verified</div>
                        <div className="font-heading text-lg font-bold leading-tight">
                          +{verifiedInfo.amount.toFixed(2)} USDT credited to your balance
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {verifiedInfo.via ? `Via ${verifiedInfo.via}. ` : ''}New balance: <span className="font-mono font-semibold text-emerald-300">{format(customer?.balance || 0)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="relative mt-4 flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setVState('idle'); setVerifiedInfo(null); }} className="text-xs">Make another deposit</Button>
                      <Button size="sm" variant="ghost" onClick={() => navigate('/account')} className="text-xs">Back to account</Button>
                    </div>
                  </div>
                )}

                {vState === 'timeout' && (
                  <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
                    <div className="flex items-start gap-3">
                      <Clock className="h-5 w-5 shrink-0 mt-0.5 text-amber-400" />
                      <div className="flex-1">
                        <div className="font-semibold text-amber-200">Still waiting for confirmation</div>
                        <div className="text-xs text-amber-100/80 mt-0.5">
                          Your deposit is submitted. Admin will verify it manually and your balance will be credited shortly. You can safely close this page.
                        </div>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => { setVState('idle'); setPendingDeposit(null); }} className="text-xs shrink-0">Dismiss</Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* FAQ / help */}
      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-3">
        <h3 className="font-heading text-sm font-bold flex items-center gap-2"><Info className="h-4 w-4 text-primary" /> Need help?</h3>
        <div className="grid sm:grid-cols-2 gap-3 text-xs text-muted-foreground">
          <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3">
            <div className="font-semibold text-foreground mb-1">How long does it take?</div>
            bKash deposits credit instantly. Crypto/manual deposits are usually confirmed within a few minutes once the network confirms your transaction.
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
