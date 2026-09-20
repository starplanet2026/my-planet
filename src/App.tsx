import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppRoutes } from './routes';
import { ToastContainer } from './components/common/Toast';
import { useFamilyStore } from './store/familyStore';
import { supabase } from './api/client';
import { Loading } from './components/common/Loading';

export default function App() {
  const navigate = useNavigate();
  const load = useFamilyStore(s => s.load);
  const family = useFamilyStore(s => s.family);
  const loading = useFamilyStore(s => s.loading);
  const [checking, setChecking] = useState(true);

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
      load().then(() => setChecking(false));
    });
  }, []);

  // 监听登录状态变化
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        navigate('/setup');
      } else if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        load().then(() => {
          if (!useFamilyStore.getState().family) {
            navigate('/setup');
          }
        });
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  if (checking || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loading text="正在加载星球..." />
      </div>
    );
  }

  // 未登录且不在 setup 页 → 重定向
  if (!family && window.location.pathname !== '/setup') {
    navigate('/setup');
  }

  return (
    <>
      <AppRoutes />
      <ToastContainer />
    </>
  );
}
