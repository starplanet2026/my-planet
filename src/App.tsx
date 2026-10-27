import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AppRoutes } from './routes';
import { ToastContainer } from './components/common/Toast';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { useFamilyStore } from './store/familyStore';
import { useAppContextStore } from './store/appContextStore';
import { supabase } from './api/client';
import { Loading } from './components/common/Loading';

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const load = useFamilyStore(s => s.load);
  const loadAppContext = useAppContextStore(s => s.load);
  const family = useFamilyStore(s => s.family);
  const loading = useFamilyStore(s => s.loading);
  const [checking, setChecking] = useState(true);
  // 已加载过的登录用户 id：用于跳过「同一用户重复派发的 SIGNED_IN」
  const loadedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    // 检测登录状态
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        // 未登录 → 首次设置
        navigate('/setup');
        setChecking(false);
        return;
      }
      // 已登录 → 加载家庭数据
      loadedUserIdRef.current = session.user?.id ?? null;
      loadAppContext();
      load().then(() => setChecking(false));
    });
  }, []);

  // 监听登录状态变化
  // 注意：supabase auth-js 会注册 visibilitychange 监听，标签页从后台切回前台时
  // 调用 _recoverAndRefresh() 并「再次」派发 SIGNED_IN 事件。因此 SIGNED_IN 不等于
  // 「刚登录」，不能用它触发整页重载；仅当登录用户发生变化时才重新加载数据。
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        loadedUserIdRef.current = null;
        navigate('/setup');
      } else if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        const userId = session?.user?.id ?? null;
        // 同一用户重复派发（切标签/切窗口回来）→ 跳过，保持当前页面状态、不发请求
        if (userId && userId === loadedUserIdRef.current && useFamilyStore.getState().family) {
          return;
        }
        loadedUserIdRef.current = userId;
        loadAppContext();
        load().then(() => {
          if (!useFamilyStore.getState().family) {
            navigate('/setup');
          }
        });
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // 仅在「尚无家庭数据」时才用全屏 Loading 覆盖整个应用。
  // 已有数据时不再因为 loading 卸载 AppRoutes —— 否则每次切回前台触发
  // 的一次静默 load() 都会重建整棵路由树，清空所有 KeepAlive 页面状态，
  // 表现为「切回来整页重新加载、Tab/筛选/滚动位置全部丢失」。
  if (checking || (loading && !family)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loading text="正在加载星球..." />
      </div>
    );
  }

  // 未登录且不在 setup 页 → 重定向（用 <Navigate> 在渲染期安全跳转，
  // 避免在 render 中调用 navigate() 触发"渲染期间更新组件"循环告警导致卡死）
  // 注意：必须用 useLocation().pathname（相对 basename），不能用 window.location.pathname，
  // 否则子路径部署（/my-planet/）下路径永远不等于 '/setup' 导致无限重定向白屏。
  if (!family && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />;
  }

  return (
    <ErrorBoundary>
      <AppRoutes />
      <ToastContainer />
    </ErrorBoundary>
  );
}
