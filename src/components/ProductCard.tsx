import { ShoppingCart, Minus, Plus, CheckCircle, Loader2, Copy, FileText, FileSpreadsheet } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import type { Product, OrderItem } from '@/types/product';
import { getCopyText, getTxtContent, getCsvContent, getFileName, downloadFile } from '@/lib/orderExport';

interface ProductCardProps {
  product: Product;
  onOrder: (productId: string, quantity: number) => Promise<OrderItem | null>;
}

const ProductCard = ({ product, onOrder }: ProductCardProps) => {
  const [quantity, setQuantity] = useState<number | string>(1);
  const [loading, setLoading] = useState(false);
  const [lastOrder, setLastOrder] = useState<OrderItem | null>(null);

  const numQty = typeof quantity === 'number' ? quantity : (parseInt(String(quantity)) || 1);
  const handleDecrement = () => setQuantity(Math.max(1, numQty - 1));
  const handleIncrement = () => setQuantity(Math.min(product.stock, numQty + 1));

  const handleOrder = async () => {
    setLoading(true);
    try {
      const order = await onOrder(product.id, numQty);
      if (order) {
        setLastOrder(order);
        setQuantity(1);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!lastOrder) return;
    navigator.clipboard.writeText(getCopyText(lastOrder));
    toast.success('Copied!');
  };

  const handleDownloadTxt = () => {
    if (!lastOrder) return;
    downloadFile(getTxtContent(lastOrder), `${getFileName(lastOrder)}.txt`, 'text/plain');
  };

  const handleDownloadCsv = () => {
    if (!lastOrder) return;
    downloadFile(getCsvContent(lastOrder), `${getFileName(lastOrder)}.csv`, 'text/csv');
  };

  const handleNewOrder = () => {
    setLastOrder(null);
  };

  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-md">
      <CardContent className="p-5">
        <div className="mb-3 flex items-start justify-between">
          <h3 className="font-heading text-lg font-semibold text-foreground">{product.name}</h3>
          <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
            {product.sheetTab}
          </code>
        </div>

        {product.status === 'loading' ? (
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading...
          </div>
        ) : product.stock <= 10 ? (
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive">
            <CheckCircle className="h-3 w-3" />
            {product.stock} In Stock
          </div>
        ) : product.stock <= 50 ? (
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
            <CheckCircle className="h-3 w-3" />
            {product.stock} In Stock
          </div>
        ) : (
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-medium text-success">
            <CheckCircle className="h-3 w-3" />
            {product.stock} In Stock
          </div>
        )}

        {lastOrder ? (
          <>
            {/* Order result view */}
            <ScrollArea className="mb-3 max-h-60 rounded-lg border border-border bg-muted/30 p-3">
              <div className="space-y-3">
                {lastOrder.details.map((detail, i) => (
                  <div key={i} className="space-y-0.5">
                    {Object.values(detail).map((val, vIdx) => (
                      <p key={vIdx} className="font-mono text-xs text-foreground break-all leading-relaxed">
                        {val}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="mb-3 flex items-center gap-1">
              <Button variant="ghost" size="sm" className="gap-1 text-xs h-8" onClick={handleCopy}>
                <Copy className="h-3.5 w-3.5" /> Copy
              </Button>
              <Button variant="ghost" size="sm" className="gap-1 text-xs h-8" onClick={handleDownloadTxt}>
                <FileText className="h-3.5 w-3.5" /> TXT
              </Button>
              <Button variant="ghost" size="sm" className="gap-1 text-xs h-8" onClick={handleDownloadCsv}>
                <FileSpreadsheet className="h-3.5 w-3.5" /> CSV
              </Button>
            </div>

            <Button variant="outline" className="w-full gap-2 text-sm" onClick={handleNewOrder}>
              <ShoppingCart className="h-4 w-4" /> New Order
            </Button>
          </>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3">
              <span className="text-sm text-muted-foreground">Qty:</span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8 rounded-full" onClick={handleDecrement} disabled={numQty <= 1}>
                  <Minus className="h-3 w-3" />
                </Button>
                <input
                  type="number"
                  min={1}
                  max={product.stock}
                  value={quantity}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === '') { setQuantity(''); return; }
                    const val = parseInt(raw);
                    if (!isNaN(val)) setQuantity(Math.min(product.stock, val));
                  }}
                  onBlur={() => {
                    if (quantity === '' || numQty < 1) setQuantity(1);
                  }}
                  className="flex h-8 w-16 items-center justify-center rounded-lg border border-input bg-card text-center text-sm font-medium outline-none focus:ring-1 focus:ring-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <Button variant="outline" size="icon" className="h-8 w-8 rounded-full" onClick={handleIncrement} disabled={numQty >= product.stock}>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <Button
              className="w-full gap-2 text-sm"
              onClick={handleOrder}
              disabled={product.status === 'loading' || product.stock === 0 || loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
              Place Order
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default ProductCard;
