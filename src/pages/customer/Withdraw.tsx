import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useCustomerAuth } from '@/contexts/CustomerAuthContext';
import { toast } from 'sonner';

export default function Withdraw() {
  const { user, customer, loading: authLoading, refreshCustomer } = useCustomerAuth();
  const navigate = useNavigate();
  const [amount, setAmount] = useState('');
  const [details, setDetails] = useState('');
  const [network, setNetwork] = useState('TRC20');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (!authLoading && !user) navigate('/login?next=/account/withdraw'); }, [user, authLoading]);
  if (authLoading) return <div className="grid place-items-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error('Invalid amount'); return; }
    if (amt > Number(customer?.balance || 0)) { toast.error('Insufficient balance'); return; }
    if (!details.trim()) { toast.error('Enter wallet address'); return; }
    setSubmitting(true);
    const { error } = await supabase.from('bot_withdrawals').insert({
      customer_id: customer!.id,
      amount: amt,
      payment_details: details.trim(),
      network,
      asset: 'USDT',
    });
    if (error) { toast.error(error.message); setSubmitting(false); return; }
    // deduct
    await supabase.rpc('deduct_customer_balance', { _customer_id: customer!.id, _amount: amt });
    await refreshCustomer();
    toast.success('Withdrawal request submitted');
    setSubmitting(false);
    navigate('/account');
  };

  return (
    <div className="space-y-5 max-w-xl mx-auto">
      <Button variant="ghost" size="sm" onClick={() => navigate('/account')} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back</Button>
      <div className="premium-card gradient-border p-6 space-y-4">
        <h1 className="font-heading text-2xl font-bold">Withdraw</h1>
        <p className="text-sm text-muted-foreground">Available: <span className="font-mono font-semibold text-foreground">${Number(customer?.balance || 0).toFixed(2)}</span></p>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Amount (USDT)</label>
            <Input type="number" step="0.01" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Network</label>
            <select value={network} onChange={(e) => setNetwork(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="TRC20">USDT — TRC20</option>
              <option value="BEP20">USDT — BEP20</option>
              <option value="TON">USDT — TON</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Wallet address</label>
            <Textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={2} required />
          </div>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Request withdrawal
          </Button>
        </form>
      </div>
    </div>
  );
}
