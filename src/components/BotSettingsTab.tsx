import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Loader2, Save, MessageSquare, Info, Gift, DollarSign, Image as ImageIcon, Upload, X, Megaphone } from 'lucide-react';

const BotSettingsTab = () => {
  const [logoUrl, setLogoUrl] = useState('');
  const [origLogoUrl, setOrigLogoUrl] = useState('');
  const [shopName, setShopName] = useState('');
  const [origShopName, setOrigShopName] = useState('');
  const [savingBrand, setSavingBrand] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [welcomeMsg, setWelcomeMsg] = useState('');
  const [originalMsg, setOriginalMsg] = useState('');
  const [refCommission, setRefCommission] = useState('2');
  const [origRefCommission, setOrigRefCommission] = useState('2');
  const [refBonus, setRefBonus] = useState('0.50');
  const [origRefBonus, setOrigRefBonus] = useState('0.50');
  const [bdtRate, setBdtRate] = useState('125');
  const [origBdtRate, setOrigBdtRate] = useState('125');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingRef, setSavingRef] = useState(false);
  const [savingBdt, setSavingBdt] = useState(false);

  // Channel join verification settings
  const [cjEnabled, setCjEnabled] = useState(false);
  const [origCjEnabled, setOrigCjEnabled] = useState(false);
  const [cjUsername, setCjUsername] = useState('');
  const [origCjUsername, setOrigCjUsername] = useState('');
  const [cjMessage, setCjMessage] = useState('');
  const [origCjMessage, setOrigCjMessage] = useState('');
  const [cjJoinEmoji, setCjJoinEmoji] = useState('📢');
  const [origCjJoinEmoji, setOrigCjJoinEmoji] = useState('📢');
  const [cjDoneEmoji, setCjDoneEmoji] = useState('✅');
  const [origCjDoneEmoji, setOrigCjDoneEmoji] = useState('✅');
  const [savingCj, setSavingCj] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    const { data, error } = await supabase
      .from('bot_settings')
      .select('*')
      .in('key', ['welcome_message', 'referral_commission_percent', 'referral_first_bonus', 'dollar_rate_bdt', 'site_logo_url', 'site_shop_name']);
    if (error) {
      toast.error('Failed to load settings');
      setLoading(false);
      return;
    }
    for (const row of (data || [])) {
      if (row.key === 'welcome_message') { setWelcomeMsg(row.value); setOriginalMsg(row.value); }
      if (row.key === 'referral_commission_percent') { setRefCommission(row.value); setOrigRefCommission(row.value); }
      if (row.key === 'referral_first_bonus') { setRefBonus(row.value); setOrigRefBonus(row.value); }
      if (row.key === 'dollar_rate_bdt') { setBdtRate(row.value); setOrigBdtRate(row.value); }
      if (row.key === 'site_logo_url') { setLogoUrl(row.value); setOrigLogoUrl(row.value); }
      if (row.key === 'site_shop_name') { setShopName(row.value); setOrigShopName(row.value); }
    }
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('bot_settings')
      .update({ value: welcomeMsg, updated_at: new Date().toISOString() })
      .eq('key', 'welcome_message');
    if (error) toast.error('Failed to save welcome message');
    else { toast.success('Welcome message updated!'); setOriginalMsg(welcomeMsg); }
    setSaving(false);
  };

  const upsertSetting = async (key: string, value: string) => {
    const { data: existing } = await supabase.from('bot_settings').select('id').eq('key', key).maybeSingle();
    if (existing) {
      return supabase.from('bot_settings').update({ value, updated_at: new Date().toISOString() }).eq('key', key);
    }
    return supabase.from('bot_settings').insert({ key, value });
  };

  const handleSaveRef = async () => {
    setSavingRef(true);
    const [r1, r2] = await Promise.all([
      upsertSetting('referral_commission_percent', refCommission),
      upsertSetting('referral_first_bonus', refBonus),
    ]);
    if (r1.error || r2.error) toast.error('Failed to save referral settings');
    else {
      toast.success('Referral settings updated!');
      setOrigRefCommission(refCommission);
      setOrigRefBonus(refBonus);
    }
    setSavingRef(false);
  };

  const hasChanges = welcomeMsg !== originalMsg;
  const hasRefChanges = refCommission !== origRefCommission || refBonus !== origRefBonus;
  const hasBdtChanges = bdtRate !== origBdtRate;
  const hasBrandChanges = logoUrl !== origLogoUrl || shopName !== origShopName;

  const handleLogoUpload = async (file: File) => {
    setUploadingLogo(true);
    try {
      const ext = file.name.split('.').pop() || 'png';
      const path = `logo-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('site-assets').upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('site-assets').getPublicUrl(path);
      setLogoUrl(data.publicUrl);
      toast.success('Logo uploaded! Click Save to apply.');
    } catch (e: any) {
      toast.error(e.message || 'Upload failed');
    }
    setUploadingLogo(false);
  };

  const handleSaveBrand = async () => {
    setSavingBrand(true);
    const [r1, r2] = await Promise.all([
      upsertSetting('site_logo_url', logoUrl),
      upsertSetting('site_shop_name', shopName),
    ]);
    if (r1.error || r2.error) toast.error('Failed to save branding');
    else { toast.success('Site branding updated!'); setOrigLogoUrl(logoUrl); setOrigShopName(shopName); }
    setSavingBrand(false);
  };

  const handleSaveBdt = async () => {
    setSavingBdt(true);
    const { error } = await upsertSetting('dollar_rate_bdt', bdtRate);
    if (error) toast.error('Failed to save BDT rate');
    else { toast.success('Dollar rate updated!'); setOrigBdtRate(bdtRate); }
    setSavingBdt(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ImageIcon className="h-5 w-5 text-primary" />
            Site Branding
          </CardTitle>
          <CardDescription>
            Customer site এর header logo আর shop name সেট করো।
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Shop Name</Label>
            <Input value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder="Rexovaan Shop" />
          </div>
          <div className="space-y-2">
            <Label>Logo</Label>
            <div className="flex items-center gap-3">
              <div className="h-16 w-16 rounded-lg border border-border bg-muted/40 grid place-items-center overflow-hidden shrink-0">
                {logoUrl ? (
                  <img src={logoUrl} alt="Logo" className="h-full w-full object-contain" />
                ) : (
                  <ImageIcon className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 space-y-2">
                <Input
                  type="file"
                  accept="image/*"
                  disabled={uploadingLogo}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); }}
                />
                <div className="flex items-center gap-2">
                  <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="Or paste image URL..." className="text-xs" />
                  {logoUrl && (
                    <Button variant="ghost" size="icon" onClick={() => setLogoUrl('')} title="Remove">
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
            {uploadingLogo && <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Uploading...</p>}
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSaveBrand} disabled={savingBrand || !hasBrandChanges} size="sm" className="gap-2">
              {savingBrand ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Branding
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <MessageSquare className="h-5 w-5 text-primary" />
            Welcome Message
          </CardTitle>
          <CardDescription className="flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Bot এ /start দিলে এই message দেখাবে। HTML formatting সাপোর্ট করে: <code className="text-xs bg-muted px-1 rounded">&lt;b&gt;bold&lt;/b&gt;</code>, <code className="text-xs bg-muted px-1 rounded">&lt;i&gt;italic&lt;/i&gt;</code>, <code className="text-xs bg-muted px-1 rounded">&lt;tg-emoji emoji-id="ID"&gt;emoji&lt;/tg-emoji&gt;</code>
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={welcomeMsg}
            onChange={(e) => setWelcomeMsg(e.target.value)}
            placeholder="Welcome message..."
            className="min-h-[200px] font-mono text-sm"
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Use <code className="bg-muted px-1 rounded">{'{name}'}</code> for user's name
            </p>
            <Button onClick={handleSave} disabled={saving || !hasChanges} size="sm" className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Gift className="h-5 w-5 text-primary" />
            Referral Settings
          </CardTitle>
          <CardDescription>
            Referral commission আর first purchase bonus কনফিগার করো
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ref-commission">Commission (%)</Label>
              <Input
                id="ref-commission"
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={refCommission}
                onChange={(e) => setRefCommission(e.target.value)}
                placeholder="2"
              />
              <p className="text-xs text-muted-foreground">প্রতিটি order এর শতকরা হার</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ref-bonus">First Purchase Bonus ($)</Label>
              <Input
                id="ref-bonus"
                type="number"
                step="0.01"
                min="0"
                value={refBonus}
                onChange={(e) => setRefBonus(e.target.value)}
                placeholder="0.50"
              />
              <p className="text-xs text-muted-foreground">Referred user প্রথমবার কিনলে বোনাস</p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSaveRef} disabled={savingRef || !hasRefChanges} size="sm" className="gap-2">
              {savingRef ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Referral Settings
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <DollarSign className="h-5 w-5 text-primary" />
            Dollar Rate (BDT)
          </CardTitle>
          <CardDescription>
            bKash পেমেন্টের জন্য ডলার রেট সেট করো। এই রেট অনুযায়ী BDT-তে price দেখাবে।
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bdt-rate">1 USD = ? BDT</Label>
            <Input
              id="bdt-rate"
              type="number"
              step="0.5"
              min="1"
              value={bdtRate}
              onChange={(e) => setBdtRate(e.target.value)}
              placeholder="125"
            />
            <p className="text-xs text-muted-foreground">
              Example: Rate 125 হলে $10 প্রোডাক্ট = ১,২৫০ টাকা দেখাবে bKash এ
            </p>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSaveBdt} disabled={savingBdt || !hasBdtChanges} size="sm" className="gap-2">
              {savingBdt ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Rate
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default BotSettingsTab;
