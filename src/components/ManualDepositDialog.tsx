import { useState } from 'react';
import { Loader2, PlusCircle, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

type Cust = { id: string; chat_id: number | null; username: string | null; first_name: string | null };

const label = (c: Cust) => (c.username ? `@${c.username}` : c.first_name || `#${c.chat_id ?? '—'}`);

const ManualDepositDialog = ({ onDone }: { onDone: () => void }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Cust[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Cust | null>(null);
  const [amount, setAmount] = useState('');
  const [txn, setTxn] = useState('');
  const [method, setMethod] = useState('Bybit Pay');
  const [saving, setSaving] = useState(false);

  const search = async () => {
    const term = q.trim();
    if (!term) return;
    setSearching(true);
    const numeric = /^-?\d+$/.test(term);
    let query = supabase.from('bot_customers').select('id, chat_id, username, first_name').limit(15);
    query = numeric
      ? query.eq('chat_id', Number(term))
      : query.or(`username.ilike.%${term}%,first_name.ilike.%${term}%`);
    const { data, error } = await query;
    setSearching(false);
    if (error) { toast.error('Search failed'); return; }
    setResults((data as Cust[]) || []);
    if (!data?.length) toast.error('No customer found');
  };

  const submit = async () => {
    const amt = Number(amount);
    if (!picked) { toast.error('Pick a customer'); return; }
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    if (!confirm(`Credit $${amt.toFixed(2)} to ${label(picked)}?\n\nOnly do this after you've confirmed the payment really arrived.`)) return;
    setSaving(true);
    const { data, error } = await supabase.functions.invoke('admin-manual-deposit', {
      body: { customer_id: picked.id, amount: amt, txn_hash: txn.trim(), payment_method: method.trim() },
    });
    setSaving(false);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || 'Failed to credit');
      return;
    }
    toast.success(`Credited $${amt.toFixed(2)}${(data as any)?.notified ? ' — customer notified' : ''}`);
    setOpen(false);
    setPicked(null); setAmount(''); setTxn(''); setQ(''); setResults([]);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" className="gap-1.5">
          <PlusCircle className="h-3.5 w-3.5" /> Manual Deposit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manual Deposit</DialogTitle>
          <DialogDescription>
            Credit a payment auto-verification missed (e.g. a Bybit Pay order ID). Creates a verified deposit record and notifies the customer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Customer</Label>
            {picked ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                <span className="font-medium">{label(picked)}</span>
                <span className="font-mono text-xs text-muted-foreground">{picked.chat_id}</span>
                <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => setPicked(null)}>Change</Button>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <Input
                    placeholder="Username or chat ID"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }}
                  />
                  <Button size="sm" variant="outline" onClick={search} disabled={searching} className="gap-1.5">
                    {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                {results.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded-md border border-border divide-y divide-border">
                    {results.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { setPicked(c); setResults([]); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60"
                      >
                        <span className="font-medium">{label(c)}</span>
                        <span className="ml-auto font-mono text-xs text-muted-foreground">{c.chat_id}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Amount ($)</Label>
              <Input type="number" step="0.01" placeholder="0.90" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Method</Label>
              <Input placeholder="Bybit Pay" value={method} onChange={(e) => setMethod(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">TxID / Order ID (optional)</Label>
            <Input placeholder="26080800002086125862129938432475" value={txn} onChange={(e) => setTxn(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={saving} className="gap-1.5">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Credit & Notify
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ManualDepositDialog;
