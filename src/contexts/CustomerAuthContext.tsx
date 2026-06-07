import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface CustomerRow {
  id: string;
  chat_id: number | null;
  first_name: string | null;
  username: string | null;
  balance: number;
  referral_balance: number;
  pay_later_enabled: boolean;
  pay_later_limit: number;
  pay_later_used: number;
  is_banned: boolean;
}

interface CustomerAuthContextType {
  user: User | null;
  session: Session | null;
  customer: CustomerRow | null;
  loading: boolean;
  refreshCustomer: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<CustomerAuthContextType | undefined>(undefined);

export function CustomerAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [customer, setCustomer] = useState<CustomerRow | null>(null);
  const [loading, setLoading] = useState(true);

  const loadCustomer = async (uid: string | null) => {
    if (!uid) { setCustomer(null); return; }
    const { data } = await supabase.from('bot_customers').select('id,chat_id,first_name,username,balance,referral_balance,pay_later_enabled,pay_later_limit,pay_later_used,is_banned').eq('auth_user_id', uid).maybeSingle();
    setCustomer(data as any || null);
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) setTimeout(() => loadCustomer(s.user!.id), 0);
      else setCustomer(null);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) loadCustomer(data.session.user.id).finally(() => setLoading(false));
      else setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Telegram WebApp auto-login
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (!tg?.initData || user) return;
    tg.ready?.();
    tg.expand?.();
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('telegram-webapp-auth', { body: { initData: tg.initData } });
        if (error || !data?.action_link) return;
        // Extract tokens from the magic link URL hash
        const url = new URL(data.action_link);
        const token = url.searchParams.get('token');
        const type = url.searchParams.get('type');
        if (token && type) {
          await supabase.auth.verifyOtp({ token_hash: token, type: type as any });
        }
      } catch (e) {
        console.error('TG auto-login failed', e);
      }
    })();
  }, [user]);

  const refreshCustomer = async () => { if (user) await loadCustomer(user.id); };
  const signOut = async () => { await supabase.auth.signOut(); };

  return <Ctx.Provider value={{ user, session, customer, loading, refreshCustomer, signOut }}>{children}</Ctx.Provider>;
}

export function useCustomerAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCustomerAuth must be used inside CustomerAuthProvider');
  return v;
}
