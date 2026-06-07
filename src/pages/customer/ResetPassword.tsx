import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Lock, ShieldCheck } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Supabase auto-handles the recovery token in the URL and fires PASSWORD_RECOVERY.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setReady(true);
    });
    // Also check current session — link may already be exchanged.
    supabase.auth.getSession().then(({ data }) => { if (data.session) setReady(true); });
    return () => sub.subscription.unsubscribe();
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
          <div className="mx-auto h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-[hsl(260_75%_65%)] grid place-items-center glow-primary">
            <ShieldCheck className="h-5 w-5 text-primary-foreground" />
          </div>
          <h1 className="font-heading text-2xl font-bold gradient-text">Choose a new password</h1>
          <p className="text-sm text-muted-foreground">
            {ready ? 'Enter your new password below.' : 'Validating reset link…'}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div className="relative">
            <Lock className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input type="password" required minLength={6} placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} className="pl-9" disabled={!ready} />
          </div>
          <div className="relative">
            <Lock className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input type="password" required minLength={6} placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="pl-9" disabled={!ready} />
          </div>
          <Button type="submit" className="w-full" disabled={loading || !ready}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Update password
          </Button>
        </form>
      </div>
    </div>
  );
}
