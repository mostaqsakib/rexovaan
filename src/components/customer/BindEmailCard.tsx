import { useState } from 'react';
import { Mail, Lock, Loader2, CheckCircle2, GitMerge } from 'lucide-react';
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
  const [mergePrompt, setMergePrompt] = useState<null | { email: string }>(null);

  const call = async (merge = false) => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('customer-bind-email', {
      body: { email, password, merge },
    });
    setBusy(false);
    const res = data as any;
    if (error || res?.error) {
      // Server signals a mergeable conflict → show merge prompt
      if (res?.can_merge && !merge) {
        setMergePrompt({ email });
        return;
      }
      toast.error(res?.error || error?.message || 'Failed to update email');
      return;
    }
    if (res?.merged) {
      toast.success('Accounts merged! Signing in with your email account…');
      await supabase.auth.signOut();
      // After a merge the current auth user is deleted; force a full reload to /login
      window.location.href = `/login?next=/account`;
      return;
    }
    toast.success(isSynthetic ? 'Email linked! You can now log in with email or Telegram.' : 'Email & password updated.');
    setPassword('');
    setEditing(false);
    setMergePrompt(null);
    onBound?.(email);
  };

  const submit = (e: React.FormEvent) => { e.preventDefault(); call(false); };

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

      {editing && !mergePrompt && (
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

      {mergePrompt && (
        <div className="space-y-3 pt-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-start gap-2 text-sm">
            <GitMerge className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">Existing account found</div>
              <div className="text-xs text-muted-foreground mt-1">
                <span className="font-medium text-foreground">{mergePrompt.email}</span> already has an account. Enter the password above to merge your Telegram balance, orders and deposits into it. Your current Telegram-only account will be replaced.
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => call(true)} disabled={busy} className="flex-1">
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Verify & merge
            </Button>
            <Button variant="ghost" onClick={() => setMergePrompt(null)} disabled={busy}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
