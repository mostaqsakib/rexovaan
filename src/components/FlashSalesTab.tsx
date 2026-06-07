import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Flame, X, Megaphone, Save, Trash2 } from 'lucide-react';

interface Product { id: string; name: string; price: number; }
interface FlashSale {
  id: string;
  product_id: string;
  sale_price: number;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  announcement_messages: any;
  target_group_ids: number[] | null;
  broadcast_attempted?: boolean;
}
interface Group { chat_id: number; title: string | null; }

const FlashSalesTab = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<FlashSale[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [feedGroupId, setFeedGroupId] = useState<string>('');
  const [origFeedGroupId, setOrigFeedGroupId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [savingFeed, setSavingFeed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Form state
  const [productId, setProductId] = useState<string>('');
  const [salePrice, setSalePrice] = useState<string>('');
  const [duration, setDuration] = useState<string>('1');
  const [durationUnit, setDurationUnit] = useState<'minutes' | 'hours' | 'days'>('hours');
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);
  const [sendToInbox, setSendToInbox] = useState(false);
  const [digitEmojis, setDigitEmojis] = useState<Record<string, string>>({});

  useEffect(() => { void fetchAll(); }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Auto-refetch every 5s so bot-side broadcast/end status reflects in UI
  useEffect(() => {
    const t = setInterval(() => { void fetchAll(); }, 5000);
    return () => clearInterval(t);
  }, []);

  const fetchAll = async () => {
    const [{ data: prods }, { data: salesData }, { data: groupsData }, { data: setting }, { data: digitSetting }] = await Promise.all([
      supabase.from('bot_products').select('id, name, price').eq('is_active', true).order('sort_order'),
      supabase.from('bot_flash_sales').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('bot_broadcast_groups').select('chat_id, title').eq('is_active', true).order('created_at', { ascending: false }),
      supabase.from('bot_settings').select('value').eq('key', 'recent_sales_group_id').maybeSingle(),
      supabase.from('bot_settings').select('value').eq('key', 'countdown_digit_emojis').maybeSingle(),
    ]);
    setProducts((prods || []) as Product[]);
    setSales((salesData || []) as FlashSale[]);
    setGroups((groupsData || []) as Group[]);
    const v = setting?.value || '';
    setFeedGroupId(v);
    setOrigFeedGroupId(v);
    try { setDigitEmojis(digitSetting?.value ? JSON.parse(digitSetting.value) : {}); } catch { setDigitEmojis({}); }
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!productId) return toast.error('Pick a product');
    const price = parseFloat(salePrice);
    const num = parseInt(duration);
    if (isNaN(price) || price < 0) return toast.error('Invalid sale price');
    if (isNaN(num) || num < 1) return toast.error('Invalid duration');
    const multiplier = durationUnit === 'days' ? 1440 : durationUnit === 'hours' ? 60 : 1;
    const mins = num * multiplier;
    if (mins > 10080) return toast.error('Max duration is 7 days');
    if (!sendToInbox && selectedGroupIds.length === 0) return toast.error('Pick customer inbox and/or at least one group');
    setCreating(true);
    const endsAt = new Date(Date.now() + mins * 60 * 1000).toISOString();
    // Encode targets: sentinel 0 = customer inbox (DMs); other numbers = group chat_ids.
    const targets: number[] = [
      ...(sendToInbox ? [0] : []),
      ...selectedGroupIds,
    ];
    const { error } = await supabase.from('bot_flash_sales').insert({
      product_id: productId,
      sale_price: price,
      starts_at: new Date().toISOString(),
      ends_at: endsAt,
      is_active: true,
      announcement_messages: [],
      target_group_ids: targets,
    });
    if (error) toast.error(error.message);
    else {
      toast.success(`Flash sale created! Broadcasting to ${sendToInbox ? 'inbox + ' : ''}${selectedGroupIds.length} group(s) within 5s.`);
      setProductId(''); setSalePrice(''); setDuration('1'); setSelectedGroupIds([]); setSendToInbox(false);
      void fetchAll();
    }
    setCreating(false);
  };

  const handleEnd = async (id: string) => {
    if (!confirm('End this flash sale now?')) return;
    const { error } = await supabase.from('bot_flash_sales').update({
      ends_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success('Sale will end within 5s'); void fetchAll(); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this flash sale and remove ALL broadcast messages from every chat? This cannot be undone.')) return;
    const { error } = await supabase.from('bot_flash_sales').update({
      pending_delete: true,
      is_active: false,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success('Deleting… broadcast messages will be removed within 5s'); void fetchAll(); }
  };

  const upsertSetting = async (key: string, value: string) => {
    const { data: existing } = await supabase.from('bot_settings').select('id').eq('key', key).maybeSingle();
    if (existing) {
      return supabase.from('bot_settings').update({ value, updated_at: new Date().toISOString() }).eq('key', key);
    }
    return supabase.from('bot_settings').insert({ key, value });
  };

  const handleSaveFeed = async () => {
    setSavingFeed(true);
    const { error } = await upsertSetting('recent_sales_group_id', feedGroupId);
    if (error) toast.error(error.message);
    else { toast.success('Recent Sales Feed updated'); setOrigFeedGroupId(feedGroupId); }
    setSavingFeed(false);
  };

  const fmtCountdown = (endsAt: string) => {
    const ms = new Date(endsAt).getTime() - now;
    if (ms <= 0) return 'Ended';
    const t = Math.floor(ms / 1000);
    const h = String(Math.floor(t / 3600)).padStart(2, '0');
    const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
    const s = String(t % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  const productName = (id: string) => products.find(p => p.id === id)?.name || id.slice(0, 8);

  if (loading) {
    return <div className="flex items-center justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  const activeSales = sales.filter(s => s.is_active && new Date(s.ends_at).getTime() > now);
  const pastSales = sales.filter(s => !activeSales.includes(s));

  return (
    <div className="space-y-6">
      {/* Create Flash Sale */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Flame className="h-5 w-5 text-orange-500" />Create Flash Sale</CardTitle>
          <CardDescription>Set a temporary discounted price. Pricing override applies instantly. To broadcast the announcement with live countdown, use the bot: <code className="text-xs bg-muted px-1 rounded">/admin → 🔥 Flash Sales</code></CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Product</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger><SelectValue placeholder="Pick a product" /></SelectTrigger>
                <SelectContent>
                  {products.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name} (${Number(p.price).toFixed(2)})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Sale Price ($)</Label>
              <Input type="number" step="0.01" min="0" value={salePrice} onChange={e => setSalePrice(e.target.value)} placeholder="9.99" />
            </div>
            <div className="space-y-2">
              <Label>Duration</Label>
              <div className="flex gap-2">
                <Input type="number" min="1" value={duration} onChange={e => setDuration(e.target.value)} className="flex-1" />
                <Select value={durationUnit} onValueChange={(v) => setDurationUnit(v as 'minutes' | 'hours' | 'days')}>
                  <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes">Minutes</SelectItem>
                    <SelectItem value="hours">Hours</SelectItem>
                    <SelectItem value="days">Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">Max 7 days</p>
            </div>
          </div>

          {/* Broadcast targets */}
          <div className="space-y-3 border-t border-border pt-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <Label className="text-sm font-medium">Auto-broadcast targets</Label>
              <div className="flex gap-3 text-xs">
                <button type="button" className="text-primary hover:underline" onClick={() => setSelectedGroupIds(groups.map(g => Number(g.chat_id)))}>Select all groups</button>
                <button type="button" className="text-muted-foreground hover:underline" onClick={() => setSelectedGroupIds([])}>Clear groups</button>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer p-2 border border-border rounded-md hover:bg-muted/50">
              <Checkbox checked={sendToInbox} onCheckedChange={(c) => setSendToInbox(!!c)} />
              <span>📨 Customer Inbox (DM all bot users)</span>
            </label>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Pick groups (test on a demo group first ✅):</p>
              {groups.length === 0 ? (
                <p className="text-xs text-muted-foreground">No connected broadcast groups. Add the bot to a group first.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-48 overflow-auto border border-border rounded-md p-3">
                  {groups.map(g => {
                    const id = Number(g.chat_id);
                    const checked = selectedGroupIds.includes(id);
                    return (
                      <label key={id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 p-1 rounded">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(c) => {
                            setSelectedGroupIds(prev => c ? [...prev, id] : prev.filter(x => x !== id));
                          }}
                        />
                        <span className="truncate">{g.title || `Group ${id}`}</span>
                      </label>
                    );
                  })}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Selected: {sendToInbox ? 'Inbox + ' : ''}{selectedGroupIds.length} group(s)
              </p>
            </div>
          </div>

          <Button onClick={handleCreate} disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Flame className="h-4 w-4 mr-2" />}
            Create Flash Sale
          </Button>
        </CardContent>
      </Card>

      {/* Active Sales */}
      <Card>
        <CardHeader>
          <CardTitle>Active Flash Sales ({activeSales.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {activeSales.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active flash sales.</p>
          ) : (
            <div className="space-y-2">
              {activeSales.map(s => (
                <div key={s.id} className="flex items-center justify-between gap-3 p-3 border border-border rounded-md">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{productName(s.product_id)}</div>
                    <div className="text-xs text-muted-foreground">
                      Sale: <span className="text-orange-500 font-semibold">${Number(s.sale_price).toFixed(2)}</span>
                      {' • '}Ends in: <code className="text-foreground">{fmtCountdown(s.ends_at)}</code>
                      {Array.isArray(s.announcement_messages) && s.announcement_messages.length > 0 && (
                        <> {' • '}📤 {s.announcement_messages.length} broadcast(s)</>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => handleEnd(s.id)}>
                      <X className="h-4 w-4 mr-1" />End
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(s.id)}>
                      <Trash2 className="h-4 w-4 mr-1" />Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Past Sales */}
      {pastSales.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Past Sales</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-72 overflow-auto">
              {pastSales.slice(0, 20).map(s => (
                <div key={s.id} className="flex items-center justify-between gap-2 text-sm p-2 border-b border-border last:border-0">
                  <span className="truncate flex-1">{productName(s.product_id)} — ${Number(s.sale_price).toFixed(2)}</span>
                  <span className="text-xs text-muted-foreground hidden sm:inline">{new Date(s.ends_at).toLocaleString()}</span>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(s.id)} title="Delete & remove broadcasts">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Countdown Digit Emojis */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">🔢 Countdown Digit Emojis</CardTitle>
          <CardDescription>
            Replace plain countdown digits (e.g. <code className="text-xs bg-muted px-1 rounded">02:45:13</code>) with premium animated emojis from any pack like RetroFontEmoji.
            <br />
            Setup in bot: send <code className="text-xs bg-muted px-1 rounded">/setdigits</code> to your bot, then send <code className="text-xs bg-muted px-1 rounded">0123456789:</code> with each character replaced by its premium emoji.
            <br />
            Clear with <code className="text-xs bg-muted px-1 rounded">/resetdigits</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {Object.keys(digitEmojis).length === 0 ? (
            <p className="text-sm text-muted-foreground">⚪ Not set — countdowns use plain digits.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-green-600 font-medium">✅ Active — {Object.keys(digitEmojis).length} mapped</p>
              <div className="grid grid-cols-6 md:grid-cols-11 gap-2 text-xs">
                {['0','1','2','3','4','5','6','7','8','9',':'].map(k => (
                  <div key={k} className="border border-border rounded p-2 text-center">
                    <div className="font-mono text-base">{k}</div>
                    <div className="text-[10px] text-muted-foreground truncate" title={digitEmojis[k] || 'missing'}>
                      {digitEmojis[k] ? '✓' : '—'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Sales Feed */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Megaphone className="h-5 w-5" />Recent Sales Feed</CardTitle>
          <CardDescription>Anonymous "someone just bought" notifications sent to a group on every purchase. No buyer info shared.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Target Group</Label>
            <Select value={feedGroupId || 'none'} onValueChange={(v) => setFeedGroupId(v === 'none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Disabled" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Disabled —</SelectItem>
                {groups.map(g => (
                  <SelectItem key={g.chat_id} value={String(g.chat_id)}>
                    {g.title || `Group ${g.chat_id}`} ({g.chat_id})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {groups.length === 0 && (
              <p className="text-xs text-muted-foreground">No connected broadcast groups. Add the bot to a group first via /start in the group.</p>
            )}
          </div>
          <Button onClick={handleSaveFeed} disabled={savingFeed || feedGroupId === origFeedGroupId}>
            {savingFeed ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default FlashSalesTab;
