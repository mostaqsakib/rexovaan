import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Loader2, Plus, Pencil, Trash2, CreditCard, GripVertical } from 'lucide-react';
import { toast } from 'sonner';

interface PaymentMethod {
  id: string;
  name: string;
  emoji: string;
  payment_type: string;
  payment_details: string;
  instruction: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  custom_emoji_id: string | null;
}

const PaymentMethodsTab = () => {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editMethod, setEditMethod] = useState<PaymentMethod | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('💳');
  const [paymentType, setPaymentType] = useState('wallet');
  const [paymentDetails, setPaymentDetails] = useState('');
  const [instruction, setInstruction] = useState('');
  const [customEmojiId, setCustomEmojiId] = useState('');

  useEffect(() => {
    fetchMethods();
  }, []);

  const fetchMethods = async () => {
    const { data } = await supabase
      .from('bot_payment_methods')
      .select('*')
      .order('sort_order');
    if (data) setMethods(data.map((d: any) => ({ ...d, custom_emoji_id: d.custom_emoji_id ?? null })) as PaymentMethod[]);
    setLoading(false);
  };

  const openAdd = () => {
    setEditMethod(null);
    setName('');
    setEmoji('💳');
    setPaymentType('wallet');
    setPaymentDetails('');
    setInstruction('');
    setCustomEmojiId('');
    setDialogOpen(true);
  };

  const openEdit = (m: PaymentMethod) => {
    setEditMethod(m);
    setName(m.name);
    setEmoji(m.emoji);
    setPaymentType(m.payment_type);
    setPaymentDetails(m.payment_details);
    setInstruction(m.instruction || '');
    setCustomEmojiId(m.custom_emoji_id || '');
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim() || !paymentDetails.trim()) return;
    setSaving(true);
    try {
      if (editMethod) {
        const { error } = await supabase.from('bot_payment_methods').update({
          name: name.trim(),
          emoji,
          payment_type: paymentType,
          payment_details: paymentDetails.trim(),
          instruction: instruction.trim() || null,
          custom_emoji_id: customEmojiId.trim() || null,
        } as any).eq('id', editMethod.id);
        if (error) throw error;
        toast.success('Payment method updated');
      } else {
        const { error } = await supabase.from('bot_payment_methods').insert({
          name: name.trim(),
          emoji,
          payment_type: paymentType,
          payment_details: paymentDetails.trim(),
          instruction: instruction.trim() || null,
          custom_emoji_id: customEmojiId.trim() || null,
          sort_order: methods.length,
        } as any);
        if (error) throw error;
        toast.success('Payment method added');
      }
      setDialogOpen(false);
      fetchMethods();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await supabase.from('bot_payment_methods').update({ is_active: isActive }).eq('id', id);
    setMethods(prev => prev.map(m => m.id === id ? { ...m, is_active: isActive } : m));
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this payment method?')) return;
    await supabase.from('bot_payment_methods').delete().eq('id', id);
    setMethods(prev => prev.filter(m => m.id !== id));
    toast.success('Payment method deleted');
  };

  if (loading) {
    return <div className="py-20 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground font-medium">{methods.length} payment methods</span>
        </div>
        <Button size="sm" onClick={openAdd} className="gap-1">
          <Plus className="h-4 w-4" /> Add Method
        </Button>
      </div>

      <div className="text-xs text-muted-foreground mb-4 rounded-lg border border-border bg-muted/30 px-3 py-2">
        💡 <b>Tip:</b> Payment Details এ সরাসরি wallet address / ID দিতে পারো, অথবা environment variable name দিলে (যেমন <code>BINANCE_ID</code>) সেটার value automatically ব্যবহার হবে। নতুন payment method যোগ করতে "Add Method" চাপো, নাম, emoji, আর payment details দাও।
      </div>

      {methods.length === 0 ? (
        <div className="py-20 text-center"><p className="text-lg text-muted-foreground">No payment methods yet.</p></div>
      ) : (
        <div className="space-y-2">
          {methods.map((m) => (
            <div key={m.id} className="rounded-lg border border-border bg-card px-4 py-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xl">{m.emoji}</span>
                <span className="font-semibold text-foreground">{m.name}</span>
                <Badge variant={m.is_active ? 'default' : 'secondary'}>
                  {m.is_active ? 'Active' : 'Inactive'}
                </Badge>
                {m.custom_emoji_id && (
                  <Badge className="text-[10px] px-1.5 py-0 bg-primary/20 text-primary border-primary/30">
                    Premium ✨
                  </Badge>
                )}
                <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{m.payment_details}</code>
                <div className="w-full sm:w-auto sm:ml-auto flex items-center gap-2 flex-wrap">
                  <Switch checked={m.is_active} onCheckedChange={(v) => handleToggle(m.id, v)} />
                  <Button size="sm" variant="outline" onClick={() => openEdit(m)}><Pencil className="h-3 w-3" /></Button>
                  <Button size="sm" variant="outline" onClick={() => handleDelete(m.id)}><Trash2 className="h-3 w-3" /></Button>
                </div>
              </div>
              {m.custom_emoji_id && (
                <p className="mt-1 text-xs text-muted-foreground font-mono">Emoji ID: {m.custom_emoji_id}</p>
              )}
              {m.instruction && (
                <p className="mt-1 text-xs text-muted-foreground">{m.instruction}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editMethod ? 'Edit' : 'Add'} Payment Method</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="w-20">
                <label className="text-sm font-medium">Emoji</label>
                <Input value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="💳" />
              </div>
              <div className="flex-1">
                <label className="text-sm font-medium">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Binance Pay, USDT TRC20" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Payment Details</label>
              <Input value={paymentDetails} onChange={(e) => setPaymentDetails(e.target.value)} placeholder="Wallet address, ID, or env var name (e.g. BINANCE_ID)" />
              <p className="text-xs text-muted-foreground mt-1">Direct value or env variable name that resolves at runtime</p>
            </div>
            <div>
              <label className="text-sm font-medium">Instruction (optional)</label>
              <Textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Extra instructions shown to customer after selecting this method" rows={2} />
            </div>
            <div>
              <label className="text-sm font-medium">Premium Emoji ID (optional)</label>
              <Input value={customEmojiId} onChange={(e) => setCustomEmojiId(e.target.value)} placeholder="e.g. 5271619747891388291" className="font-mono text-xs" />
              <p className="text-xs text-muted-foreground mt-1">Send premium emoji to @RawDataBot to get the ID. Bot needs Fragment username.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !name.trim() || !paymentDetails.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editMethod ? 'Update' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default PaymentMethodsTab;
