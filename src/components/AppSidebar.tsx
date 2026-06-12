import { ShoppingCart, Package, PackageCheck, History, Bot, DollarSign, Users, ArrowUpCircle, ArrowDownCircle, CreditCard, Sparkles, Settings, Gift, KeyRound, MessagesSquare, Server, Flame, FormInput, ClipboardList, Zap, LayoutDashboard, Tag, Globe, Megaphone, Link2 } from 'lucide-react';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter,
  useSidebar,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

interface AppSidebarProps {
  activeTab: string;
  onChange: (tab: string) => void;
  pendingCount?: number;
}

type Item = { id: string; label: string; icon: typeof ShoppingCart; badge?: number };
type Group = { label: string; items: Item[] };

const AppSidebar = ({ activeTab, onChange, pendingCount = 0 }: AppSidebarProps) => {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  const groups: Group[] = [
    {
      label: 'Operations',
      items: [
        { id: 'web-orders', label: 'Orders', icon: Globe },
        { id: 'pending', label: 'Pending', icon: ClipboardList, badge: pendingCount },
        { id: 'history', label: 'History', icon: History },
      ],
    },
    {
      label: 'Catalog',
      items: [
        { id: 'products', label: 'Products', icon: Package },
        { id: 'stock', label: 'Stock', icon: PackageCheck },
        { id: 'pricing', label: 'Pricing', icon: DollarSign },
        { id: 'special-pricing', label: 'Special Pricing', icon: Tag },
        { id: 'flash', label: 'Flash Sales', icon: Flame },
        { id: 'inputs', label: 'Cust. Inputs', icon: FormInput },
        { id: 'link-checker', label: 'Link Checker', icon: Link2 },
      ],
    },
    {
      label: 'People & Money',
      items: [
        { id: 'customers', label: 'Customers', icon: Users },
        { id: 'deposits', label: 'Deposits', icon: ArrowDownCircle },
        { id: 'withdrawals', label: 'Withdrawals', icon: ArrowUpCircle },
        { id: 'payments', label: 'Payments', icon: CreditCard },
        { id: 'referrals', label: 'Referrals', icon: Gift },
        { id: 'resellers', label: 'Resellers', icon: KeyRound },
      ],
    },
    {
      label: 'Bot & System',
      items: [
        { id: 'announcements', label: 'Site Notices', icon: Megaphone },
        { id: 'emojis', label: 'Emojis', icon: Sparkles },
        { id: 'groups', label: 'Groups', icon: MessagesSquare },
        { id: 'sources', label: 'Sources', icon: Server },
        { id: 'settings', label: 'Settings', icon: Settings },
      ],
    },
  ];

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border px-3 py-4">
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-[hsl(217_91%_60%)] glow-primary">
            <Zap className="h-4.5 w-4.5 text-primary-foreground" strokeWidth={2.5} />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="font-heading text-sm font-bold leading-tight tracking-tight gradient-text">
                Rexovaan Shoppie
              </div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
                AUTOMATION BOT
              </div>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 py-3">
        {groups.map((g) => (
          <SidebarGroup key={g.label} className="mb-2">
            {!collapsed && (
              <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60 px-2">
                {g.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeTab === item.id;
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={collapsed ? item.label : undefined}
                        className={cn(
                          'relative h-9 rounded-lg text-sm font-medium transition-all',
                          'data-[active=true]:bg-gradient-to-r data-[active=true]:from-primary/15 data-[active=true]:to-primary/5',
                          'data-[active=true]:text-foreground data-[active=true]:shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.25)]',
                          'hover:bg-sidebar-accent/70',
                        )}
                      >
                        <button type="button" onClick={() => onChange(item.id)} className="flex w-full items-center gap-2.5">
                          {active && (
                            <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_10px_hsl(var(--primary))]" />
                          )}
                          <Icon className={cn('h-4 w-4 shrink-0 transition-colors', active ? 'text-primary' : 'text-muted-foreground')} />
                          {!collapsed && <span className="truncate flex-1 text-left">{item.label}</span>}
                          {!collapsed && item.badge && item.badge > 0 ? (
                            <span className="ml-auto inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-warning/15 px-1.5 text-[10px] font-bold text-warning ring-1 ring-warning/30">
                              {item.badge}
                            </span>
                          ) : null}
                        </button>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border px-3 py-3">
        {!collapsed ? (
          <div className="flex items-center gap-2 rounded-lg bg-sidebar-accent/50 px-2.5 py-2">
            <div className="h-2 w-2 rounded-full bg-success animate-pulse-soft shadow-[0_0_8px_hsl(var(--success))]" />
            <div className="text-[11px] text-muted-foreground">Bot online</div>
            <LayoutDashboard className="ml-auto h-3.5 w-3.5 text-muted-foreground/60" />
          </div>
        ) : (
          <div className="flex justify-center"><div className="h-2 w-2 rounded-full bg-success shadow-[0_0_8px_hsl(var(--success))]" /></div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
};

export default AppSidebar;
