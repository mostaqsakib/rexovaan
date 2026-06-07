import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2, Mail, KeyRound } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setSent(true);
    toast.success('Reset link sent — check your inbox');
  };

  return (
    <div className="min-h-[80vh] grid place-items-center px-4">
      <div className="premium-card gradient-border p-8 w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <div className="mx-auto h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-[hsl(260_75%_65%)] grid place-items-center glow-primary">
            <KeyRound className="h-5 w-5 text-primary-foreground" />
          </div>
          <h1 className="font-heading text-2xl font-bold gradient-text">Forgot password</h1>
          <p className="text-sm text-muted-foreground">We'll email you a reset link</p>
        </div>

        {sent ? (
          <div className="text-center space-y-3">
            <p className="text-sm">A password reset link has been sent to <span className="font-medium">{email}</span>.</p>
            <p className="text-xs text-muted-foreground">Check your spam folder if you don't see it within a minute.</p>
            <Link to="/login" className="inline-flex items-center text-sm text-primary hover:underline gap-1">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <form onSubmit={submit} className="space-y-3">
              <div className="relative">
                <Mail className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="pl-9" />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Send reset link
              </Button>
            </form>
            <p className="text-center text-sm text-muted-foreground">
              Remembered it? <Link to="/login" className="text-primary hover:underline">Sign in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
