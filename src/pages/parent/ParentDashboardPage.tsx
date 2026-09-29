import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFamilyStore } from '../../store/familyStore';
import { useModeStore } from '../../store/modeStore';
import { useTasks } from '../../hooks/useTasks';
import { useCoinRecords } from '../../hooks/useCoinRecords';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { Avatar } from '../../components/common/Avatar';
import { useToastStore } from '../../store/toastStore';
import { ROUTES, CHILD_EMOJIS, STAR_ICON_SM, COIN_ICON_SM } from '../../lib/constants';
import { cn } from '../../lib/utils';
import { changePassword, resetAllData, setParentPin } from '../../api/family';
import { addChild, deleteMember } from '../../api/members';
import { ListTodo, ShoppingBag, CheckCircle, Coins, Settings, Lock, Trash2, Plus, Minus, BookOpen, PawPrint, Mic, KeyRound, Gamepad2, Flag } from 'lucide-react';

export function ParentDashboardPage() {
  const navigate = useNavigate();
  const family = useFamilyStore(s => s.family);
  const members = useFamilyStore(s => s.members);
  const loadFamily = useFamilyStore(s => s.load);
  const refreshMembers = useFamilyStore(s => s.refreshMembers);
  const currentChildId = useModeStore(s => s.currentChildId);
  const setChild = useModeStore(s => s.setChild);
  const multiChildMode = useModeStore(s => s.multiChildMode);
  const setMultiChildMode = useModeStore(s => s.setMultiChildMode);
  const { manualAdjustCoins, refresh: refreshRecords } = useCoinRecords();
  const { tasks } = useTasks();
  const toast = useToastStore();

  const childMembers = members.filter(m => m.role === 'child');
  const parentMember = members.find(m => m.role === 'parent');
  const currentChild = childMembers.find(m => m.id === currentChildId) ?? childMembers[0];
  const pendingCount = tasks.filter(t => t.status === 'pending_approval').length;

  const [adjusting, setAdjusting] = useState(false);
  const [adjustForm, setAdjustForm] = useState({
    amount: 1,
    reason: '',
    direction: 'add' as 'add' | 'sub',
    balanceType: 'star' as 'coin' | 'star',
  });

  // 设置
  const [showSettings, setShowSettings] = useState(false);
  const [showAddChild, setShowAddChild] = useState(false);
  const [newChildName, setNewChildName] = useState('');
  const [newChildEmoji, setNewChildEmoji] = useState('🦁');
  const [addingChild, setAddingChild] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<typeof childMembers[0] | null>(null);
  const [deletingMember, setDeletingMember] = useState(false);
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [changingPwd, setChangingPwd] = useState(false);
  const [showChangePin, setShowChangePin] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [changingPin, setChangingPin] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleManualAdjust = async () => {
    if (!family || !parentMember || !currentChild) return;
    if (!adjustForm.reason.trim()) { toast.error('请填写原因'); return; }

    setAdjusting(true);
    try {
      const amount = adjustForm.direction === 'add'
        ? Number(adjustForm.amount)
        : -Number(adjustForm.amount);
      const result = await manualAdjustCoins(
        family.id,
        currentChild.id,
        amount,
        adjustForm.reason.trim(),
        parentMember.id,
        adjustForm.balanceType
      );
      await refreshRecords();
      await refreshMembers();
      const label = adjustForm.balanceType === 'star' ? '星光值' : '金币';
      toast.success(`${amount > 0 ? '+' : ''}${result.amount} ${label}`);
      setAdjustForm({ amount: 1, reason: '', direction: 'add', balanceType: 'star' });
    } catch (e: any) {
      toast.error(e?.message ?? '操作失败');
    } finally {
      setAdjusting(false);
    }
  };

  const handleAddChild = async () => {
    if (!family) return;
    if (!newChildName.trim()) { toast.error('请输入名字'); return; }
    setAddingChild(true);
    try {
      await addChild(family.id, newChildName.trim(), newChildEmoji);
      await loadFamily();
      toast.success('已添加小朋友');
      setShowAddChild(false);
      setNewChildName('');
      setNewChildEmoji('🦁');
    } catch (e: any) {
      toast.error(e?.message ?? '添加失败');
    } finally {
      setAddingChild(false);
    }
  };

  const handleDeleteMember = async () => {
    if (!deleteTarget) return;
    setDeletingMember(true);
    try {
      await deleteMember(deleteTarget.id);
      await loadFamily();
      toast.success('已删除');
      setDeleteTarget(null);
    } catch (e: any) {
      toast.error(e?.message ?? '删除失败');
    } finally {
      setDeletingMember(false);
    }
  };

  const handleChangePwd = async () => {
    if (newPassword.length < 6) { toast.error('密码至少 6 位'); return; }
    setChangingPwd(true);
    try {
      await changePassword(newPassword);
      toast.success('密码已修改');
      setShowChangePwd(false);
      setNewPassword('');
    } catch (e: any) {
      toast.error(e?.message ?? '修改失败');
    } finally {
      setChangingPwd(false);
    }
  };

  const handleChangePin = async () => {
    if (newPin.length < 4) { toast.error('PIN 码至少 4 位'); return; }
    if (newPin !== confirmPin) { toast.error('两次 PIN 码不一致'); return; }
    setChangingPin(true);
    try {
      await setParentPin(newPin);
      toast.success('PIN 码已修改');
      setShowChangePin(false);
      setNewPin('');
      setConfirmPin('');
    } catch (e: any) {
      toast.error(e?.message ?? '修改失败');
    } finally {
      setChangingPin(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      await resetAllData();
      toast.success('所有数据已清除');
      window.location.reload();
    } catch (e: any) {
      toast.error(e?.message ?? '重置失败');
    } finally {
      setResetting(false);
    }
  };

  const actions = [
    { label: '家默管理', icon: BookOpen, route: ROUTES.PARENT_DICTATION, color: 'blue' },
    { label: '背诵管理', icon: Mic, route: ROUTES.PARENT_RECITATION, color: 'emerald' },
    { label: '任务管理', icon: ListTodo, route: ROUTES.PARENT_TASKS, color: 'blue' },
    { label: '验证申请', icon: CheckCircle, route: ROUTES.PARENT_VERIFICATION, color: 'green' },
    { label: '特权管理', icon: ShoppingBag, route: ROUTES.PARENT_SHOP, color: 'purple' },
    { label: '智慧星战', icon: BookOpen, route: ROUTES.PARENT_CHALLENGES, color: 'star' },
    { label: '萌宠星球', icon: PawPrint, route: ROUTES.PARENT_PETS, color: 'amber' },
    { label: '萌宠闯关', icon: Gamepad2, route: ROUTES.PARENT_WORD_CHALLENGE, color: 'emerald' },
    { label: '题目报错', icon: Flag, route: ROUTES.PARENT_QUESTION_REPORTS, color: 'red' },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{family?.name ?? '我的家庭'}</h1>
          <p className="text-sm text-slate-500 mt-1">家长管理后台</p>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-1 px-3 py-2 rounded-full bg-slate-100 hover:bg-slate-200 transition-colors"
        >
          <Settings className="w-4 h-4 text-slate-500" />
          <span className="text-sm">设置</span>
        </button>
      </div>

      {/* 手动加减分板块 */}
      <Card className="p-4 space-y-3 border-star-200 bg-star-50/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Coins className="w-5 h-5 text-star-500" />
            <h2 className="font-bold text-star-700">手动加减分</h2>
          </div>
          {currentChild && (
            <span className="text-sm text-slate-500 flex items-center gap-1">
              <Avatar emoji={currentChild.avatar_emoji} size="sm" />
              {currentChild.name}
            </span>
          )}
        </div>
        {/* 货币类型切换 */}
        <div className="flex gap-2">
          <button
            onClick={() => setAdjustForm(p => ({ ...p, balanceType: 'star' }))}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium transition-colors',
              adjustForm.balanceType === 'star'
                ? 'bg-gradient-to-r from-purple-400 to-purple-500 text-white shadow'
                : 'bg-slate-100 text-slate-500'
            )}
          >
            <img src={STAR_ICON_SM} alt="星光值" className="w-4 h-4" />
            星光值
          </button>
          <button
            onClick={() => setAdjustForm(p => ({ ...p, balanceType: 'coin' }))}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium transition-colors',
              adjustForm.balanceType === 'coin'
                ? 'bg-gradient-to-r from-amber-400 to-amber-500 text-white shadow'
                : 'bg-slate-100 text-slate-500'
            )}
          >
            <img src={COIN_ICON_SM} alt="金币" className="w-4 h-4" />
            金币
          </button>
        </div>
        {/* 数字 + 加减分 一排 */}
        <div className="flex gap-2 items-center">
          <button
            onClick={() => setAdjustForm(p => ({ ...p, direction: 'add' }))}
            className={cn(
              'flex items-center justify-center w-10 h-10 rounded-full font-bold transition-colors shrink-0',
              adjustForm.direction === 'add'
                ? 'bg-emerald-400 text-white'
                : 'bg-slate-100 text-slate-400'
            )}
          >
            <Plus className="w-5 h-5" />
          </button>
          <button
            onClick={() => setAdjustForm(p => ({ ...p, direction: 'sub' }))}
            className={cn(
              'flex items-center justify-center w-10 h-10 rounded-full font-bold transition-colors shrink-0',
              adjustForm.direction === 'sub'
                ? 'bg-red-400 text-white'
                : 'bg-slate-100 text-slate-400'
            )}
          >
            <Minus className="w-5 h-5" />
          </button>
          <Input
            type="number"
            min={1}
            value={adjustForm.amount}
            onChange={e => setAdjustForm(p => ({ ...p, amount: Number(e.target.value) }))}
            placeholder="数量"
            className="flex-1"
          />
          <Button
            loading={adjusting}
            onClick={handleManualAdjust}
            variant={adjustForm.direction === 'add' ? undefined : 'danger'}
            className="shrink-0"
          >
            确认
          </Button>
        </div>
        {/* 留言原因单行 */}
        <Input
          value={adjustForm.reason}
          onChange={e => setAdjustForm(p => ({ ...p, reason: e.target.value }))}
          placeholder="留言原因（必填）"
        />
      </Card>

      {/* 快捷操作 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {actions.map(a => (
          <Card
            key={a.label}
            className="p-4 cursor-pointer hover:shadow-md transition-shadow relative"
            onClick={() => navigate(a.route)}
          >
            <div className={`w-10 h-10 rounded-xl bg-${a.color}-50 flex items-center justify-center mb-2`}>
              <a.icon className={`w-5 h-5 text-${a.color}-500`} />
            </div>
            <span className="text-sm font-medium">{a.label}</span>
            {a.label === '验证申请' && pendingCount > 0 && (
              <span className="absolute top-2 right-2 min-w-5 h-5 px-1 flex items-center justify-center bg-red-500 text-white text-xs font-bold rounded-full">
                {pendingCount}
              </span>
            )}
          </Card>
        ))}
      </div>

      {/* 设置弹窗 */}
      <Modal open={showSettings} onClose={() => setShowSettings(false)} title="设置" size="sm">
        <div className="space-y-4">
          {/* 成员管理 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">成员管理</span>
              <button
                onClick={() => setShowAddChild(true)}
                className="flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-star-50 text-star-600 border border-star-200"
              >
                <Plus className="w-3 h-3" /> 添加
              </button>
            </div>
            <div className="space-y-1">
              {childMembers.map(m => (
                <div key={m.id} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
                  <span className="flex items-center gap-2">
                    <Avatar emoji={m.avatar_emoji} size="md" />
                    <span className="text-sm">{m.name}</span>
                    <span className="text-xs text-slate-400">{m.coin_balance} 金币</span>
                  </span>
                  <button
                    onClick={() => setDeleteTarget(m)}
                    className="p-1 text-red-400 hover:bg-red-50 rounded-full"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-slate-100" />

          {/* 多小朋友模式 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">多小朋友模式</span>
              <button
                onClick={() => {
                  const next = !multiChildMode;
                  setMultiChildMode(next);
                  if (next && currentChild) setChild(currentChild.id);
                }}
                className={cn(
                  'relative w-12 h-6 rounded-full transition-colors',
                  multiChildMode ? 'bg-star-400' : 'bg-slate-300'
                )}
              >
                <span className={cn(
                  'absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform',
                  multiChildMode ? 'translate-x-6' : 'translate-x-0.5'
                )} />
              </button>
            </div>
            {multiChildMode && (
              <p className="text-xs text-slate-400">开启后可在页面顶部切换小朋友</p>
            )}
          </div>

          <div className="border-t border-slate-100" />

          {/* 修改密码 */}
          <button
            onClick={() => setShowChangePwd(true)}
            className="w-full flex items-center justify-between p-2 hover:bg-slate-50 rounded-lg"
          >
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-medium">修改家长密码</span>
            </div>
          </button>

          {/* 修改 PIN 码 */}
          <button
            onClick={() => setShowChangePin(true)}
            className="w-full flex items-center justify-between p-2 hover:bg-slate-50 rounded-lg"
          >
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-medium">修改家长 PIN 码</span>
            </div>
          </button>

          <div className="border-t border-slate-100" />

          {/* 重置所有数据 */}
          <button
            onClick={() => setShowReset(true)}
            className="w-full flex items-center justify-between p-2 hover:bg-red-50 rounded-lg"
          >
            <div className="flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-red-400" />
              <span className="text-sm font-medium text-red-500">重置所有数据</span>
            </div>
          </button>
        </div>
      </Modal>

      {/* 添加小朋友弹窗 */}
      <Modal open={showAddChild} onClose={() => !addingChild && setShowAddChild(false)} title="添加小朋友" size="sm">
        <div className="space-y-4">
          <Input
            label="名字"
            placeholder="如：小红"
            value={newChildName}
            onChange={e => setNewChildName(e.target.value)}
            autoFocus
          />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">头像</label>
            <div className="grid grid-cols-8 gap-2">
              {CHILD_EMOJIS.map(emoji => (
                <button
                  key={emoji}
                  onClick={() => setNewChildEmoji(emoji)}
                  className={cn(
                    'aspect-square rounded-xl flex items-center justify-center text-2xl transition-all',
                    newChildEmoji === emoji
                      ? 'bg-star-100 ring-2 ring-star-400 scale-110'
                      : 'bg-slate-50 hover:bg-slate-100'
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
          <Button fullWidth loading={addingChild} onClick={handleAddChild}>
            添加
          </Button>
        </div>
      </Modal>

      {/* 删除成员确认 */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="删除成员？"
        message={`确认删除「${deleteTarget?.avatar_emoji?.startsWith('data:') ? '📷' : deleteTarget?.avatar_emoji} ${deleteTarget?.name}」？相关金币记录也会清除。`}
        confirmText="删除"
        variant="danger"
        onConfirm={handleDeleteMember}
        onClose={() => setDeleteTarget(null)}
      />

      {/* 修改密码弹窗 */}
      <Modal open={showChangePwd} onClose={() => !changingPwd && setShowChangePwd(false)} title="修改密码" size="sm">
        <div className="space-y-4">
          <Input
            label="新密码"
            type="password"
            placeholder="至少 6 位"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            autoFocus
          />
          <Button fullWidth loading={changingPwd} onClick={handleChangePwd}>
            确认修改
          </Button>
        </div>
      </Modal>

      {/* 修改 PIN 码弹窗 */}
      <Modal open={showChangePin} onClose={() => !changingPin && setShowChangePin(false)} title="修改家长 PIN 码" size="sm">
        <div className="space-y-4">
          <Input
            label="新 PIN 码"
            type="password"
            placeholder="至少 4 位"
            value={newPin}
            onChange={e => setNewPin(e.target.value)}
            autoFocus
          />
          <Input
            label="确认 PIN 码"
            type="password"
            placeholder="再次输入"
            value={confirmPin}
            onChange={e => setConfirmPin(e.target.value)}
          />
          <Button fullWidth loading={changingPin} onClick={handleChangePin}>
            确认修改
          </Button>
        </div>
      </Modal>

      {/* 重置确认 */}
      <ConfirmDialog
        open={showReset}
        title="重置所有数据？"
        message="这将删除家庭、任务、金币、特权等所有数据，不可恢复！"
        confirmText="确认重置"
        variant="danger"
        onConfirm={handleReset}
        onClose={() => setShowReset(false)}
      />
    </div>
  );
}
