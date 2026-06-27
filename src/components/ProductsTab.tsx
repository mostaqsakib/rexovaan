import { useState, useEffect, useRef, useMemo } from 'react';
import { Trash2, Check, Pencil, ImagePlus, X, FileVideo, Bold, Italic, Code, Strikethrough, Underline, Link, Hand, GripVertical, Download, ArrowLeft, Package, Boxes, Paperclip, Upload, CalendarIcon, ChevronRight, ChevronDown, ShieldCheck, ShoppingCart, Globe2, AlertTriangle, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { Product } from '@/types/product';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';

interface ProductsTabProps {
  products: Product[];
  onRemove: (id: string) => void;
  onReorder?: (products: Product[]) => void;
  onStockChanged?: (productId: string) => void;
  stockOnly?: boolean;
}

interface MediaItem {
  url: string;
  type: 'image' | 'video';
}

const InstructionCell = ({ product }: { product: Product }) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(product.deliveryInstruction || '');
  const [savedValue, setSavedValue] = useState(product.deliveryInstruction || '');
  const [media, setMedia] = useState<MediaItem[]>((product.deliveryMedia as MediaItem[]) || []);
  const [savedMedia, setSavedMedia] = useState<MediaItem[]>((product.deliveryMedia as MediaItem[]) || []);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const wrapSelection = (openTag: string, closeTag: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = value.substring(start, end);
    const before = value.substring(0, start);
    const after = value.substring(end);
    const newValue = `${before}${openTag}${selected}${closeTag}${after}`;
    setValue(newValue);
    setTimeout(() => {
      ta.focus();
      if (selected) {
        ta.selectionStart = start;
        ta.selectionEnd = start + openTag.length + selected.length + closeTag.length;
      } else {
        ta.selectionStart = ta.selectionEnd = start + openTag.length;
      }
    }, 0);
  };

  useEffect(() => {
    setSavedValue(product.deliveryInstruction || '');
    setSavedMedia((product.deliveryMedia as MediaItem[]) || []);
    if (!editing) {
      setValue(product.deliveryInstruction || '');
      setMedia((product.deliveryMedia as MediaItem[]) || []);
    }
  }, [product.deliveryInstruction, product.deliveryMedia]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    const newMedia: MediaItem[] = [...media];

    for (const file of Array.from(files)) {
      const isVideo = file.type.startsWith('video/');
      const isImage = file.type.startsWith('image/');
      if (!isVideo && !isImage) {
        toast.error(`Unsupported file type: ${file.name}`);
        continue;
      }

      const ext = file.name.split('.').pop();
      const path = `${product.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      const { error } = await supabase.storage.from('instruction-media').upload(path, file);
      if (error) {
        toast.error(`Upload failed: ${file.name}`);
        continue;
      }

      const { data: urlData } = supabase.storage.from('instruction-media').getPublicUrl(path);
      newMedia.push({ url: urlData.publicUrl, type: isVideo ? 'video' : 'image' });
    }

    setMedia(newMedia);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeMedia = (idx: number) => {
    setMedia(media.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    const instruction = value.trim() || null;
    const { error } = await supabase
      .from('bot_products')
      .update({
        delivery_instruction: instruction,
        delivery_media: media.length > 0 ? JSON.stringify(media) : '[]',
      })
      .eq('id', product.id);

    if (error) {
      toast.error('Failed to save instruction');
    } else {
      setSavedValue(instruction || '');
      setSavedMedia([...media]);
      toast.success('Instruction saved');
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-1.5 min-w-[280px]">
        {/* Formatting toolbar */}
        <div className="flex items-center gap-0.5 border border-border rounded-t-md bg-muted/50 px-1 py-0.5">
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" title="Bold" onClick={() => wrapSelection('<b>', '</b>')}>
            <Bold className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" title="Italic" onClick={() => wrapSelection('<i>', '</i>')}>
            <Italic className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" title="Underline" onClick={() => wrapSelection('<u>', '</u>')}>
            <Underline className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" title="Strikethrough" onClick={() => wrapSelection('<s>', '</s>')}>
            <Strikethrough className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" title="Code" onClick={() => wrapSelection('<code>', '</code>')}>
            <Code className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" title="Link" onClick={() => wrapSelection('<a href="">', '</a>')}>
            <Link className="h-3.5 w-3.5" />
          </Button>
        </div>
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. Login using incognito mode..."
          className="text-xs min-h-[60px] resize-y rounded-t-none -mt-1.5 border-t-0"
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Escape') { setValue(savedValue); setMedia(savedMedia); setEditing(false); } }}
        />

        {/* Media previews */}
        {media.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {media.map((m, i) => (
              <div key={i} className="relative group">
                {m.type === 'image' ? (
                  <img src={m.url} alt="" className="h-14 w-14 rounded object-cover border border-border" />
                ) : (
                  <div className="h-14 w-14 rounded border border-border bg-muted flex items-center justify-center">
                    <FileVideo className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <button
                  type="button"
                  className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full h-4 w-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => removeMedia(i)}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={handleUpload}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <ImagePlus className="h-3.5 w-3.5" />
            {uploading ? 'Uploading...' : 'Add Media'}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 gap-1 ml-auto text-xs text-success" onClick={handleSave}>
            <Check className="h-3.5 w-3.5" /> Save
          </Button>
        </div>
      </div>
    );
  }

  const hasContent = savedValue || savedMedia.length > 0;

  return (
    <button
      type="button"
      className="flex items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-muted transition-colors text-left max-w-[240px]"
      onClick={() => { setValue(savedValue); setMedia(savedMedia); setEditing(true); }}
    >
      {hasContent ? (
        <div className="flex items-center gap-1.5">
          {savedMedia.length > 0 && (
            <span className="text-xs text-muted-foreground">📎{savedMedia.length}</span>
          )}
          {savedValue ? (
            <span className="text-xs text-foreground line-clamp-2">{savedValue}</span>
          ) : (
            <span className="text-xs text-muted-foreground">Media only</span>
          )}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground flex items-center gap-1"><Pencil className="h-3 w-3" /> Add</span>
      )}
    </button>
  );
};

const DescriptionCell = ({ product }: { product: Product }) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(product.description || '');
  const [savedValue, setSavedValue] = useState(product.description || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const wrapSelection = (openTag: string, closeTag: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = value.substring(start, end);
    const before = value.substring(0, start);
    const after = value.substring(end);
    const newValue = `${before}${openTag}${selected}${closeTag}${after}`;
    setValue(newValue);
    setTimeout(() => {
      ta.focus();
      if (selected) {
        ta.selectionStart = start;
        ta.selectionEnd = start + openTag.length + selected.length + closeTag.length;
      } else {
        ta.selectionStart = ta.selectionEnd = start + openTag.length;
      }
    }, 0);
  };

  useEffect(() => {
    setSavedValue(product.description || '');
    if (!editing) setValue(product.description || '');
  }, [product.description]);

  const handleSave = async () => {
    const desc = value.trim() || null;
    const { error } = await supabase
      .from('bot_products')
      .update({ description: desc })
      .eq('id', product.id);

    if (error) {
      toast.error('Failed to save description');
    } else {
      setSavedValue(desc || '');
      toast.success('Description saved');
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-1.5 min-w-[280px]">
        <div className="flex items-center gap-0.5 border border-border rounded-t-md bg-muted/50 px-1 py-0.5">
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" title="Bold" onClick={() => wrapSelection('<b>', '</b>')}>
            <Bold className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" title="Italic" onClick={() => wrapSelection('<i>', '</i>')}>
            <Italic className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" title="Underline" onClick={() => wrapSelection('<u>', '</u>')}>
            <Underline className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" title="Strikethrough" onClick={() => wrapSelection('<s>', '</s>')}>
            <Strikethrough className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" title="Code" onClick={() => wrapSelection('<code>', '</code>')}>
            <Code className="h-3.5 w-3.5" />
          </Button>
        </div>
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Product description shown in bot..."
          className="text-xs min-h-[80px] resize-y rounded-t-none -mt-1.5 border-t-0"
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Escape') { setValue(savedValue); setEditing(false); } }}
        />
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" className="h-7 gap-1 ml-auto text-xs text-success" onClick={handleSave}>
            <Check className="h-3.5 w-3.5" /> Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="flex items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-muted transition-colors text-left max-w-[240px]"
      onClick={() => { setValue(savedValue); setEditing(true); }}
    >
      {savedValue ? (
        <span className="text-xs text-foreground line-clamp-2">{savedValue}</span>
      ) : (
        <span className="text-xs text-muted-foreground flex items-center gap-1"><Pencil className="h-3 w-3" /> Add</span>
      )}
    </button>
  );
};

const NameCell = ({ product }: { product: Product }) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(product.name);

  useEffect(() => {
    if (!editing) setValue(product.name);
  }, [product.name]);

  const handleSave = async () => {
    const newName = value.trim();
    if (!newName || newName === product.name) { setEditing(false); return; }
    const { error } = await supabase.from('bot_products').update({ name: newName }).eq('id', product.id);
    if (error) {
      toast.error('Failed to update name');
      setValue(product.name);
    } else {
      toast.success('Name updated');
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          className="border border-border rounded px-2 py-1 text-sm bg-background w-full min-w-[120px]"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          onBlur={handleSave}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') { setValue(product.name); setEditing(false); } }}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      className="font-medium flex items-center gap-1 hover:bg-muted rounded px-2 py-1 transition-colors"
      onClick={() => setEditing(true)}
      title="Click to edit name"
    >
      {product.name}
      <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
    </button>
  );
};

const ManualDeliveryCell = ({ product }: { product: Product }) => {
  const [isManual, setIsManual] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('bot_products').select('is_manual_delivery').eq('id', product.id).single()
      .then(({ data }) => {
        if (data) setIsManual(data.is_manual_delivery);
        setLoading(false);
      });
  }, [product.id]);

  const handleToggle = async (checked: boolean) => {
    setIsManual(checked);
    const { error } = await supabase.from('bot_products').update({ is_manual_delivery: checked }).eq('id', product.id);
    if (error) {
      toast.error('Failed to update');
      setIsManual(!checked);
    } else {
      toast.success(checked ? 'Manual delivery enabled' : 'Auto delivery enabled');
    }
  };

  if (loading) return <span className="text-xs text-muted-foreground">...</span>;

  return (
    <div className="flex items-center gap-2">
      <Switch checked={isManual} onCheckedChange={handleToggle} />
      {isManual && <Hand className="h-3.5 w-3.5 text-warning" />}
    </div>
  );
};

const ActiveCell = ({ product }: { product: Product }) => {
  const [isActive, setIsActive] = useState<boolean>(product.isActive ?? true);

  useEffect(() => {
    setIsActive(product.isActive ?? true);
  }, [product.isActive, product.id]);

  const handleToggle = async (checked: boolean) => {
    setIsActive(checked);
    const { error } = await supabase.from('bot_products').update({ is_active: checked }).eq('id', product.id);
    if (error) {
      toast.error('Failed to update');
      setIsActive(!checked);
    } else {
      // Update store so UI stays in sync
      const { useProductStore } = await import('@/store/useProductStore');
      useProductStore.setState((state) => ({
        products: state.products.map((p) => (p.id === product.id ? { ...p, isActive: checked } : p)),
      }));
      toast.success(checked ? 'Product enabled' : 'Product disabled');
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Switch checked={isActive} onCheckedChange={handleToggle} />
      <span className={`text-xs ${isActive ? 'text-success' : 'text-muted-foreground'}`}>
        {isActive ? 'Active' : 'Hidden'}
      </span>
    </div>
  );
};

const InternalStockCell = ({ product, onStockChanged, onBack }: { product: Product; onStockChanged?: (productId: string) => void; onBack?: () => void }) => {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [bulkRemoving, setBulkRemoving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<'available' | 'sold' | 'all'>('available');
  const [items, setItems] = useState<Array<{ id: string; data: Record<string, unknown>; status: string; created_at: string; sold_at: string | null; sort_index?: number | null }>>([]);
  const [totalStockCount, setTotalStockCount] = useState(0);
  const [availableStockCount, setAvailableStockCount] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  type ReviewBucketKey = 'available' | 'reserved' | 'sold' | 'external' | 'invalid';
  type ReviewState = {
    totalSubmitted: number;
    duplicateInPaste: number;
    newLines: string[];
    buckets: Record<ReviewBucketKey, { ids: string[]; lines: string[] }>;
    actions: Record<ReviewBucketKey, 'skip' | 'readd'>;
    expanded: Record<ReviewBucketKey, boolean>;
  };
  const [review, setReview] = useState<ReviewState | null>(null);
  const [confirming, setConfirming] = useState(false);


  const formatBytes = (b: number) => {
    if (!b) return '0 B';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(2)} MB`;
  };

  const handleUploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const MAX = 20 * 1024 * 1024;
    const tooBig = files.find((f) => f.size > MAX);
    if (tooBig) {
      toast.error(`"${tooBig.name}" is over 20MB. Each file must be ≤ 20MB.`);
      return;
    }
    setUploadingFiles(true);
    setUploadProgress({ done: 0, total: files.length });
    let success = 0;
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        const safe = f.name.replace(/[^\w.\-]+/g, '_').slice(0, 80);
        const path = `${product.id}/${crypto.randomUUID()}-${safe}`;
        const { error: upErr } = await supabase.storage
          .from('product-files')
          .upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false });
        if (upErr) throw upErr;
        const data = {
          _file_path: path,
          _file_name: f.name,
          _size: f.size,
          _mime: f.type || 'application/octet-stream',
        };
        const { error: insErr } = await supabase
          .from('bot_product_stock_items')
          .insert({ product_id: product.id, data });
        if (insErr) {
          // best-effort cleanup
          await supabase.storage.from('product-files').remove([path]);
          throw insErr;
        }
        success++;
      } catch (err) {
        console.error('Upload failed for', f.name, err);
        failed++;
      }
      setUploadProgress({ done: i + 1, total: files.length });
    }
    setUploadingFiles(false);
    setUploadProgress(null);
    if (success > 0) {
      const { count: newTotalStock } = await supabase
        .from('bot_product_stock_items')
        .select('id', { count: 'exact', head: true })
        .eq('product_id', product.id)
        .eq('status', 'available');
      const { data: productRow } = await supabase
        .from('bot_products')
        .select('last_known_stock')
        .eq('id', product.id)
        .maybeSingle();
      const previousKnownStock = Math.max(0, Number(productRow?.last_known_stock || 0));
      const availableTotal = Math.max(0, Number(newTotalStock || 0));
      const fallbackKnownStock = Math.max(0, availableTotal - success);
      // Optimistically bump last_known_stock to current so the bot's background
      // stock-checker does NOT also fire a duplicate broadcast. If the edge
      // function fails, we lower it back so the poller can pick it up.
      await supabase
        .from('bot_products')
        .update({ stock_source: 'internal', last_known_stock: availableTotal })
        .eq('id', product.id);
      const { error: broadcastError } = await supabase.functions.invoke('stock-broadcast', {
        body: { productId: product.id, addedCount: success },
      });
      toast.success(`Uploaded ${success} file(s)${failed ? `, ${failed} failed` : ''}`);
      if (broadcastError) {
        await supabase
          .from('bot_products')
          .update({ last_known_stock: Math.min(previousKnownStock, fallbackKnownStock) })
          .eq('id', product.id);
        toast.error('Files added, but broadcast could not be started');
      } else {
        toast.success('Stock alert broadcast started');
      }
      void loadStock('available');
      onStockChanged?.(product.id);
    } else {
      toast.error('All uploads failed');
    }
  };


  const ingestFiles = async (files: File[]) => {
    const txtFiles = files.filter((f) => f.type === 'text/plain' || /\.txt$/i.test(f.name));
    if (txtFiles.length === 0) {
      toast.error('Only .txt files are supported');
      return;
    }
    try {
      const texts = await Promise.all(txtFiles.map((f) => f.text()));
      const merged = texts.join('\n').replace(/\r/g, '');
      setValue((prev) => {
        const base = prev.trim();
        return base ? `${base}\n${merged}` : merged;
      });
      const lineCount = merged.split('\n').filter((l) => l.trim()).length;
      toast.success(`Loaded ${lineCount} line(s) from ${txtFiles.length} file(s)`);
    } catch (err) {
      toast.error('Failed to read file');
    }
  };

  const loadStock = async (filter: 'available' | 'sold' | 'all' = statusFilter, opts?: { from?: string; to?: string }) => {
    setLoading(true);
    try {
      const fromDate = opts?.from ?? dateFrom;
      const toDate = opts?.to ?? dateTo;
      const hasDateRange = Boolean(fromDate || toDate);
      const buildItemsQuery = () => {
        let q = supabase
          .from('bot_product_stock_items')
          .select('id,data,status,created_at,sold_at,sort_index')
          .eq('product_id', product.id);
        if (filter !== 'all') q = q.eq('status', filter);
        if (hasDateRange) {
          const col = filter === 'sold' ? 'sold_at' : 'created_at';
          if (fromDate) q = q.gte(col, `${fromDate}T00:00:00`);
          if (toDate) q = q.lte(col, `${toDate}T23:59:59.999`);
        }
        return q.order('created_at', { ascending: true }).order('id', { ascending: true });
      };

      const PAGE = 1000;
      const allItems: Array<{ id: string; data: Record<string, unknown>; status: string; created_at: string; sold_at: string | null; sort_index?: number | null }> = [];
      let pageErr: unknown = null;
      let offset = 0;
      // Range-based pagination — robust against duplicate created_at values
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await buildItemsQuery().range(offset, offset + PAGE - 1);
        if (error) { pageErr = error; break; }
        const rows = (data || []) as typeof allItems;
        allItems.push(...rows);
        if (rows.length < PAGE) break;
        offset += PAGE;
        if (offset > 500000) break; // safety cap
      }



      const [totalResult, availableResult] = await Promise.all([
        supabase.from('bot_product_stock_items').select('id', { count: 'exact', head: true }).eq('product_id', product.id),
        supabase.from('bot_product_stock_items').select('id', { count: 'exact', head: true }).eq('product_id', product.id).eq('status', 'available'),
      ]);

      if (pageErr || totalResult.error || availableResult.error) {
        toast.error('Failed to load stock');
      } else {
        setItems(allItems);
        setTotalStockCount(totalResult.count || 0);
        setAvailableStockCount(availableResult.count || 0);
      }


    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (product.stockSource === 'internal') void loadStock();
  }, [product.id, product.stockSource, statusFilter]);

  // Reload server-side when date range changes for heavy tabs
  useEffect(() => {
    if (product.stockSource !== 'internal') return;
    if (statusFilter === 'available') return; // available is light, client filter is enough
    const t = setTimeout(() => { void loadStock(statusFilter, { from: dateFrom, to: dateTo }); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);



  useEffect(() => {
    if (product.stockSource !== 'internal') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`stock-items-${product.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bot_product_stock_items', filter: `product_id=eq.${product.id}` },
        () => {
          // Debounce to avoid refetching 30k+ rows on every sale during heavy tabs
          if (timer) clearTimeout(timer);
          const delay = statusFilter === 'available' ? 500 : 4000;
          timer = setTimeout(() => {
            void loadStock();
            onStockChanged?.(product.id);
          }, delay);
        }
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [product.id, product.stockSource, statusFilter, onStockChanged]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => items.some((item) => item.id === id && item.status === 'available')));
  }, [items]);

  const handleAdd = async () => {
    const rawLines = value.split('\n').map((line) => line.trim()).filter(Boolean);
    const seen = new Set<string>();
    const duplicateInPaste = rawLines.length - rawLines.filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).length;
    const lines = Array.from(seen).map((key) => rawLines.find((line) => line.toLowerCase() === key) as string);
    if (lines.length === 0) return;
    setSaving(true);

    // Fetch existing items (id + status + data) to bucket duplicates by status.
    const existing: Array<{ id: string; status: string; data: Record<string, unknown> }> = [];
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data: rows, error: fetchError } = await supabase
        .from('bot_product_stock_items')
        .select('id,status,data')
        .eq('product_id', product.id)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (fetchError) {
        toast.error('Failed to check duplicate stock');
        setSaving(false);
        return;
      }
      const batch = (rows || []) as Array<{ id: string; status: string; data: Record<string, unknown> }>;
      existing.push(...batch);
      if (batch.length < PAGE) break;
      from += PAGE;
    }

    // line(lowercased) -> first matching existing row
    const valueIndex = new Map<string, { id: string; status: string }>();
    for (const row of existing) {
      const data = (row.data || {}) as Record<string, unknown>;
      for (const v of Object.values(data)) {
        const key = String(v).trim().toLowerCase();
        if (!key) continue;
        if (!valueIndex.has(key)) valueIndex.set(key, { id: row.id, status: row.status });
      }
    }

    const buckets: Record<ReviewBucketKey, { ids: string[]; lines: string[] }> = {
      available: { ids: [], lines: [] },
      reserved: { ids: [], lines: [] },
      sold: { ids: [], lines: [] },
      external: { ids: [], lines: [] },
      invalid: { ids: [], lines: [] },
    };
    const newLines: string[] = [];
    for (const line of lines) {
      const hit = valueIndex.get(line.toLowerCase());
      if (!hit) { newLines.push(line); continue; }
      const key: ReviewBucketKey =
        hit.status === 'available' ? 'available' :
        hit.status === 'reserved' ? 'reserved' :
        hit.status === 'sold' ? 'sold' :
        hit.status === 'external' ? 'external' :
        'invalid';
      buckets[key].ids.push(hit.id);
      buckets[key].lines.push(line);
    }

    setReview({
      totalSubmitted: rawLines.length,
      duplicateInPaste,
      newLines,
      buckets,
      actions: { available: 'skip', reserved: 'skip', sold: 'skip', external: 'skip', invalid: 'skip' },
      expanded: { available: false, reserved: false, sold: false, external: false, invalid: false },
    });
    setSaving(false);
  };

  const confirmAdd = async () => {
    if (!review) return;
    setConfirming(true);
    const newLines = review.newLines;
    const readdIds: string[] = [];
    (Object.keys(review.buckets) as ReviewBucketKey[]).forEach((k) => {
      if (review.actions[k] === 'readd' && k !== 'available') {
        readdIds.push(...review.buckets[k].ids);
      }
    });

    // Clone re-add rows as NEW available stock — never mutate the original sold/reserved/external/deleted row.
    let readdPayloads: { product_id: string; data: any }[] = [];
    if (readdIds.length > 0) {
      const FETCH_CHUNK = 200;
      for (let i = 0; i < readdIds.length; i += FETCH_CHUNK) {
        const idsChunk = readdIds.slice(i, i + FETCH_CHUNK);
        const { data: srcRows, error: srcErr } = await supabase
          .from('bot_product_stock_items')
          .select('id, data')
          .in('id', idsChunk);
        if (srcErr) {
          toast.error(`Re-add fetch failed: ${srcErr.message}`);
          setConfirming(false);
          return;
        }
        readdPayloads.push(...(srcRows || []).map((r: any) => ({ product_id: product.id, data: r.data })));
      }
    }

    const newPayloads = newLines.map((line) => ({
      product_id: product.id,
      data: { [product.detailColumns[0] || 'Delivery Info']: line },
    }));
    const allInserts = [...newPayloads, ...readdPayloads];

    let insertedCount = 0;
    let insertedRowIds: string[] = [];
    if (allInserts.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < allInserts.length; i += CHUNK) {
        const chunk = allInserts.slice(i, i + CHUNK);
        const { data: insertedRows, error } = await supabase
          .from('bot_product_stock_items')
          .insert(chunk)
          .select('id');
        if (error) {
          toast.error(`Failed to add stock: ${error.message}`);
          setConfirming(false);
          return;
        }
        const ids = (insertedRows || []).map((r) => r.id);
        insertedRowIds.push(...ids);
        insertedCount += ids.length;
      }
    }

    const newInsertedCount = Math.min(insertedCount, newPayloads.length);
    const restoredCount = Math.max(0, insertedCount - newInsertedCount);

    const totalAdded = insertedCount;
    if (totalAdded === 0) {
      toast.message('Nothing to add — all items skipped');
      setConfirming(false);
      setReview(null);
      setValue('');
      return;
    }

    const { count: newTotalStock } = await supabase
      .from('bot_product_stock_items')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', product.id)
      .eq('status', 'available');
    const { data: productRow } = await supabase
      .from('bot_products')
      .select('last_known_stock')
      .eq('id', product.id)
      .maybeSingle();
    const previousKnownStock = Math.max(0, Number(productRow?.last_known_stock || 0));
    const availableTotal = Math.max(0, Number(newTotalStock || 0));
    const fallbackKnownStock = Math.max(0, availableTotal - totalAdded);
    await supabase
      .from('bot_products')
      .update({ stock_source: 'internal', last_known_stock: availableTotal })
      .eq('id', product.id);
    const { error: broadcastError } = await supabase.functions.invoke('stock-broadcast', {
      body: { productId: product.id, addedCount: totalAdded, stockItemIds: insertedRowIds },
    });
    toast.success(`${newInsertedCount} new + ${restoredCount} re-added = ${totalAdded} stock item(s)`);
    if (broadcastError) {
      await supabase
        .from('bot_products')
        .update({ last_known_stock: Math.min(previousKnownStock, fallbackKnownStock) })
        .eq('id', product.id);
      toast.error('Stock added, but broadcast could not be started');
    } else {
      toast.success('Stock alert broadcast started');
    }
    setValue('');
    setStatusFilter('available');
    await loadStock('available');
    onStockChanged?.(product.id);
    setConfirming(false);
    setReview(null);
  };


  const cleanupStorageFiles = async (itemIds: string[]) => {
    const targets = items.filter((it) => itemIds.includes(it.id));
    const paths = targets
      .map((it) => (it.data as Record<string, any> | null)?._file_path)
      .filter((p): p is string => typeof p === 'string' && p.length > 0);
    if (paths.length > 0) {
      try { await supabase.storage.from('product-files').remove(paths); }
      catch (e) { console.warn('Storage cleanup failed:', e); }
    }
  };

  const handleRemove = async (itemId: string) => {
    setRemovingId(itemId);
    await cleanupStorageFiles([itemId]);
    const { error } = await supabase.from('bot_product_stock_items').delete().eq('id', itemId);
    if (error) {
      toast.error('Failed to remove stock');
      setRemovingId(null);
      return;
    }
    toast.success('Stock removed');
    await loadStock();
    onStockChanged?.(product.id);
    setRemovingId(null);
  };

  const handleBulkRemove = async () => {
    if (selectedIds.length === 0) return;
    setBulkRemoving(true);
    const CHUNK = 200;
    let removed = 0;
    for (let i = 0; i < selectedIds.length; i += CHUNK) {
      const chunk = selectedIds.slice(i, i + CHUNK);
      await cleanupStorageFiles(chunk);
      const { error } = await supabase
        .from('bot_product_stock_items')
        .delete()
        .in('id', chunk)
        .eq('status', 'available');
      if (error) {
        console.error('Bulk remove failed:', error);
        toast.error(`Failed to remove selected stock (${removed}/${selectedIds.length} done)`);
        setBulkRemoving(false);
        await loadStock();
        onStockChanged?.(product.id);
        return;
      }
      removed += chunk.length;
    }
    toast.success(`${removed} stock item(s) removed`);
    setSelectedIds([]);
    await loadStock();
    onStockChanged?.(product.id);
    setBulkRemoving(false);
  };



  const availableCount = availableStockCount;
  const filteredItems = useMemo(() => {
    const base = items.filter((item) => statusFilter === 'all' || item.status === statusFilter);
    if (!dateFrom && !dateTo) return base;
    const fromMs = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : -Infinity;
    const toMs = dateTo ? new Date(dateTo + 'T23:59:59.999').getTime() : Infinity;
    return base.filter((item) => {
      const ref = item.status === 'sold' ? item.sold_at : item.created_at;
      if (!ref) return false;
      const t = new Date(ref).getTime();
      return t >= fromMs && t <= toMs;
    });
  }, [items, statusFilter, dateFrom, dateTo]);
  const dateFilterActive = Boolean(dateFrom || dateTo);
  const currentFilterTotal = dateFilterActive
    ? filteredItems.length
    : statusFilter === 'all'
    ? totalStockCount
    : statusFilter === 'available'
      ? availableStockCount
      : Math.max(totalStockCount - availableStockCount, filteredItems.length);
  const hiddenByLimitCount = Math.max(currentFilterTotal - filteredItems.length, 0);
  const RENDER_CAP = 500;
  const visibleItems = filteredItems.length > RENDER_CAP ? filteredItems.slice(0, RENDER_CAP) : filteredItems;
  const renderHiddenCount = filteredItems.length - visibleItems.length;

  const visibleAvailableIds = visibleItems.filter((item) => item.status === 'available').map((item) => item.id);
  const allVisibleAvailableSelected = visibleAvailableIds.length > 0 && visibleAvailableIds.every((id) => selectedIds.includes(id));

  if (product.stockSource !== 'internal') return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          {onBack && (
            <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          )}
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Boxes className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="font-heading text-base font-semibold truncate">{product.name}</div>
            <div className="text-xs text-muted-foreground">
              Available: <span className="text-success font-medium">{availableCount}</span> / Total: {totalStockCount}
              {filteredItems.length > 0 && ` · Loaded ${filteredItems.length} ${statusFilter}`}
              {renderHiddenCount > 0 && ` (showing first ${RENDER_CAP}, all exportable)`}
            </div>
          </div>
        </div>
      </div>

      <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] min-h-0">
            <div className="space-y-2 min-h-0">
              <div
                className={`relative rounded-md transition ${isDragging ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
                onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
                onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDragging(false);
                  const files = Array.from(e.dataTransfer?.files || []);
                  if (files.length > 0) void ingestFiles(files);
                }}
              >
                <Textarea
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="One delivery item per line — or drag & drop a .txt file here"
                  className="min-h-[220px] sm:min-h-[360px] lg:min-h-[calc(100dvh-26rem)] text-xs font-mono"
                />
                {isDragging && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md bg-primary/10 text-sm font-medium text-primary">
                    📄 Drop .txt file to load
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <input
                  id={`stock-file-${product.id}`}
                  type="file"
                  accept=".txt,text/plain"
                  multiple
                  className="hidden"
                  onChange={async (e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length > 0) await ingestFiles(files);
                    e.target.value = '';
                  }}
                />
                <input
                  id={`stock-upload-${product.id}`}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={async (e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length > 0) await handleUploadFiles(files);
                    e.target.value = '';
                  }}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full gap-1"
                    onClick={() => document.getElementById(`stock-file-${product.id}`)?.click()}
                    disabled={saving || uploadingFiles}
                  >
                    📄 Load .txt
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full gap-1"
                    onClick={() => document.getElementById(`stock-upload-${product.id}`)?.click()}
                    disabled={saving || uploadingFiles}
                    title="Upload files as stock (each file = 1 stock unit, max 20MB)"
                  >
                    <Upload className="h-4 w-4" />
                    {uploadingFiles && uploadProgress
                      ? `${uploadProgress.done}/${uploadProgress.total}…`
                      : 'Upload files'}
                  </Button>
                </div>
                <Button className="w-full" onClick={handleAdd} disabled={saving || uploadingFiles || !value.trim()}>
                  {saving ? 'Adding...' : '+ Add Stock'}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Tip: "Upload files as stock" — each file (max 20MB, e.g. .md, .pdf, .zip) becomes 1 stock unit. Customers get the file as download.
              </p>
            </div>


            <div className="flex min-h-[260px] flex-col rounded-md border border-border overflow-hidden">
              <div className="flex flex-col gap-2 border-b border-border bg-muted/40 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex rounded-md border border-border bg-background p-0.5">
                    {(['available', 'sold', 'all'] as const).map((filter) => (
                      <Button
                        key={filter}
                        type="button"
                        size="sm"
                        variant={statusFilter === filter ? 'secondary' : 'ghost'}
                        className="h-7 px-3 text-xs capitalize"
                        onClick={() => setStatusFilter(filter)}
                      >
                        {filter}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={cn('h-8 gap-1 text-xs', !dateFrom && 'text-muted-foreground')}
                      >
                        <CalendarIcon className="h-3.5 w-3.5" />
                        {dateFrom ? format(new Date(dateFrom), 'PP') : 'From date'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={dateFrom ? new Date(dateFrom) : undefined}
                        onSelect={(date) => setDateFrom(date ? format(date, 'yyyy-MM-dd') : '')}
                        initialFocus
                        className="p-3 pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>

                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={cn('h-8 gap-1 text-xs', !dateTo && 'text-muted-foreground')}
                      >
                        <CalendarIcon className="h-3.5 w-3.5" />
                        {dateTo ? format(new Date(dateTo), 'PP') : 'To date'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={dateTo ? new Date(dateTo) : undefined}
                        onSelect={(date) => setDateTo(date ? format(date, 'yyyy-MM-dd') : '')}
                        initialFocus
                        className="p-3 pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>

                  {(dateFrom || dateTo) && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => { setDateFrom(''); setDateTo(''); }}
                    >
                      Clear dates
                    </Button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">

                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs"
                    disabled={filteredItems.length === 0}
                    onClick={() => {
                      const lines = filteredItems.map((item) => Object.values(item.data || {}).join(' | '));
                      const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      const range = dateFrom || dateTo ? `-${dateFrom || 'start'}_to_${dateTo || 'end'}` : '';
                      a.download = `${product.name}-${statusFilter}${range}-${Date.now()}.txt`;
                      a.click();
                      URL.revokeObjectURL(url);
                      toast.success(`Exported ${filteredItems.length} item(s)`);
                    }}

                  >
                    <Download className="h-3.5 w-3.5" /> Export TXT
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs"
                    disabled={filteredItems.length === 0}
                    onClick={() => {
                      const headers = Array.from(new Set(filteredItems.flatMap((it) => Object.keys(it.data || {}))));
                      const rows = [['Status', 'Sold At', 'Created At', ...headers].join(',')];
                      filteredItems.forEach((it) => {
                        const cols = headers.map((h) => `"${String((it.data as Record<string, unknown>)?.[h] ?? '').replace(/"/g, '""')}"`);
                        rows.push([it.status, it.sold_at || '', it.created_at || '', ...cols].join(','));
                      });
                      const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      const range = dateFrom || dateTo ? `-${dateFrom || 'start'}_to_${dateTo || 'end'}` : '';
                      a.download = `${product.name}-${statusFilter}${range}-${Date.now()}.csv`;

                      a.click();
                      URL.revokeObjectURL(url);
                      toast.success(`Exported ${filteredItems.length} item(s)`);
                    }}
                  >
                    <Download className="h-3.5 w-3.5" /> Export CSV
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="outline" className="h-7 text-xs text-destructive" disabled={selectedIds.length === 0 || bulkRemoving}>
                        Remove Selected ({selectedIds.length})
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove selected stock items?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete {selectedIds.length} available stock item(s).
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleBulkRemove}>
                          Remove Selected
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
              <div className="grid grid-cols-[28px_1fr_86px_68px] gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                <Checkbox
                  checked={allVisibleAvailableSelected}
                  disabled={visibleAvailableIds.length === 0}
                  onCheckedChange={(checked) => {
                    setSelectedIds((current) => checked
                      ? Array.from(new Set([...current, ...visibleAvailableIds]))
                      : current.filter((id) => !visibleAvailableIds.includes(id))
                    );
                  }}
                  aria-label="Select visible available stock"
                />
                <span>Stock</span>
                <span>Status</span>
                <span className="text-right">Action</span>
              </div>
              <div className="min-h-[280px] max-h-[calc(100dvh-22rem)] flex-1 overflow-y-auto overscroll-contain sm:max-h-[calc(100dvh-18rem)]">
                {loading ? (
                  <div className="p-4 text-sm text-muted-foreground">Loading...</div>
                ) : totalStockCount === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground">No stock added yet.</div>
                ) : filteredItems.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground">No {statusFilter} stock found.</div>
                ) : (
                  <>
                  {visibleItems.map((item) => {
                  const data = (item.data || {}) as Record<string, any>;
                  const isFile = !!data._file_path;
                  const text = isFile
                    ? `${data._file_name || 'file'}`
                    : Object.values(data).join(' | ');
                  const isAvailable = item.status === 'available';
                  return (
                    <div key={item.id} className="grid grid-cols-[28px_1fr_86px_68px] gap-2 border-b border-border/60 px-3 py-2 text-xs last:border-b-0">
                      <Checkbox
                        checked={selectedIds.includes(item.id)}
                        disabled={!isAvailable}
                        onCheckedChange={(checked) => {
                          setSelectedIds((current) => checked ? [...current, item.id] : current.filter((id) => id !== item.id));
                        }}
                        aria-label={`Select ${text}`}
                      />
                      {isFile ? (
                        <span className="flex items-center gap-1.5 min-w-0 text-foreground">
                          <Paperclip className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <span className="truncate font-medium">{data._file_name}</span>
                          <span className="text-muted-foreground shrink-0">({formatBytes(Number(data._size) || 0)})</span>
                        </span>
                      ) : (
                        <code className="break-all text-foreground">{text}</code>
                      )}
                      <span className={isAvailable ? 'text-success' : 'text-muted-foreground'}>{item.status}</span>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive hover:bg-destructive/10" disabled={removingId === item.id}>
                            Remove
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove this stock item?</AlertDialogTitle>
                            <AlertDialogDescription className="break-all">
                              This will permanently delete this {item.status} stock item: {text}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => handleRemove(item.id)}>
                              Remove
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  );
                })}
                {renderHiddenCount > 0 && (
                  <div className="p-3 text-center text-xs text-muted-foreground bg-muted/30 border-t border-border">
                    +{renderHiddenCount.toLocaleString()} more loaded (use Export to download all, or narrow with date range)
                  </div>
                )}
                  </>
                )}
              </div>
            </div>
          </div>

      <Dialog open={!!review} onOpenChange={(o) => { if (!o && !confirming) setReview(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Boxes className="h-5 w-5 text-primary" /> Stock Import Review
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">Review duplicates before adding. Nothing is inserted until you confirm.</p>
          </DialogHeader>
          {review && (() => {
            const bucketMeta: Array<{ key: ReviewBucketKey; label: string; icon: any; color: string }> = [
              { key: 'available', label: 'Available', icon: AlertTriangle, color: 'text-warning border-warning/30 bg-warning/5' },
              { key: 'reserved', label: 'Reserved', icon: ShieldCheck, color: 'text-primary border-primary/30 bg-primary/5' },
              { key: 'sold', label: 'Sold', icon: ShoppingCart, color: 'text-success border-success/30 bg-success/5' },
              { key: 'external', label: 'External', icon: Globe2, color: 'text-info border-info/30 bg-info/5' },
              { key: 'invalid', label: 'Deleted', icon: Trash2, color: 'text-destructive border-destructive/30 bg-destructive/5' },
            ];
            const newCount = review.newLines.length;
            let willReadd = 0;
            (Object.keys(review.buckets) as ReviewBucketKey[]).forEach((k) => {
              if (review.actions[k] === 'readd' && k !== 'available') willReadd += review.buckets[k].ids.length;
            });
            const willSkip = (Object.keys(review.buckets) as ReviewBucketKey[]).reduce((acc, k) => {
              if (review.actions[k] === 'skip' || k === 'available') acc += review.buckets[k].ids.length;
              return acc;
            }, 0);
            return (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="rounded-md border border-border p-2.5">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Total submitted</div>
                    <div className="text-xl font-bold tabular-nums">{review.totalSubmitted}</div>
                  </div>
                  <div className="rounded-md border border-success/30 bg-success/5 p-2.5">
                    <div className="text-[10px] uppercase tracking-wide text-success flex items-center gap-1"><Check className="h-3 w-3" /> New unique</div>
                    <div className="text-xl font-bold tabular-nums">{newCount}</div>
                  </div>
                  {bucketMeta.map((b) => {
                    const Icon = b.icon;
                    const n = review.buckets[b.key].ids.length;
                    return (
                      <div key={b.key} className={`rounded-md border p-2.5 ${b.color}`}>
                        <div className="text-[10px] uppercase tracking-wide flex items-center gap-1"><Icon className="h-3 w-3" /> {b.label}</div>
                        <div className="text-xl font-bold tabular-nums">{n}</div>
                      </div>
                    );
                  })}
                </div>

                {review.duplicateInPaste > 0 && (
                  <div className="text-xs text-muted-foreground">{review.duplicateInPaste} duplicate line(s) in your paste were merged.</div>
                )}

                <div className="space-y-2">
                  {bucketMeta.filter((b) => review.buckets[b.key].ids.length > 0).map((b) => {
                    const Icon = b.icon;
                    const bucket = review.buckets[b.key];
                    const expanded = review.expanded[b.key];
                    const isAvailable = b.key === 'available';
                    return (
                      <div key={b.key} className={`rounded-md border ${b.color}`}>
                        <div className="flex items-center justify-between gap-2 p-3">
                          <button
                            type="button"
                            onClick={() => setReview((r) => r ? { ...r, expanded: { ...r.expanded, [b.key]: !r.expanded[b.key] } } : r)}
                            className="flex items-center gap-2 text-sm font-medium"
                          >
                            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            <Icon className="h-4 w-4" /> {b.label}
                            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-background/60 text-xs tabular-nums">{bucket.ids.length}</span>
                          </button>
                          <div className="flex items-center gap-3 text-xs">
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="radio"
                                checked={review.actions[b.key] === 'skip'}
                                onChange={() => setReview((r) => r ? { ...r, actions: { ...r.actions, [b.key]: 'skip' } } : r)}
                              />
                              Skip
                            </label>
                            {!isAvailable && (
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input
                                  type="radio"
                                  checked={review.actions[b.key] === 'readd'}
                                  onChange={() => setReview((r) => r ? { ...r, actions: { ...r.actions, [b.key]: 'readd' } } : r)}
                                />
                                Re-add as new stock
                              </label>
                            )}
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                              onClick={() => {
                                navigator.clipboard.writeText(bucket.lines.join('\n'));
                                toast.success(`Copied ${bucket.lines.length} value(s)`);
                              }}
                              title="Copy values"
                            >
                              <Copy className="h-3.5 w-3.5" /> Copy values
                            </button>
                          </div>
                        </div>
                        {expanded && (
                          <div className="border-t border-border/60 bg-background/40 px-3 py-2 max-h-40 overflow-y-auto font-mono text-[11px] leading-relaxed">
                            {bucket.lines.slice(0, 500).map((l, i) => (
                              <div key={i} className="truncate">{l}</div>
                            ))}
                            {bucket.lines.length > 500 && (
                              <div className="text-muted-foreground italic">…and {bucket.lines.length - 500} more</div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1">
                  <div className="font-medium text-sm mb-1">Execution preview</div>
                  <div>Will insert: <span className="font-bold tabular-nums">{newCount}</span> new</div>
                  <div>Will re-add (restore to available): <span className="font-bold tabular-nums">{willReadd}</span></div>
                  <div>Will skip: <span className="font-bold tabular-nums">{willSkip}</span></div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setReview(null)} disabled={confirming}>Cancel</Button>
                  <Button onClick={confirmAdd} disabled={confirming || (newCount + willReadd === 0)}>
                    {confirming ? 'Applying…' : 'Confirm & apply'}
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );

};

const SortableRow = ({ product, onRemove, onStockChanged }: { product: Product; onRemove: (id: string) => void; onStockChanged?: (productId: string) => void }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: product.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <TableRow ref={setNodeRef} style={style} className="group">
      <TableCell className="w-8">
        <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 text-muted-foreground hover:text-foreground touch-none">
          <GripVertical className="h-4 w-4" />
        </button>
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <NameCell product={product} />
          <span className={`ml-2 text-[10px] font-medium tabular-nums ${
            product.stock === 0 ? 'text-destructive' : product.stock <= 3 ? 'text-warning' : 'text-muted-foreground'
          }`}>
            Stock: {product.stock}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <ActiveCell product={product} />
      </TableCell>
      <TableCell>
        <ManualDeliveryCell product={product} />
      </TableCell>
      <TableCell>
        <DescriptionCell product={product} />
      </TableCell>
      <TableCell>
        <InstructionCell product={product} />
      </TableCell>
      <TableCell className="text-right">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:bg-destructive/10"
          onClick={() => onRemove(product.id)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
};

const ProductsTab = ({ products, onRemove, onReorder, onStockChanged, stockOnly = false }: ProductsTabProps) => {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const [managedProductId, setManagedProductId] = useState<string | null>(null);
  const [showDisabled, setShowDisabled] = useState(false);

  const visibleProducts = stockOnly
    ? products.filter((product) => product.stockSource === 'internal' && !product.isManualDelivery && (product.isActive ?? true))
    : (showDisabled ? products : products.filter((p) => p.isActive ?? true));
  const disabledCount = products.filter((p) => (p.isActive ?? true) === false).length;

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = products.findIndex((p) => p.id === active.id);
    const newIndex = products.findIndex((p) => p.id === over.id);
    const reordered = arrayMove(products, oldIndex, newIndex);

    // Update UI immediately
    onReorder?.(reordered);

    // Save new sort_order to DB
    const updates = reordered.map((p, i) =>
      supabase.from('bot_products').update({ sort_order: i + 1 }).eq('id', p.id)
    );

    const results = await Promise.all(updates);
    const hasError = results.some(r => r.error);
    if (hasError) {
      toast.error('Failed to save order');
    } else {
      toast.success('Order saved');
    }
  };

  // Detail page view (Manage Stock for one product)
  if (stockOnly && managedProductId) {
    const managed = visibleProducts.find((p) => p.id === managedProductId);
    if (managed) {
      return (
        <InternalStockCell
          product={managed}
          onStockChanged={onStockChanged}
          onBack={() => setManagedProductId(null)}
        />
      );
    }
    // fallback if product disappeared
    setManagedProductId(null);
  }

  // Stock list view: card grid for easier scanning
  if (stockOnly) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visibleProducts.length === 0 ? (
          <div className="col-span-full rounded-lg border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
            No products available for stock management.
          </div>
        ) : visibleProducts.map((p) => {
          const isLow = p.stock <= 3;
          const isOut = p.stock === 0;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setManagedProductId(p.id)}
              className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left transition-all hover:border-primary/50 hover:shadow-md hover:-translate-y-0.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/15">
                  <Package className="h-5 w-5" />
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  isOut ? 'bg-destructive/15 text-destructive' : isLow ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'
                }`}>
                  {isOut ? 'Out' : isLow ? 'Low' : 'In stock'}
                </span>
              </div>
              <div className="min-w-0">
                <div className="font-heading text-sm font-semibold truncate">{p.name}</div>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-bold tabular-nums">{p.stock}</span>
                    <span className="text-xs text-muted-foreground">available</span>
                  </div>
                  {p.price > 0 && (
                    <span className="text-xs font-semibold text-primary tabular-nums">
                      {Number(p.price).toFixed(2)} USDT
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-auto flex items-center justify-between border-t border-border/60 pt-2 text-xs text-muted-foreground">
                <span>Tap to manage</span>
                <Boxes className="h-3.5 w-3.5" />
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {disabledCount > 0 && (
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <span>{disabledCount} disabled hidden</span>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowDisabled((v) => !v)}>
            {showDisabled ? 'Hide disabled' : 'Show disabled'}
          </Button>
        </div>
      )}
      <div className="rounded-lg border border-border bg-card overflow-x-auto">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis]}>
        <Table className="min-w-[800px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead className="font-heading">Name</TableHead>
              <TableHead className="font-heading">Status</TableHead>
              <TableHead className="font-heading">Manual</TableHead>
              <TableHead className="font-heading">Description</TableHead>
              <TableHead className="font-heading">Delivery Instruction</TableHead>
              <TableHead className="font-heading text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <SortableContext items={visibleProducts.map(p => p.id)} strategy={verticalListSortingStrategy}>
              {visibleProducts.map((p) => (
                <SortableRow key={p.id} product={p} onRemove={onRemove} onStockChanged={onStockChanged} />
              ))}
            </SortableContext>
          </TableBody>
        </Table>
      </DndContext>
      </div>
    </div>
  );
};

export default ProductsTab;
