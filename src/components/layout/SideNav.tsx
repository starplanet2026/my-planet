import { NavLink } from 'react-router-dom';
import { LayoutDashboard, ListTodo, ShoppingBag, Ticket } from 'lucide-react';
import { ROUTES } from '../../lib/constants';
import { cn } from '../../lib/utils';

const navItems = [
  { to: ROUTES.PARENT_DASHBOARD, icon: LayoutDashboard, label: '概览' },
  { to: ROUTES.PARENT_TASKS, icon: ListTodo, label: '任务管理' },
  { to: ROUTES.PARENT_SHOP, icon: ShoppingBag, label: '特权管理' },
  { to: ROUTES.PARENT_REDEEM, icon: Ticket, label: '特权记录' },
];

export function SideNav() {
  return (
    <nav className="hidden lg:flex flex-col w-56 h-full sticky top-16 border-r border-slate-100 bg-white py-4">
      {navItems.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => cn(
            'flex items-center gap-3 px-6 py-3 text-sm font-medium transition-colors',
            isActive
              ? 'text-blue-500 bg-blue-50 border-r-2 border-blue-500'
              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
          )}
        >
          <Icon className="w-5 h-5" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
