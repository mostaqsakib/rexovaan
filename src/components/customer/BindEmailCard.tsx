import { useState } from 'react';
import { Mail, Lock, Loader2, CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  currentEmail: string | null | undefined;
  onBound?: (email: string) => void;
}

export default function BindEmailCard({ currentEmail, onBound }: Props) {
  const isSynthetic = !currentEmail || currentEmail.endsWith('@telegram.local');
  const [email, setEmail] = useState(isSynthetic ? '' : currentEmail || '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(isSynthetic);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('customer-bind-email', { body: { email, password } });
    setBusy(false);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || 'Failed to update email');
      return;
    }
    toast.success(isSynthetic ? 'Email linked! You can now log in with email or Telegram.' : 'Email & password updated.');
    setPassword('');
    setEditing(false);
    onBound?.(email);
  };

  return (
    <div className="premium-card gradient-border p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" />
            {isSynthetic ? 'Link an email' : 'Login email'}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {isSynthetic
              ? 'Set an email & password to also log in without Telegram.'
              : (
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-green-500" /> {currentEmail}
                </span>
              )}
          </div>
        </div>
        {!isSynthetic && !editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Change</Button>
        )}
      </div>

      {editing && (
        <form onSubmit={submit} className="space-y-2 pt-2">
          <div className="relative">
            <Mail className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="pl-9" />
          </div>
          <div className="relative">
            <Lock className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input type="password" required minLength={6} placeholder="Password (min 6 chars)" value={password} onChange={(e) => setPassword(e.target.value)} className="pl-9" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy} className="flex-1">
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isSynthetic ? 'Link email' : 'Save changes'}
            </Button>
            {!isSynthetic && (
              <Button type="button" variant="ghost" onClick={() => { setEditing(false); setPassword(''); }}>Cancel</Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
