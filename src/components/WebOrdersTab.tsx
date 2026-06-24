import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Globe, Loader2, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

type WebOrder = {
  id: string;
  customer_id: string;
  product_name: string;
  quantity: number;
  total_price: number;
  status: string;
  payment_method: string | null;
  txn_hash?: string | null;
  source: string;
  details: any;
  delivered_items?: any;
  created_at: string;
  delivered_at: string | null;
  customer?: {
    chat_id: number | null;
    username: string | null;
    first_name: string | null;
    auth_user_id: string | null;
  } | null;
};

const getOrderSource = (order: WebOrder): 'web' | 'bot' => {
  return order.source === 'web' ? 'web' : 'bot';
};

const getOrderDetails = (order: WebOrder) => {
  const details = Array.isArray(order.details) ? order.details : [];
  if (details.length > 0) return details;
  return Array.isArray(order.delivered_items) ? order.delivered_items : [];
};

const fmtDate = (s: string) => {
  const d = new Date(s);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ', ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
};

const WebOrdersTab = () => {
  const [orders, setOrders] = useState<WebOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'web' | 'bot'>('all');
  const [refundTarget, setRefundTarget] = useState<WebOrder | null>(null);
  const [refundNote, setRefundNote] = useState('');
  const [refunding, setRefunding] = useState(false);

  const PAGE_SIZE = 500;

  const fetchPage = async (from: number, to: number, search?: string): Promise<WebOrder[]> => {
    let data: any[] | null = null;
    if (search && search.trim()) {
      // Server-side full search across product, ids, txn, delivered_items, details, customer
      const { data: rpcData, error } = await supabase.rpc('admin_search_orders', {
        q: search.trim(),
        lim: 100000,
      });
      if (error) {
        toast.error('Orders could not be loaded');
        return [];
      }
      data = rpcData as any[];
    } else {
      const { data: pageData, error } = await supabase
        .from('bot_orders')
        .select('id, customer_id, product_name, quantity, total_price, status, payment_method, txn_hash, source, details, delivered_items, created_at, delivered_at')
        .order('created_at', { ascending: false })
        .range(from, to);
      if (error) {
        toast.error('Orders could not be loaded');
        return [];
      }
      data = pageData as any[];
    }
    const customerIds = Array.from(new Set((data || []).map((r: any) => r.customer_id).filter(Boolean)));
    let customersById: Record<string, WebOrder['customer']> = {};
    if (customerIds.length) {
      const { data: customers } = await supabase
        .from('bot_customers')
        .select('id, chat_id, username, first_name, auth_user_id')
        .in('id', customerIds as string[]);
      customersById = (customers || []).reduce((acc: Record<string, WebOrder['customer']>, c: any) => {
        acc[c.id] = c;
        return acc;
      }, {});
    }
    return (data || []).map((r: any) => ({ ...r, customer: customersById[r.customer_id] || null }));
  };

  const load = async (search?: string) => {
    setLoading(true);
    const rows = await fetchPage(0, PAGE_SIZE - 1, search);
    setOrders(rows);
    setHasMore(!search?.trim() && rows.length === PAGE_SIZE);
    setLoading(false);
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const rows = await fetchPage(orders.length, orders.length + PAGE_SIZE - 1);
    setOrders(prev => [...prev, ...rows]);
    setHasMore(rows.length === PAGE_SIZE);
    setLoadingMore(false);
  };

  useEffect(() => {
    const handle = setTimeout(() => { void load(q); }, q ? 300 : 0);
    return () => clearTimeout(handle);
  }, [q]);

  const filtered = orders.filter((o) => {
    if (sourceFilter !== 'all' && getOrderSource(o) !== sourceFilter) return false;
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    const detailsText = getOrderDetails(o)
      .map((d: any) => Object.values(d || {}).join(' '))
      .join(' ')
      .toLowerCase();
    return (
      o.product_name.toLowerCase().includes(s) ||
      (o.customer?.username || '').toLowerCase().includes(s) ||
      (o.customer?.first_name || '').toLowerCase().includes(s) ||
      String(o.customer?.chat_id || '').includes(s) ||
      o.id.toLowerCase().includes(s) ||
      detailsText.includes(s)
    );
  });

  const copyDetails = (o: WebOrder) => {
    const lines: string[] = [];
    const arr = getOrderDetails(o);
    arr.forEach((d: any) => {
      Object.values(d || {}).forEach((v) => lines.push(String(v)));
    });
    navigator.clipboard.writeText(lines.join('\n'));
    toast.success('Copied details');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by product, customer, chat ID, order ID…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
          {(['all', 'web', 'bot'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSourceFilter(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded capitalize transition-colors ${
                sourceFilter === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => load(q)} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="py-20 text-center">
          <Globe className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">No orders found.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((o) => {
            const isOpen = expanded === o.id;
            const details = getOrderDetails(o);
            const cust = o.customer;
            const custLabel = cust?.username
              ? `@${cust.username}`
              : cust?.first_name || (cust?.chat_id ? `#${cust.chat_id}` : 'Unknown');
            const src = getOrderSource(o);
            return (
              <div key={o.id} className="rounded-lg border border-border bg-card overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : o.id)}
                  className="flex w-full items-center gap-2 flex-wrap px-4 py-3 text-left transition-colors hover:bg-muted/50"
                >
                  {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  <Badge variant="secondary" className="font-medium">{o.product_name}</Badge>
                  <span className="text-sm font-semibold">x{o.quantity}</span>
                  <span className="text-sm text-muted-foreground">${Number(o.total_price).toFixed(2)}</span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] uppercase ${src === 'web' ? 'border-primary/40 text-primary' : 'border-muted-foreground/30 text-muted-foreground'}`}
                  >
                    {src}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] uppercase">{o.status}</Badge>
                  <span className="ml-auto flex items-center gap-2 flex-wrap justify-end text-xs text-muted-foreground">
                    <span className="hidden sm:inline">{custLabel}</span>
                    <span className="whitespace-nowrap">{fmtDate(o.created_at)}</span>
                  </span>
                </button>

                {isOpen && (
                  <div className="border-t border-border bg-muted/30 px-4 py-4 space-y-4">
                    <div className="grid gap-2 sm:grid-cols-2 text-xs">
                      <div><span className="text-muted-foreground">Customer: </span><span className="font-medium">{custLabel}</span></div>
                      {cust?.chat_id && <div><span className="text-muted-foreground">Chat ID: </span><span className="font-mono">{cust.chat_id}</span></div>}
                      <div>
                        <span className="text-muted-foreground">Order #: </span>
                        <span className="font-mono font-semibold">{o.id.substring(0, 4).toUpperCase()}</span>
                        <span className="text-muted-foreground/60 font-mono text-[10px] break-all ml-2">({o.id})</span>
                      </div>
                      <div><span className="text-muted-foreground">Payment: </span><span className="font-medium">{o.payment_method || '—'}</span></div>
                      {o.txn_hash && <div><span className="text-muted-foreground">Transaction: </span><span className="font-mono break-all">{o.txn_hash}</span></div>}
                      {o.delivered_at && <div><span className="text-muted-foreground">Delivered: </span><span>{fmtDate(o.delivered_at)}</span></div>}
                    </div>

                    {details.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Delivered items</div>
                        <div className="space-y-2">
                          {details.map((d: any, i: number) => (
                            <div key={i} className="rounded-md bg-background/60 border border-border/50 p-3 space-y-1">
                              {Object.entries(d || {}).map(([k, v]) => (
                                <p key={k} className="font-mono text-xs break-all">
                                  <span className="text-muted-foreground">{k}: </span>{String(v)}
                                </p>
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
                      <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={() => copyDetails(o)}>
                        <Copy className="h-3.5 w-3.5" /> Copy details
                      </Button>
                      {o.status !== 'refunded' && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 text-xs text-destructive hover:text-destructive border-destructive/40 hover:bg-destructive/10"
                          onClick={() => { setRefundTarget(o); setRefundNote(''); }}
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Refund
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {hasMore && !loading && !q && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore} className="gap-1.5">
            {loadingMore ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</> : 'Load more orders'}
          </Button>
        </div>
      )}

      <AlertDialog open={!!refundTarget} onOpenChange={(o) => !o && !refunding && setRefundTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Refund this order?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>This will:</p>
                <ul className="list-disc pl-5 text-muted-foreground space-y-0.5">
                  <li>Restore the delivered items back to stock</li>
                  <li>Return <span className="font-semibold text-foreground">${Number(refundTarget?.total_price || 0).toFixed(2)}</span> to the customer's balance</li>
                  <li>Delete the delivery messages from their Telegram inbox</li>
                  <li>Remove the order from their order history</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={refundNote}
            onChange={(e) => setRefundNote(e.target.value)}
            placeholder="Optional note (sent to customer)"
            className="text-sm"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={refunding}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={refunding}
              onClick={async (e) => {
                e.preventDefault();
                if (!refundTarget) return;
                setRefunding(true);
                try {
                  const { data, error } = await supabase.functions.invoke('admin-refund-order', {
                    body: { order_id: refundTarget.id, note: refundNote.trim() || undefined },
                  });
                  if (error || data?.error) throw new Error(data?.error || error?.message || 'Refund failed');
                  toast.success(`Refunded — ${data?.deleted_messages || 0}/${data?.total_messages || 0} messages removed`);
                  setRefundTarget(null);
                  await load();
                } catch (err) {
                  toast.error((err as Error).message);
                } finally {
                  setRefunding(false);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {refunding ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refund order'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default WebOrdersTab;
