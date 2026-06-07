import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Save, Sparkles, Info } from 'lucide-react';

interface ButtonEmoji {
  id: string;
  button_key: string;
  button_label: string;
  custom_emoji_id: string | null;
  style: string | null;
}

const STYLE_OPTIONS = [
  { value: 'default', label: '⚪ Default', desc: 'Transparent' },
  { value: 'success', label: '🟢 Success', desc: 'Green' },
  { value: 'primary', label: '🔵 Primary', desc: 'Blue' },
  { value: 'danger', label: '🔴 Danger', desc: 'Red' },
];

const ButtonEmojisTab = () => {
  const [emojis, setEmojis] = useState<ButtonEmoji[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [editStyles, setEditStyles] = useState<Record<string, string>>({});

  const fetchEmojis = async (background = false) => {
    if (background) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    const { data, error } = await supabase
      .from('bot_button_emojis')
      .select('*')
      .order('button_key');

    if (error) {
      if (!background) {
        toast.error('Failed to load button emojis');
      }
    } else {
      setEmojis(data || []);
      const vals: Record<string, string> = {};
      const styles: Record<string, string> = {};
      for (const e of data || []) {
        vals[e.id] = e.custom_emoji_id || '';
        styles[e.id] = e.style || 'default';
      }
      setEditValues(vals);
      setEditStyles(styles);
    }

    if (background) {
      setRefreshing(false);
    } else {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmojis();

    const handleFocus = () => {
      void fetchEmojis(true);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void fetchEmojis(true);
      }
    };

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchEmojis(true);
      }
    }, 15000);

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const handleSave = async (emoji: ButtonEmoji) => {
    setSaving(emoji.id);
    const emojiValue = editValues[emoji.id]?.trim() || null;
    const styleValue = editStyles[emoji.id] === 'default' ? null : editStyles[emoji.id] || null;
    const { error } = await supabase
      .from('bot_button_emojis')
      .update({ custom_emoji_id: emojiValue, style: styleValue })
      .eq('id', emoji.id);
    if (error) {
      toast.error('Failed to save');
    } else {
      toast.success(`${emoji.button_label} updated!`);
      setEmojis(prev => prev.map(e => e.id === emoji.id ? { ...e, custom_emoji_id: emojiValue, style: styleValue } : e));
    }
    setSaving(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="h-5 w-5 text-primary" />
              Button Emojis & Colors
            </CardTitle>
            <CardDescription className="flex items-start gap-2">
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Set custom emoji IDs and button colors for inline keyboard buttons.
                Colors: <b>🟢 Green</b> (success), <b>🔵 Blue</b> (primary), <b>🔴 Red</b> (danger), <b>⚪ Default</b> (transparent).
              </span>
            </CardDescription>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={() => void fetchEmojis(true)}
            disabled={refreshing}
            className="shrink-0 gap-2"
          >
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {emojis.map((emoji) => {
            const styleDot = emoji.style ? { primary: '🔵', success: '🟢', danger: '🔴' }[emoji.style] || '⚪' : '⚪';
            return (
              <div key={emoji.id} className="flex flex-col gap-2 rounded-lg border border-border/50 bg-muted/50 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{styleDot}</span>
                  <span className="font-medium text-sm">{emoji.button_label}</span>
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                    {emoji.button_key}
                  </Badge>
                  {emoji.custom_emoji_id && (
                    <Badge className="bg-primary/20 px-1.5 py-0 text-[10px] text-primary border-primary/30">
                      Emoji ✓
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="custom_emoji_id..."
                    value={editValues[emoji.id] || ''}
                    onChange={(e) => setEditValues(prev => ({ ...prev, [emoji.id]: e.target.value }))}
                    className="h-8 flex-1 font-mono text-xs"
                  />
                  <Select
                    value={editStyles[emoji.id] || 'default'}
                    onValueChange={(val) => setEditStyles(prev => ({ ...prev, [emoji.id]: val }))}
                  >
                    <SelectTrigger className="h-8 w-[120px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STYLE_OPTIONS.map(o => (
                        <SelectItem key={o.value} value={o.value} className="text-xs">
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleSave(emoji)}
                    disabled={saving === emoji.id}
                    className="h-8 shrink-0"
                  >
                    {saving === emoji.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
};

export default ButtonEmojisTab;
