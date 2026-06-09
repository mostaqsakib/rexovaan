import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Trash2, Save, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { Product } from '@/types/product';
import { useProductStore } from '@/store/useProductStore';

interface PricingTier {
  id?: string;
  product_id: string;
  min_quantity: number;
  max_quantity: number | null;
  price: number;
  isNew?: boolean;
}

interface PricingTabProps {
  products: Product[];
}

const PricingTab = ({ products: propProducts }: PricingTabProps) => {
  const [products, setProducts] = useState<Product[]>(propProducts);
  const [sourceMeta, setSourceMeta] = useState<Record<string, { sourcePrice: number | null; sourceName: string | null }>>({});
  const [tiers, setTiers] = useState<Record<string, PricingTier[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: dbProducts }, { data: srcs }] = await Promise.all([
      supabase.from('bot_products').select('id, name, sheet_tab, price, source_id, source_price, is_active').order('sort_order').eq('is_active', true),
      supabase.from('bot_product_sources').select('id, name'),
    ]);

    const srcNameMap = new Map((srcs || []).map((s: any) => [s.id, s.name]));
    const meta: Record<string, { sourcePrice: number | null; sourceName: string | null }> = {};
    const merged: Product[] = (dbProducts || []).map((d: any) => {
      meta[d.id] = {
        sourcePrice: d.source_id ? Number(d.source_price ?? 0) : null,
        sourceName: d.source_id ? (srcNameMap.get(d.source_id) || 'Source') : null,
      };
      return {
        id: d.id,
        name: d.name,
        sheetTab: d.sheet_tab,
        detailColumns: [],
        soldColumn: '',
        soldValue: '',
        price: Number(d.price) || 0,
        stock: 0,
        status: 'loaded' as const,
      };
    });
    setSourceMeta(meta);
    setProducts(merged);

    const { data, error } = await supabase
      .from('bot_product_pricing')
      .select('*')
      .order('min_quantity');

    if (error) {
      console.error('Failed to fetch pricing:', error);
      setLoading(false);
      return;
    }

    const grouped: Record<string, PricingTier[]> = {};
    for (const p of merged) {
      grouped[p.id] = (data || [])
        .filter((t: any) => t.product_id === p.id)
        .map((t: any) => ({
          id: t.id,
          product_id: t.product_id,
          min_quantity: t.min_quantity,
          max_quantity: t.max_quantity,
          price: Number(t.price),
        }));
    }
    setTiers(grouped);
    setLoading(false);
  };

  const addTier = (productId: string) => {
    setTiers((prev) => {
      const existing = prev[productId] || [];
      const lastMax = existing.length > 0
        ? (existing[existing.length - 1].max_quantity || existing[existing.length - 1].min_quantity)
        : 0;
      return {
        ...prev,
        [productId]: [
          ...existing,
          {
            product_id: productId,
            min_quantity: lastMax + 1,
            max_quantity: null,
            price: 0,
            isNew: true,
          },
        ],
      };
    });
  };

  const removeTier = async (productId: string, index: number) => {
    const tier = tiers[productId]?.[index];
    if (tier?.id) {
      await supabase.from('bot_product_pricing').delete().eq('id', tier.id);
    }
    setTiers((prev) => ({
      ...prev,
      [productId]: prev[productId].filter((_, i) => i !== index),
    }));
    toast.success('Pricing tier removed');
  };

  const updateTierField = (productId: string, index: number, field: keyof PricingTier, value: any) => {
    setTiers((prev) => ({
      ...prev,
      [productId]: prev[productId].map((t, i) =>
        i === index ? { ...t, [field]: value } : t
      ),
    }));
  };

  const savePricing = async (productId: string) => {
    const productTiers = tiers[productId] || [];
    if (productTiers.length === 0) {
      toast.error('Add at least one pricing tier');
      return;
    }

    setSaving(productId);

    // Delete all existing tiers for this product, then re-insert
    await supabase.from('bot_product_pricing').delete().eq('product_id', productId);

    const rows = productTiers.map((t) => ({
      product_id: productId,
      min_quantity: t.min_quantity,
      max_quantity: t.max_quantity,
      price: t.price,
    }));

    const { error } = await supabase.from('bot_product_pricing').insert(rows);
    if (error) {
      toast.error('Failed to save pricing');
      console.error(error);
    } else {
      // Also update the base price in bot_products (use first tier price)
      const basePrice = productTiers[0]?.price || 0;
      const currentPrice = products.find((product) => product.id === productId)?.price ?? basePrice;
      if (Number(currentPrice) !== Number(basePrice)) {
        const settingKey = `last_price_${productId}`;
        const { data: lastPriceRow } = await supabase
          .from('bot_settings')
          .select('key')
          .eq('key', settingKey)
          .maybeSingle();

        if (lastPriceRow) {
          await supabase
            .from('bot_settings')
            .update({ value: String(currentPrice), updated_at: new Date().toISOString() })
            .eq('key', settingKey);
        } else {
          await supabase
            .from('bot_settings')
            .insert({ key: settingKey, value: String(currentPrice) });
        }
      }
      await supabase.from('bot_products').update({ price: basePrice }).eq('id', productId);
      // Sync price into global product store so Stock page reflects the update
      useProductStore.setState((state) => ({
        products: state.products.map((p) => (p.id === productId ? { ...p, price: basePrice } : p)),
      }));
      toast.success('Pricing saved!');
      await fetchAll();
    }
    setSaving(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={fetchAll} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>
      {products.map((product) => {
        const productTiers = tiers[product.id] || [];
        const meta = sourceMeta[product.id];
        return (
          <Card key={product.id} className="border-border bg-card">
            <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-1 min-w-0">
                <CardTitle className="text-lg font-heading break-words">{product.name}</CardTitle>
                {meta?.sourcePrice !== null && meta?.sourcePrice !== undefined && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="px-2 py-0.5 rounded bg-primary/10 text-primary font-medium">
                      Source cost: {meta.sourcePrice.toFixed(2)} USDT
                    </span>
                    {meta.sourceName && <span className="text-muted-foreground">via {meta.sourceName}</span>}
                  </div>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={() => addTier(product.id)} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" /> Add Tier
                </Button>
                <Button
                  size="sm"
                  onClick={() => savePricing(product.id)}
                  disabled={saving === product.id}
                  className="gap-1.5"
                >
                  {saving === product.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Save
                </Button>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {productTiers.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No pricing set. Add a tier to set prices for this product.
                </p>
              ) : (
                <Table className="min-w-[520px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[140px]">Min Qty</TableHead>
                      <TableHead className="w-[140px]">Max Qty</TableHead>
                      <TableHead className="w-[160px]">Price (USDT)</TableHead>
                      <TableHead className="w-[80px] text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {productTiers.map((tier, idx) => (
                      <TableRow key={tier.id || `new-${idx}`}>
                        <TableCell>
                          <Input
                            type="number"
                            min={1}
                            value={tier.min_quantity || ''}
                            onChange={(e) => updateTierField(product.id, idx, 'min_quantity', parseInt(e.target.value) || 1)}
                            className="h-8 w-24 text-sm"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={tier.min_quantity}
                            value={tier.max_quantity ?? ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              updateTierField(product.id, idx, 'max_quantity', val === '' ? null : parseInt(val));
                            }}
                            placeholder="∞"
                            className="h-8 w-24 text-sm"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={tier.price || ''}
                            onChange={(e) => updateTierField(product.id, idx, 'price', parseFloat(e.target.value) || 0)}
                            className="h-8 w-28 text-sm"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:bg-destructive/10"
                            onClick={() => removeTier(product.id, idx)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

export default PricingTab;
