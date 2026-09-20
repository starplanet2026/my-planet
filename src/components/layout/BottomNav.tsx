import { NavLink } from 'react-router-dom';
import { Sparkles, ShoppingBag, User, Brain, PawPrint } from 'lucide-react';
import { ROUTES } from '../../lib/constants';
import { cn } from '../../lib/utils';

const navItems = [
  { to: ROUTES.TASKS, icon: Sparkles, label: '领取成就' },
  { to: ROUTES.CHALLENGE, icon: Brain, label: '智慧星战' },
  { to: ROUTES.PET, icon: PawPrint, label: '萌宠星球' },
  { to: ROUTES.SHOP, icon: ShoppingBag, label: '兑换特权' },
  { to: ROUTES.PROFILE, icon: User, label: '我的星球' },
];

export function BottomNav() {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 bg-white/90 backdrop-blur-md border-t border-star-100"
      style={{ paddingBottom: 'var(--safe-bottom)' }}
    >
      <div className="max-w-7xl mx-auto grid grid-cols-5 h-16">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => cn(
              'flex flex-col items-center justify-center gap-1 text-xs transition-all',
              isActive
                ? 'text-star-600'
                : 'text-slate-400 hover:text-star-500'
            )}
          >
            {({ isActive }) => (
              <>
                <div className={cn(
                  'flex items-center justify-center w-10 h-10 rounded-full transition-all',
                  isActive ? 'bg-star-100' : 'bg-transparent'
                )}>
                  <Icon className={cn('w-5 h-5', isActive && 'scale-110')} strokeWidth={isActive ? 2.5 : 2} />
                </div>
                <span className="font-medium">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
