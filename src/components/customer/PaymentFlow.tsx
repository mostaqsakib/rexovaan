import { useEffect, useMemo, useState } from 'react';
import { Loader2, Copy, Send, CheckCircle2, ExternalLink, Zap, ChevronRight, Info, Clock } from 'lucide-react';
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

const VERIFY_WINDOW_MS = 5 * 60 * 1000;

export interface PaymentFlowProps {
  /** USD amount to prefill (string or number). For bKash this gets converted to BDT. */
  prefillAmount?: string | number | null;
  /** Called when payment is verified (instant credit). */
  onVerified?: (info: { amount: number; via?: string; newBalance?: number }) => void;
  /** Show compact mode (used inside checkout). */
  compact?: boolean;
}

export default function PaymentFlow({ prefillAmount, onVerified, compact }: PaymentFlowProps) {
  const { customer, refreshCustomer } = useCustomerAuth();
  const { format } = useCurrency();

  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [selected, setSelected] = useState<PaymentMethod | null>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [bdtAmount, setBdtAmount] = useState('');
  const [txnId, setTxnId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [dollarRate, setDollarRate] = useState<number>(125);

  type VState = 'idle' | 'verifying' | 'success' | 'timeout';
  const [vState, setVState] = useState<VState>('idle');
  const [pendingDeposit, setPendingDeposit] = useState<{ id: string; startedAt: number } | null>(null);
  const [verifiedInfo, setVerifiedInfo] = useState<{ amount: number; via?: string; newBalance?: number } | null>(null);
  const [nowTs, setNowTs] = useState<number>(Date.now());

  const isBkash = useMemo(() => isBkashMethod(selected), [selected]);

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    if (vState !== 'verifying') return;
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [vState]);

  const markVerified = async (info: { amount: number; via?: string; newBalance?: number }) => {
    setVerifiedInfo(info);
    setVState('success');
    setPendingDeposit(null);
    try { await refreshCustomer(); } catch { /* ignore */ }
    onVerified?.(info);
  };

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
      if (elapsed >= VERIFY_WINDOW_MS) { setVState('timeout'); return; }
      const done = await checkStatus();
      if (done || stopped) return;
      if (pollIdx > 0 && pollIdx % 3 === 0) await triggerRecheck();
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
      setAmount(String(prefillAmount));
      setBdtAmount('');
    } else if (prefillAmount && bk) {
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
    setTimeout(() => document.getElementById('pf-instructions')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
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

  if (loading) return <div className="grid place-items-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-5">
      {/* STEP 1 — pick method */}
      <section className="space-y-3">
        {!compact && (
          <div className="flex items-center gap-3">
            <div className="grid h-7 w-7 place-items-center rounded-full bg-primary/15 text-primary text-xs font-bold ring-1 ring-primary/30">1</div>
            <h2 className="font-heading text-lg font-bold">Choose a payment method</h2>
          </div>
        )}

        <div className={`grid gap-3 ${compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
          {methods.map(m => {
            const active = selected?.id === m.id;
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

      {/* STEP 2 — pay & verify */}
      {selected && (
        <section id="pf-instructions" className="space-y-3 scroll-mt-4">
          {!compact && (
            <div className="flex items-center gap-3">
              <div className="grid h-7 w-7 place-items-center rounded-full bg-primary/15 text-primary text-xs font-bold ring-1 ring-primary/30">2</div>
              <h2 className="font-heading text-lg font-bold">
                {isBkash ? 'Pay with bKash' : `Send via ${selected.name}`}
              </h2>
            </div>
          )}

          {isBkash ? (
            <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-br from-pink-500/[0.06] to-white/[0.02] p-5 space-y-4">
              {selected.instruction && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3 flex gap-2 text-xs text-amber-200/90">
                  <Info className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
                  <p className="whitespace-pre-wrap leading-relaxed">{selected.instruction}</p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="pf-bkash-bdt" className="text-xs uppercase tracking-wider text-muted-foreground">Amount (BDT)</Label>
                <div className="relative">
                  <Input
                    id="pf-bkash-bdt"
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
              </div>
              <Button onClick={payWithBkash} disabled={submitting || !bdtAmount} className="w-full h-12 text-base gap-2 bg-gradient-to-r from-pink-600 to-pink-500 hover:from-pink-500 hover:to-pink-400 text-white shadow-[0_8px_24px_-8px_rgba(236,72,153,0.6)]">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                Continue to bKash
              </Button>
            </div>
          ) : (
            <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-br from-primary/[0.06] to-white/[0.02] p-5 space-y-4">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">{selected.payment_type === 'wallet' ? 'Wallet address' : 'Payment details'}</Label>
                <div className="mt-1.5 flex flex-col items-center gap-3">
                  {selected.payment_details && (
                    <div className="rounded-xl bg-white p-3 shadow-lg shadow-primary/10 ring-1 ring-white/10">
                      <QRCodeSVG value={selected.payment_details} size={140} level="M" />
                    </div>
                  )}
                  <div className="w-full rounded-xl border border-white/[0.08] bg-[hsl(var(--background))]/70 p-3 flex items-center gap-2">
                    <code className="font-mono text-sm break-all leading-relaxed flex-1 select-all text-center">
                      {selected.payment_details || 'Payment details unavailable'}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={!selected.payment_details}
                      onClick={() => copyText(selected.payment_details, 'Address copied')}
                      className="shrink-0 h-9 w-9 rounded-lg hover:bg-primary/10 hover:text-primary"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
                  <Info className="h-3 w-3" /> Scan the QR or copy the address. Send only on the correct network.
                </p>
              </div>

              {selected.instruction && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3 flex gap-2 text-xs text-amber-200/90">
                  <Info className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
                  <p className="whitespace-pre-wrap leading-relaxed">{selected.instruction}</p>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr] pt-1">
                <div className="space-y-1.5">
                  <Label htmlFor="pf-amount" className="text-xs uppercase tracking-wider text-muted-foreground">Amount sent (USDT)</Label>
                  <div className="relative">
                    <Input id="pf-amount" type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50.00" className="h-11 pl-8 font-mono" />
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">$</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pf-txn" className="text-xs uppercase tracking-wider text-muted-foreground">Transaction ID / Hash</Label>
                  <Input id="pf-txn" value={txnId} onChange={(e) => setTxnId(e.target.value)} placeholder="Paste your payment TxID" className="h-11 font-mono text-sm" />
                </div>
              </div>

              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3 flex gap-2 text-[11px] text-emerald-200/90 leading-relaxed">
                <Info className="h-4 w-4 shrink-0 mt-0.5 text-emerald-400" />
                <p>
                  Send <span className="font-semibold text-emerald-300">any amount</span> — we auto-detect from the blockchain and credit the exact amount. Order completes automatically once verified.
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
                        <div className="text-xs text-muted-foreground mt-0.5">Order completes the moment payment is confirmed.</div>
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
                  <div className="relative flex items-center gap-4">
                    <div className="shrink-0 grid h-16 w-16 place-items-center rounded-full bg-emerald-500/20 ring-1 ring-emerald-500/40">
                      <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold mb-1">Payment verified</div>
                      <div className="font-heading text-lg font-bold leading-tight">
                        +{verifiedInfo.amount.toFixed(2)} USDT credited
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        New balance: <span className="font-mono font-semibold text-emerald-300">{format(customer?.balance || 0)}</span>
                      </div>
                    </div>
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
                        Your deposit is submitted. Once verified, your balance is credited and your order auto-completes.
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => { setVState('idle'); setPendingDeposit(null); }} className="text-xs shrink-0">Dismiss</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
