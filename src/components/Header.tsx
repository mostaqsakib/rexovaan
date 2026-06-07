import { RefreshCw, Plus, Megaphone, Search, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import { toast } from 'sonner';

interface HeaderProps {
  onAddProduct: () => void;
  onRefresh: () => void;
  onBroadcast: () => void;
  telegramUser?: { id: number; first_name: string; username?: string } | null;
  title?: string;
}

const Header = ({ onAddProduct, onRefresh, onBroadcast, telegramUser, title = 'Dashboard' }: HeaderProps) => {
  const { signOut, isTelegramWebApp } = useAdminAuth();
  const initials = telegramUser?.first_name?.slice(0, 2)?.toUpperCase() || 'AD';
  const handleSignOut = async () => {
    await signOut();
    toast.success('Signed out');
    if (!isTelegramWebApp) window.location.href = '/admin/login';
  };
  return (
    <header className="sticky top-0 z-40 glass-subtle border-b border-border/60">
      <div className="flex h-14 items-center gap-2 px-2 sm:gap-3 sm:px-3 md:px-5">
        <SidebarTrigger className="h-9 w-9 shrink-0 rounded-lg hover:bg-accent/60" />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="hidden sm:inline text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">Admin</span>
          <span className="font-heading text-sm font-semibold text-foreground truncate">{title}</span>
        </div>

        <div className="hidden lg:flex items-center gap-2 ml-4 px-3 h-9 w-72 rounded-lg bg-muted/40 border border-border/60 text-muted-foreground">
          <Search className="h-3.5 w-3.5" />
          <span className="text-xs">Quick search…</span>
          <kbd className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded bg-background/60 border border-border/60">⌘K</kbd>
        </div>

        <div className="ml-auto flex items-center gap-1 sm:gap-1.5 shrink-0">
          <Button variant="ghost" size="icon" onClick={onBroadcast} className="h-9 w-9 rounded-lg hover:bg-accent/60" title="Broadcast">
            <Megaphone className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onRefresh} className="h-9 w-9 rounded-lg hover:bg-accent/60" title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleSignOut} className="h-9 w-9 rounded-lg hover:bg-destructive/10 hover:text-destructive" title="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
          <Button onClick={onAddProduct} size="sm" className="h-9 w-9 sm:w-auto px-0 sm:px-3 gap-1.5 rounded-lg bg-gradient-to-r from-primary to-[hsl(217_91%_60%)] hover:opacity-95 text-primary-foreground font-semibold shadow-[0_4px_20px_-6px_hsl(var(--primary)/0.6)]">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add Product</span>
          </Button>
          <div className="ml-1 sm:ml-2 hidden sm:flex items-center gap-2 pl-2 sm:pl-3 border-l border-border/60">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-primary/5 ring-1 ring-primary/30 text-[11px] font-bold text-primary">
              {initials}
            </div>
            <div className="hidden md:flex flex-col leading-tight">
              <span className="text-xs font-medium text-foreground">{telegramUser?.first_name || 'Admin'}</span>
              <span className="text-[10px] text-muted-foreground">{telegramUser?.username ? `@${telegramUser.username}` : 'Console'}</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
