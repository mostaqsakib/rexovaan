import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, RefreshCw, Users, DollarSign, TrendingUp, Gift, Megaphone, ChevronDown, ChevronRight, Copy, Search } from 'lucide-react';
import { toast } from 'sonner';

interface CustomerLite {
  first_name: string | null;
  username: string | null;
  chat_id: number;
}

interface ReferralRow {
  id: string;
  referrer_id: string;
  referred_id: string;
  first_bonus_paid: boolean;
  created_at: string;
  referrer: CustomerLite | null;
  referred: CustomerLite | null;
}

interface EarningRow {
  id: string;
  referrer_id: string;
  referred_id: string;
  amount: number;
  type: string;
  created_at: string;
  referrer: { first_name: string | null; username: string | null } | null;
  referred: { first_name: string | null; username: string | null } | null;
}

const getLabel = (u: { first_name: string | null; username: string | null } | null) => {
  if (!u) return 'Unknown';
  return u.username ? `@${u.username}` : u.first_name || 'Unknown';
};

const copy = (v: string | number) => {
  navigator.clipboard?.writeText(String(v));
  toast.success('Copied');
};

const ReferralStatsTab = () => {
  const [loading, setLoading] = useState(true);
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [earnings, setEarnings] = useState<EarningRow[]>([]);
  const [topReferrers, setTopReferrers] = useState<{ id: string; name: string; chat_id: number | null; username: string | null; count: number; earned: number }[]>([]);
  const [expandedReferrer, setExpandedReferrer] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Campaign settings (limited-time join bonus — independent of permanent commission/first-purchase system)
  const [campaignActive, setCampaignActive] = useState(false);
  const [campaignReward, setCampaignReward] = useState('0.1');
  const [savingCampaign, setSavingCampaign] = useState(false);

  const loadCampaignSettings = async () => {
    const { data } = await supabase
      .from('bot_settings')
      .select('key, value')
      .in('key', ['referral_campaign_active', 'referral_campaign_reward']);
    if (data) {
      const map = Object.fromEntries(data.map((r) => [r.key, r.value]));
      setCampaignActive(String(map.referral_campaign_active || '').toLowerCase() === 'true');
      if (map.referral_campaign_reward) setCampaignReward(String(map.referral_campaign_reward));
    }
  };

  const saveSetting = async (key: string, value: string) => {
    const { data: existing } = await supabase.from('bot_settings').select('id').eq('key', key).maybeSingle();
    if (existing) {
      return supabase.from('bot_settings').update({ value, updated_at: new Date().toISOString() }).eq('key', key);
    }
    return supabase.from('bot_settings').insert({ key, value });
  };

  const saveCampaign = async () => {
    const rew = parseFloat(campaignReward);
    if (!Number.isFinite(rew) || rew < 0) {
      toast.error('Reward must be a non-negative number');
      return;
    }
    setSavingCampaign(true);
    try {
      const { data: prev } = await supabase
        .from('bot_settings')
        .select('value')
        .eq('key', 'referral_campaign_active')
        .maybeSingle();
      const wasActive = String(prev?.value || '').toLowerCase() === 'true';
      const turningOff = wasActive && !campaignActive;

      const [r1, r2] = await Promise.all([
        saveSetting('referral_campaign_active', campaignActive ? 'true' : 'false'),
        saveSetting('referral_campaign_reward', String(rew)),
      ]);
      if (r1.error || r2.error) throw new Error(r1.error?.message || r2.error?.message);
      toast.success('Campaign settings saved');

      if (turningOff) {
        toast.info('Deleting previously broadcast campaign messages…');
        const { data: del, error: delErr } = await supabase.functions.invoke('referral-campaign-cleanup', { body: {} });
        if (delErr) toast.error(`Cleanup failed: ${delErr.message}`);
        else toast.success(`Deleted ${del?.deleted ?? 0} messages (${del?.skipped ?? 0} skipped)`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    }
    setSavingCampaign(false);
  };

  const [broadcasting, setBroadcasting] = useState<'users' | 'groups' | 'preview' | null>(null);
  const doBroadcast = async (target: 'users' | 'groups') => {
    if (!confirm(`Send referral campaign broadcast to all ${target}?`)) return;
    setBroadcasting(target);
    try {
      const { data, error } = await supabase.functions.invoke('referral-campaign-broadcast', { body: { target } });
      if (error) throw error;
      toast.success(`Broadcast complete — sent: ${data?.sent ?? 0}, failed: ${data?.failed ?? 0}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Broadcast failed');
    }
    setBroadcasting(null);
  };

  const doPreview = async () => {
    setBroadcasting('preview');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const chatId = (user?.user_metadata as any)?.telegram_chat_id;
      if (!chatId) {
        toast.error('No Telegram account bound to your admin login. Sign in via Telegram first.');
        setBroadcasting(null);
        return;
      }
      const { data, error } = await supabase.functions.invoke('referral-campaign-broadcast', {
        body: { target: 'preview', preview_chat_id: chatId },
      });
      if (error) throw error;
      toast.success(`Preview sent to your Telegram (${data?.sent ?? 0} messages). Check your DMs.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Preview failed');
    }
    setBroadcasting(null);
  };


  const fetchData = async () => {
    setLoading(true);
    try {
      const [refRes, earnRes] = await Promise.all([
        supabase
          .from('bot_referrals')
          .select('*, referrer:bot_customers!bot_referrals_referrer_id_fkey(first_name, username, chat_id), referred:bot_customers!bot_referrals_referred_id_fkey(first_name, username, chat_id)')
          .order('created_at', { ascending: false })
          .limit(1000),
        supabase
          .from('bot_referral_earnings')
          .select('*, referrer:bot_customers!bot_referral_earnings_referrer_id_fkey(first_name, username), referred:bot_customers!bot_referral_earnings_referred_id_fkey(first_name, username)')
          .order('created_at', { ascending: false })
          .limit(1000),
      ]);

      const refs = (refRes.data || []) as unknown as ReferralRow[];
      const earns = (earnRes.data || []) as unknown as EarningRow[];
      setReferrals(refs);
      setEarnings(earns);

      // Calculate top referrers
      const referrerMap = new Map<string, { name: string; chat_id: number | null; username: string | null; count: number; earned: number }>();
      for (const r of refs) {
        const key = r.referrer_id;
        const existing = referrerMap.get(key) || {
          name: getLabel(r.referrer),
          chat_id: r.referrer?.chat_id ?? null,
          username: r.referrer?.username ?? null,
          count: 0,
          earned: 0,
        };
        existing.count++;
        referrerMap.set(key, existing);
      }
      for (const e of earns) {
        const existing = referrerMap.get(e.referrer_id);
        if (existing) existing.earned += Number(e.amount);
      }
      const sorted = Array.from(referrerMap.entries())
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 25);
      setTopReferrers(sorted);
    } catch (err) {
      toast.error('Failed to load referral data');
    }
    setLoading(false);
  };


  useEffect(() => { fetchData(); loadCampaignSettings(); }, []);

  const totalReferrals = referrals.length;
  const totalEarned = earnings.reduce((s, e) => s + Number(e.amount), 0);
  const totalCommissions = earnings.filter(e => e.type === 'commission').reduce((s, e) => s + Number(e.amount), 0);
  const totalBonuses = earnings.filter(e => e.type === 'first_bonus').reduce((s, e) => s + Number(e.amount), 0);

  // Group referrals by referrer for the per-referrer expandable view
  const referralsByReferrer = useMemo(() => {
    const map = new Map<string, ReferralRow[]>();
    for (const r of referrals) {
      const arr = map.get(r.referrer_id) || [];
      arr.push(r);
      map.set(r.referrer_id, arr);
    }
    return map;
  }, [referrals]);

  // Earnings per (referrer, referred) pair
  const earningsByPair = useMemo(() => {
    const map = new Map<string, { commission: number; first_bonus: number; campaign_signup: number; total: number }>();
    for (const e of earnings) {
      const key = `${e.referrer_id}__${e.referred_id}`;
      const v = map.get(key) || { commission: 0, first_bonus: 0, campaign_signup: 0, total: 0 };
      const amt = Number(e.amount);
      if (e.type === 'commission') v.commission += amt;
      else if (e.type === 'first_bonus') v.first_bonus += amt;
      else if (e.type === 'campaign_signup') v.campaign_signup += amt;
      v.total += amt;
      map.set(key, v);
    }
    return map;
  }, [earnings]);

  const filteredReferrals = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return referrals;
    return referrals.filter(r => {
      const fields = [
        r.referrer?.username, r.referrer?.first_name, String(r.referrer?.chat_id ?? ''),
        r.referred?.username, r.referred?.first_name, String(r.referred?.chat_id ?? ''),
      ];
      return fields.some(f => f && String(f).toLowerCase().includes(q));
    });
  }, [referrals, search]);


  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Limited-Time Join-Bonus Campaign (independent of permanent commission/first-purchase system) */}
      <Card className="border-primary/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            Join-Bonus Campaign
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Pays a one-time fixed reward to the referrer the moment a new user joins via their referral link.
            <br />
            <span className="text-foreground/80">This is independent of the permanent commission % + first-purchase bonus system, which is always active.</span>
          </p>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label className="text-sm font-medium">Campaign Active</Label>
              <p className="text-xs text-muted-foreground">When OFF, no join bonus is credited. Existing referral system keeps working.</p>
            </div>
            <Switch checked={campaignActive} onCheckedChange={setCampaignActive} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="campaign-reward" className="text-sm font-medium">Join Reward (USDT)</Label>
            <Input
              id="campaign-reward"
              type="number"
              step="0.01"
              min="0"
              value={campaignReward}
              onChange={(e) => setCampaignReward(e.target.value)}
              placeholder="0.1"
            />
            <p className="text-xs text-muted-foreground">Credited to the referrer's main wallet balance, one-time per new referred user.</p>
          </div>
          <Button onClick={saveCampaign} disabled={savingCampaign} className="w-full">
            {savingCampaign && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Campaign Settings
          </Button>

          <div className="rounded-lg border p-3 space-y-2">
            <Label className="text-sm font-medium flex items-center gap-2"><Megaphone className="h-4 w-4 text-primary" />📢 Broadcast Campaign</Label>
            <p className="text-xs text-muted-foreground">Sent messages are tracked and auto-deleted when the campaign is turned OFF.</p>
            <Button variant="secondary" disabled={!!broadcasting} onClick={doPreview} className="w-full">
              {broadcasting === 'preview' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              👁 Preview Message (sends to your Telegram)
            </Button>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button variant="outline" disabled={!!broadcasting} onClick={() => doBroadcast('users')}>
                {broadcasting === 'users' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                👤 Broadcast to Users
              </Button>
              <Button variant="outline" disabled={!!broadcasting} onClick={() => doBroadcast('groups')}>
                {broadcasting === 'groups' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                👥 Broadcast to Groups
              </Button>
            </div>
          </div>

        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <Users className="h-5 w-5 mx-auto text-primary mb-1" />
            <p className="text-2xl font-bold">{totalReferrals}</p>
            <p className="text-xs text-muted-foreground">Total Referrals</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <DollarSign className="h-5 w-5 mx-auto text-primary mb-1" />
            <p className="text-2xl font-bold">${totalEarned.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">Total Paid Out</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <TrendingUp className="h-5 w-5 mx-auto text-primary mb-1" />
            <p className="text-2xl font-bold">${totalCommissions.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">Commissions</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Gift className="h-5 w-5 mx-auto text-primary mb-1" />
            <p className="text-2xl font-bold">${totalBonuses.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">First Bonuses</p>
          </CardContent>
        </Card>
      </div>

      {/* Top Referrers — Expandable */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-lg">🏆 Top Referrers (click to expand)</CardTitle>
          <Button variant="outline" size="sm" onClick={fetchData} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {topReferrers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No referrals yet</p>
          ) : (
            <div className="space-y-2">
              {topReferrers.map((r, i) => {
                const isOpen = expandedReferrer === r.id;
                const refs = referralsByReferrer.get(r.id) || [];
                return (
                  <div key={r.id} className="rounded-lg border bg-muted/30">
                    <button
                      type="button"
                      onClick={() => setExpandedReferrer(isOpen ? null : r.id)}
                      className="w-full flex items-center justify-between p-3 hover:bg-muted/60 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                        <span className="text-sm font-bold w-6 shrink-0">{i + 1}.</span>
                        <div className="flex flex-col items-start min-w-0">
                          <span className="text-sm font-medium truncate">{r.name}</span>
                          {r.chat_id != null && (
                            <span className="text-[10px] text-muted-foreground font-mono">ID: {r.chat_id}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="secondary">{r.count} refs</Badge>
                        <Badge variant="default">${r.earned.toFixed(2)}</Badge>
                      </div>
                    </button>
                    {isOpen && (
                      <div className="border-t p-2 space-y-1 max-h-[400px] overflow-y-auto">
                        {refs.length === 0 ? (
                          <p className="text-xs text-muted-foreground p-2">No referred users loaded.</p>
                        ) : (
                          refs.map((rr, idx) => {
                            const pairKey = `${rr.referrer_id}__${rr.referred_id}`;
                            const pe = earningsByPair.get(pairKey);
                            return (
                              <div key={rr.id} className="flex items-center justify-between p-2 rounded bg-background text-xs gap-2">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <span className="text-muted-foreground shrink-0 w-6">#{idx + 1}</span>
                                  <div className="flex flex-col min-w-0">
                                    <span className="font-medium truncate">
                                      {rr.referred?.first_name || 'Unknown'}
                                      {rr.referred?.username && (
                                        <span className="text-muted-foreground"> · @{rr.referred.username}</span>
                                      )}
                                    </span>
                                    <span className="font-mono text-[10px] text-muted-foreground flex items-center gap-1">
                                      ID: {rr.referred?.chat_id ?? '—'}
                                      {rr.referred?.chat_id != null && (
                                        <button
                                          type="button"
                                          onClick={(ev) => { ev.stopPropagation(); copy(rr.referred!.chat_id); }}
                                          className="hover:text-foreground"
                                          title="Copy chat ID"
                                        >
                                          <Copy className="h-3 w-3" />
                                        </button>
                                      )}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex flex-col items-end gap-0.5 shrink-0">
                                  <span className="text-[10px] text-muted-foreground">
                                    {new Date(rr.created_at).toLocaleString()}
                                  </span>
                                  <div className="flex items-center gap-1 flex-wrap justify-end">
                                    {pe && pe.campaign_signup > 0 && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0">join +${pe.campaign_signup.toFixed(2)}</Badge>
                                    )}
                                    {pe && pe.first_bonus > 0 && (
                                      <Badge variant="secondary" className="text-[9px] px-1 py-0">bonus +${pe.first_bonus.toFixed(2)}</Badge>
                                    )}
                                    {pe && pe.commission > 0 && (
                                      <Badge variant="default" className="text-[9px] px-1 py-0">comm +${pe.commission.toFixed(2)}</Badge>
                                    )}
                                    {(!pe || pe.total === 0) && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 text-muted-foreground">no earnings</Badge>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* All Referrals — Searchable Detailed Table */}
      <Card>
        <CardHeader className="pb-3 space-y-2">
          <CardTitle className="text-lg">👥 All Referrals ({filteredReferrals.length} of {referrals.length})</CardTitle>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by username, name, or chat ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
        </CardHeader>
        <CardContent>
          {filteredReferrals.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No referrals match</p>
          ) : (
            <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
              {filteredReferrals.slice(0, 200).map(r => (
                <div key={r.id} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr_auto] items-center gap-2 p-2 rounded-lg bg-muted/40 text-xs">
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium truncate">
                      {r.referrer?.first_name || 'Unknown'}
                      {r.referrer?.username && <span className="text-muted-foreground"> · @{r.referrer.username}</span>}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">ID: {r.referrer?.chat_id ?? '—'}</span>
                  </div>
                  <span className="text-muted-foreground hidden sm:inline">→</span>
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium truncate">
                      {r.referred?.first_name || 'Unknown'}
                      {r.referred?.username && <span className="text-muted-foreground"> · @{r.referred.username}</span>}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">ID: {r.referred?.chat_id ?? '—'}</span>
                  </div>
                  <div className="flex items-center gap-1 justify-end shrink-0">
                    {r.first_bonus_paid && <Badge variant="outline" className="text-[9px] px-1 py-0">Bonus ✓</Badge>}
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {new Date(r.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
              {filteredReferrals.length > 200 && (
                <p className="text-[10px] text-muted-foreground text-center pt-2">
                  Showing first 200 of {filteredReferrals.length} — refine search to see more.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Earnings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">💰 Recent Earnings</CardTitle>
        </CardHeader>
        <CardContent>
          {earnings.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No earnings yet</p>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {earnings.slice(0, 50).map(e => (
                <div key={e.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50 text-sm">
                  <div>
                    <span className="font-medium">{getLabel(e.referrer)}</span>
                    <span className="text-muted-foreground"> from </span>
                    <span>{getLabel(e.referred)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={e.type === 'first_bonus' ? 'secondary' : e.type === 'campaign_signup' ? 'outline' : 'default'}>
                      {e.type === 'first_bonus' ? '🎁 Bonus' : e.type === 'campaign_signup' ? '🎯 Join' : '💵 Commission'}
                    </Badge>
                    <span className="font-medium text-primary">${Number(e.amount).toFixed(2)}</span>
                    <span className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};



export default ReferralStatsTab;
