import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { useFamilyStore } from '../../store/familyStore';
import { useModeStore } from '../../store/modeStore';
import { useToastStore } from '../../store/toastStore';
import {
  initFamily, initFamilyByPhone, signIn, signInWithPhone,
  isValidChinaPhone, normalizePhone,
} from '../../api/family';
import { ROUTES } from '../../lib/constants';

type Method = 'phone' | 'email';
type Action = 'login' | 'register';

export function InitSetupPage() {
  const navigate = useNavigate();
  const loadFamily = useFamilyStore(s => s.load);
  const setChild = useModeStore(s => s.setChild);
  const toast = useToastStore();

  const [method, setMethod] = useState<Method>('phone');
  const [loadingAction, setLoadingAction] = useState<Action | null>(null);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  const enterApp = async () => {
    await loadFamily();
    const family = useFamilyStore.getState();
    const firstChild = family.members?.find(m => m.role === 'child');
    if (firstChild) setChild(firstChild.id);
  };

  const validate = (): string | null => {
    if (method === 'phone') {
      if (!isValidChinaPhone(phone)) return '请输入正确的 11 位手机号';
    } else {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return '请输入正确的邮箱地址';
    }
    if (password.length < 6) return '密码至少 6 位';
    return null;
  };

  const handleRegister = async () => {
    const err = validate();
    if (err) { toast.error(err); return; }
    setLoadingAction('register');
    try {
      if (method === 'phone') {
        await initFamilyByPhone('我的家庭', normalizePhone(phone), password);
      } else {
        await initFamily('我的家庭', email.trim(), password);
      }
      await enterApp();
      toast.success('注册成功！欢迎使用 My Planet');
      // 首次进入默认落在「萌宠星球」板块
      navigate(ROUTES.PET, { replace: true });
    } catch (e: any) {
      toast.error(e?.message ?? '注册失败');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleLogin = async () => {
    const err = validate();
    if (err) { toast.error(err); return; }
    setLoadingAction('login');
    try {
      if (method === 'phone') {
        await signInWithPhone(normalizePhone(phone), password);
      } else {
        await signIn(email.trim(), password);
      }
      await enterApp();
      toast.success('登录成功！');
      // 登录后默认落在「萌宠星球」板块
      navigate(ROUTES.PET, { replace: true });
    } catch (e: any) {
      toast.error(e?.message ?? '登录失败');
    } finally {
      setLoadingAction(null);
    }
  };

  // 阻止表单默认提交（页面上无 submit 按钮，两个按钮均为显式点击动作）
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 px-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-8">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">🪐</div>
            <h1 className="text-2xl font-bold text-slate-900">欢迎来到 My Planet</h1>
            <p className="text-sm text-slate-500 mt-2">使用手机号或邮箱登录 / 注册家长账号</p>
          </div>

          {/* 方式切换：手机号 / 邮箱 */}
          <div className="flex bg-slate-100 rounded-full p-1">
            <button
              type="button"
              onClick={() => setMethod('phone')}
              className={`flex-1 py-2 rounded-full text-sm font-medium transition-colors ${
                method === 'phone' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
              }`}
            >
              手机号
            </button>
            <button
              type="button"
              onClick={() => setMethod('email')}
              className={`flex-1 py-2 rounded-full text-sm font-medium transition-colors ${
                method === 'email' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
              }`}
            >
              邮箱
            </button>
          </div>

          {/* 账号输入 */}
          {method === 'phone' ? (
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">手机号</label>
              <div className="flex items-center gap-2">
                <div className="flex-shrink-0 h-11 px-3 flex items-center rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-600 min-h-[44px]">
                  +86
                </div>
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={11}
                  required
                  placeholder="请输入 11 位手机号"
                  value={phone}
                  onChange={e => setPhone(e.target.value.replace(/[^\d]/g, '').slice(0, 11))}
                  className="flex-1 min-w-0 w-full rounded-xl border border-slate-200 px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-h-[44px]"
                />
              </div>
            </div>
          ) : (
            <Input
              label="家长邮箱"
              type="email"
              required
              placeholder="parent@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          )}
          <Input
            label="密码"
            type="password"
            required
            placeholder="至少 6 位"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />

          {/* 登录 / 注册 双按钮 */}
          <div className="flex gap-3 pt-1">
            <Button
              type="button"
              variant="primary"
              size="lg"
              fullWidth
              loading={loadingAction === 'login'}
              onClick={handleLogin}
            >
              登录
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              fullWidth
              loading={loadingAction === 'register'}
              onClick={handleRegister}
            >
              注册
            </Button>
          </div>
          <p className="text-xs text-slate-400 text-center mt-2">
            未注册的账号点击「注册」即可自动创建；注册后在孩子端"我的"页面设置名字和头像
          </p>
        </form>
      </div>
    </div>
  );
}
