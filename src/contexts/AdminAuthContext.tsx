import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Session } from '@supabase/supabase-js';

interface TelegramUser {
  id: number;
  first_name: string;
  username?: string;
}

interface AdminAuthContextType {
  isAuthorized: boolean;
  isLoading: boolean;
  user: TelegramUser | null;
  isTelegramWebApp: boolean;
  session: Session | null;
  signOut: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthContextType>({
  isAuthorized: false,
  isLoading: true,
  user: null,
  isTelegramWebApp: false,
  session: null,
  signOut: async () => {},
});

export const useAdminAuth = () => useContext(AdminAuthContext);

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe: { user?: { id: number; first_name: string; username?: string } };
        ready: () => void;
        expand: () => void;
        close: () => void;
        MainButton: { text: string; show: () => void; hide: () => void; onClick: (cb: () => void) => void };
        themeParams: Record<string, string | undefined>;
        colorScheme: 'light' | 'dark';
        platform: string;
      };
    };
  }
}

async function checkIsAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'admin')
    .maybeSingle();
  if (error) return false;
  return !!data;
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<TelegramUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  const isTelegramWebApp = !!(window.Telegram?.WebApp?.initData && window.Telegram.WebApp.initData.length > 0);

  useEffect(() => {
    let mounted = true;

    const verify = async (sess: Session | null) => {
      if (!sess?.user) {
        setIsAuthorized(false);
        return;
      }
      const ok = await checkIsAdmin(sess.user.id);
      if (mounted) setIsAuthorized(ok);
    };

    // Auth state listener — sync only, defer async work
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      if (!mounted) return;
      setSession(sess);
      setTimeout(() => { void verify(sess); }, 0);
    });

    const bootstrap = async () => {
      // Try Telegram WebApp first — exchange initData for a Supabase session
      if (isTelegramWebApp) {
        const tg = window.Telegram!.WebApp!;
        try { tg.ready(); tg.expand(); } catch {}

        const launchToken = new URLSearchParams(window.location.search).get('admin_launch');
        try {
          const { data, error } = await supabase.functions.invoke('telegram-auth', {
            body: { initData: tg.initData, launchToken },
          });
          if (!error && data?.authorized && data.token_hash && data.email) {
            const { data: verifyData } = await supabase.auth.verifyOtp({
              email: data.email,
              token_hash: data.token_hash,
              type: 'magiclink',
            });
            if (verifyData?.session && mounted) {
              setSession(verifyData.session);
              setUser({
                id: data.user.id,
                first_name: data.user.first_name,
                username: data.user.username,
              });
              await verify(verifyData.session);
              setIsLoading(false);
              return;
            }
          }
        } catch (e) {
          console.error('Telegram auth failed:', e);
        }
      }

      // Browser path — use existing Supabase session if any
      const { data: { session: existing } } = await supabase.auth.getSession();
      if (mounted) {
        setSession(existing);
        await verify(existing);
        setIsLoading(false);
      }
    };

    void bootstrap();
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, [isTelegramWebApp]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setIsAuthorized(false);
    setSession(null);
    setUser(null);
  };

  return (
    <AdminAuthContext.Provider value={{ isAuthorized, isLoading, user, isTelegramWebApp, session, signOut }}>
      {children}
    </AdminAuthContext.Provider>
  );
}
