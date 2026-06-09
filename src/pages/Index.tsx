import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import type { OrderItem } from '@/types/product';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';
import CustomerInputsTab from '@/components/CustomerInputsTab';
import PendingDeliveriesTab from '@/components/PendingDeliveriesTab';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import Header from '@/components/Header';
import AppSidebar from '@/components/AppSidebar';
import WebOrdersTab from '@/components/WebOrdersTab';
import ProductsTab from '@/components/ProductsTab';
import HistoryTab from '@/components/HistoryTab';

import CustomersTab from '@/components/CustomersTab';
import WithdrawalsTab from '@/components/WithdrawalsTab';
import DepositsTab from '@/components/DepositsTab';
import PricingTab from '@/components/PricingTab';
import SpecialPricingTab from '@/components/SpecialPricingTab';
import PaymentMethodsTab from '@/components/PaymentMethodsTab';
import ButtonEmojisTab from '@/components/ButtonEmojisTab';
import BotSettingsTab from '@/components/BotSettingsTab';
import ReferralStatsTab from '@/components/ReferralStatsTab';
import ResellersTab from '@/components/ResellersTab';
import GroupsKeywordsTab from '@/components/GroupsKeywordsTab';
import SourcesTab from '@/components/SourcesTab';
import FlashSalesTab from '@/components/FlashSalesTab';
import AnnouncementsTab from '@/components/AnnouncementsTab';
import BroadcastDialog from '@/components/BroadcastDialog';
import AddProductDialog from '@/components/AddProductDialog';
import { useProductStore } from '@/store/useProductStore';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import { toast } from 'sonner';

const TAB_TITLES: Record<string, string> = {
  'web-orders': 'Orders',
  products: 'Products',
  stock: 'Stock Manager',
  pricing: 'Pricing',
  'special-pricing': 'Special Pricing',
  flash: 'Flash Sales',
  pending: 'Pending Deliveries',
  inputs: 'Customer Inputs',
  history: 'Order History',
  
  customers: 'Customers',
  withdrawals: 'Withdrawals',
  deposits: 'Deposits',
  payments: 'Payment Methods',
  emojis: 'Button Emojis',
  referrals: 'Referrals',
  resellers: 'Resellers',
  groups: 'Groups & Keywords',
  sources: 'Product Sources',
  announcements: 'Site Notices',
  settings: 'Bot Settings',
};

const Index = () => {
  const { isAuthorized, isLoading, user, isTelegramWebApp } = useAdminAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('web-orders');
  const [pendingCount, setPendingCount] = useState(0);
  const { products, orderHistory, addProduct, removeProduct, refreshStock, placeOrder, restoreOrder } = useProductStore();

  useEffect(() => {
    if (!isAuthorized) return;
    supabase.from('bot_products').select('*').order('sort_order').then(async ({ data }) => {
      if (data && data.length > 0) {
        const store = useProductStore.getState();
        const dbProducts = data.map(d => {
          const localProduct = store.products.find(p => p.sheetTab === d.sheet_tab);
          let parsedMedia: Array<{ type: 'image' | 'video'; url: string }> = [];
          try { parsedMedia = typeof d.delivery_media === 'string' ? JSON.parse(d.delivery_media) : d.delivery_media || []; } catch {}
          return {
            id: d.id,
            name: d.name,
            sheetTab: d.sheet_tab,
            stockSource: 'internal' as const,
            sheetGid: (d as any).sheet_gid ?? null,
            detailColumns: d.detail_columns || [],
            soldColumn: d.sold_column,
            soldValue: d.sold_value,
            price: Number(d.price) || 0,
            stock: localProduct?.stock ?? 0,
            status: localProduct?.status ?? ('loading' as const),
            deliveryInstruction: d.delivery_instruction,
            deliveryMedia: parsedMedia,
            description: d.description,
            isManualDelivery: d.is_manual_delivery,
            isActive: d.is_active ?? true,
          };
        });
        useProductStore.setState({ products: dbProducts });
      }
      void refreshStock();
    });
  }, [isAuthorized]);

  const fetchPendingCount = async () => {
    const { count } = await supabase
      .from('bot_orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending_delivery');
    setPendingCount(count || 0);
  };
  useEffect(() => {
    if (!isAuthorized) return;
    void fetchPendingCount();
  }, [isAuthorized]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="relative mx-auto h-12 w-12">
            <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl animate-pulse" />
            <Loader2 className="relative h-12 w-12 animate-spin text-primary mx-auto" />
          </div>
          <p className="text-muted-foreground text-sm">Verifying access…</p>
        </div>
      </div>
    );
  }

  if (!isAuthorized) {
    return <Navigate to="/admin/login" replace />;
  }


  const handleOrder = async (productId: string, quantity: number): Promise<OrderItem | null> => {
    const product = products.find((p) => p.id === productId);
    if (!product) return null;
    try {
      const order = await placeOrder(productId, quantity);
      if (order) toast.success(`${product.name} - ${quantity} item(s) ordered!`);
      return order;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Order failed');
      return null;
    }
  };

  const handleAddProduct = (data: { name: string; sheetTab: string; stockSource?: 'google_sheet' | 'internal'; sheetGid: number | null; detailColumns: string[]; soldColumn: string; soldValue: string; price: number; isManualDelivery?: boolean }) => {
    addProduct(data);
    toast.success(`${data.name} added successfully!`);
    setTimeout(() => {
      const latest = useProductStore.getState().products;
      const newProduct = latest[latest.length - 1];
      if (newProduct) void refreshStock(newProduct.id);
    }, 100);
  };

  const handleRefresh = () => { toast.info('Refreshing...'); void refreshStock(); void fetchPendingCount(); };

  return (
    <SidebarProvider defaultOpen>
      <div className="min-h-screen flex w-full">
        <AppSidebar activeTab={activeTab} onChange={setActiveTab} pendingCount={pendingCount} />
        <SidebarInset className="bg-transparent">
          <Header
            onAddProduct={() => setDialogOpen(true)}
            onRefresh={handleRefresh}
            onBroadcast={() => setBroadcastOpen(true)}
            telegramUser={isTelegramWebApp ? user : null}
            title={TAB_TITLES[activeTab] || 'Console'}
          />
          <main className="flex-1 min-w-0 px-3 py-4 sm:px-4 sm:py-6 md:px-6 md:py-8 max-w-[1400px] w-full mx-auto overflow-x-auto">
            {activeTab === 'web-orders' && <WebOrdersTab />}
            {activeTab === 'products' && <ProductsTab products={products} onRemove={removeProduct} onReorder={(reordered) => useProductStore.setState({ products: reordered })} onStockChanged={(productId) => void refreshStock(productId)} />}
            {activeTab === 'stock' && <ProductsTab products={products} onRemove={removeProduct} onStockChanged={(productId) => void refreshStock(productId)} stockOnly />}
            {activeTab === 'pricing' && <PricingTab products={products} />}
            {activeTab === 'special-pricing' && <SpecialPricingTab />}
            {activeTab === 'flash' && <FlashSalesTab />}
            {activeTab === 'pending' && <PendingDeliveriesTab />}
            {activeTab === 'inputs' && <CustomerInputsTab />}
            {activeTab === 'history' && <HistoryTab orders={orderHistory} onRestore={async (order) => { try { await restoreOrder(order); toast.success(`${order.productName} - ${order.quantity} item(s) restored!`); } catch (err) { toast.error(err instanceof Error ? err.message : 'Restore failed'); } }} />}
            
            {activeTab === 'customers' && <CustomersTab />}
            {activeTab === 'withdrawals' && <WithdrawalsTab />}
            {activeTab === 'deposits' && <DepositsTab />}
            {activeTab === 'payments' && <PaymentMethodsTab />}
            {activeTab === 'emojis' && <ButtonEmojisTab />}
            {activeTab === 'referrals' && <ReferralStatsTab />}
            {activeTab === 'resellers' && <ResellersTab />}
            {activeTab === 'groups' && <GroupsKeywordsTab products={products} />}
            {activeTab === 'sources' && <SourcesTab />}
            {activeTab === 'announcements' && <AnnouncementsTab />}
            {activeTab === 'settings' && <BotSettingsTab />}
          </main>
        </SidebarInset>
      </div>
      {dialogOpen && <AddProductDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onAdd={handleAddProduct} existingSheetTabs={products.map(p => p.sheetTab)} />}
      {broadcastOpen && <BroadcastDialog open={broadcastOpen} onClose={() => setBroadcastOpen(false)} />}
    </SidebarProvider>
  );
};

export default Index;
