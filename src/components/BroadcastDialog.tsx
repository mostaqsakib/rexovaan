import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Send, Megaphone, ImagePlus, X, Film, Globe, Plus, MousePointerClick } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface BroadcastDialogProps {
  open: boolean;
  onClose: () => void;
}

interface ProductOpt { id: string; name: string }
interface ProductBtn { productId: string; label: string }

const BroadcastDialog = ({ open, onClose }: BroadcastDialogProps) => {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [alsoOnSite, setAlsoOnSite] = useState(true);
  const [siteTitle, setSiteTitle] = useState('');
  const [siteSeverity, setSiteSeverity] = useState<'info' | 'success' | 'sale' | 'warning'>('info');
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [productButtons, setProductButtons] = useState<ProductBtn[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    supabase.from('bot_products').select('id,name').eq('is_active', true).order('name')
      .then(({ data }) => setProducts((data || []) as ProductOpt[]));
  }, [open]);

  const addButton = () => setProductButtons(b => [...b, { productId: '', label: '' }]);
  const updateButton = (i: number, patch: Partial<ProductBtn>) =>
    setProductButtons(b => b.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  const removeButton = (i: number) =>
    setProductButtons(b => b.filter((_, idx) => idx !== i));

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');

    if (!isImage && !isVideo) {
      toast.error('Only image or video files are supported');
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      toast.error('File too large. Max 50MB');
      return;
    }

    setMediaFile(file);
    setMediaPreview(URL.createObjectURL(file));
  };

  const removeMedia = () => {
    setMediaFile(null);
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    setMediaPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSend = async () => {
    if (!message.trim() && !mediaFile) return;
    setSending(true);
    try {
      let mediaUrl: string | null = null;
      let mediaType: 'photo' | 'video' | null = null;

      if (mediaFile) {
        mediaType = mediaFile.type.startsWith('video/') ? 'video' : 'photo';
        const ext = mediaFile.name.split('.').pop() || 'jpg';
        const fileName = `broadcast/${Date.now()}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from('instruction-media')
          .upload(fileName, mediaFile, { contentType: mediaFile.type });

        if (uploadError) throw new Error('Failed to upload media: ' + uploadError.message);

        const { data: urlData } = supabase.storage
          .from('instruction-media')
          .getPublicUrl(fileName);

        mediaUrl = urlData.publicUrl;
      }

      const cleanButtons = productButtons
        .filter(b => b.productId)
        .map(b => ({ productId: b.productId, label: b.label.trim() }));

      const { data, error } = await supabase.functions.invoke('broadcast-message', {
        body: {
          message: message.trim() || undefined,
          mediaUrl,
          mediaType,
          productButtons: cleanButtons,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Also publish on the website (banner + notification bell) — keep the EXACT format
      // sent to the bot: full HTML (bold/italic/links/<tg-emoji>) and media.
      if (alsoOnSite && (siteTitle.trim() || message.trim() || mediaUrl)) {
        const raw = message.trim();
        const stripped = raw
          .replace(/<tg-emoji[^>]*>([\s\S]*?)<\/tg-emoji>/gi, '$1')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .trim();
        const title = (siteTitle.trim() || stripped.split('\n')[0] || 'Announcement').slice(0, 200);
        const { error: siteErr } = await supabase.from('site_announcements').insert({
          title,
          body: stripped || null,
          body_html: raw || null,
          media_url: mediaUrl,
          media_type: mediaType,
          severity: siteSeverity,
          show_as_banner: true,
          is_active: true,
        });
        if (siteErr) toast.warning('Bot sent, but site post failed: ' + siteErr.message);
      }

      toast.success(`📢 Broadcast sent! ${data.sent}/${data.total} delivered${data.failed > 0 ? `, ${data.failed} failed` : ''}`);
      setMessage('');
      setSiteTitle('');
      setProductButtons([]);
      removeMedia();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Broadcast failed');
    } finally {
      setSending(false);
    }
  };

  const isVideo = mediaFile?.type.startsWith('video/');

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { removeMedia(); onClose(); } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            Broadcast to All Users
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            This message will be sent to <b>all bot users</b> via Telegram. HTML formatting is supported.
          </p>

          {mediaPreview && (
            <div className="relative inline-block">
              {isVideo ? (
                <video src={mediaPreview} className="max-h-40 rounded-md border" controls />
              ) : (
                <img src={mediaPreview} alt="Media preview" className="max-h-40 rounded-md border" />
              )}
              <button
                onClick={removeMedia}
                className="absolute -right-2 -top-2 rounded-full bg-destructive p-1 text-destructive-foreground shadow-sm hover:opacity-80"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          <Textarea
            placeholder={"🎉 New Product Alert!\n\nWe've just added Premium accounts at amazing prices. Check /shop now!"}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            className="font-mono text-sm"
          />

          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              Supported: <code>&lt;b&gt;bold&lt;/b&gt;</code>, <code>&lt;i&gt;italic&lt;/i&gt;</code>, <code>&lt;code&gt;code&lt;/code&gt;</code>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={handleFileSelect}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => fileInputRef.current?.click()}
            >
              {mediaFile ? (
                isVideo ? <Film className="h-4 w-4" /> : <ImagePlus className="h-4 w-4" />
              ) : (
                <ImagePlus className="h-4 w-4" />
              )}
              {mediaFile ? 'Change' : 'Add Media'}
            </Button>
          </div>

          {/* Product Buttons */}
          <div className="space-y-2 border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm font-medium">
                <MousePointerClick className="h-4 w-4 text-primary" />
                Product Buttons ({productButtons.length})
              </label>
              <Button type="button" variant="outline" size="sm" onClick={addButton} className="gap-1.5 h-7">
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </div>
            {productButtons.length === 0 && (
              <p className="text-xs text-muted-foreground">Product select korle oi product er Buy button broadcast er sathe jabe.</p>
            )}
            {productButtons.map((b, i) => {
              const selected = products.find(p => p.id === b.productId);
              return (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={b.productId}
                    onChange={e => updateButton(i, { productId: e.target.value })}
                    className="h-9 flex-1 min-w-0 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="">— Select product —</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <Input
                    value={b.label}
                    onChange={e => updateButton(i, { label: e.target.value })}
                    placeholder={selected ? `Buy ${selected.name}` : 'Button label (optional)'}
                    className="h-9 flex-1 min-w-0"
                  />
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => removeButton(i)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>

          {/* Also post on site */}
          <div className="space-y-2 border-t border-border pt-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={alsoOnSite} onCheckedChange={c => setAlsoOnSite(!!c)} />
              <Globe className="h-4 w-4 text-primary" />
              <span>Also post on website (banner + notification bell)</span>
            </label>
            {alsoOnSite && (
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2 pl-6">
                <Input
                  value={siteTitle}
                  onChange={e => setSiteTitle(e.target.value)}
                  placeholder="Site title (optional — auto from message)"
                  maxLength={120}
                />
                <select
                  value={siteSeverity}
                  onChange={e => setSiteSeverity(e.target.value as any)}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="info">ℹ️ Info</option>
                  <option value="success">✅ Success</option>
                  <option value="sale">🔥 Sale</option>
                  <option value="warning">⚠️ Warning</option>
                </select>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { removeMedia(); onClose(); }}>Cancel</Button>
          <Button onClick={handleSend} disabled={sending || (!message.trim() && !mediaFile)} className="gap-2">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sending ? 'Sending...' : 'Send Broadcast'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BroadcastDialog;
