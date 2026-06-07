import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Check, Package, Tag, Hand } from 'lucide-react';

interface AddProductDialogProps {
  open: boolean;
  onClose: () => void;
  onAdd: (data: {
    name: string;
    sheetTab: string;
    stockSource?: 'google_sheet' | 'internal';
    sheetGid: number | null;
    detailColumns: string[];
    soldColumn: string;
    soldValue: string;
    price: number;
    isManualDelivery?: boolean;
  }) => void;
  existingSheetTabs?: string[];
}

const AddProductDialog = ({ open, onClose, onAdd }: AddProductDialogProps) => {
  const [name, setName] = useState('');
  const [isManualDelivery, setIsManualDelivery] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setIsManualDelivery(false);
    }
  }, [open]);

  const handleSubmit = () => {
    const productName = name.trim();
    if (!productName) return;

    onAdd({
      name: productName,
      sheetTab: productName,
      stockSource: 'internal',
      sheetGid: null,
      detailColumns: isManualDelivery ? [] : ['Delivery Info'],
      soldColumn: '',
      soldValue: '',
      price: 0,
      isManualDelivery,
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Add New Product
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            New products use internal stock only. Set prices in the <b>Pricing</b> tab and add stock from <b>Manage Stock</b>.
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Tag className="h-3.5 w-3.5" /> Product Name
            </Label>
            <Input placeholder="e.g. Quillbot" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <Label className="flex items-center gap-2 text-sm">
              <Hand className="h-4 w-4 text-warning" /> Manual delivery
            </Label>
            <Switch checked={isManualDelivery} onCheckedChange={setIsManualDelivery} />
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button className="flex-1" onClick={handleSubmit} disabled={!name.trim()}>
              <Check className="h-4 w-4 mr-1" /> Save Product
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AddProductDialog;
