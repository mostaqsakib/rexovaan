import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Loader2, MailX, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export default function Unsubscribe() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState<'loading' | 'valid' | 'already' | 'invalid' | 'done' | 'error'>('loading');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) { setState('invalid'); return; }
    (async () => {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`, {
          headers: { apikey: ANON_KEY },
        });
        const data = await res.json();
        if (data.valid) setState('valid');
        else if (data.reason === 'already_unsubscribed') setState('already');
        else setState('invalid');
      } catch { setState('error'); }
    })();
  }, [token]);

  const confirm = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/handle-email-unsubscribe`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (data.success) setState('done');
      else if (data.reason === 'already_unsubscribed') setState('already');
      else setState('error');
    } catch { setState('error'); }
    setBusy(false);
  };

  return (
    <div className="min-h-[80vh] grid place-items-center px-4">
      <div className="premium-card gradient-border p-8 w-full max-w-md text-center space-y-4">
        <div className="mx-auto h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-[hsl(260_75%_65%)] grid place-items-center glow-primary">
          {state === 'done' || state === 'already' ? <CheckCircle2 className="h-5 w-5 text-primary-foreground" /> : <MailX className="h-5 w-5 text-primary-foreground" />}
        </div>

        {state === 'loading' && (<><h1 className="font-heading text-xl font-bold">Checking link…</h1><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></>)}

        {state === 'valid' && (<>
          <h1 className="font-heading text-2xl font-bold gradient-text">Unsubscribe</h1>
          <p className="text-sm text-muted-foreground">Click below to stop receiving emails from us.</p>
          <Button onClick={confirm} disabled={busy} className="w-full">
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Confirm unsubscribe
          </Button>
        </>)}

        {state === 'done' && (<>
          <h1 className="font-heading text-2xl font-bold gradient-text">You're unsubscribed</h1>
          <p className="text-sm text-muted-foreground">You won't receive further emails. You can still log in any time.</p>
          <Link to="/"><Button variant="outline">Back to shop</Button></Link>
        </>)}

        {state === 'already' && (<>
          <h1 className="font-heading text-2xl font-bold">Already unsubscribed</h1>
          <p className="text-sm text-muted-foreground">This email is already on the suppression list.</p>
          <Link to="/"><Button variant="outline">Back to shop</Button></Link>
        </>)}

        {state === 'invalid' && (<><h1 className="font-heading text-xl font-bold">Invalid link</h1><p className="text-sm text-muted-foreground">This unsubscribe link is invalid or expired.</p></>)}
        {state === 'error' && (<><h1 className="font-heading text-xl font-bold">Something went wrong</h1><p className="text-sm text-muted-foreground">Please try again later.</p></>)}
      </div>
    </div>
  );
}
