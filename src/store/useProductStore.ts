import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Product, OrderItem } from '@/types/product';
import { supabase } from '@/integrations/supabase/client';

let fullRefreshPromise: Promise<void> | null = null;
const productRefreshPromises = new Map<string, Promise<void>>();

interface ProductStore {
  products: Product[];
  orderHistory: OrderItem[];
  addProduct: (product: Omit<Product, 'id' | 'stock' | 'status'> & { sheetGid?: number | null }) => void;
  removeProduct: (id: string) => void;
  updateStock: (id: string, stock: number) => void;
  updateStatus: (id: string, status: Product['status']) => void;
  updatePrice: (id: string, price: number) => void;
  addOrder: (order: OrderItem) => void;
  refreshStock: (productId?: string) => Promise<void>;
  placeOrder: (productId: string, quantity: number) => Promise<OrderItem | null>;
  restoreOrder: (order: OrderItem) => Promise<void>;
  removeOrder: (orderedAt: string) => void;
}

export const useProductStore = create<ProductStore>()(
  persist(
    (set, get) => ({
      products: [
        {
          id: '1',
          name: 'Quillbot',
          sheetTab: 'Quillbot',
          detailColumns: ['Original Link'],
          soldColumn: 'Sold/Unsold',
          soldValue: 'SOLD',
          price: 0,
          stock: 0,
          status: 'loading' as const,
        },
        {
          id: '2',
          name: 'Career 3m Login',
          sheetTab: 'Career 3m Login',
          detailColumns: ['Original Link', 'Coupon Code'],
          soldColumn: 'Sold/Unsold',
          soldValue: 'SOLD',
          price: 0,
          stock: 0,
          status: 'loading' as const,
        },
        {
          id: '3',
          name: 'Own Login Career 12m',
          sheetTab: 'Own Login Career 12m',
          detailColumns: ['Original Link'],
          soldColumn: 'Sold/Unsold',
          soldValue: 'SOLD',
          price: 0,
          stock: 0,
          status: 'loading' as const,
        },
        {
          id: '4',
          name: 'Freepik Credit 45k',
          sheetTab: 'Freepik Credit 45k',
          detailColumns: ['Original Link'],
          soldColumn: 'Sold/Unsold',
          soldValue: 'SOLD',
          price: 0,
          stock: 0,
          status: 'loading' as const,
        },
      ],
      orderHistory: [],

      addProduct: (product) => {
        const id = crypto.randomUUID();
        const stockSource = 'internal' as const;
        const newProduct = { ...product, id, stock: 0, status: 'loading' as const, price: product.price || 0, stockSource };
        set((state) => ({
          products: [...state.products, newProduct],
        }));
        supabase.from('bot_products').insert({
          id,
          name: product.name,
          sheet_tab: product.sheetTab,
          sheet_gid: product.sheetGid ?? null,
          stock_source: stockSource,
          is_manual_delivery: product.isManualDelivery || false,
          detail_columns: product.detailColumns,
          sold_column: product.soldColumn,
          sold_value: product.soldValue,
          price: product.price || 0,
          sort_order: get().products.length,
        }).then(({ error }) => {
          if (error) console.error('Failed to sync product to bot:', error);
        });
      },

      removeProduct: (id) => {
        set((state) => ({
          products: state.products.filter((p) => p.id !== id),
        }));
        // Remove from bot_products table
        supabase.from('bot_products').delete().eq('id', id).then(({ error }) => {
          if (error) console.error('Failed to remove product from bot:', error);
        });
      },

      updateStock: (id, stock) =>
        set((state) => ({
          products: state.products.map((p) => (p.id === id ? { ...p, stock } : p)),
        })),

      updateStatus: (id, status) =>
        set((state) => ({
          products: state.products.map((p) => (p.id === id ? { ...p, status } : p)),
        })),

      updatePrice: (id, price) => {
        set((state) => ({
          products: state.products.map((p) => (p.id === id ? { ...p, price } : p)),
        }));
        supabase.from('bot_products').update({ price }).eq('id', id).then(({ error }) => {
          if (error) console.error('Failed to sync price to bot:', error);
        });
      },

      addOrder: (order) =>
        set((state) => ({
          orderHistory: [order, ...state.orderHistory],
        })),

      refreshStock: async (productId?: string) => {
        if (productId) {
          const existingProductRefresh = productRefreshPromises.get(productId);
          if (existingProductRefresh) return existingProductRefresh;
        } else if (fullRefreshPromise) {
          return fullRefreshPromise;
        }

        const runRefresh = async () => {
        const { products } = get();
        const targets = productId
          ? products.filter((p) => p.id === productId && !p.isManualDelivery)
          : products.filter((p) => !p.isManualDelivery);

        if (targets.length === 0) return;

        // Only show loading for single product refresh (manual/new), not auto-refresh
        if (productId) {
          set((state) => ({
              products: state.products.map((p) =>
                targets.some((t) => t.id === p.id) ? { ...p, status: 'loading' as const } : p
              ),
          }));
        }

        const targetIds = new Set(targets.map((product) => product.id));

        try {
          const internalTargets = targets;
          const internalStockById = new Map<string, number>();

          if (internalTargets.length > 0) {
            const ids = internalTargets.map((p) => p.id);
            const { data, error } = await supabase.rpc('get_product_stock_counts', { _product_ids: ids });
            if (error) throw error;
            for (const row of (data || []) as Array<{ product_id: string; available_count: number }>) {
              internalStockById.set(row.product_id, Number(row.available_count) || 0);
            }
            // ensure products with 0 stock still get a value
            for (const id of ids) if (!internalStockById.has(id)) internalStockById.set(id, 0);
          }

          const unavailableIds = new Set<string>();
          const stockById = internalStockById;

          set((state) => ({
            products: state.products.map((p) => {
              if (!targetIds.has(p.id)) return p;

              if (unavailableIds.has(p.id)) {
                console.error(`Stock refresh was rate-limited for ${p.name}`);
                return { ...p, status: 'error' as const };
              }

              return { ...p, stock: stockById.get(p.id) ?? 0, status: 'loaded' as const };
            }),
          }));
        } catch (err) {
          console.error('Failed to refresh stock:', err);
          set((state) => ({
            products: state.products.map((p) =>
              targetIds.has(p.id) ? { ...p, status: 'error' as const } : p
            ),
          }));
        }
        };

        const refreshPromise = runRefresh().finally(() => {
          if (productId) {
            productRefreshPromises.delete(productId);
          } else {
            fullRefreshPromise = null;
          }
        });

        if (productId) {
          productRefreshPromises.set(productId, refreshPromise);
        } else {
          fullRefreshPromise = refreshPromise;
        }

        return refreshPromise;
      },

      placeOrder: async (productId: string, quantity: number) => {
        const { products } = get();
        const product = products.find((p) => p.id === productId);
        if (!product) return null;

        try {
          let details: Record<string, string>[] = [];
          let rowNumbers: number[] = [];
          let remainingStock = 0;

          const { data: invokeData, error } = await supabase.functions.invoke('admin-reserve-stock', {
            body: { product_id: productId, quantity },
          });
          if (error) throw error;
          if ((invokeData as any)?.error) throw new Error((invokeData as any).error);
          const reserved = (invokeData as any)?.items ?? [];
          details = (reserved || []).map((item: any) => item.data as Record<string, string>);
          if (details.length < quantity) throw new Error(`Only ${details.length} items available, requested ${quantity}`);
          remainingStock = Math.max(0, product.stock - quantity);

          // Update local stock
          set((state) => ({
            products: state.products.map((p) =>
              p.id === productId ? { ...p, stock: remainingStock } : p
            ),
          }));

          const order: OrderItem = {
            productId,
            productName: product.name,
            quantity,
            details,
            rowNumbers,
            orderedAt: new Date().toISOString(),
          };

          set((state) => ({
            orderHistory: [order, ...state.orderHistory],
          }));

          return order;
        } catch (err) {
          console.error(`Failed to place order for ${product.name}:`, err);
          throw err;
        }
      },

      restoreOrder: async (order: OrderItem) => {
        const product = get().products.find((p) => p.id === order.productId);
        if (!product) throw new Error('Product not found');

        throw new Error('Internal stock restore is available from saved customer orders only.');

        // Remove from history
        set((state) => ({
          orderHistory: state.orderHistory.filter((o) => o.orderedAt !== order.orderedAt),
        }));

        // Refresh stock
        get().refreshStock(order.productId);
      },

      removeOrder: (orderedAt: string) =>
        set((state) => ({
          orderHistory: state.orderHistory.filter((o) => o.orderedAt !== orderedAt),
        })),
    }),
    { name: 'stock-manager-storage' }
  )
);
