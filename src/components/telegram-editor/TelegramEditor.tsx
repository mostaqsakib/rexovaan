import { useRef, useState, useEffect, useCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import EmojiPicker from './EmojiPicker';
import { TgEmoji } from '@/components/TelegramRichText';
import {
  Bold, Italic, Underline, Strikethrough, Code, Link2, Quote, EyeOff,
  Smile, Lightbulb, Terminal,
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

// ---------------- Serialization ----------------
// DOM (contentEditable) -> Telegram HTML string.
function serialize(root: HTMLElement): string {
  let out = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent || '').replace(/\u00a0/g, ' ');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    // Line breaks
    if (tag === 'br') { out += '\n'; return; }

    // Custom emoji marker (span/img with data-emoji-id)
    const emojiId = el.getAttribute('data-emoji-id');
    if (emojiId) {
      const fb = el.getAttribute('data-fallback') || el.textContent || '😀';
      out += `<tg-emoji emoji-id="${emojiId}">${fb}</tg-emoji>`;
      return;
    }

    // Block-level: div acts as a paragraph — prepend newline unless first
    const isBlock = tag === 'div' || tag === 'p';
    if (isBlock && out && !out.endsWith('\n')) out += '\n';

    // Map allowed inline/block tags
    const map: Record<string, [string, string]> = {
      b: ['<b>', '</b>'], strong: ['<b>', '</b>'],
      i: ['<i>', '</i>'], em: ['<i>', '</i>'],
      u: ['<u>', '</u>'],
      s: ['<s>', '</s>'], strike: ['<s>', '</s>'], del: ['<s>', '</s>'],
      code: ['<code>', '</code>'],
      pre: ['<pre>', '</pre>'],
      blockquote: ['<blockquote>', '</blockquote>'],
    };

    let open = '', close = '';
    if (map[tag]) { [open, close] = map[tag]; }
    else if (tag === 'a') {
      const href = el.getAttribute('href') || '';
      open = `<a href="${href.replace(/"/g, '&quot;')}">`; close = '</a>';
    } else if (el.classList?.contains('tg-spoiler') || tag === 'tg-spoiler') {
      open = '<tg-spoiler>'; close = '</tg-spoiler>';
    }

    out += open;
    el.childNodes.forEach(walk);
    out += close;
  };
  root.childNodes.forEach(walk);
  // Cleanup
  return out.replace(/\n{3,}/g, '\n\n').replace(/\s+$/g, '');
}

// Telegram HTML -> DOM-ready HTML for the editor.
function deserialize(tgHtml: string): string {
  if (!tgHtml) return '';
  let s = tgHtml;
  // tg-emoji -> non-editable pill span
  s = s.replace(
    /<tg-emoji\s+emoji-id="([^"]+)"[^>]*>([\s\S]*?)<\/tg-emoji>/gi,
    (_, id, fb) => {
      const safeFb = String(fb || '😀').replace(/</g, '&lt;');
      const fbAttr = safeFb.replace(/"/g, '&quot;');
      return `<span class="tge-emoji" contenteditable="false" data-emoji-id="${id}" data-fallback="${fbAttr}"><span class="tge-emoji-mount" data-fallback-text="${fbAttr}">${safeFb}</span></span>`;
    },
  );
  // tg-spoiler -> span.tg-spoiler
  s = s.replace(/<tg-spoiler>/gi, '<span class="tg-spoiler">').replace(/<\/tg-spoiler>/gi, '</span>');
  // Line breaks
  s = s.replace(/\r\n/g, '\n').replace(/\n/g, '<br>');
  return s;
}

// ---------------- Component ----------------
export function TelegramEditor({
  value,
  onChange,
  placeholder = 'Type your message...',
  rows = 6,
  className,
  showPreview = false, // WYSIWYG box IS the preview now
  examplePlaceholder,
  toolbarCompact = false,
}: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastValueRef = useRef<string>('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const savedSelectionRef = useRef<Range | null>(null);
  const [isEmpty, setIsEmpty] = useState(!value);

  const emojiRootsRef = useRef<Map<HTMLElement, Root>>(new Map());
  const mountEmojiRootsRef = useRef<() => void>(() => {});

  // Sync external value -> editor (only if different from what we produced)
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (value === lastValueRef.current) return;
    // Defer-unmount stale roots so React finishes its commit before we swap innerHTML
    const stale = Array.from(emojiRootsRef.current.values());
    emojiRootsRef.current.clear();
    setTimeout(() => { stale.forEach(r => { try { r.unmount(); } catch {} }); }, 0);
    el.innerHTML = deserialize(value);
    lastValueRef.current = value;
    setIsEmpty(!el.textContent && el.querySelectorAll('.tge-emoji, img').length === 0);
    mountEmojiRootsRef.current?.();
  }, [value]);

  // Mount TgEmoji React roots inside .tge-emoji-mount hosts so animated/premium
  // emojis actually render in the WYSIWYG editor (not just the fallback char).
  useEffect(() => {
    const mountAll = () => {
      const el = editorRef.current;
      if (!el) return;
      const hosts = el.querySelectorAll<HTMLElement>('.tge-emoji-mount');
      hosts.forEach(host => {
        if (emojiRootsRef.current.has(host)) return;
        const pill = host.closest('.tge-emoji') as HTMLElement | null;
        const id = pill?.getAttribute('data-emoji-id');
        if (!id) return;
        const fb = host.getAttribute('data-fallback-text') || pill?.getAttribute('data-fallback') || '😀';
        host.textContent = '';
        const root = createRoot(host);
        root.render(<TgEmoji id={id} fallback={fb} size="1.2em" />);
        emojiRootsRef.current.set(host, root);
      });
      // Defer-unmount roots whose host was removed from DOM
      const orphans: Root[] = [];
      emojiRootsRef.current.forEach((root, host) => {
        if (!el.contains(host)) { orphans.push(root); emojiRootsRef.current.delete(host); }
      });
      if (orphans.length) setTimeout(() => orphans.forEach(r => { try { r.unmount(); } catch {} }), 0);
    };
    mountEmojiRootsRef.current = mountAll;
    mountAll();
    return () => {
      const all = Array.from(emojiRootsRef.current.values());
      emojiRootsRef.current.clear();
      setTimeout(() => all.forEach(r => { try { r.unmount(); } catch {} }), 0);
    };
  }, []);

  const emit = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const s = serialize(el);
    lastValueRef.current = s;
    setIsEmpty(!el.textContent && el.querySelectorAll('.tge-emoji, img').length === 0);
    mountEmojiRootsRef.current?.();
    onChange(s);
  }, [onChange]);

  // ---------------- Selection helpers ----------------
  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      savedSelectionRef.current = sel.getRangeAt(0).cloneRange();
    }
  };
  const restoreSelection = () => {
    const r = savedSelectionRef.current;
    if (!r) { editorRef.current?.focus(); return; }
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(r);
    editorRef.current?.focus();
  };

  const exec = (cmd: string, arg?: string) => {
    restoreSelection();
    document.execCommand(cmd, false, arg);
    emit();
  };

  const wrapSelection = (tag: string, className?: string) => {
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const el = document.createElement(tag);
    if (className) el.className = className;
    try {
      const contents = range.extractContents();
      if (!contents.textContent && !contents.querySelector?.('*')) {
        el.textContent = tag;
      } else {
        el.appendChild(contents);
      }
      range.insertNode(el);
      // Place caret after
      const after = document.createRange();
      after.setStartAfter(el);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
    } catch { /* noop */ }
    emit();
  };

  const insertNodeAtCursor = (node: Node) => {
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      editorRef.current?.appendChild(node);
    } else {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(node);
      // Move caret after
      const after = document.createRange();
      after.setStartAfter(node);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
    }
    emit();
  };

  const insertText = (text: string) => {
    insertNodeAtCursor(document.createTextNode(text));
  };

  const insertCustomEmoji = (id: string, fallback: string) => {
    const fb = fallback || '😀';
    const span = document.createElement('span');
    span.className = 'tge-emoji';
    span.setAttribute('contenteditable', 'false');
    span.setAttribute('data-emoji-id', id);
    span.setAttribute('data-fallback', fb);
    const mount = document.createElement('span');
    mount.className = 'tge-emoji-mount';
    mount.setAttribute('data-fallback-text', fb);
    mount.textContent = fb;
    span.appendChild(mount);
    // Insert with a trailing space so caret sits nicely
    const frag = document.createDocumentFragment();
    frag.appendChild(span);
    frag.appendChild(document.createTextNode('\u00a0'));
    insertNodeAtCursor(frag);
    // Mount will be picked up by the effect below.
    setTimeout(() => mountEmojiRootsRef.current?.(), 0);
  };

  const insertLinkNode = () => {
    if (!linkUrl.trim()) return;
    restoreSelection();
    const url = linkUrl.trim();
    const text = linkText.trim() || (window.getSelection()?.toString() || url);
    const a = document.createElement('a');
    a.href = url;
    a.textContent = text;
    insertNodeAtCursor(a);
    setLinkOpen(false);
    setLinkUrl(''); setLinkText('');
  };

  const loadExample = () => {
    if (examplePlaceholder) onChange(examplePlaceholder);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); exec('bold'); }
      else if (k === 'i') { e.preventDefault(); exec('italic'); }
      else if (k === 'u') { e.preventDefault(); exec('underline'); }
      else if (k === 'k') { e.preventDefault(); saveSelection(); setLinkOpen(true); }
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    // Force plain text paste — no external styles
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    document.execCommand('insertText', false, text);
    emit();
  };

  const btnCls = 'h-8 w-8 p-0';
  const minHeight = `${Math.max(rows * 22, 120)}px`;

  return (
    <div className={cn('rounded-md border border-input bg-background overflow-hidden', className)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/30 px-1.5 py-1">
        <Button type="button" variant="ghost" size="sm" className={cn(btnCls, 'font-bold')} onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => exec('bold')} title="Bold (Ctrl+B)"><Bold className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className={cn(btnCls, 'italic')} onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => exec('italic')} title="Italic (Ctrl+I)"><Italic className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className={btnCls} onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => exec('underline')} title="Underline (Ctrl+U)"><Underline className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className={btnCls} onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => exec('strikeThrough')} title="Strikethrough"><Strikethrough className="h-4 w-4" /></Button>
        <div className="mx-1 h-5 w-px bg-border" />
        <Button type="button" variant="ghost" size="sm" className={btnCls} onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => wrapSelection('code')} title="Inline code"><Code className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className={btnCls} onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => wrapSelection('pre')} title="Code block"><Terminal className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className={btnCls} onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => wrapSelection('blockquote')} title="Quote"><Quote className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className={btnCls} onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => wrapSelection('span', 'tg-spoiler')} title="Spoiler"><EyeOff className="h-4 w-4" /></Button>
        <div className="mx-1 h-5 w-px bg-border" />
        <Button type="button" variant="ghost" size="sm" className={btnCls} onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => setLinkOpen(true)} title="Link (Ctrl+K)"><Link2 className="h-4 w-4" /></Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2" onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} title="Emoji panel">
              <Smile className="h-4 w-4" />{!toolbarCompact && <span className="text-xs">Emoji</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="p-0 border-0 shadow-none bg-transparent w-auto">
            <EmojiPicker
              onPickUnicode={(e) => insertText(e)}
              onPickCustom={(id, f) => insertCustomEmoji(id, f || '😀')}
            />
          </PopoverContent>
        </Popover>
        {examplePlaceholder && (
          <>
            <div className="mx-1 h-5 w-px bg-border" />
            <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2" onClick={loadExample} title="Load example">
              <Lightbulb className="h-4 w-4" />{!toolbarCompact && <span className="text-xs">Example</span>}
            </Button>
          </>
        )}
      </div>

      {/* WYSIWYG editable Telegram-style box */}
      <div className="relative bg-[#0e1621] p-4">
        {isEmpty && (
          <div className="pointer-events-none absolute left-[26px] top-[26px] text-neutral-500 text-sm select-none">
            {placeholder}
          </div>
        )}
        <div className="flex justify-start">
          <div
            ref={editorRef}
            className="tge-editable tg-content tg-bubble-dark rounded-[12px] rounded-bl-[4px] shadow-[0_1px_2px_rgba(0,0,0,0.35)] max-w-[480px] px-[14px] py-[10px] text-[15px] leading-[1.45] break-words outline-none whitespace-pre-wrap"
            style={{ minHeight, minWidth: '160px', background: '#182533', color: '#e6ebef' }}
            contentEditable
            suppressContentEditableWarning
            onInput={emit}
            onBlur={saveSelection}
            onKeyUp={saveSelection}
            onMouseUp={saveSelection}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
        </div>
      </div>

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
            <Button onClick={insertLinkNode}>Insert</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TelegramEditor;
