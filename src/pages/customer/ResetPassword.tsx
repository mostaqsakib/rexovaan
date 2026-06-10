import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Lock, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type Status = 'validating' | 'ready' | 'error';

function readUrlParams() {
  // Supabase puts tokens/errors in either the hash (#) or the query (?)
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
  const hp = new URLSearchParams(hash);
  const qp = new URLSearchParams(window.location.search);
  const get = (k: string) => hp.get(k) || qp.get(k);
  return {
    error: get('error'),
    errorCode: get('error_code'),
    errorDescription: get('error_description'),
    accessToken: get('access_token'),
    type: get('type'),
  };
}

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<Status>('validating');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const navigate = useNavigate();

  useEffect(() => {
    const params = readUrlParams();

    // If Supabase redirected back with an error (expired / already used / invalid)
    if (params.error || params.errorCode) {
      const desc = (params.errorDescription || params.error || '').replace(/\+/g, ' ');
      const code = (params.errorCode || '').toLowerCase();
      let friendly = decodeURIComponent(desc) || 'This reset link is invalid or has expired.';
      if (code.includes('otp_expired') || code.includes('expired')) {
        friendly = 'This reset link has expired or was already used. Please request a new one.';
      } else if (code.includes('access_denied')) {
        friendly = 'This reset link is no longer valid. Please request a new one.';
      }
      setErrorMsg(friendly);
      setStatus('error');
      return;
    }

    // Listen for PASSWORD_RECOVERY (fired when Supabase finishes exchanging the token)
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setStatus('ready');
    });

    // Already-exchanged session?
    supabase.auth.getSession().then(({ data }) => { if (data.session) setStatus('ready'); });

    // Safety timeout: if nothing happens in 8s, show error instead of forever-loading.
    const timeout = setTimeout(() => {
      setStatus((s) => {
        if (s === 'validating') {
          setErrorMsg('Could not validate the reset link. It may have expired or been opened on a different device. Please request a new one.');
          return 'error';
        }
        return s;
      });
    }, 8000);

    return () => { sub.subscription.unsubscribe(); clearTimeout(timeout); };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) return toast.error('Password must be at least 6 characters');
    if (password !== confirm) return toast.error('Passwords do not match');
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success('Password updated');
    navigate('/account', { replace: true });
  };

  return (
    <div className="min-h-[80vh] grid place-items-center px-4">
      <div className="premium-card gradient-border p-8 w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <div className={`mx-auto h-12 w-12 rounded-xl grid place-items-center ${
            status === 'error'
              ? 'bg-gradient-to-br from-amber-500 to-orange-600'
              : 'bg-gradient-to-br from-primary to-[hsl(260_75%_65%)] glow-primary'
          }`}>
            {status === 'error'
              ? <AlertTriangle className="h-5 w-5 text-white" />
              : <ShieldCheck className="h-5 w-5 text-primary-foreground" />}
          </div>
          <h1 className="font-heading text-2xl font-bold gradient-text">
            {status === 'error' ? 'Link expired' : 'Choose a new password'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {status === 'ready' && 'Enter your new password below.'}
            {status === 'validating' && 'Validating reset link…'}
            {status === 'error' && errorMsg}
          </p>
        </div>

        {status === 'error' ? (
          <div className="space-y-3">
            <Button asChild className="w-full">
              <Link to="/forgot-password">Request a new reset link</Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link to="/login">Back to login</Link>
            </Button>
            <p className="text-[11px] text-muted-foreground text-center leading-relaxed pt-1">
              Tip: open the reset link in the same browser, and don't refresh after opening — each link can only be used once.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="relative">
              <Lock className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input type="password" required minLength={6} placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} className="pl-9" disabled={status !== 'ready'} />
            </div>
            <div className="relative">
              <Lock className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input type="password" required minLength={6} placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="pl-9" disabled={status !== 'ready'} />
            </div>
            <Button type="submit" className="w-full" disabled={loading || status !== 'ready'}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Update password
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
