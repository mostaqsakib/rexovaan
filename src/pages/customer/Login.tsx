import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Lock, Mail } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useCustomerAuth } from '@/contexts/CustomerAuthContext';
import { toast } from 'sonner';
import TelegramLoginButton from '@/components/customer/TelegramLoginButton';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';
  const { user } = useCustomerAuth();

  useEffect(() => { if (user) navigate(next, { replace: true }); }, [user]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) toast.error(error.message);
    else { toast.success('Welcome back!'); navigate(next, { replace: true }); }
  };

  return (
    <div className="min-h-[80vh] grid place-items-center px-4 relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
        className="absolute top-4 left-4 gap-1.5"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </Button>
      <div className="premium-card gradient-border p-8 w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <div className="mx-auto h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-[hsl(260_75%_65%)] grid place-items-center glow-primary"><Lock className="h-5 w-5 text-primary-foreground" /></div>
          <h1 className="font-heading text-2xl font-bold gradient-text">Welcome back</h1>
          <p className="text-sm text-muted-foreground">Sign in to your account</p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div className="relative">
            <Mail className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input type="email" placeholder="Email" required value={email} onChange={(e) => setEmail(e.target.value)} className="pl-9" />
          </div>
          <div className="relative">
            <Lock className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input type="password" placeholder="Password" required value={password} onChange={(e) => setPassword(e.target.value)} className="pl-9" />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Sign in
          </Button>
          <div className="text-right">
            <Link to="/forgot-password" className="text-xs text-primary hover:underline">Forgot password?</Link>
          </div>
        </form>
        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <TelegramLoginButton onSuccess={() => navigate(next, { replace: true })} />
        <p className="text-center text-sm text-muted-foreground">
          New here? <Link to={`/signup?next=${encodeURIComponent(next)}`} className="text-primary hover:underline">Create account</Link>
        </p>
      </div>
    </div>
  );
}
