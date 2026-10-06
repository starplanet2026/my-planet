import { useState, useEffect, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useModeStore } from '../store/modeStore';
import { PinGate } from '../components/parent/PinGate';
import { ROUTES } from '../lib/constants';

/**
 * 家长模式守卫。
 *
 * 改造要点（配合 KeepAlive）：
 * - 始终渲染 children，保证页面组件不被卸载、状态得以保留
 * - 仅当「当前处于家长路由且未解锁」时，叠加 PIN 码弹窗遮罩
 * - 关闭弹窗时回退到首页
 */
export function RequireParentMode({ children }: { children: ReactNode }) {
  const unlocked = useModeStore(s => s.parentUnlocked);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isParentRoute = pathname.startsWith('/parent');
  const [showPin, setShowPin] = useState(false);

  // 进入家长路由但未解锁时弹出 PIN
  useEffect(() => {
    if (isParentRoute && !unlocked) {
      setShowPin(true);
    }
  }, [isParentRoute, unlocked]);

  return (
    <>
      {children}
      {isParentRoute && !unlocked && (
        <PinGate open={showPin} onClose={() => navigate(ROUTES.HOME)} />
      )}
    </>
  );
}
