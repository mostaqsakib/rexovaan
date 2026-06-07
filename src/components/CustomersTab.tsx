import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Users, Pencil, Plus, CreditCard, Ban, Activity, Tag, Globe, Send } from 'lucide-react';
import CustomerActivityDialog from './CustomerActivityDialog';
import SpecialPricingDialog from './SpecialPricingDialog';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';

interface Customer {
  id: string;
  chat_id: number;
  username: string | null;
  first_name: string | null;
  balance: number;
  created_at: string;
  updated_at: string;
  pay_later_enabled: boolean;
  pay_later_limit: number;
  pay_later_used: number;
  is_banned: boolean;
  ban_reason: string | null;
  banned_at: string | null;
  auth_user_id: string | null;
}

type AccountFilter = 'all' | 'web' | 'telegram';

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const PAGE_SIZE = 50;

const CustomersTab = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [newBalance, setNewBalance] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [depositCustomer, setDepositCustomer] = useState<Customer | null>(null);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositNote, setDepositNote] = useState('');
  const [depositing, setDepositing] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [creditCustomer, setCreditCustomer] = useState<Customer | null>(null);
  const [creditEnabled, setCreditEnabled] = useState(false);
  const [creditLimit, setCreditLimit] = useState('');
  const [savingCredit, setSavingCredit] = useState(false);
  const [banCustomer, setBanCustomer] = useState<Customer | null>(null);
  const [banReason, setBanReason] = useState('');
  const [savingBan, setSavingBan] = useState(false);
  const [activityCustomer, setActivityCustomer] = useState<Customer | null>(null);
  const [pricingCustomer, setPricingCustomer] = useState<Customer | null>(null);
  const [accountFilter, setAccountFilter] = useState<AccountFilter>('all');
  const [emailMap, setEmailMap] = useState<Record<string, string>>({});


  useEffect(() => {
    fetchCustomers(true);
  }, [debouncedSearch, accountFilter]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchCustomers = async (reset = false) => {
    if (reset) {
      // Only show full-page loader on initial mount; for search/filter changes, use the inline "loadingMore" indicator so the list doesn't unmount
      if (customers.length === 0) setLoading(true);
      setLoadingMore(true);
    } else {
      setLoadingMore(true);
    }


    const from = reset ? 0 : customers.length;
    const to = from + PAGE_SIZE - 1;

    const searchRaw = debouncedSearch.trim();
    const hasSearch = searchRaw.length > 0;
    // Treat as username/name search unless input starts with '@' followed by no text (edge case)
    const isAtPrefix = searchRaw.startsWith('@');

    // Always also search emails when there's any input (partial substring match)
    let emailMatchedIds: string[] = [];
    let emailLookup: Record<string, string> = {};
    if (hasSearch && !isAtPrefix) {
      try {
        const { data: ed } = await supabase.functions.invoke('admin-customer-emails', {
          body: { search_email: searchRaw.toLowerCase() },
        });
        emailMatchedIds = Array.isArray(ed?.matched_ids) ? ed.matched_ids : [];
        emailLookup = ed?.emails || {};
      } catch {
        emailMatchedIds = [];
      }
      if (Object.keys(emailLookup).length > 0) {
        setEmailMap(prev => ({ ...prev, ...emailLookup }));
      }
    }

    let query = supabase
      .from('bot_customers')
      .select('*', { count: 'exact' })
      .order('updated_at', { ascending: false });

    if (accountFilter === 'web') query = query.not('auth_user_id', 'is', null);
    else if (accountFilter === 'telegram') query = query.is('auth_user_id', null);

    if (hasSearch) {
      const s = searchRaw.replace(/^@/, '');
      const esc = s.replace(/[,()]/g, ' ');
      const chatIdClause = /^\d+$/.test(s) ? s : '0';
      const orParts = [
        `username.ilike.%${esc}%`,
        `first_name.ilike.%${esc}%`,
        `chat_id.eq.${chatIdClause}`,
      ];
      if (emailMatchedIds.length > 0) {
        orParts.push(`auth_user_id.in.(${emailMatchedIds.join(',')})`);
      }
      query = query.or(orParts.join(','));
    }

    const { data, count } = await query.range(from, to);

    if (data) {
      const merged = reset ? data as Customer[] : [...customers, ...data as Customer[]];
      setCustomers(merged);
      setHasMore(data.length === PAGE_SIZE);
      // Fetch emails for any new auth_user_ids we don't have yet
      const needed = (data as Customer[])
        .map(c => c.auth_user_id)
        .filter((id): id is string => !!id && !(id in emailMap) && !(id in emailLookup));
      if (needed.length > 0) {
        supabase.functions.invoke('admin-customer-emails', { body: { auth_user_ids: needed } })
          .then(({ data: ed }) => { if (ed?.emails) setEmailMap(prev => ({ ...prev, ...ed.emails })); })
          .catch(() => {});
      }
    }
    if (count !== null) setTotalCount(count);
    setLoading(false);
    setLoadingMore(false);
  };

  const getLabel = (c: Customer) => {
    if (c.username) return `@${c.username}`;
    if (c.first_name) return c.first_name;
    return `#${c.chat_id}`;
  };

  const handleEditBalance = async () => {
    if (!editCustomer || newBalance === '' || !note.trim()) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-edit-balance', {
        body: { customer_id: editCustomer.id, new_balance: Number(newBalance), note: note.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Balance updated: ${Number(data.old_balance).toFixed(2)} → ${Number(data.new_balance).toFixed(2)} USDT`);
      setEditCustomer(null);
      setNewBalance('');
      setNote('');
      fetchCustomers(true);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update balance');
    } finally {
      setSaving(false);
    }
  };

  const handleDeposit = async () => {
    if (!depositCustomer || !depositAmount || Number(depositAmount) <= 0 || !depositNote.trim()) return;
    setSaving(true);
    try {
      const amt = Number(depositAmount);
      const newBal = Number(depositCustomer.balance) + amt;
      const { data, error } = await supabase.functions.invoke('admin-edit-balance', {
        body: { customer_id: depositCustomer.id, new_balance: newBal, note: depositNote.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`${amt.toFixed(2)} USDT deposited to ${getLabel(depositCustomer)}`);
      setDepositCustomer(null);
      setDepositAmount('');
      setDepositNote('');
      fetchCustomers(true);
    } catch (err: any) {
      toast.error(err.message || 'Deposit failed');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCredit = async () => {
    if (!creditCustomer) return;
    setSavingCredit(true);
    try {
      const { error } = await supabase
        .from('bot_customers')
        .update({
          pay_later_enabled: creditEnabled,
          pay_later_limit: Number(creditLimit) || 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', creditCustomer.id);
      if (error) throw error;
      toast.success(`Pay Later ${creditEnabled ? 'enabled' : 'disabled'} for ${getLabel(creditCustomer)}`);
      setCreditCustomer(null);
      fetchCustomers(true);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update');
    } finally {
      setSavingCredit(false);
    }
  };

  const handleToggleBan = async () => {
    if (!banCustomer) return;
    const willBan = !banCustomer.is_banned;
    if (willBan && !banReason.trim()) { toast.error('Reason required'); return; }
    setSavingBan(true);
    try {
      const { error } = await supabase
        .from('bot_customers')
        .update({
          is_banned: willBan,
          ban_reason: willBan ? banReason.trim() : null,
          banned_at: willBan ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', banCustomer.id);
      if (error) throw error;
      toast.success(willBan ? `${getLabel(banCustomer)} banned` : `${getLabel(banCustomer)} unbanned`);
      setBanCustomer(null);
      setBanReason('');
      fetchCustomers(true);
    } catch (err: any) {
      toast.error(err.message || 'Failed');
    } finally {
      setSavingBan(false);
    }
  };

  if (loading) {
    return <div className="py-20 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground font-medium">Total: {totalCount} customers (showing {customers.length})</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-md border border-border overflow-hidden">
            {(['all','web','telegram'] as AccountFilter[]).map(f => (
              <button
                key={f}
                onClick={() => setAccountFilter(f)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${accountFilter === f ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
              >
                {f === 'all' ? 'All' : f === 'web' ? 'Web' : 'Telegram'}
              </button>
            ))}
          </div>
          <Input
            placeholder="Search by username, name, chat ID, or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
        </div>
      </div>

      {customers.length === 0 ? (
        <div className="py-20 text-center"><p className="text-lg text-muted-foreground">No customers found.</p></div>
      ) : (
        <div className="space-y-2">
          {customers.map((c) => (
            <div key={c.id} className="rounded-lg border border-border bg-card px-4 py-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-semibold text-foreground">{getLabel(c)}</span>
                {c.username && c.first_name && (
                  <span className="text-sm text-muted-foreground">({c.first_name})</span>
                )}
                {c.auth_user_id ? (
                  <Badge variant="secondary" className="text-xs gap-1"><Globe className="h-3 w-3" />Web{emailMap[c.auth_user_id] ? ` · ${emailMap[c.auth_user_id]}` : ''}</Badge>
                ) : (
                  <Badge variant="outline" className="text-xs gap-1"><Send className="h-3 w-3" />Telegram</Badge>
                )}
                <Badge variant="outline" className="font-mono">
                  {Number(c.balance).toFixed(2)} USDT
                </Badge>
                {c.pay_later_enabled && (
                  <Badge variant="secondary" className="font-mono text-xs">
                    🏷️ Credit: {(Number(c.pay_later_limit) - Number(c.pay_later_used)).toFixed(2)}/{Number(c.pay_later_limit).toFixed(2)}
                    {Number(c.pay_later_used) > 0 && ` (Due: ${Number(c.pay_later_used).toFixed(2)})`}
                  </Badge>
                )}
                {c.is_banned && (
                  <Badge variant="destructive" className="font-mono text-xs">🚫 Banned</Badge>
                )}
                <span className="text-xs text-muted-foreground">ID: {c.chat_id}</span>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 text-xs"
                    onClick={() => setActivityCustomer(c)}
                  >
                    <Activity className="h-3 w-3" />
                    Activity
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 text-xs"
                    onClick={() => { setDepositCustomer(c); setDepositAmount(''); setDepositNote(''); }}
                  >
                    <Plus className="h-3 w-3" />
                    Deposit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 text-xs"
                    onClick={() => { setEditCustomer(c); setNewBalance(Number(c.balance).toFixed(2)); setNote(''); }}
                  >
                    <Pencil className="h-3 w-3" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant={c.pay_later_enabled ? "default" : "outline"}
                    className="gap-1 text-xs"
                    onClick={() => { setCreditCustomer(c); setCreditEnabled(c.pay_later_enabled); setCreditLimit(Number(c.pay_later_limit).toFixed(2)); }}
                  >
                    <CreditCard className="h-3 w-3" />
                    Credit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 text-xs"
                    onClick={() => setPricingCustomer(c)}
                  >
                    <Tag className="h-3 w-3" />
                    Special Price
                  </Button>
                  <Button
                    size="sm"
                    variant={c.is_banned ? "destructive" : "outline"}
                    className="gap-1 text-xs"
                    onClick={() => { setBanCustomer(c); setBanReason(c.ban_reason || ''); }}
                  >
                    <Ban className="h-3 w-3" />
                    {c.is_banned ? 'Unban' : 'Ban'}
                  </Button>
                  <span className="text-xs text-muted-foreground">{formatDate(c.created_at)}</span>
                </div>
              </div>
            </div>
          ))}
          {hasMore && (
            <div className="pt-3 text-center">
              <Button variant="outline" onClick={() => fetchCustomers(false)} disabled={loadingMore}>
                {loadingMore && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Load More
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Edit Balance Dialog */}
      <Dialog open={!!editCustomer} onOpenChange={(open) => { if (!open) setEditCustomer(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Balance — {editCustomer && getLabel(editCustomer)}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Current Balance: <span className="font-semibold text-foreground">{editCustomer && Number(editCustomer.balance).toFixed(2)} USDT</span>
            </div>
            <div>
              <label className="text-sm font-medium">New Balance (USDT)</label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={newBalance}
                onChange={(e) => setNewBalance(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Note (required) <span className="text-destructive">*</span></label>
              <Textarea
                placeholder="e.g. Refund for order #123, Manual deposit, Bonus credit..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditCustomer(null)}>Cancel</Button>
            <Button onClick={handleEditBalance} disabled={saving || newBalance === '' || !note.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save & Notify
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deposit Dialog */}
      <Dialog open={!!depositCustomer} onOpenChange={(open) => { if (!open) setDepositCustomer(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Manual Deposit — {depositCustomer && getLabel(depositCustomer)}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Current Balance: <span className="font-semibold text-foreground">{depositCustomer && Number(depositCustomer.balance).toFixed(2)} USDT</span>
            </div>
            <div>
              <label className="text-sm font-medium">Deposit Amount (USDT)</label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="Enter amount to add"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Note (required) <span className="text-destructive">*</span></label>
              <Textarea
                placeholder="e.g. Manual top-up, Cash payment received..."
                value={depositNote}
                onChange={(e) => setDepositNote(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDepositCustomer(null)}>Cancel</Button>
            <Button onClick={handleDeposit} disabled={saving || !depositAmount || Number(depositAmount) <= 0 || !depositNote.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Deposit & Notify
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pay Later / Credit Dialog */}
      <Dialog open={!!creditCustomer} onOpenChange={(open) => { if (!open) setCreditCustomer(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pay Later Settings — {creditCustomer && getLabel(creditCustomer)}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {creditCustomer && Number(creditCustomer.pay_later_used) > 0 && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm">
                ⚠️ Outstanding Due: <span className="font-semibold text-destructive">{Number(creditCustomer.pay_later_used).toFixed(2)} USDT</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Enable Pay Later</label>
              <Switch checked={creditEnabled} onCheckedChange={setCreditEnabled} />
            </div>
            {creditEnabled && (
              <div>
                <label className="text-sm font-medium">Credit Limit (USDT)</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={creditLimit}
                  onChange={(e) => setCreditLimit(e.target.value)}
                />
                {creditCustomer && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Available: {(Number(creditLimit || 0) - Number(creditCustomer.pay_later_used)).toFixed(2)} USDT
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreditCustomer(null)}>Cancel</Button>
            <Button onClick={handleSaveCredit} disabled={savingCredit}>
              {savingCredit && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ban Dialog */}
      <Dialog open={!!banCustomer} onOpenChange={(open) => { if (!open) { setBanCustomer(null); setBanReason(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {banCustomer?.is_banned ? 'Unban' : 'Ban'} — {banCustomer && getLabel(banCustomer)}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {banCustomer?.is_banned ? (
              <div className="rounded-md bg-muted p-3 text-sm">
                This user is currently <span className="font-semibold text-destructive">banned</span>.
                {banCustomer.ban_reason && <div className="mt-1 text-muted-foreground">Reason: {banCustomer.ban_reason}</div>}
              </div>
            ) : (
              <div>
                <label className="text-sm font-medium">Ban Reason <span className="text-destructive">*</span></label>
                <Textarea
                  placeholder="e.g. Abusing the bot, fraud, spam..."
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                  rows={3}
                />
                <p className="text-xs text-muted-foreground mt-1">Banned users will see this reason and cannot interact with the bot.</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBanCustomer(null)}>Cancel</Button>
            <Button
              variant={banCustomer?.is_banned ? "default" : "destructive"}
              onClick={handleToggleBan}
              disabled={savingBan || (!banCustomer?.is_banned && !banReason.trim())}
            >
              {savingBan && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {banCustomer?.is_banned ? 'Unban User' : 'Ban User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CustomerActivityDialog
        customerId={activityCustomer?.id || null}
        customerLabel={activityCustomer ? getLabel(activityCustomer) : ''}
        currentBalance={activityCustomer ? Number(activityCustomer.balance) : 0}
        onClose={() => setActivityCustomer(null)}
      />

      <SpecialPricingDialog
        customerId={pricingCustomer?.id || null}
        customerLabel={pricingCustomer ? getLabel(pricingCustomer) : ''}
        onClose={() => setPricingCustomer(null)}
      />
    </>
  );
};

export default CustomersTab;
