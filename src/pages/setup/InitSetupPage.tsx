import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { useFamilyStore } from '../../store/familyStore';
import { useModeStore } from '../../store/modeStore';
import { useToastStore } from '../../store/toastStore';
import { initFamily, signIn } from '../../api/family';
import { ROUTES } from '../../lib/constants';

export function InitSetupPage() {
  const navigate = useNavigate();
  const loadFamily = useFamilyStore(s => s.load);
  const setChild = useModeStore(s => s.setChild);
  const toast = useToastStore();

  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleRegister = async () => {
    if (password.length < 6) { toast.error('密码至少 6 位'); return; }
    setLoading(true);
    try {
      await initFamily('我的家庭', email, password);
      await loadFamily();
      const family = useFamilyStore.getState();
      const firstChild = family.members.find(m => m.role === 'child');
      if (firstChild) setChild(firstChild.id);
      toast.success('注册成功！欢迎使用 My Planet');
      navigate(ROUTES.HOME);
    } catch (err: any) {
      toast.error(err?.message ?? '注册失败');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    setLoading(true);
    try {
      await signIn(email, password);
      await loadFamily();
      const family = useFamilyStore.getState();
      const firstChild = family.members?.find(m => m.role === 'child');
      if (firstChild) setChild(firstChild.id);
      toast.success('登录成功！');
      navigate(ROUTES.HOME);
    } catch (err: any) {
      toast.error(err?.message ?? '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'register') handleRegister();
    else handleLogin();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 px-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-8">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">🪐</div>
            <h1 className="text-2xl font-bold text-slate-900">
              {mode === 'register' ? '欢迎来到 My Planet' : '登录 My Planet'}
            </h1>
            <p className="text-sm text-slate-500 mt-2">
              {mode === 'register' ? '注册一个家长账号，开启你的星球之旅' : '登录已有账号继续使用'}
            </p>
          </div>

          {/* 注册/登录切换 */}
          <div className="flex bg-slate-100 rounded-full p-1">
            <button
              type="button"
              onClick={() => setMode('register')}
              className={`flex-1 py-2 rounded-full text-sm font-medium transition-colors ${
                mode === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
              }`}
            >
              注册
            </button>
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`flex-1 py-2 rounded-full text-sm font-medium transition-colors ${
                mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
              }`}
            >
              登录
            </button>
          </div>

          <Input
            label="家长邮箱"
            type="email"
            required
            placeholder="parent@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
          <Input
            label="密码"
            type="password"
            required
            placeholder="至少 6 位"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          <Button type="submit" fullWidth size="lg" loading={loading}>
            {mode === 'register' ? '注册并开始' : '登录'}
          </Button>
          <p className="text-xs text-slate-400 text-center mt-2">
            {mode === 'register'
              ? '注册后在孩子端"我的"页面设置名字和头像，金币点击 2 次进入家长端设置 PIN 码'
              : '登录后即可继续使用'}
          </p>
        </form>
      </div>
    </div>
  );
}
