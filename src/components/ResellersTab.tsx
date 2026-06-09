import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Copy, KeyRound, Loader2, Plus, RefreshCw, Wallet } from 'lucide-react';
import { toast } from 'sonner';

interface Reseller {
  id: string;
  name: string;
  balance: number;
  api_key_prefix: string;
  is_active: boolean;
  created_at: string;
}

const apiBase = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reseller-api`;

const ResellersTab = () => {
  const [resellers, setResellers] = useState<Reseller[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [initialBalance, setInitialBalance] = useState('0');
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [balanceTarget, setBalanceTarget] = useState<Reseller | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchResellers = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke('admin-resellers', { method: 'GET' });
    if (error || data?.error) {
      toast.error(data?.error || error?.message || 'Failed to load resellers');
    } else {
      setResellers(data?.resellers || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchResellers();
  }, []);

  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  const createReseller = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-resellers', {
        body: { action: 'create', name: name.trim(), initial_balance: Number(initialBalance) || 0 },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setNewApiKey(data.api_key);
      setName('');
      setInitialBalance('0');
      fetchResellers();
    } catch (err: any) {
      toast.error(err.message || 'Create failed');
    } finally {
      setSaving(false);
    }
  };

  const adjustBalance = async () => {
    if (!balanceTarget || !amount || !note.trim()) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-resellers', {
        body: { action: 'adjust_balance', reseller_id: balanceTarget.id, amount: Number(amount), note: note.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Balance updated: ${Number(data.balance).toFixed(2)} USDT`);
      setBalanceTarget(null);
      setAmount('');
      setNote('');
      fetchResellers();
    } catch (err: any) {
      toast.error(err.message || 'Balance update failed');
    } finally {
      setSaving(false);
    }
  };

  const toggleReseller = async (reseller: Reseller) => {
    const { data, error } = await supabase.functions.invoke('admin-resellers', {
      body: { action: 'toggle', reseller_id: reseller.id, is_active: !reseller.is_active },
    });
    if (error || data?.error) toast.error(data?.error || error?.message || 'Update failed');
    else fetchResellers();
  };

  const rotateKey = async (reseller: Reseller) => {
    if (!confirm(`Rotate API key for ${reseller.name}? Old key will stop working.`)) return;
    const { data, error } = await supabase.functions.invoke('admin-resellers', {
      body: { action: 'rotate_key', reseller_id: reseller.id },
    });
    if (error || data?.error) toast.error(data?.error || error?.message || 'Rotate failed');
    else {
      setNewApiKey(data.api_key);
      fetchResellers();
    }
  };

  if (loading) return <div className="py-20 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground font-medium">Reseller API accounts</span>
        </div>
        <Button onClick={() => setCreateOpen(true)} size="sm" className="gap-2"><Plus className="h-4 w-4" />Add Reseller</Button>
      </div>

      <div className="mb-4 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground space-y-2">
        <div><b className="text-foreground">API Base:</b> <code>{apiBase}</code></div>
        <div>GET <code>?action=products</code>, GET <code>?action=balance</code>, POST <code>?action=order</code></div>
        <div>Auth header: <code>Authorization: Bearer API_KEY</code></div>
      </div>

      {resellers.length === 0 ? (
        <div className="py-20 text-center"><p className="text-lg text-muted-foreground">No reseller account yet.</p></div>
      ) : (
        <div className="space-y-2">
          {resellers.map((r) => (
            <div key={r.id} className="rounded-lg border border-border bg-card px-4 py-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-semibold text-foreground">{r.name}</span>
                <Badge variant={r.is_active ? 'default' : 'secondary'}>{r.is_active ? 'Active' : 'Paused'}</Badge>
                <Badge variant="outline" className="font-mono">{Number(r.balance).toFixed(2)} USDT</Badge>
                <span className="text-xs text-muted-foreground font-mono">{r.api_key_prefix}</span>
                <div className="ml-auto flex items-center gap-2 flex-wrap">
                  <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => { setBalanceTarget(r); setAmount(''); setNote(''); }}><Wallet className="h-3 w-3" />Balance</Button>
                  <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => rotateKey(r)}><RefreshCw className="h-3 w-3" />Rotate</Button>
                  <Button size="sm" variant={r.is_active ? 'destructive' : 'default'} className="text-xs" onClick={() => toggleReseller(r)}>{r.is_active ? 'Pause' : 'Activate'}</Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) setNewApiKey(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Reseller</DialogTitle></DialogHeader>
          {newApiKey ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Copy this API key now. It will not be shown again.</p>
              <Textarea value={newApiKey} readOnly className="font-mono text-xs" />
              <Button onClick={() => copy(newApiKey, 'API key')} className="w-full gap-2"><Copy className="h-4 w-4" />Copy API Key</Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Reseller name" /></div>
              <div><Label>Initial balance</Label><Input type="number" min="0" value={initialBalance} onChange={(e) => setInitialBalance(e.target.value)} /></div>
              <DialogFooter><Button onClick={createReseller} disabled={saving || !name.trim()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create</Button></DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!balanceTarget} onOpenChange={(open) => { if (!open) setBalanceTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Adjust Balance — {balanceTarget?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Amount (+ add, - cut)</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10 or -5" /></div>
            <div><Label>Note</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason" /></div>
            <DialogFooter><Button onClick={adjustBalance} disabled={saving || !amount || !note.trim()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button></DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ResellersTab;
