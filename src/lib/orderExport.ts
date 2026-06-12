import type { OrderItem } from '@/types/product';

export const getFileName = (order: OrderItem) => {
  const rows = order.rowNumbers || [];
  if (rows.length === 0) return order.productName;
  const sorted = [...rows].sort((a, b) => a - b);
  return `${order.productName}-#${sorted[0]}-#${sorted[sorted.length - 1]}`;
};

const formatDetail = (detail: Record<string, string>, idx: number, total: number) => {
  const entries = Object.entries(detail).filter(([, v]) => v.trim());
  const prefix = total > 1 ? `${idx + 1}. ` : '';
  if (entries.length <= 1) {
    const mainVal = entries.find(([, v]) => v.startsWith('http'))?.[1] || entries[0]?.[1] || '';
    return `${prefix}${mainVal}`;
  }
  return `${prefix}${entries.map(([k, v]) => `${k}: ${v}`).join('\n')}`;
};

export const getCopyText = (order: OrderItem) => {
  return order.details.map((detail, i) => formatDetail(detail, i, order.details.length)).join('\n\n');
};

export const getTxtContent = (order: OrderItem) => {
  return order.details.map((detail, i) => formatDetail(detail, i, order.details.length)).join('\n\n');
};

export const getCsvContent = (order: OrderItem) => {
  if (!order.details?.length) return '';
  const headers = Object.keys(order.details[0]);
  if (order.details.length > 1) {
    const rows = [['No.', ...headers].join(',')];
    order.details.forEach((detail, i) => {
      const cols = headers.map(h => `"${(detail[h] || '').replace(/"/g, '""')}"`);
      rows.push([String(i + 1), ...cols].join(','));
    });
    return rows.join('\n');
  }
  const rows = [headers.join(',')];
  order.details.forEach((detail) => {
    const cols = headers.map(h => `"${(detail[h] || '').replace(/"/g, '""')}"`);
    rows.push(cols.join(','));
  });
  return rows.join('\n');
};

export const downloadFile = (content: string, filename: string, type: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};
