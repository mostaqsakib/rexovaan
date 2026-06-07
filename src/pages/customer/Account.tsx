import { useNavigate, Link } from 'react-router-dom';
import { Wallet, ArrowDownToLine, ArrowUpFromLine, ClipboardList, Users, LogOut, MessageCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCustomerAuth } from '@/contexts/CustomerAuthContext';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import BindEmailCard from '@/components/customer/BindEmailCard';

export default function Account() {
  const { user, customer, signOut, loading } = useCustomerAuth();
  const navigate = useNavigate();
  const [botUsername, setBotUsername] = useState('');

  useEffect(() => { if (!loading && !user) navigate('/login?next=/account'); }, [user, loading]);
  useEffect(() => {
    supabase.functions.invoke('telegram-bot-info').then(({ data }) => {
      const u = (data as any)?.bot_username;
      if (u) setBotUsername(u);
    });
  }, []);
  if (loading || !user) return <div className="grid place-items-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  const isTg = typeof window !== 'undefined' && !!(window as any).Telegram?.WebApp?.initData;
  const botUrl = botUsername ? `https://t.me/${botUsername}` : 'https://t.me/';

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <div className="premium-card gradient-border p-6 space-y-4">
        <div>
          <div className="text-sm text-muted-foreground">Signed in as</div>
          <div className="font-semibold">{customer?.first_name || user.email}</div>
          {customer?.username && <div className="text-sm text-muted-foreground">@{customer.username}</div>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><Wallet className="h-3 w-3" /> Balance</div>
            <div className="text-2xl font-bold gradient-text mt-1">${Number(customer?.balance || 0).toFixed(2)}</div>
          </div>
          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" /> Referral</div>
            <div className="text-2xl font-bold mt-1">${Number(customer?.referral_balance || 0).toFixed(2)}</div>
          </div>
        </div>
        {customer?.pay_later_enabled && (
          <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
            Pay-Later: <span className="font-semibold">${(Number(customer.pay_later_limit) - Number(customer.pay_later_used)).toFixed(2)}</span> available of ${Number(customer.pay_later_limit).toFixed(2)}
          </div>
        )}
      </div>

      <BindEmailCard currentEmail={user.email} />

      <div className="grid sm:grid-cols-2 gap-3">
        <Button asChild variant="outline" className="h-auto py-4 justify-start gap-3"><Link to="/account/orders"><ClipboardList className="h-5 w-5 text-primary" /> Order history</Link></Button>
        <Button asChild variant="outline" className="h-auto py-4 justify-start gap-3"><Link to="/account/deposits"><ClipboardList className="h-5 w-5 text-primary" /> Deposit history</Link></Button>
        <Button asChild variant="outline" className="h-auto py-4 justify-start gap-3"><Link to="/account/deposit"><ArrowDownToLine className="h-5 w-5 text-primary" /> Deposit</Link></Button>
        <Button asChild variant="outline" className="h-auto py-4 justify-start gap-3"><Link to="/account/withdraw"><ArrowUpFromLine className="h-5 w-5 text-primary" /> Withdraw</Link></Button>
        <Button asChild variant="outline" className="h-auto py-4 justify-start gap-3"><a href={botUrl} target="_blank" rel="noreferrer"><MessageCircle className="h-5 w-5 text-primary" /> Open Telegram bot</a></Button>
      </div>

      {!isTg && (
        <Button variant="ghost" className="w-full text-destructive" onClick={() => signOut()}><LogOut className="h-4 w-4 mr-2" /> Sign out</Button>
      )}
    </div>
  );
}
