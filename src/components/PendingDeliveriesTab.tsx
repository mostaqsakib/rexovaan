import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ClipboardList, Copy, Check, Loader2, RefreshCw, PackageCheck, X, Send, SkipForward, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';

interface PendingOrder {
  id: string;
  product_name: string;
  quantity: number;
  total_price: number;
  payment_method: string | null;
  customer_inputs: Record<string, string> | null;
  delivered_items: number[] | null;
  delivery_notes: Record<string, string> | null;
  created_at: string;
  customer: { id: string; chat_id: number; first_name: string | null; username: string | null } | null;
}

type DeliverTarget =
  | { kind: 'item'; order: PendingOrder; itemNum: number; fields: [string, string][] }
  | { kind: 'all'; order: PendingOrder; remaining: number[] };

const PendingDeliveriesTab = () => {
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [target, setTarget] = useState<DeliverTarget | null>(null);
  const [note, setNote] = useState('');

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('bot_orders')
      .select('id, product_name, quantity, total_price, payment_method, customer_inputs, delivered_items, delivery_notes, created_at, customer:bot_customers(id, chat_id, first_name, username)')
      .eq('status', 'pending_delivery')
      .order('created_at', { ascending: false })
      .limit(100);
    setOrders((data || []) as unknown as PendingOrder[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const ch = supabase.channel('pending-deliveries')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bot_orders' }, () => void load())
      .subscribe();
    const interval = setInterval(load, 30000);
    return () => { supabase.removeChannel(ch); clearInterval(interval); };
  }, []);

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch { toast.error('Copy failed'); }
  };

  const sendBotMessage = async (chatId: number | undefined, text: string) => {
    if (!chatId) return;
    try {
      await supabase.functions.invoke('send-bot-message', { body: { chat_id: chatId, text } });
    } catch { /* ignore */ }
  };

  const confirmDeliver = async (includeNote: boolean) => {
    if (!target) return;
    const order = target.order;
    const noteText = includeNote ? note.trim() : '';
    setBusy(order.id);

    // Refetch latest delivered_items / notes to avoid stale overwrites
    const { data: fresh } = await supabase
      .from('bot_orders')
      .select('delivered_items, delivery_notes, status')
      .eq('id', order.id)
      .single();
    if (!fresh || fresh.status !== 'pending_delivery') {
      toast.error('Order is no longer pending');
      setBusy(null); setTarget(null); setNote('');
      await load();
      return;
    }
    const delivered: number[] = Array.isArray(fresh.delivered_items) ? (fresh.delivered_items as number[]) : [];
    const notes: Record<string, string> = (fresh.delivery_notes && typeof fresh.delivery_notes === 'object') ? (fresh.delivery_notes as Record<string, string>) : {};

    const itemsToMark = target.kind === 'item' ? [target.itemNum] : target.remaining;
    const newDelivered = Array.from(new Set([...delivered, ...itemsToMark])).sort((a, b) => a - b);
    const newNotes = { ...notes };
    if (noteText) {
      for (const i of itemsToMark) newNotes[String(i)] = noteText;
    }
    const allDone = newDelivered.length >= order.quantity;

    const update = {
      delivered_items: newDelivered,
      delivery_notes: newNotes,
      ...(allDone ? { status: 'completed', delivered_at: new Date().toISOString() } : {}),
    } as never;

    const { error } = await supabase
      .from('bot_orders')
      .update(update)
      .eq('id', order.id)
      .eq('status', 'pending_delivery');
    if (error) { toast.error(error.message); setBusy(null); return; }

    // Build customer message
    const productLine = `Product: <b>${order.product_name}</b>`;
    const isPartial = !allDone && target.kind === 'item';
    const itemLabel = order.quantity > 1
      ? (target.kind === 'item' ? `Item ${target.itemNum} of ${order.quantity}` : `Items ${itemsToMark.join(', ')} of ${order.quantity}`)
      : '';
    const header = allDone
      ? `✅ <b>Order Delivered!</b>\n\n${productLine}\nQuantity: <b>${order.quantity}</b>`
      : `📦 <b>Item Delivered</b>\n\n${productLine}${itemLabel ? `\n${itemLabel}` : ''}`;
    const body = noteText
      ? `\n\n📩 <b>Delivery Details:</b>\n${noteText}`
      : (allDone ? `\n\nYour order has been activated. Check your account/email for access.` : '');
    const footer = allDone
      ? `\n\nThank you for your purchase! 💎`
      : (isPartial ? `\n\nRemaining items will follow shortly.` : '');
    await sendBotMessage(order.customer?.chat_id, header + body + footer);

    toast.success(allDone ? 'Order fully delivered' : `Item ${itemsToMark.join(', ')} delivered`);
    setBusy(null);
    setTarget(null);
    setNote('');
    await load();
  };

  const cancelRefund = async (order: PendingOrder) => {
    if (!confirm(`Cancel & refund "${order.product_name}"?`)) return;
    setBusy(order.id);
    const { data, error } = await supabase.functions.invoke('admin-cancel-pending-delivery', {
      body: { order_id: order.id },
    });
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || 'Cancel failed');
      setBusy(null);
      return;
    }
    if (order.customer?.chat_id) {
      await sendBotMessage(order.customer.chat_id, `❌ <b>Order Cancelled & Refunded</b>\n\nProduct: <b>${order.product_name}</b> x${order.quantity}\nAmount: <b>${Number(order.total_price).toFixed(2)} USDT</b> refunded.`);
    }
    toast.success('Cancelled & refunded');
    setBusy(null);
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-primary" />
          <h2 className="font-heading text-lg">Pending Deliveries</h2>
          <Badge variant="secondary">{orders.length}</Badge>
        </div>
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-4 w-4 mr-1" /> Refresh</Button>
      </div>

      {loading ? (
        <div className="p-8 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></div>
      ) : orders.length === 0 ? (
        <div className="p-12 text-center text-muted-foreground rounded-lg border border-dashed">
          No pending deliveries 🎉
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map(order => {
            const inputs = order.customer_inputs && typeof order.customer_inputs === 'object' ? Object.entries(order.customer_inputs) : [];
            const groups = new Map<number, [string, string][]>();
            for (const [k, v] of inputs) {
              const m = k.match(/^(.*)#(\d+)$/);
              const itemNum = m ? Number(m[2]) : 1;
              const fieldKey = m ? m[1] : k;
              if (!groups.has(itemNum)) groups.set(itemNum, []);
              groups.get(itemNum)!.push([fieldKey, String(v)]);
            }
            // Always render N item slots based on quantity (even if no inputs)
            const itemNums: number[] = [];
            for (let i = 1; i <= order.quantity; i++) itemNums.push(i);
            const delivered = new Set<number>(Array.isArray(order.delivered_items) ? order.delivered_items : []);
            const remaining = itemNums.filter(n => !delivered.has(n));
            const hasMultipleItems = order.quantity > 1;
            const custLabel = order.customer?.username ? `@${order.customer.username}` : (order.customer?.first_name || `ID ${order.customer?.chat_id}`);

            const buildCopyAll = () => itemNums.map(n => {
              const fields = groups.get(n) || [];
              return (hasMultipleItems ? `--- Item ${n} ---\n` : '') + (fields.length ? fields.map(([f, v]) => `${f}: ${v}`).join('\n') : '(no inputs)');
            }).join('\n\n');

            return (
              <Card key={order.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div>
                    <div className="font-semibold">{order.product_name} <span className="text-muted-foreground">×{order.quantity}</span></div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {custLabel} · {Number(order.total_price).toFixed(2)} USDT · {order.payment_method || '—'} · {new Date(order.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant="outline" className="text-warning border-warning/40">
                      {delivered.size}/{order.quantity} delivered
                    </Badge>
                  </div>
                </div>

                {inputs.length > 0 && (
                  <div className="flex justify-end">
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => copy(buildCopyAll(), `${order.id}-all`)}>
                      {copied === `${order.id}-all` ? <Check className="h-3.5 w-3.5 mr-1 text-success" /> : <Copy className="h-3.5 w-3.5 mr-1" />} Copy all inputs
                    </Button>
                  </div>
                )}

                <div className="grid gap-2 sm:grid-cols-2">
                  {itemNums.map(n => {
                    const fields = groups.get(n) || [];
                    const isDelivered = delivered.has(n);
                    return (
                      <div key={n} className={`rounded-md border p-3 space-y-2 ${isDelivered ? 'border-success/40 bg-success/5' : 'border-border bg-muted/40'}`}>
                        <div className="flex items-center justify-between">
                          {hasMultipleItems
                            ? <Badge variant={isDelivered ? 'default' : 'secondary'} className="text-[10px] px-2 py-0.5">Item {n}</Badge>
                            : <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Order</span>}
                          {isDelivered
                            ? <span className="inline-flex items-center gap-1 text-[11px] text-success font-medium"><CheckCheck className="h-3.5 w-3.5" /> Delivered</span>
                            : fields.length > 0 && (
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copy(fields.map(([f, v]) => `${f}: ${v}`).join('\n'), `${order.id}-item-${n}`)}>
                                {copied === `${order.id}-item-${n}` ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                              </Button>
                            )}
                        </div>
                        {fields.length === 0 ? (
                          <div className="text-xs text-muted-foreground italic">No customer inputs</div>
                        ) : (
                          fields.map(([f, v]) => (
                            <div key={f} className="flex items-center justify-between gap-2 text-sm">
                              <div className="min-w-0 flex-1">
                                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{f}</div>
                                <div className="font-mono text-xs break-all">{v}</div>
                              </div>
                              {!isDelivered && (
                                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => copy(v, `${order.id}-${n}-${f}`)}>
                                  {copied === `${order.id}-${n}-${f}` ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                                </Button>
                              )}
                            </div>
                          ))
                        )}
                        {!isDelivered && (
                          <Button
                            size="sm"
                            className="w-full h-8"
                            onClick={() => { setTarget({ kind: 'item', order, itemNum: n, fields }); setNote(''); }}
                            disabled={busy === order.id}
                          >
                            <PackageCheck className="h-3.5 w-3.5 mr-1" /> Mark this {hasMultipleItems ? 'item' : 'order'} delivered
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="flex gap-2 pt-1">
                  {hasMultipleItems && remaining.length > 0 && (
                    <Button
                      variant="secondary"
                      onClick={() => { setTarget({ kind: 'all', order, remaining }); setNote(''); }}
                      disabled={busy === order.id}
                      className="flex-1"
                    >
                      {busy === order.id ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCheck className="h-4 w-4 mr-1" />}
                      Mark all remaining ({remaining.length})
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => cancelRefund(order)} disabled={busy === order.id} className={hasMultipleItems ? '' : 'flex-1'}>
                    <X className="h-4 w-4 mr-1" /> Cancel & Refund
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!target} onOpenChange={(o) => { if (!o) { setTarget(null); setNote(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackageCheck className="h-5 w-5 text-success" />
              {target?.kind === 'all' ? 'Deliver Remaining Items' : (target?.order && target.order.quantity > 1 ? `Deliver Item ${target.itemNum}` : 'Deliver Order')}
            </DialogTitle>
          </DialogHeader>
          {target && (
            <div className="space-y-3">
              <div className="rounded-md bg-muted/40 p-3 text-sm">
                <div className="font-semibold">
                  {target.order.product_name} <span className="text-muted-foreground">×{target.order.quantity}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {target.order.customer?.username ? `@${target.order.customer.username}` : (target.order.customer?.first_name || `ID ${target.order.customer?.chat_id}`)}
                  {' · '}
                  {target.kind === 'item' ? `Item ${target.itemNum}` : `${target.remaining.length} remaining (${target.remaining.join(', ')})`}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Optional delivery message (sent to customer)</Label>
                <Textarea
                  rows={6}
                  placeholder={'e.g.\nLogin: user@example.com\nPassword: TempPass123\nProfile: Slot 2'}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Leave empty and press Skip to send only the standard confirmation.</p>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => confirmDeliver(false)} disabled={!target || busy === target?.order.id}>
              <SkipForward className="h-4 w-4 mr-1" /> Skip & Deliver
            </Button>
            <Button onClick={() => confirmDeliver(true)} disabled={!target || !note.trim() || busy === target?.order.id}>
              {target && busy === target.order.id ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />} Send & Deliver
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PendingDeliveriesTab;
