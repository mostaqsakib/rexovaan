import { useEffect, useRef, useState } from 'react';
import { Send, Loader2, CheckCircle2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  currentChatId?: number | null;
  currentUsername?: string | null;
  onBound?: () => void;
}

declare global {
  interface Window {
    onTelegramBindAuth?: (user: any) => void;
  }
}

export default function BindTelegramCard({ currentChatId, currentUsername, onBound }: Props) {
  // Web-only users get a negative synthetic chat_id; real Telegram chat_ids are positive.
  const isBound = typeof currentChatId === 'number' && currentChatId > 0;

  const widgetRef = useRef<HTMLDivElement>(null);
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'widget' | 'code'>('widget');
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (isBound) return;
    supabase.functions.invoke('telegram-bot-info').then(({ data }) => {
      const u = (data as any)?.bot_username;
      if (u) setBotUsername(u);
    });
  }, [isBound]);

  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  const onBoundRef = useRef(onBound);
  useEffect(() => { onBoundRef.current = onBound; }, [onBound]);

  // Mount Telegram Login Widget for the bind flow
  useEffect(() => {
    if (isBound || mode !== 'widget' || !botUsername || !widgetRef.current) return;

    window.onTelegramBindAuth = async (user: any) => {
      setBusy(true);
      try {
        const { data, error } = await supabase.functions.invoke('customer-bind-telegram', {
          body: { action: 'widget', widget: user },
        });
        if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message || 'Bind failed');
        toast.success('Telegram linked!');
        onBoundRef.current?.();
      } catch (e: any) {
        toast.error(e?.message || 'Failed to link Telegram');
      } finally {
        setBusy(false);
      }
    };

    widgetRef.current.innerHTML = '';
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://telegram.org/js/telegram-widget.js?22';
    s.setAttribute('data-telegram-login', botUsername);
    s.setAttribute('data-size', 'large');
    s.setAttribute('data-radius', '8');
    s.setAttribute('data-onauth', 'onTelegramBindAuth(user)');
    s.setAttribute('data-request-access', 'write');
    widgetRef.current.appendChild(s);
  }, [botUsername, mode, isBound]);

  const generateCode = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('customer-bind-telegram', { body: { action: 'generate_code' } });
      if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message);
      setCode((data as any).code);
      setExpiresAt(Date.now() + Number((data as any).expires_in_seconds || 600) * 1000);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to generate code');
    } finally {
      setBusy(false);
    }
  };

  if (isBound) {
    return (
      <div className="premium-card gradient-border p-5">
        <div className="font-semibold flex items-center gap-2">
          <Send className="h-4 w-4 text-primary" /> Telegram
        </div>
        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3 text-green-500" />
          Linked{currentUsername ? ` as @${currentUsername}` : ''}
        </div>
      </div>
    );
  }

  const secondsLeft = expiresAt ? Math.max(0, Math.floor((expiresAt - now) / 1000)) : 0;

  return (
    <div className="premium-card gradient-border p-5 space-y-3">
      <div>
        <div className="font-semibold flex items-center gap-2">
          <Send className="h-4 w-4 text-primary" /> Link Telegram
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          Connect your Telegram so you can use the same account on the bot too.
        </div>
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant={mode === 'widget' ? 'default' : 'outline'} onClick={() => setMode('widget')}>Telegram login</Button>
        <Button size="sm" variant={mode === 'code' ? 'default' : 'outline'} onClick={() => setMode('code')}>Use a code</Button>
      </div>

      {mode === 'widget' && (
        <div className="pt-1">
          {botUsername ? (
            <div className="flex flex-col items-center gap-2">
              <div ref={widgetRef} />
              {busy && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Linking…</div>}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">Loading Telegram…</div>
          )}
        </div>
      )}

      {mode === 'code' && (
        <div className="space-y-2">
          {!code || secondsLeft <= 0 ? (
            <Button onClick={generateCode} disabled={busy} className="w-full">
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Generate code
            </Button>
          ) : (
            <>
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                <div className="text-xs text-muted-foreground">Open the bot and send:</div>
                <div className="font-mono text-lg font-bold tracking-wider mt-1 flex items-center justify-center gap-2">
                  /bind {code}
                  <button
                    type="button"
                    onClick={() => { navigator.clipboard.writeText(`/bind ${code}`); toast.success('Copied'); }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">Expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}</div>
              </div>
              {botUsername && (
                <a
                  href={`https://t.me/${botUsername}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline block text-center"
                >
                  Open @{botUsername}
                </a>
              )}
              <Button variant="ghost" size="sm" onClick={generateCode} disabled={busy} className="w-full">
                Generate a new code
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
