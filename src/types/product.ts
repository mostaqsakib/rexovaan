export interface Product {
  id: string;
  name: string;
  sheetTab: string;
  stockSource?: 'google_sheet' | 'internal';
  sheetGid?: number | null;
  detailColumns: string[];
  soldColumn: string;
  soldValue: string;
  price: number;
  stock: number;
  status: 'loaded' | 'loading' | 'error';
  isManualDelivery?: boolean;
  isActive?: boolean;
  description?: string | null;
  deliveryInstruction?: string | null;
  deliveryMedia?: { url: string; type: 'image' | 'video' }[] | null;
}

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  details: Record<string, string>[];
  rowNumbers: number[];
  orderedAt: string;
}
