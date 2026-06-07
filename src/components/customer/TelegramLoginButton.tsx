import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface Props {
  onSuccess?: () => void;
}

declare global {
  interface Window {
    onTelegramAuth?: (user: any) => void;
  }
}

export default function TelegramLoginButton({ onSuccess }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.functions.invoke('telegram-bot-info').then(({ data }) => {
      const u = (data as any)?.bot_username;
      if (u) setBotUsername(u);
    });
  }, []);

  useEffect(() => {
    if (!botUsername || !containerRef.current) return;

    window.onTelegramAuth = async (user: any) => {
      setBusy(true);
      try {
        const { data, error } = await supabase.functions.invoke('telegram-widget-auth', { body: user });
        if (error || !data?.action_link) throw new Error(error?.message || 'auth failed');
        const url = new URL(data.action_link);
        const token = url.searchParams.get('token');
        const type = url.searchParams.get('type');
        if (token && type) {
          const { error: verifyErr } = await supabase.auth.verifyOtp({ token_hash: token, type: type as any });
          if (verifyErr) throw verifyErr;
          toast.success('Signed in with Telegram');
          onSuccess?.();
        }
      } catch (e: any) {
        toast.error(e?.message || 'Telegram sign-in failed');
      } finally {
        setBusy(false);
      }
    };

    containerRef.current.innerHTML = '';
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://telegram.org/js/telegram-widget.js?22';
    s.setAttribute('data-telegram-login', botUsername);
    s.setAttribute('data-size', 'large');
    s.setAttribute('data-radius', '8');
    s.setAttribute('data-onauth', 'onTelegramAuth(user)');
    s.setAttribute('data-request-access', 'write');
    containerRef.current.appendChild(s);
  }, [botUsername, onSuccess]);

  if (!botUsername) {
    return <div className="text-xs text-muted-foreground text-center">Loading Telegram login…</div>;
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={containerRef} />
      {busy && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Signing in…</div>}
    </div>
  );
}
