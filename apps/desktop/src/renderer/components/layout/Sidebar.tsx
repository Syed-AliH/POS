import { NavLink, useLocation } from 'react-router-dom';
import {
  BarChart3,
  Boxes,
  Building2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  CreditCard,
  Gift,
  LayoutDashboard,
  Package,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Tag,
  Tags,
  FileText,
  Sticker,
  Truck,
  Undo2,
  Users,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { UserRole } from '@shared/types';
import { cn } from '@mama-babi/ui';
import { useThemeStore } from '../../stores/themeStore';

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: UserRole[];
  end?: boolean;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Operations',
    items: [
      { to: '/checkout', label: 'Checkout', icon: ShoppingCart, roles: ['cashier', 'manager', 'super_admin'] },
      { to: '/returns', label: 'Returns', icon: Undo2, roles: ['cashier', 'manager', 'super_admin'] },
      { to: '/sales', label: 'Sales', icon: Receipt, roles: ['cashier', 'manager', 'super_admin'] },
    ],
  },
  {
    label: 'Overview',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['manager', 'super_admin'] },
      { to: '/reports', label: 'Reports', icon: BarChart3, roles: ['manager', 'super_admin'] },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { to: '/products', label: 'Products', icon: Package, roles: ['manager', 'super_admin'] },
      { to: '/grn', label: 'Purchases', icon: Truck, roles: ['manager', 'super_admin'] },
      { to: '/inventory-report', label: 'Inventory', icon: Boxes, roles: ['manager', 'super_admin'] },
      { to: '/labels', label: 'Labels', icon: Tags, roles: ['manager', 'super_admin'] },
      { to: '/label-designer', label: 'Label Designer', icon: Sticker, roles: ['manager', 'super_admin'] },
      { to: '/receipt-designer', label: 'Receipt Designer', icon: FileText, roles: ['manager', 'super_admin'] },
    ],
  },
  {
    label: 'Partners',
    items: [
      { to: '/vendors', label: 'Vendors', icon: Building2, roles: ['manager', 'super_admin'] },
      { to: '/customers', label: 'Customers', icon: Users, roles: ['manager', 'super_admin'] },
      { to: '/supplier-payments', label: 'Supplier Payments', icon: CreditCard, roles: ['manager', 'super_admin'] },
    ],
  },
  {
    label: 'Finance',
    items: [
      { to: '/expenses', label: 'Expenses', icon: Wallet, roles: ['manager', 'super_admin'] },
      { to: '/gift-cards', label: 'Gift Cards', icon: Gift, roles: ['manager', 'super_admin'] },
      { to: '/shifts', label: 'Shifts & EOD', icon: Clock, roles: ['manager', 'super_admin'] },
    ],
  },
  {
    label: 'Tools',
    items: [
      { to: '/promotions', label: 'Promotions', icon: Tag, roles: ['manager', 'super_admin'] },
      { to: '/stocktake', label: 'Stocktake', icon: ClipboardList, roles: ['manager', 'super_admin'] },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to: '/settings', label: 'Settings', icon: Settings, roles: ['manager', 'super_admin'] },
      { to: '/settings', label: 'Users', icon: ShieldCheck, roles: ['super_admin'] },
    ],
  },
];

export function Sidebar({ role }: { role: UserRole }) {
  const location = useLocation();
  const { sidebarCollapsed, toggleSidebar } = useThemeStore();

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.roles.includes(role)),
  })).filter((section) => section.items.length > 0);

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-slate-200 bg-white transition-all duration-200 dark:border-slate-800 dark:bg-slate-900',
        sidebarCollapsed ? 'w-[68px]' : 'w-60',
      )}
    >
      <div className={cn('flex h-14 items-center border-b border-slate-200 px-3 dark:border-slate-800', sidebarCollapsed ? 'justify-center' : 'justify-between')}>
        {!sidebarCollapsed && (
          <div className="min-w-0 px-1">
            <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-50">Mama Babi POS</p>
            <p className="truncate text-[10px] font-medium uppercase tracking-wider text-slate-400">Enterprise</p>
          </div>
        )}
        <button
          type="button"
          onClick={toggleSidebar}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {sections.map((section) => (
          <div key={section.label} className="mb-4">
            {!sidebarCollapsed && (
              <p className="section-label mb-2 px-3">{section.label}</p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = location.pathname === item.to || (item.to !== '/settings' && location.pathname.startsWith(item.to));
                return (
                  <li key={`${section.label}-${item.label}`}>
                    <NavLink
                      to={item.to}
                      title={item.label}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                        sidebarCollapsed && 'justify-center px-2',
                        active
                          ? 'bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300'
                          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
                      )}
                    >
                      <Icon className={cn('h-[18px] w-[18px] shrink-0', active && 'text-primary-600 dark:text-primary-400')} />
                      {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}

export function flattenNavForShortcuts(role: UserRole): { to: string; label: string }[] {
  const items: { to: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (!item.roles.includes(role) || seen.has(item.to)) continue;
      seen.add(item.to);
      items.push({ to: item.to, label: item.label });
    }
  }
  return items;
}
