import { useRef, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { TelegramRichText } from '@/components/TelegramRichText';
import EmojiPicker from './EmojiPicker';
import {
  Bold, Italic, Underline, Strikethrough, Code, Link2, Quote, EyeOff,
  Undo2, Redo2, Smile, Hash, Lightbulb, Terminal,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  showPreview?: boolean;
  examplePlaceholder?: string;
  toolbarCompact?: boolean;
}

const HISTORY_LIMIT = 40;

export function TelegramEditor({
  value,
  onChange,
  placeholder = 'Type your message...',
  rows = 6,
  className,
  showPreview = true,
  examplePlaceholder,
  toolbarCompact = false,
}: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<{ stack: string[]; index: number }>({ stack: [value], index: 0 });
  const skipHistoryRef = useRef(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [emojiIdOpen, setEmojiIdOpen] = useState(false);
  const [emojiId, setEmojiId] = useState('');
  const [emojiIdFallback, setEmojiIdFallback] = useState('😀');

  useEffect(() => {
    // record snapshots on value change (external or internal)
    if (skipHistoryRef.current) { skipHistoryRef.current = false; return; }
    const h = historyRef.current;
    if (h.stack[h.index] === value) return;
    h.stack = h.stack.slice(0, h.index + 1);
    h.stack.push(value);
    if (h.stack.length > HISTORY_LIMIT) h.stack.shift();
    h.index = h.stack.length - 1;
  }, [value]);

  const applyUndo = () => {
    const h = historyRef.current;
    if (h.index > 0) { h.index -= 1; skipHistoryRef.current = true; onChange(h.stack[h.index]); }
  };
  const applyRedo = () => {
    const h = historyRef.current;
    if (h.index < h.stack.length - 1) { h.index += 1; skipHistoryRef.current = true; onChange(h.stack[h.index]); }
  };

  const insertAtCursor = (before: string, after = '', selectionFallback = '') => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = value.slice(start, end) || selectionFallback;
    const next = value.slice(0, start) + before + selected + after + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + before.length + selected.length + after.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  const wrap = (tag: string, defaultText = '') => insertAtCursor(`<${tag}>`, `</${tag}>`, defaultText);
  const wrapSpoiler = () => wrap('tg-spoiler', 'spoiler');

  const insertLink = () => {
    if (!linkUrl.trim()) return;
    const text = linkText.trim() || linkUrl.trim();
    insertAtCursor(`<a href="${linkUrl.trim()}">${text}</a>`, '');
    setLinkOpen(false);
    setLinkUrl(''); setLinkText('');
  };

  const insertEmojiId = () => {
    if (!emojiId.trim()) return;
    insertAtCursor(`<tg-emoji emoji-id="${emojiId.trim()}">${emojiIdFallback || '😀'}</tg-emoji>`, '');
    setEmojiIdOpen(false);
    setEmojiId('');
  };

  const loadExample = () => {
    if (examplePlaceholder) onChange(examplePlaceholder);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey)) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); wrap('b', 'bold'); }
      else if (k === 'i') { e.preventDefault(); wrap('i', 'italic'); }
      else if (k === 'u') { e.preventDefault(); wrap('u', 'underline'); }
      else if (k === 'k') { e.preventDefault(); setLinkOpen(true); }
      else if (k === 'z' && !e.shiftKey) { e.preventDefault(); applyUndo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); applyRedo(); }
    }
  };

  const btnCls = 'h-8 w-8 p-0';

  return (
    <div className={cn('rounded-md border border-input bg-background overflow-hidden', className)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/30 px-1.5 py-1">
        <Button type="button" variant="ghost" size="sm" className={btnCls} onClick={applyUndo} title="Undo (Ctrl+Z)"><Undo2 className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className={btnCls} onClick={applyRedo} title="Redo (Ctrl+Y)"><Redo2 className="h-4 w-4" /></Button>
        <div className="mx-1 h-5 w-px bg-border" />
        <Button type="button" variant="ghost" size="sm" className={cn(btnCls, 'font-bold')} onClick={() => wrap('b', 'bold')} title="Bold (Ctrl+B)"><Bold className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className={cn(btnCls, 'italic')} onClick={() => wrap('i', 'italic')} title="Italic (Ctrl+I)"><Italic className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className={btnCls} onClick={() => wrap('u', 'underline')} title="Underline (Ctrl+U)"><Underline className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className={btnCls} onClick={() => wrap('s', 'strikethrough')} title="Strikethrough"><Strikethrough className="h-4 w-4" /></Button>
        <div className="mx-1 h-5 w-px bg-border" />
        <Button type="button" variant="ghost" size="sm" className={btnCls} onClick={() => wrap('code', 'code')} title="Inline code"><Code className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className={btnCls} onClick={() => wrap('pre', 'code block')} title="Code block"><Terminal className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className={btnCls} onClick={() => wrap('blockquote', 'quote')} title="Quote"><Quote className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className={btnCls} onClick={wrapSpoiler} title="Spoiler"><EyeOff className="h-4 w-4" /></Button>
        <div className="mx-1 h-5 w-px bg-border" />
        <Button type="button" variant="ghost" size="sm" className={btnCls} onClick={() => setLinkOpen(true)} title="Link (Ctrl+K)"><Link2 className="h-4 w-4" /></Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2" title="Emoji panel">
              <Smile className="h-4 w-4" />{!toolbarCompact && <span className="text-xs">Emoji</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="p-0 border-0 shadow-none bg-transparent w-auto">
            <EmojiPicker
              onPickUnicode={(e) => insertAtCursor(e)}
              onPickCustom={(id, f) => insertAtCursor(`<tg-emoji emoji-id="${id}">${f || '😀'}</tg-emoji>`)}
            />
          </PopoverContent>
        </Popover>
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2" onClick={() => setEmojiIdOpen(true)} title="Insert emoji by ID">
          <Hash className="h-4 w-4" />{!toolbarCompact && <span className="text-xs">Emoji ID</span>}
        </Button>
        {examplePlaceholder && (
          <>
            <div className="mx-1 h-5 w-px bg-border" />
            <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2" onClick={loadExample} title="Load example">
              <Lightbulb className="h-4 w-4" />{!toolbarCompact && <span className="text-xs">Example</span>}
            </Button>
          </>
        )}
      </div>

      {/* Editable area */}
      <Textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        rows={rows}
        placeholder={placeholder}
        className="rounded-none border-0 font-mono text-sm resize-y focus-visible:ring-0 bg-white text-neutral-900 placeholder:text-neutral-500"
      />

      {/* Preview */}
      {showPreview && value.trim() && (
        <div className="border-t bg-[#0e1621] p-4 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-[#8e9ba8]">Telegram Preview</div>
          <div className="flex justify-start">
            <div className="max-w-[480px] rounded-[12px] rounded-bl-[4px] bg-white px-[14px] py-[10px] text-sm break-words text-neutral-900 shadow-[0_1px_2px_rgba(16,35,47,0.15)]">
              <TelegramRichText html={value} />
            </div>
          </div>
        </div>
      )}

      {/* Link dialog */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Insert link</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Input placeholder="https://example.com" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} autoFocus />
            <Input placeholder="Link text (optional)" value={linkText} onChange={e => setLinkText(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)}>Cancel</Button>
            <Button onClick={insertLink}>Insert</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Emoji ID dialog */}
      <Dialog open={emojiIdOpen} onOpenChange={setEmojiIdOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Insert custom emoji by ID</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Input placeholder="5379748062124056162" value={emojiId} onChange={e => setEmojiId(e.target.value)} autoFocus />
            <Input placeholder="Fallback emoji (😀)" value={emojiIdFallback} onChange={e => setEmojiIdFallback(e.target.value)} maxLength={4} />
            <p className="text-xs text-muted-foreground">Paste a Telegram custom_emoji_id. Fallback emoji shows if the animated one can't load.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmojiIdOpen(false)}>Cancel</Button>
            <Button onClick={insertEmojiId}>Insert</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TelegramEditor;
