import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, ArrowDownCircle, ShoppingBag, CheckCircle, XCircle } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';

interface BotDeposit {
  id: string;
  customer_id: string;
  amount: number;
  txn_hash: string | null;
  status: string;
  created_at: string;
  verified_at: string | null;
  pending_product_id: string | null;
  pending_quantity: number | null;
  payment_method: string | null;
  via: string | null;
  customer?: { chat_id: number; username: string | null; first_name: string | null };
  product?: { name: string } | null;
}

interface BotOrder {
  id: string;
  customer_id: string;
  product_name: string;
  quantity: number;
  total_price: number;
  status: string;
  created_at: string;
  details: Record<string, string>[] | null;
  customer?: { chat_id: number; username: string | null; first_name: string | null };
}

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ', ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
};

const BotLogsTab = () => {
  const [deposits, setDeposits] = useState<BotDeposit[]>([]);
  const [orders, setOrders] = useState<BotOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifyDialog, setVerifyDialog] = useState<BotDeposit | null>(null);
  const [verifyAmount, setVerifyAmount] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 15000);
    return () => clearInterval(interval);
  }, []);

  const fetchLogs = async () => {
    const [depRes, ordRes] = await Promise.all([
      supabase.from('bot_deposits').select('*, customer:bot_customers(chat_id, username, first_name), product:bot_products!bot_deposits_pending_product_id_fkey(name)').order('created_at', { ascending: false }).limit(50),
      supabase.from('bot_orders').select('*, customer:bot_customers(chat_id, username, first_name)').order('created_at', { ascending: false }).limit(50),
    ]);
    if (depRes.data) setDeposits(depRes.data as any);
    if (ordRes.data) setOrders(ordRes.data as any);
    setLoading(false);
  };

  const getCustomerLabel = (item: { customer?: { username: string | null; first_name: string | null; chat_id: number } }) => {
    if (item.customer?.username) return `@${item.customer.username}`;
    if (item.customer?.first_name) return item.customer.first_name;
    return `#${item.customer?.chat_id || '?'}`;
  };

  const handleVerify = async () => {
    if (!verifyDialog || !verifyAmount || Number(verifyAmount) <= 0) return;
    setVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-verify-deposit', {
        body: { deposit_id: verifyDialog.id, amount: Number(verifyAmount) },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (data?.action === 'delivered') {
        toast.success(`✅ Verified & delivered ${data.product} x${data.qty}`);
      } else {
        toast.success('✅ Deposit verified & balance added');
      }
      setVerifyDialog(null);
      setVerifyAmount('');
      fetchLogs();
    } catch (err: any) {
      toast.error(err.message || 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const handleReject = async (dep: BotDeposit) => {
    if (!confirm(`Reject deposit from ${getCustomerLabel(dep)}?`)) return;
    setRejecting(dep.id);
    try {
      const { data, error } = await supabase.functions.invoke('admin-reject-deposit', {
        body: { deposit_id: dep.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('Deposit rejected & customer notified');
      fetchLogs();
    } catch (err: any) {
      toast.error(err.message || 'Rejection failed');
    } finally {
      setRejecting(null);
    }
  };

  if (loading) {
    return (
      <div className="py-20 text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const pendingCount = deposits.filter(d => d.status === 'pending').length;

  return (
    <>
      <Tabs defaultValue="deposits" className="w-full">
        <TabsList className="mb-4 bg-card">
          <TabsTrigger value="deposits" className="gap-2">
            <ArrowDownCircle className="h-4 w-4" />
            Deposits
            {pendingCount > 0 && (
              <Badge variant="secondary" className="ml-1 bg-yellow-500/20 text-yellow-400 text-xs px-1.5 py-0">{pendingCount} pending</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="bot-orders" className="gap-2"><ShoppingBag className="h-4 w-4" />Bot Orders</TabsTrigger>
        </TabsList>

        <TabsContent value="deposits">
          {deposits.length === 0 ? (
            <div className="py-20 text-center"><p className="text-lg text-muted-foreground">No deposits yet.</p></div>
          ) : (
            <div className="space-y-2">
              {deposits.map((dep) => (
                <div key={dep.id} className="rounded-lg border border-border bg-card px-4 py-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <Badge variant={dep.status === 'verified' ? 'default' : 'secondary'} className={dep.status === 'verified' ? 'bg-success text-success-foreground' : dep.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' : ''}>
                      {dep.status}
                    </Badge>
                    <span className="font-semibold text-foreground">{Number(dep.amount).toFixed(2)} USDT</span>
                    <span className="text-sm text-muted-foreground">{getCustomerLabel(dep)}</span>
                    {dep.payment_method && (
                      <Badge variant="outline" className="text-[10px] font-mono">💳 {dep.payment_method}</Badge>
                    )}
                    {dep.via && (
                      <Badge variant="outline" className="text-[10px] font-mono border-primary/40 text-primary">🌐 {dep.via}</Badge>
                    )}
                    {dep.pending_product_id && dep.product && (
                      <Badge variant="outline" className="text-xs">
                        📦 {(dep.product as any)?.name} x{dep.pending_quantity}
                      </Badge>
                    )}
                    {dep.txn_hash && (
                      <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground truncate max-w-[200px]">
                        {dep.txn_hash}
                      </code>
                    )}
                    {dep.status === 'pending' && (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 text-xs border-green-500/50 text-green-400 hover:bg-green-500/10"
                          onClick={() => { setVerifyDialog(dep); setVerifyAmount(''); }}
                        >
                          <CheckCircle className="h-3 w-3" />
                          Verify
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 text-xs border-destructive/50 text-destructive hover:bg-destructive/10"
                          onClick={() => handleReject(dep)}
                          disabled={rejecting === dep.id}
                        >
                          {rejecting === dep.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                          Reject
                        </Button>
                      </div>
                    )}
                    <span className="ml-auto text-sm text-muted-foreground">{formatDate(dep.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="bot-orders">
          {orders.length === 0 ? (
            <div className="py-20 text-center"><p className="text-lg text-muted-foreground">No bot orders yet.</p></div>
          ) : (
            <div className="space-y-2">
              {orders.map((ord) => (
                <div key={ord.id} className="rounded-lg border border-border bg-card px-4 py-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <Badge variant="default">{ord.product_name}</Badge>
                    <span className="text-sm font-semibold text-foreground">x{ord.quantity}</span>
                    <span className="font-semibold text-foreground">{Number(ord.total_price).toFixed(2)} USDT</span>
                    <span className="text-sm text-muted-foreground">{getCustomerLabel(ord)}</span>
                    <Badge variant="secondary">{ord.status}</Badge>
                    <span className="ml-auto text-sm text-muted-foreground">{formatDate(ord.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!verifyDialog} onOpenChange={(open) => { if (!open) setVerifyDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Verify Deposit</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Customer: <span className="font-semibold text-foreground">{verifyDialog && getCustomerLabel(verifyDialog)}</span>
            </div>
            {verifyDialog?.txn_hash && (
              <div className="text-sm text-muted-foreground">
                TxID: <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{verifyDialog.txn_hash}</code>
              </div>
            )}
            {verifyDialog?.pending_product_id && verifyDialog?.product && (
              <div className="text-sm text-muted-foreground">
                Pending Order: <span className="font-semibold text-foreground">📦 {(verifyDialog.product as any)?.name} x{verifyDialog.pending_quantity}</span>
                <br />
                <span className="text-xs text-yellow-400">Verifying will auto-deliver the product.</span>
              </div>
            )}
            <div>
              <label className="text-sm font-medium">Amount (USDT)</label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="Enter verified amount"
                value={verifyAmount}
                onChange={(e) => setVerifyAmount(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVerifyDialog(null)}>Cancel</Button>
            <Button onClick={handleVerify} disabled={verifying || !verifyAmount || Number(verifyAmount) <= 0}>
              {verifying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
              {verifyDialog?.pending_product_id ? 'Verify & Deliver' : 'Verify & Add Balance'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default BotLogsTab;
