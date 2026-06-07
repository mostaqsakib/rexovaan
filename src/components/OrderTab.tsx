import ProductCard from '@/components/ProductCard';
import type { Product, OrderItem } from '@/types/product';

interface OrderTabProps {
  products: Product[];
  onOrder: (productId: string, quantity: number) => Promise<OrderItem | null>;
}

const OrderTab = ({ products, onOrder }: OrderTabProps) => {
  const visible = products.filter((p) => p.isActive !== false);
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {visible.map((product) => (
        <ProductCard key={product.id} product={product} onOrder={onOrder} />
      ))}
      {visible.length === 0 && (
        <div className="col-span-full py-20 text-center">
          <p className="text-lg text-muted-foreground">No active products. Enable products from the Products tab.</p>
        </div>
      )}
    </div>
  );
};

export default OrderTab;
