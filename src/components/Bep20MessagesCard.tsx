import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, Save, Coins, Info } from 'lucide-react';
import { TelegramEditor } from '@/components/telegram-editor';

const AMOUNT_DEFAULT = `🟡 <b>USDT/USDC BEP20 (Auto-Verify)</b>

💵 Enter amount to deposit in <b>USDT/USDC</b> (example: <code>10</code>).
<i>Minimum: 1 USDT</i>

You'll get a <b>unique BSC address</b> just for this deposit. Send USDT or USDC (BEP20) — auto-credited after 3 confirmations (~9 sec).`;

const ADDRESS_DEFAULT = `🟡 <b>USDT/USDC BEP20 — Auto-Verify</b>

💵 Amount: <b>{amount} USDT/USDC</b>
⏱ Expires in: <b>{expires_min} min</b>

📥 <b>Send to this address (BSC / BEP20):</b>
<code>{address}</code>
<i>👆 Tap to copy</i>

✅ Any amount will be credited exactly as received.
✅ USDT or USDC — both accepted on this address.
⚠️ <b>BEP20 only.</b> Wrong network = lost funds.

Auto-verified after 3 confirmations (~9 sec).`;

export default function Bep20MessagesCard() {
  const [loading, setLoading] = useState(true);
  const [amountMsg, setAmountMsg] = useState('');
  const [origAmount, setOrigAmount] = useState('');
  const [addressMsg, setAddressMsg] = useState('');
  const [origAddress, setOrigAddress] = useState('');
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('bot_settings')
        .select('key,value')
        .in('key', ['bep20_amount_msg', 'bep20_address_msg']);
      for (const r of data || []) {
        if (r.key === 'bep20_amount_msg') { setAmountMsg(r.value || AMOUNT_DEFAULT); setOrigAmount(r.value || AMOUNT_DEFAULT); }
        if (r.key === 'bep20_address_msg') { setAddressMsg(r.value || ADDRESS_DEFAULT); setOrigAddress(r.value || ADDRESS_DEFAULT); }
      }
      setLoading(false);
    })();
  }, []);

  const upsert = async (key: string, value: string) => {
    const { data: existing } = await supabase.from('bot_settings').select('id').eq('key', key).maybeSingle();
    if (existing) return supabase.from('bot_settings').update({ value, updated_at: new Date().toISOString() }).eq('key', key);
    return supabase.from('bot_settings').insert({ key, value });
  };

  const saveAmount = async () => {
    setSaving('amount');
    const { error } = await upsert('bep20_amount_msg', amountMsg);
    if (error) toast.error('Save failed'); else { toast.success('Amount page updated'); setOrigAmount(amountMsg); }
    setSaving(null);
  };

  const saveAddress = async () => {
    setSaving('address');
    const { error } = await upsert('bep20_address_msg', addressMsg);
    if (error) toast.error('Save failed'); else { toast.success('Address page updated'); setOrigAddress(addressMsg); }
    setSaving(null);
  };

  if (loading) return <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Coins className="h-5 w-5 text-primary" />
          BEP20 Deposit Messages
        </CardTitle>
        <CardDescription className="flex items-start gap-2">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            BEP20 auto-verify flow er proti page er msg edit koro. Premium emoji support ache। Button emoji admin panel er <b>Button Emojis</b> tab e set koro: <code className="text-xs bg-muted px-1 rounded">bep20_back_menu</code>, <code className="text-xs bg-muted px-1 rounded">bep20_check_status</code>।
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Page 1 — Amount Prompt</Label>
          <TelegramEditor value={amountMsg} onChange={setAmountMsg} rows={7} placeholder="Amount prompt message..." />
          <div className="flex justify-end">
            <Button size="sm" onClick={saveAmount} disabled={saving === 'amount' || amountMsg === origAmount} className="gap-2">
              {saving === 'amount' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Page 2 — Address / QR Page</Label>
          <TelegramEditor value={addressMsg} onChange={setAddressMsg} rows={11} placeholder="Address page caption..." />
          <p className="text-xs text-muted-foreground">
            Variables: <code className="bg-muted px-1 rounded">{'{amount}'}</code>, <code className="bg-muted px-1 rounded">{'{address}'}</code>, <code className="bg-muted px-1 rounded">{'{expires_min}'}</code>
          </p>
          <div className="flex justify-end">
            <Button size="sm" onClick={saveAddress} disabled={saving === 'address' || addressMsg === origAddress} className="gap-2">
              {saving === 'address' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
