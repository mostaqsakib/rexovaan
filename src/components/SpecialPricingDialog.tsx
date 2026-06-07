import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Loader2, Trash2, Tag, Plus } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  customerId: string | null;
  customerLabel: string;
  onClose: () => void;
}

interface Row {
  id: string;
  product_id: string;
  product_name: string;
  product_price: number;
  price: number;
  min_quantity: number;
  is_active: boolean;
  note: string | null;
}

interface Product {
  id: string;
  name: string;
  price: number;
}

const SpecialPricingDialog = ({ customerId, customerLabel, onClose }: Props) => {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [newProductId, setNewProductId] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newMoq, setNewMoq] = useState('1');
  const [newNote, setNewNote] = useState('');
  const [saving, setSaving] = useState(false);


  const load = async () => {
    if (!customerId) return;
    setLoading(true);
    const [{ data: special }, { data: prods }] = await Promise.all([
      supabase.from('bot_customer_pricing').select('id, product_id, price, min_quantity, is_active, note').eq('customer_id', customerId),
      supabase.from('bot_products').select('id, name, price').order('sort_order'),
    ]);
    const map = new Map((prods || []).map((p: Product) => [p.id, p]));
    setProducts(prods || []);
    setRows((special || []).map((r: any) => ({
      id: r.id,
      product_id: r.product_id,
      product_name: map.get(r.product_id)?.name || 'Unknown',
      product_price: Number(map.get(r.product_id)?.price ?? 0),
      price: Number(r.price),
      min_quantity: Number(r.min_quantity ?? 1),
      is_active: r.is_active !== false,
      note: r.note,
    })));
    setLoading(false);
  };

  useEffect(() => { void load(); }, [customerId]);

  const handleAdd = async () => {
    if (!customerId || !newProductId || !newPrice) return;
    const price = Number(newPrice);
    const moq = Math.max(1, Math.floor(Number(newMoq) || 1));
    if (!(price >= 0)) { toast.error('Invalid price'); return; }
    setSaving(true);
    const { error } = await supabase
      .from('bot_customer_pricing')
      .upsert(
        { customer_id: customerId, product_id: newProductId, price, min_quantity: moq, note: newNote.trim() || null },
        { onConflict: 'customer_id,product_id' }
      );
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Special price set');
    setNewProductId(''); setNewPrice(''); setNewMoq('1'); setNewNote('');
    void load();
  };

  const handleUpdate = async (id: string, price: number, minQuantity: number) => {
    if (!(price >= 0)) { toast.error('Invalid price'); return; }
    const moq = Math.max(1, Math.floor(minQuantity || 1));
    const { error } = await supabase.from('bot_customer_pricing').update({ price, min_quantity: moq, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Updated');
    void load();
  };


  const handleToggleActive = async (id: string, is_active: boolean) => {
    const { error } = await supabase.from('bot_customer_pricing').update({ is_active, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success(is_active ? 'Special price enabled' : 'Disabled — customer sees regular price');
    void load();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('bot_customer_pricing').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Removed — customer will see regular price');
    void load();
  };


  const usedIds = new Set(rows.map((r) => r.product_id));
  const availableProducts = products.filter((p) => !usedIds.has(p.id));

  return (
    <Dialog open={!!customerId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" /> Special Pricing — {customerLabel}
          </DialogTitle>
        </DialogHeader>

        <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
          Customer pays the special price regardless of bulk tiers. Set a <b>MOQ</b> (min quantity) to only apply the special when the customer orders at least that many; otherwise regular/tiered pricing is used. Flash sale wins only if it is cheaper.
        </div>

        {loading ? (
          <div className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
        ) : (
          <>
            <div className="space-y-2">
              {rows.length === 0 ? (
                <p className="text-center py-4 text-sm text-muted-foreground">No special prices set yet.</p>
              ) : rows.map((r) => (
                <RowItem key={r.id} row={r} onUpdate={handleUpdate} onDelete={handleDelete} onToggleActive={handleToggleActive} />
              ))}
            </div>

            <div className="mt-4 rounded-lg border border-dashed border-border p-3 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Add new</div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Product</label>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={newProductId}
                  onChange={(e) => setNewProductId(e.target.value)}
                >
                  <option value="">Select product…</option>
                  {availableProducts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} (regular ${Number(p.price).toFixed(2)})</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Special Price</label>
                  <Input
                    type="number" step="0.01" min="0"
                    placeholder="0.00"
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">MOQ (min qty)</label>
                  <Input
                    type="number" step="1" min="1"
                    placeholder="1"
                    title="Minimum order quantity for this special price to apply"
                    value={newMoq}
                    onChange={(e) => setNewMoq(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Note (optional)</label>
                <Input
                  placeholder="e.g. VIP customer, agreed discount"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">MOQ = minimum quantity. Use <b>1</b> to always apply. Higher values only apply on bulk orders.</p>
              <Button onClick={handleAdd} disabled={saving || !newProductId || !newPrice} className="w-full">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" />Add Special Price</>}
              </Button>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const RowItem = ({ row, onUpdate, onDelete, onToggleActive }: { row: Row; onUpdate: (id: string, price: number, minQuantity: number) => void; onDelete: (id: string) => void; onToggleActive: (id: string, is_active: boolean) => void }) => {
  const [val, setVal] = useState(row.price.toFixed(2));
  const [moq, setMoq] = useState(String(row.min_quantity));
  const dirty = Number(val) !== row.price || Math.max(1, Math.floor(Number(moq) || 1)) !== row.min_quantity;
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 ${!row.is_active ? 'opacity-60' : ''}`}>
      <div className="w-full sm:flex-1 sm:w-auto min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="font-semibold text-sm break-words">{row.product_name}</div>
          {!row.is_active && <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Disabled</span>}
        </div>
        <div className="text-xs text-muted-foreground">
          Regular: <span className="font-mono">${row.product_price.toFixed(2)}</span>
          {row.min_quantity > 1 && <span className="ml-2">· MOQ <b>{row.min_quantity}</b></span>}
          {row.note && <span className="ml-2 italic">— {row.note}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1.5" title={row.is_active ? 'Special price ON (toggle to disable)' : 'Special price OFF (toggle to enable)'}>
        <Switch checked={row.is_active} onCheckedChange={(v) => onToggleActive(row.id, !!v)} />
      </div>
      <Input
        type="number" step="0.01" min="0"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        className="w-24 font-mono"
        title="Special price"
      />
      <Input
        type="number" step="1" min="1"
        value={moq}
        onChange={(e) => setMoq(e.target.value)}
        className="w-16 font-mono"
        title="Minimum order quantity (MOQ)"
      />
      <Button size="sm" variant={dirty ? 'default' : 'outline'} disabled={!dirty} onClick={() => onUpdate(row.id, Number(val), Number(moq))}>
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={() => onDelete(row.id)}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
};


export default SpecialPricingDialog;
