import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';

const AdminLogin = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.user) {
        toast.error(error?.message || 'Login failed');
        return;
      }
      const { data: roleRow } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', data.user.id)
        .eq('role', 'admin')
        .maybeSingle();
      if (!roleRow) {
        await supabase.auth.signOut();
        toast.error('This account does not have admin access');
        return;
      }
      toast.success('Welcome back');
      navigate('/admin', { replace: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={submit} className="premium-card gradient-border p-8 max-w-sm w-full text-center space-y-6">
        <div className="relative mx-auto h-16 w-16">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary to-[hsl(217_91%_60%)] glow-primary" />
          <div className="relative flex h-full w-full items-center justify-center">
            <Lock className="h-7 w-7 text-primary-foreground" />
          </div>
        </div>
        <div>
          <h1 className="font-heading text-2xl font-bold gradient-text">Admin Console</h1>
          <p className="text-muted-foreground text-sm mt-1.5">Sign in with your admin account</p>
        </div>
        <div className="space-y-3">
          <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" className="h-11 bg-background/50" />
          <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" className="h-11 bg-background/50" />
          <Button type="submit" disabled={busy} className="w-full h-11 bg-gradient-to-r from-primary to-[hsl(217_91%_60%)] text-primary-foreground font-semibold">
            {busy ? 'Signing in…' : 'Sign In'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default AdminLogin;
