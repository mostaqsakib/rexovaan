import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Plus, Trash2, Save, FormInput, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

type FieldType = 'email' | 'username' | 'password' | 'text';
interface InputField { key: string; label: string; type: FieldType; required: boolean }
interface ProductRow {
  id: string;
  name: string;
  is_active: boolean;
  is_manual_delivery: boolean;
  customer_input_fields: InputField[] | null;
}

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'field';

const CustomerInputsTab = () => {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fields, setFields] = useState<InputField[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('bot_products')
      .select('id, name, is_active, is_manual_delivery, customer_input_fields')
      .eq('is_active', true)
      .order('sort_order');
    const rows = (data || []) as unknown as ProductRow[];
    setProducts(rows);
    if (rows.length && !selectedId) setSelectedId(rows[0].id);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    const p = products.find(p => p.id === selectedId);
    setFields(Array.isArray(p?.customer_input_fields) ? p!.customer_input_fields! : []);
  }, [selectedId, products]);

  const addField = () => setFields([...fields, { key: `field_${fields.length + 1}`, label: '', type: 'text', required: true }]);
  const removeField = (i: number) => setFields(fields.filter((_, idx) => idx !== i));
  const updateField = (i: number, patch: Partial<InputField>) => {
    setFields(fields.map((f, idx) => idx === i ? { ...f, ...patch, key: patch.label !== undefined ? slugify(patch.label) : f.key } : f));
  };

  const save = async () => {
    if (!selectedId) return;
    for (const f of fields) {
      if (!f.label.trim()) { toast.error('All fields need a label'); return; }
    }
    setSaving(true);
    const { error } = await supabase
      .from('bot_products')
      .update({ customer_input_fields: fields as any })
      .eq('id', selectedId);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Customer inputs saved');
    await load();
  };

  const selected = products.find(p => p.id === selectedId);

  if (loading) return <div className="p-8 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <FormInput className="h-5 w-5 text-primary" />
        <h2 className="font-heading text-lg">Customer Inputs per Product</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Add fields the bot will collect from customers <b>before payment</b> (e.g. email for invites, username, password). Orders with inputs go to <b>Pending Deliveries</b> for manual processing.
      </p>

      <Card className="p-4 space-y-4">
        <div className="space-y-2">
          <Label>Product</Label>
          <Select value={selectedId || ''} onValueChange={setSelectedId}>
            <SelectTrigger><SelectValue placeholder="Select a product" /></SelectTrigger>
            <SelectContent>
              {products.map(p => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} {p.is_manual_delivery ? '✋' : '📦'} {Array.isArray(p.customer_input_fields) && p.customer_input_fields.length > 0 ? `· ${p.customer_input_fields.length} input(s)` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selected && !selected.is_manual_delivery && fields.length > 0 && (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning-foreground">
            ⚠️ This product is <b>auto-delivery</b>. Customer inputs are useful for manual delivery products. Orders will still collect inputs but auto-deliver from stock.
          </div>
        )}

        <div className="space-y-3">
          {fields.length === 0 && (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No customer inputs configured. Click "Add Field" to require info before checkout.
            </div>
          )}
          {fields.map((f, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end p-3 rounded-md border border-border">
              <div className="col-span-12 md:col-span-5 space-y-1">
                <Label className="text-xs">Label (shown to customer)</Label>
                <Input value={f.label} onChange={(e) => updateField(i, { label: e.target.value })} placeholder="e.g. Netflix Email" />
              </div>
              <div className="col-span-6 md:col-span-3 space-y-1">
                <Label className="text-xs">Type</Label>
                <Select value={f.type} onValueChange={(v) => updateField(i, { type: v as FieldType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="username">Username / ID</SelectItem>
                    <SelectItem value="password">Password</SelectItem>
                    <SelectItem value="text">Free text</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-4 md:col-span-2 flex items-center gap-2">
                <Switch checked={f.required} onCheckedChange={(v) => updateField(i, { required: v })} />
                <span className="text-xs text-muted-foreground">Required</span>
              </div>
              <div className="col-span-2 md:col-span-2 flex justify-end">
                <Button variant="ghost" size="icon" onClick={() => removeField(i)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
              <div className="col-span-12 text-xs text-muted-foreground">key: <code>{f.key || slugify(f.label)}</code></div>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={addField} className="flex-1"><Plus className="h-4 w-4 mr-1" /> Add Field</Button>
          <Button onClick={save} disabled={saving || !selectedId} className="flex-1">
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />} Save
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default CustomerInputsTab;
