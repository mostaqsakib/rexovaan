import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, RefreshCw, Users, DollarSign, TrendingUp, Gift, Megaphone } from 'lucide-react';
import { toast } from 'sonner';

interface ReferralRow {
  id: string;
  referrer_id: string;
  referred_id: string;
  first_bonus_paid: boolean;
  created_at: string;
  referrer: { first_name: string | null; username: string | null; chat_id: number } | null;
  referred: { first_name: string | null; username: string | null; chat_id: number } | null;
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

const ReferralStatsTab = () => {
  const [loading, setLoading] = useState(true);
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [earnings, setEarnings] = useState<EarningRow[]>([]);
  const [topReferrers, setTopReferrers] = useState<{ id: string; name: string; count: number; earned: number }[]>([]);

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
          .limit(100),
        supabase
          .from('bot_referral_earnings')
          .select('*, referrer:bot_customers!bot_referral_earnings_referrer_id_fkey(first_name, username), referred:bot_customers!bot_referral_earnings_referred_id_fkey(first_name, username)')
          .order('created_at', { ascending: false })
          .limit(200),
      ]);

      const refs = (refRes.data || []) as unknown as ReferralRow[];
      const earns = (earnRes.data || []) as unknown as EarningRow[];
      setReferrals(refs);
      setEarnings(earns);

      // Calculate top referrers
      const referrerMap = new Map<string, { name: string; count: number; earned: number }>();
      for (const r of refs) {
        const key = r.referrer_id;
        const existing = referrerMap.get(key) || { name: getLabel(r.referrer), count: 0, earned: 0 };
        existing.count++;
        referrerMap.set(key, existing);
      }
      for (const e of earns) {
        const existing = referrerMap.get(e.referrer_id);
        if (existing) existing.earned += Number(e.amount);
      }
      const sorted = Array.from(referrerMap.entries())
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => b.earned - a.earned)
        .slice(0, 10);
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

      {/* Top Referrers */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-lg">🏆 Top Referrers</CardTitle>
          <Button variant="outline" size="sm" onClick={fetchData} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {topReferrers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No referrals yet</p>
          ) : (
            <div className="space-y-2">
              {topReferrers.map((r, i) => (
                <div key={r.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold w-6">{i + 1}.</span>
                    <span className="text-sm font-medium">{r.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{r.count} refs</Badge>
                    <Badge variant="default">${r.earned.toFixed(2)}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Referrals */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">👥 Recent Referrals</CardTitle>
        </CardHeader>
        <CardContent>
          {referrals.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No referrals yet</p>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {referrals.slice(0, 20).map(r => (
                <div key={r.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50 text-sm">
                  <div>
                    <span className="font-medium">{getLabel(r.referrer)}</span>
                    <span className="text-muted-foreground"> → </span>
                    <span>{getLabel(r.referred)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.first_bonus_paid && <Badge variant="outline" className="text-xs">Bonus ✓</Badge>}
                    <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
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
              {earnings.slice(0, 30).map(e => (
                <div key={e.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50 text-sm">
                  <div>
                    <span className="font-medium">{getLabel(e.referrer)}</span>
                    <span className="text-muted-foreground"> from </span>
                    <span>{getLabel(e.referred)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={e.type === 'first_bonus' ? 'secondary' : 'default'}>
                      {e.type === 'first_bonus' ? '🎁 Bonus' : '💵 Commission'}
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
