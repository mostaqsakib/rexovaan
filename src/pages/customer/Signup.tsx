import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, UserPlus, Mail, Lock, User } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useCustomerAuth } from '@/contexts/CustomerAuthContext';
import { toast } from 'sonner';

export default function Signup() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
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
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin, data: { first_name: name } },
    });
    if (error) { setLoading(false); toast.error(error.message); return; }

    // bot_customers row is created automatically by a server-side trigger
    // on auth.users insert (handle_new_auth_user_create_customer).

    setLoading(false);
    if (data.session) { toast.success('Account created'); navigate(next, { replace: true }); }
    else toast.success('Check your email to verify your account');
  };

  return (
    <div className="min-h-[80vh] grid place-items-center px-4">
      <div className="premium-card gradient-border p-8 w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <div className="mx-auto h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-[hsl(260_75%_65%)] grid place-items-center glow-primary"><UserPlus className="h-5 w-5 text-primary-foreground" /></div>
          <h1 className="font-heading text-2xl font-bold gradient-text">Create account</h1>
          <p className="text-sm text-muted-foreground">Start shopping in seconds</p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div className="relative">
            <User className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="pl-9" />
          </div>
          <div className="relative">
            <Mail className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="pl-9" />
          </div>
          <div className="relative">
            <Lock className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input type="password" required minLength={6} placeholder="Password (min 6 chars)" value={password} onChange={(e) => setPassword(e.target.value)} className="pl-9" />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Create account
          </Button>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          Already have one? <Link to={`/login?next=${encodeURIComponent(next)}`} className="text-primary hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
