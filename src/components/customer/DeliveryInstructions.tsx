import { Info } from 'lucide-react';
import { TelegramRichText } from '@/components/TelegramRichText';

type MediaItem = { url: string; type: 'image' | 'video' };

interface Props {
  instruction?: string | null;
  media?: MediaItem[] | null;
}

export default function DeliveryInstructions({ instruction, media }: Props) {
  const list: MediaItem[] = Array.isArray(media) ? media : [];
  const hasInstruction = !!(instruction && instruction.trim());
  if (!hasInstruction && list.length === 0) return null;

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-primary">
        <Info className="h-4 w-4" /> Important instructions
      </div>

      {hasInstruction && (
        <TelegramRichText
          html={instruction!}
          className="text-sm leading-relaxed whitespace-pre-wrap break-words [&_a]:text-primary [&_a]:underline"
        />
      )}

      {list.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {list.map((m, i) =>
            m.type === 'video' ? (
              <video key={i} src={m.url} controls className="w-full rounded-lg border border-border bg-black" />
            ) : (
              <a key={i} href={m.url} target="_blank" rel="noopener noreferrer" className="block">
                <img src={m.url} alt={`Instruction ${i + 1}`} loading="lazy" className="w-full h-32 object-cover rounded-lg border border-border hover:opacity-90 transition" />
              </a>
            )
          )}
        </div>
      )}
    </div>
  );
}
