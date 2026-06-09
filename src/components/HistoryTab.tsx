import { useState } from 'react';
import { ChevronRight, ChevronDown, Copy, FileText, FileSpreadsheet, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { OrderItem } from '@/types/product';
import { getCopyText, getTxtContent, getCsvContent, getFileName, downloadFile } from '@/lib/orderExport';

interface HistoryTabProps {
  orders: OrderItem[];
  onRestore?: (order: OrderItem) => void;
}

const HistoryTab = ({ orders, onRestore }: HistoryTabProps) => {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (orders.length === 0) {
    return (
      <div className="py-20 text-center">
        <p className="text-lg text-muted-foreground">No orders yet.</p>
      </div>
    );
  }

  const formatRowRange = (order: OrderItem) => {
    const rows = order.rowNumbers || [];
    if (rows.length === 0) return '';
    if (rows.length === 1) return `#${rows[0]}`;
    const sorted = [...rows].sort((a, b) => a - b);
    return `#${sorted[0]}-#${sorted[sorted.length - 1]}`;
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ', ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  const handleCopy = (order: OrderItem) => {
    navigator.clipboard.writeText(getCopyText(order));
    toast.success('Copied to clipboard!');
  };

  const handleDownloadTxt = (order: OrderItem) => {
    downloadFile(getTxtContent(order), `${getFileName(order)}.txt`, 'text/plain');
  };

  const handleDownloadCsv = (order: OrderItem) => {
    downloadFile(getCsvContent(order), `${getFileName(order)}.csv`, 'text/csv');
  };

  return (
    <div className="space-y-2">
      {orders.map((order, idx) => {
        const isExpanded = expandedIdx === idx;
        return (
          <div key={idx} className="rounded-lg border border-border bg-card overflow-hidden">
            {/* Header row */}
            <button
              type="button"
              className="flex w-full items-center gap-2 flex-wrap px-4 py-3.5 text-left transition-colors hover:bg-muted/50"
              onClick={() => setExpandedIdx(isExpanded ? null : idx)}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <Badge variant="secondary" className="font-medium">
                {order.productName}
              </Badge>
              <span className="font-mono text-sm text-muted-foreground">
                {formatRowRange(order)}
              </span>
              <span className="text-sm font-semibold text-foreground">
                x{order.quantity}
              </span>
              <span className="ml-auto text-sm text-muted-foreground whitespace-nowrap">
                {formatDate(order.orderedAt)}
              </span>
            </button>

            {/* Expanded details */}
            {isExpanded && order.details && order.details.length > 0 && (
              <div className="border-t border-border bg-muted/30 px-4 py-4">
                <div className="space-y-4">
                  {order.details.map((detail, dIdx) => (
                    <div key={dIdx} className="space-y-1">
                      {Object.entries(detail).map(([key, val]) => (
                        <p key={key} className="font-mono text-sm text-foreground break-all">
                          {val}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>

                {/* Action buttons */}
                <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={() => handleCopy(order)}>
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </Button>
                    <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={() => handleDownloadTxt(order)}>
                      <FileText className="h-3.5 w-3.5" /> TXT
                    </Button>
                    <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={() => handleDownloadCsv(order)}>
                      <FileSpreadsheet className="h-3.5 w-3.5" /> CSV
                    </Button>
                  </div>
                  {onRestore && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-xs text-warning hover:text-warning"
                      onClick={() => onRestore(order)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Restore
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default HistoryTab;
