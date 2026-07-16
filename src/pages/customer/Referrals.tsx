import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Copy, Gift, Users, DollarSign, ArrowRight, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useCustomerAuth } from '@/contexts/CustomerAuthContext';
import { toast } from 'sonner';

import { md5 } from 'js-md5';

// Mirrors bot's generateReferralCode: md5(chat_id).slice(0, 8)
function refCodeFromChatId(chatId: number | string): string {
  return md5(String(chatId)).slice(0, 8).toLowerCase();
}

export default function Referrals() {
  const { user, customer, loading, refreshCustomer } = useCustomerAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [stats, setStats] = useState({ total: 0, d24: 0, d7: 0 });
  const [settings, setSettings] = useState({ commission: 2, firstBonus: 0.5 });
  const [totalEarned, setTotalEarned] = useState(0);
  const [transferred, setTransferred] = useState(0);
  const [busy, setBusy] = useState(false);
  const [siteUrl, setSiteUrl] = useState('');

  useEffect(() => { if (!loading && !user) navigate('/login?next=/account/referrals'); }, [user, loading]);

  useEffect(() => {
    if (!customer?.id || !customer.chat_id) return;
    setSiteUrl(window.location.origin);
    (async () => {
      const c = await refCodeFromChatId(customer.chat_id!);
      setCode(c);

      const now = new Date();
      const d24 = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [{ count: total }, { count: c24 }, { count: c7 }, { data: fresh }, { data: cfg }] = await Promise.all([
        supabase.from('bot_referrals').select('id', { count: 'exact', head: true }).eq('referrer_id', customer.id),
        supabase.from('bot_referrals').select('id', { count: 'exact', head: true }).eq('referrer_id', customer.id).gte('created_at', d24),
        supabase.from('bot_referrals').select('id', { count: 'exact', head: true }).eq('referrer_id', customer.id).gte('created_at', d7),
        supabase.from('bot_customers').select('referral_total_earned, referral_transferred').eq('id', customer.id).maybeSingle(),
        supabase.from('bot_settings').select('key, value').in('key', ['referral_commission_percent', 'referral_first_bonus']),
      ]);
      setStats({ total: total || 0, d24: c24 || 0, d7: c7 || 0 });
      if (fresh) {
        setTotalEarned(Number((fresh as any).referral_total_earned) || 0);
        setTransferred(Number((fresh as any).referral_transferred) || 0);
      }
      if (cfg) {
        const map = Object.fromEntries((cfg as any[]).map((r) => [r.key, r.value]));
        setSettings({
          commission: parseFloat(map.referral_commission_percent) || 2,
          firstBonus: parseFloat(map.referral_first_bonus) || 0.5,
        });
      }
    })();
  }, [customer?.id, customer?.chat_id]);

  const link = code ? `${siteUrl}/signup?ref=${code}` : '';

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Referral link copied!');
    } catch { toast.error('Copy failed'); }
  };

  const share = async () => {
    if (!link) return;
    if (navigator.share) {
      try { await navigator.share({ title: 'Join me on Rexovaan', text: 'Sign up and shop with me!', url: link }); } catch {}
    } else copy();
  };

  const transfer = async () => {
    if (!customer || Number(customer.referral_balance) <= 0) {
      toast.error('No referral balance to transfer');
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('transfer-referral-balance');
    setBusy(false);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || 'Transfer failed');
      return;
    }
    toast.success(`Transferred $${(data as any).transferred.toFixed(2)} to wallet`);
    await refreshCustomer();
  };

  if (loading || !user || !customer) {
    return <div className="grid place-items-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  const refBal = Number(customer.referral_balance) || 0;

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <div className="premium-card gradient-border p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-primary to-[hsl(260_75%_65%)] grid place-items-center glow-primary">
            <Gift className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-heading text-xl font-bold gradient-text">Refer & Earn</h1>
            <p className="text-xs text-muted-foreground">Earn {settings.commission}% on every purchase + ${settings.firstBonus.toFixed(2)} first-purchase bonus</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <StatBox label="24h" value={stats.d24} />
          <StatBox label="7d" value={stats.d7} />
          <StatBox label="Total" value={stats.total} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><DollarSign className="h-3 w-3" /> Available</div>
            <div className="text-2xl font-bold gradient-text mt-1">${refBal.toFixed(2)}</div>
          </div>
          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" /> Earned</div>
            <div className="text-2xl font-bold mt-1">${totalEarned.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Transferred: ${transferred.toFixed(2)}</div>
          </div>
        </div>
      </div>

      <div className="premium-card p-5 space-y-3">
        <div className="text-sm font-medium">Your referral link</div>
        <div className="rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs break-all">
          {link || <Loader2 className="h-4 w-4 animate-spin" />}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={copy} disabled={!link} className="gap-2"><Copy className="h-4 w-4" /> Copy</Button>
          <Button onClick={share} disabled={!link} className="gap-2"><Share2 className="h-4 w-4" /> Share</Button>
        </div>
      </div>

      <div className="premium-card p-5 space-y-3">
        <div className="text-sm font-medium">Transfer to main wallet</div>
        <p className="text-xs text-muted-foreground">Move your referral earnings into your main balance to spend on orders.</p>
        <Button onClick={transfer} disabled={busy || refBal <= 0} className="w-full gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          Transfer ${refBal.toFixed(2)} to wallet
        </Button>
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-bold mt-0.5">{value}</div>
    </div>
  );
}
