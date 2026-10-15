import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Sparkles, ShoppingBag, User, Brain, PawPrint } from 'lucide-react';
import { ROUTES } from '../../lib/constants';
import { cn } from '../../lib/utils';
import { useToastStore } from '../../store/toastStore';
import { useStudyLockStore } from '../../store/studyLockStore';

const navItems = [
  { to: ROUTES.TASKS, icon: Sparkles, label: '领取成就' },
  { to: ROUTES.CHALLENGE, icon: Brain, label: '智慧星战' },
  { to: ROUTES.PET, icon: PawPrint, label: '萌宠星球' },
  { to: ROUTES.SHOP, icon: ShoppingBag, label: '兑换特权' },
  { to: ROUTES.PROFILE, icon: User, label: '我的星球' },
];

// 基础任务未完成（等级2）时锁定的板块；智慧星战开放（需做家默任务）
const LOCKED_TABS: string[] = [ROUTES.TASKS, ROUTES.SHOP, ROUTES.PROFILE];

export function BottomNav() {
  const { pathname } = useLocation();
  const level = useStudyLockStore(s => s.level);
  const refresh = useStudyLockStore(s => s.refresh);

  // 每次进入/切换页面时重新核算当日解锁状态（覆盖每日零点重置后首次打开）
  useEffect(() => { refresh(); }, [pathname, refresh]);

  // 切回前台时重新核算（家长在其它设备审核通过后，孩子端回到前台即可解锁）
  useEffect(() => {
    const onActive = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onActive);
    window.addEventListener('focus', onActive);
    return () => {
      document.removeEventListener('visibilitychange', onActive);
      window.removeEventListener('focus', onActive);
    };
  }, [refresh]);

  const isLocked = (to: string) => level === 2 && LOCKED_TABS.includes(to);
  const warnLocked = () => useToastStore.getState().warning('请先完成陪伴学习基础任务');

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 bg-white/90 backdrop-blur-md border-t border-star-100"
      style={{ paddingBottom: 'var(--safe-bottom)' }}
    >
      <div className="max-w-7xl mx-auto grid grid-cols-5 h-16">
        {navItems.map(({ to, icon: Icon, label }) => {
          const locked = isLocked(to);
          return (
            <NavLink
              key={to}
              to={to}
              onClick={(e) => {
                if (locked) {
                  e.preventDefault();
                  warnLocked();
                }
              }}
              className={({ isActive }) => cn(
                'flex flex-col items-center justify-center gap-1 text-xs transition-all',
                isActive
                  ? 'text-star-600'
                  : 'text-slate-400 hover:text-star-500',
                locked && 'grayscale opacity-50'
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
          );
        })}
      </div>
    </nav>
  );
}
