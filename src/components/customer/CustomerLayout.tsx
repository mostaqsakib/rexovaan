import { ReactNode, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ShoppingBag, User, ClipboardList, Wallet, LogOut, LogIn, Send, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCustomerAuth } from '@/contexts/CustomerAuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { supabase } from '@/integrations/supabase/client';
import { preloadCustomEmojis } from '@/components/TelegramRichText';
import { AnnouncementBanner } from '@/components/customer/AnnouncementBanner';
import { NotificationBell } from '@/components/customer/NotificationBell';

export default function CustomerLayout({ children }: { children?: ReactNode }) {
  const { user, customer, signOut } = useCustomerAuth();
  const { currency, setCurrency, format } = useCurrency();
  const navigate = useNavigate();
  const [logoUrl, setLogoUrl] = useState('');
  const [shopName, setShopName] = useState('Rexovaan Shoppie');

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    tg?.ready?.();
    tg?.expand?.();
    supabase.from('bot_settings').select('key,value').in('key', ['site_logo_url', 'site_shop_name']).then(({ data }) => {
      for (const row of (data || [])) {
        if (row.key === 'site_logo_url' && row.value) {
          setLogoUrl(row.value);
          // Update favicon to match the shop logo
          document.querySelectorAll("link[rel~='icon'], link[rel='apple-touch-icon']").forEach(el => el.parentNode?.removeChild(el));
          const icon = document.createElement('link');
          icon.rel = 'icon';
          icon.type = 'image/png';
          icon.href = row.value;
          document.head.appendChild(icon);
          const touch = document.createElement('link');
          touch.rel = 'apple-touch-icon';
          touch.href = row.value;
          document.head.appendChild(touch);
        }
        if (row.key === 'site_shop_name' && row.value) setShopName(row.value);
      }
    });

    // Preload all custom emojis used across products so they render instantly
    supabase.from('bot_products').select('custom_emoji_id, description').eq('is_active', true).then(({ data }) => {
      const ids: string[] = [];
      for (const row of (data || []) as any[]) {
        if (row.custom_emoji_id) ids.push(String(row.custom_emoji_id));
        if (row.description) {
          const re = /<tg-emoji[^>]*emoji-id=["']([^"']+)["'][^>]*>/gi;
          let m: RegExpExecArray | null;
          while ((m = re.exec(row.description)) !== null) ids.push(m[1]);
        }
      }
      if (ids.length) preloadCustomEmojis(ids);
    });
  }, []);

  const isTg = typeof window !== 'undefined' && !!(window as any).Telegram?.WebApp?.initData;

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      {/* Top bar */}
      <header className="sticky top-0 z-40 px-3 sm:px-4 pt-3">
        <div className="max-w-6xl mx-auto relative">
          {/* Ambient gradient glow behind header */}
          <div aria-hidden className="pointer-events-none absolute -inset-x-10 -top-6 h-24 bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/0.18),transparent_60%)] blur-2xl" />

          <div className="relative flex items-center justify-between gap-2 sm:gap-4 pl-3 pr-2 sm:pl-4 sm:pr-3 py-2 rounded-2xl border border-white/[0.06] bg-[hsl(var(--background))]/70 backdrop-blur-2xl shadow-[0_8px_32px_-12px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.04)]">
            {/* Left: Logo & Brand */}
            <Link to="/" className="group flex items-center gap-2.5 shrink-0 pr-1">
              <div className="relative">
                {logoUrl ? (
                  <img src={logoUrl} alt={shopName} className="h-10 w-10 rounded-xl object-contain ring-1 ring-white/10" />
                ) : (
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary via-[hsl(245_85%_62%)] to-[hsl(280_75%_60%)] grid place-items-center font-bold text-primary-foreground text-lg ring-1 ring-white/10 shadow-[0_6px_18px_-6px_hsl(var(--primary)/0.7)]">
                    {shopName.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="hidden sm:flex flex-col leading-tight">
                <span className="font-heading text-[15px] font-semibold tracking-tight text-foreground group-hover:text-primary transition-colors">{shopName}</span>
              </div>
            </Link>

            {/* Middle: Navigation pills */}
            <nav className="hidden md:flex items-center gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              {user && (
                <NavLink
                  to="/account/orders"
                  className={({isActive}) =>
                    `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all ${
                      isActive
                        ? 'bg-gradient-to-b from-white/10 to-white/5 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                        : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.04]'
                    }`
                  }
                >
                  <Package className="h-3.5 w-3.5" /> Orders
                </NavLink>
              )}
              {user && (
                <NavLink
                  to="/account"
                  className={({isActive}) =>
                    `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all ${
                      isActive
                        ? 'bg-gradient-to-b from-white/10 to-white/5 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                        : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.04]'
                    }`
                  }
                >
                  <User className="h-3.5 w-3.5" /> Account
                </NavLink>
              )}
            </nav>

            {/* Right: Support, Balance, Auth */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              {/* Currency switcher */}
              <div className="inline-flex h-9 items-center rounded-xl border border-white/[0.06] bg-white/[0.03] p-0.5">
                <button
                  onClick={() => setCurrency('USD')}
                  className={`h-8 px-2.5 rounded-lg text-[12px] font-semibold transition-all ${currency === 'USD' ? 'bg-primary/20 text-primary ring-1 ring-primary/30' : 'text-muted-foreground hover:text-foreground'}`}
                  title="Show prices in USD"
                >
                  $ USD
                </button>
                <button
                  onClick={() => setCurrency('BDT')}
                  className={`h-8 px-2.5 rounded-lg text-[12px] font-semibold transition-all ${currency === 'BDT' ? 'bg-primary/20 text-primary ring-1 ring-primary/30' : 'text-muted-foreground hover:text-foreground'}`}
                  title="Show prices in BDT"
                >
                  ৳ BDT
                </button>
              </div>

              {/* Support link */}
              <a
                href="https://t.me/VenexOG"
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 sm:px-3 hover:bg-white/[0.08] hover:border-primary/40 transition-all"
                title="Support"
              >
                <Send className="h-4 w-4 text-sky-400 group-hover:text-sky-300 transition-colors" />
                <span className="hidden sm:inline text-[13px] font-medium text-muted-foreground group-hover:text-foreground transition-colors">Support</span>
              </a>

              <NotificationBell />

              {user ? (
                <>
                  {/* Balance chip */}
                  <div className="hidden sm:flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-xl border border-emerald-500/20 bg-gradient-to-r from-emerald-500/10 to-emerald-500/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                    <div className="grid h-6 w-6 place-items-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/30">
                      <Wallet className="h-3 w-3 text-emerald-400" />
                    </div>
                    <div className="flex flex-col leading-none">
                      <span className="text-[9px] uppercase tracking-widest text-emerald-400/70 font-semibold">Balance</span>
                      <span className="font-mono text-[13px] font-bold text-emerald-300 mt-0.5">{format(customer?.balance || 0)}</span>
                    </div>
                  </div>

                  {/* Avatar / Sign out */}
                  {!isTg && (
                    <button
                      onClick={() => signOut()}
                      title="Sign out"
                      className="group inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.03] hover:bg-destructive/10 hover:border-destructive/40 transition-all"
                    >
                      <LogOut className="h-4 w-4 text-muted-foreground group-hover:text-destructive transition-colors" />
                    </button>
                  )}
                </>
              ) : (
                <Button
                  size="sm"
                  onClick={() => navigate('/login')}
                  className="gap-1.5 h-9 px-4 rounded-xl border border-white/[0.08] bg-white/[0.04] text-foreground font-medium hover:bg-white/[0.08] hover:border-primary/40 transition-all"
                >
                  <LogIn className="h-4 w-4" /> Sign in
                </Button>
              )}
            </div>
          </div>

          {/* Bottom accent line */}
          <div className="mx-auto h-px w-2/3 bg-gradient-to-r from-transparent via-primary/40 to-transparent blur-[1px] mt-2" />
        </div>
      </header>

      <AnnouncementBanner />

      <main className="max-w-6xl mx-auto px-4 py-6">{children ?? <Outlet />}</main>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 inset-x-0 z-40 px-3 pb-3 md:hidden">
        <div className="max-w-md mx-auto rounded-2xl border border-white/[0.06] bg-[hsl(var(--background))]/80 backdrop-blur-2xl shadow-[0_-8px_32px_-12px_rgba(0,0,0,0.7)]">
          <div className="grid grid-cols-3">
            <NavLink to="/" end className={({isActive}) => `flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
              {({isActive}) => (<>
                <div className={`grid h-8 w-8 place-items-center rounded-xl transition-all ${isActive ? 'bg-primary/15 ring-1 ring-primary/30' : ''}`}>
                  <ShoppingBag className="h-4 w-4" />
                </div>
                Shop
              </>)}
            </NavLink>
            <NavLink to="/account/orders" className={({isActive}) => `flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
              {({isActive}) => (<>
                <div className={`grid h-8 w-8 place-items-center rounded-xl transition-all ${isActive ? 'bg-primary/15 ring-1 ring-primary/30' : ''}`}>
                  <ClipboardList className="h-4 w-4" />
                </div>
                Orders
              </>)}
            </NavLink>
            <NavLink to="/account" className={({isActive}) => `flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
              {({isActive}) => (<>
                <div className={`grid h-8 w-8 place-items-center rounded-xl transition-all ${isActive ? 'bg-primary/15 ring-1 ring-primary/30' : ''}`}>
                  <User className="h-4 w-4" />
                </div>
                Account
              </>)}
            </NavLink>
          </div>
        </div>
      </nav>
    </div>
  );
}
