import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  Loader2, ArrowDownCircle, ArrowUpCircle, ShoppingCart, Wallet, Gift, Pencil,
  CheckCircle2, Clock, XCircle, Hash, Package, FileText, Calendar
} from 'lucide-react';

interface Props {
  customerId: string | null;
  customerLabel: string;
  currentBalance: number;
  onClose: () => void;
}

type EntryType = 'deposit' | 'order' | 'withdrawal' | 'referral' | 'adjustment';

type Entry = {
  id: string;
  ts: string;
  type: EntryType;
  amount: number;            // signed delta to MAIN balance (0 if not affecting)
  affectsBalance: boolean;   // whether to walk running balance
  status?: 'success' | 'pending' | 'failed';
  // visual
  title: string;
  details: { label: string; value: string; mono?: boolean }[];
};

const fmtTime = (s: string) =>
  new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

const dayKey = (s: string) => {
  const d = new Date(s);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return 'Today';
  if (same(d, yest)) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const StatusIcon = ({ s }: { s?: Entry['status'] }) => {
  if (s === 'success') return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
  if (s === 'pending') return <Clock className="h-3.5 w-3.5 text-yellow-500" />;
  if (s === 'failed') return <XCircle className="h-3.5 w-3.5 text-red-500" />;
  return null;
};

const TypeIcon = ({ t }: { t: EntryType }) => {
  const cls = "h-5 w-5";
  switch (t) {
    case 'deposit': return <ArrowDownCircle className={`${cls} text-green-500`} />;
    case 'order': return <ShoppingCart className={`${cls} text-blue-500`} />;
    case 'withdrawal': return <ArrowUpCircle className={`${cls} text-orange-500`} />;
    case 'referral': return <Gift className={`${cls} text-purple-500`} />;
    case 'adjustment': return <Pencil className={`${cls} text-yellow-500`} />;
  }
};

const typeLabel: Record<EntryType, string> = {
  deposit: 'Deposit',
  order: 'Purchase',
  withdrawal: 'Withdrawal',
  referral: 'Referral Bonus',
  adjustment: 'Admin Adjustment',
};

const CustomerActivityDialog = ({ customerId, customerLabel, currentBalance, onClose }: Props) => {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    if (!customerId) return;
    setLoading(true);
    (async () => {
      const [deposits, orders, withdrawals, referrals, adjustments] = await Promise.all([
        supabase.from('bot_deposits').select('id,amount,status,txn_hash,verified_at,created_at').eq('customer_id', customerId),
        supabase.from('bot_orders').select('id,product_name,quantity,total_price,payment_method,txn_hash,status,created_at').eq('customer_id', customerId),
        supabase.from('bot_withdrawals').select('id,amount,status,payment_details,admin_note,created_at,processed_at').eq('customer_id', customerId),
        supabase.from('bot_referral_earnings').select('id,amount,type,created_at').eq('referrer_id', customerId),
        supabase.from('bot_balance_adjustments').select('id,old_balance,new_balance,diff,note,source,created_at').eq('customer_id', customerId),
      ]);

      const list: Entry[] = [];

      for (const d of deposits.data || []) {
        const verified = d.status === 'verified' || d.status === 'completed';
        const rejected = d.status === 'rejected' || d.status === 'failed';
        list.push({
          id: `dep-${d.id}`,
          ts: d.verified_at || d.created_at,
          type: 'deposit',
          amount: verified ? Number(d.amount) : 0,
          affectsBalance: verified,
          status: verified ? 'success' : rejected ? 'failed' : 'pending',
          title: `+${Number(d.amount).toFixed(2)} USDT deposit`,
          details: [
            { label: 'Status', value: d.status },
            ...(d.txn_hash ? [{ label: 'Tx hash', value: d.txn_hash, mono: true }] : []),
            { label: 'Submitted', value: new Date(d.created_at).toLocaleString('en-GB') },
            ...(d.verified_at ? [{ label: 'Verified', value: new Date(d.verified_at).toLocaleString('en-GB') }] : []),
          ],
        });
      }

      for (const o of orders.data || []) {
        const pm = (o.payment_method || '').trim();
        const pmLower = pm.toLowerCase();
        const total = Number(o.total_price);
        // Balance was directly debited only for "Balance" payments.
        // "Pay Later" → pay_later_used increased (no balance impact).
        // "Direct Pay" / specific gateway label → user paid externally (no balance impact).
        const balanceDelta = pmLower === 'balance' ? -total : 0;
        const unit = o.quantity > 0 ? total / o.quantity : total;
        list.push({
          id: `ord-${o.id}`,
          ts: o.created_at,
          type: 'order',
          amount: balanceDelta,
          affectsBalance: balanceDelta !== 0,
          status: o.status === 'completed' ? 'success' : o.status === 'cancelled' ? 'failed' : 'pending',
          title: `${o.product_name} × ${o.quantity}`,
          details: [
            { label: 'Total', value: `${total.toFixed(2)} USDT` },
            { label: 'Unit price', value: `${unit.toFixed(2)} USDT` },
            { label: 'Paid via', value: pm || 'Unknown' },
            { label: 'Status', value: o.status },
            ...(o.txn_hash ? [{ label: 'Tx hash', value: o.txn_hash, mono: true }] : []),
          ],
        });
      }

      for (const w of withdrawals.data || []) {
        const completed = w.status === 'completed' || w.status === 'approved';
        const rejected = w.status === 'rejected' || w.status === 'failed';
        list.push({
          id: `wd-${w.id}`,
          ts: w.processed_at || w.created_at,
          type: 'withdrawal',
          amount: completed ? -Number(w.amount) : 0,
          affectsBalance: completed,
          status: completed ? 'success' : rejected ? 'failed' : 'pending',
          title: `-${Number(w.amount).toFixed(2)} USDT withdrawal`,
          details: [
            { label: 'Status', value: w.status },
            { label: 'Pay to', value: w.payment_details, mono: true },
            ...(w.admin_note ? [{ label: 'Admin note', value: w.admin_note }] : []),
            { label: 'Requested', value: new Date(w.created_at).toLocaleString('en-GB') },
            ...(w.processed_at ? [{ label: 'Processed', value: new Date(w.processed_at).toLocaleString('en-GB') }] : []),
          ],
        });
      }

      for (const r of referrals.data || []) {
        list.push({
          id: `ref-${r.id}`,
          ts: r.created_at,
          type: 'referral',
          amount: Number(r.amount),
          affectsBalance: false, // goes to referral_balance, not main
          status: 'success',
          title: `+${Number(r.amount).toFixed(2)} USDT referral ${r.type}`,
          details: [
            { label: 'Type', value: r.type },
            { label: 'Goes to', value: 'Referral balance (not main)' },
          ],
        });
      }

      for (const a of adjustments.data || []) {
        const diff = Number(a.diff);
        list.push({
          id: `adj-${a.id}`,
          ts: a.created_at,
          type: 'adjustment',
          amount: diff,
          affectsBalance: true,
          status: 'success',
          title: `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} USDT admin ${diff >= 0 ? 'credit' : 'debit'}`,
          details: [
            { label: 'Note', value: a.note },
            { label: 'Source', value: a.source || 'admin' },
            { label: 'Recorded balance', value: `${Number(a.old_balance).toFixed(2)} → ${Number(a.new_balance).toFixed(2)}` },
          ],
        });
      }

      list.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
      setEntries(list);
      setLoading(false);
    })();
  }, [customerId]);

  // Compute running balance (newest → oldest).
  let running = currentBalance;
  const rows = entries.map((e) => {
    const after = running;
    const before = e.affectsBalance ? running - e.amount : running;
    if (e.affectsBalance) running = before;
    return { ...e, balanceAfter: after, balanceBefore: before };
  });

  // Group by day
  const groups: { day: string; items: typeof rows }[] = [];
  for (const r of rows) {
    const d = dayKey(r.ts);
    const last = groups[groups.length - 1];
    if (last && last.day === d) last.items.push(r);
    else groups.push({ day: d, items: [r] });
  }

  // Summary stats
  const totals = entries.reduce(
    (acc, e) => {
      if (e.type === 'deposit' && e.affectsBalance) acc.deposited += e.amount;
      if (e.type === 'order') acc.spent += Number(e.amount === 0 ? 0 : -e.amount);
      if (e.type === 'order') acc.orderCount += 1;
      return acc;
    },
    { deposited: 0, spent: 0, orderCount: 0 }
  );

  return (
    <Dialog open={!!customerId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" /> Activity — {customerLabel}
          </DialogTitle>
        </DialogHeader>

        {/* Summary bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <div className="rounded-md border border-border bg-card p-2.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Current balance</div>
            <div className="text-base font-bold font-mono">{currentBalance.toFixed(2)}</div>
          </div>
          <div className="rounded-md border border-border bg-card p-2.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Deposited (verified)</div>
            <div className="text-base font-bold font-mono text-green-500">+{totals.deposited.toFixed(2)}</div>
          </div>
          <div className="rounded-md border border-border bg-card p-2.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Spent from balance</div>
            <div className="text-base font-bold font-mono text-red-500">-{totals.spent.toFixed(2)}</div>
          </div>
          <div className="rounded-md border border-border bg-card p-2.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Total orders</div>
            <div className="text-base font-bold font-mono">{totals.orderCount}</div>
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
        ) : groups.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">No activity yet</p>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <div key={g.day}>
                <div className="flex items-center gap-2 mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  <Calendar className="h-3 w-3" /> {g.day}
                </div>
                <div className="space-y-1.5">
                  {g.items.map((r) => (
                    <div key={r.id} className="rounded-lg border border-border bg-card p-3">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5"><TypeIcon t={r.type} /></div>
                        <div className="flex-1 min-w-0">
                          {/* Header line */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">{r.title}</span>
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{typeLabel[r.type]}</Badge>
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <StatusIcon s={r.status} /> {r.status}
                            </span>
                            <span className="ml-auto text-xs text-muted-foreground">{fmtTime(r.ts)}</span>
                          </div>

                          {/* Balance change line */}
                          {r.affectsBalance ? (
                            <div className="mt-1.5 flex items-center gap-2 text-xs">
                              <span className="text-muted-foreground">Balance:</span>
                              <span className="font-mono">{r.balanceBefore.toFixed(2)}</span>
                              <span className="text-muted-foreground">→</span>
                              <span className={`font-mono font-semibold ${r.amount >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                {r.balanceAfter.toFixed(2)}
                              </span>
                              <span className={`font-mono ${r.amount >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                ({r.amount >= 0 ? '+' : ''}{r.amount.toFixed(2)})
                              </span>
                            </div>
                          ) : (
                            <div className="mt-1.5 text-xs text-muted-foreground italic">
                              Did not affect main balance
                            </div>
                          )}

                          {/* Details grid */}
                          {r.details.length > 0 && (
                            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5">
                              {r.details.map((d, i) => (
                                <div key={i} className="text-xs flex gap-1.5 min-w-0">
                                  <span className="text-muted-foreground shrink-0">{d.label}:</span>
                                  <span className={`min-w-0 break-all ${d.mono ? 'font-mono' : ''}`}>{d.value}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default CustomerActivityDialog;
