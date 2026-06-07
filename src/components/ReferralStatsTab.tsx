import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, Users, DollarSign, TrendingUp, Gift } from 'lucide-react';
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

  useEffect(() => { fetchData(); }, []);

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
