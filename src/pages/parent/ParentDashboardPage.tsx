import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFamilyStore } from '../../store/familyStore';
import { useModeStore } from '../../store/modeStore';
import { useCoinRecords } from '../../hooks/useCoinRecords';
import { useTasks } from '../../hooks/useTasks';
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
import { fetchPendingStudyReviews } from '../../api/pets';
import { fetchQuestionReports } from '../../api/challenges';
import { Coins, Settings, Lock, Trash2, Plus, Minus, KeyRound, CheckCircle, Trophy, Gift, BookOpen, PawPrint } from 'lucide-react';

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

  // 三个入口角标计数
  const [pendingTaskCount, setPendingTaskCount] = useState(0);
  const [pendingStudyCount, setPendingStudyCount] = useState(0);
  const [pendingReportCount, setPendingReportCount] = useState(0);

  const loadBadgeCounts = () => {
    // 任务达成：待审核任务数
    setPendingTaskCount(tasks.filter(t => t.status === 'pending_approval').length);
    // 学习完成：待审核学习记录
    if (family?.id) {
      fetchPendingStudyReviews(family.id).then(r => setPendingStudyCount(r.length)).catch(() => {});
    }
    // 题目报错：待处理报错
    fetchQuestionReports().then(r => setPendingReportCount(r.filter(x => x.status === 'pending').length)).catch(() => {});
  };

  useEffect(() => { loadBadgeCounts(); }, [family?.id, tasks]);
  // 从子页面返回时刷新计数
  useEffect(() => {
    const onFocus = () => loadBadgeCounts();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [family?.id, tasks]);

  const childMembers = members.filter(m => m.role === 'child');
  const parentMember = members.find(m => m.role === 'parent');
  const currentChild = childMembers.find(m => m.id === currentChildId) ?? childMembers[0];

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

  // 占位按钮：点击提示"功能待开发"
  const handlePlaceholder = (label: string) => toast.info(`${label}功能待开发`);

  // 跳转（带可选 query）
  const go = (route: string, query?: string) =>
    navigate(query ? `${route}?${query}` : route);

  // 快速验证按钮
  const quickVerifyButtons = [
    { label: '成就达成', onClick: () => go(ROUTES.PARENT_VERIFICATION), badge: pendingTaskCount },
    { label: '陪伴任务', onClick: () => go(ROUTES.PARENT_STUDY_TASKS), badge: 0 },
    { label: '学习完成', onClick: () => go(ROUTES.PARENT_STUDY_REVIEW), badge: pendingStudyCount },
  ];

  // 领取成就按钮
  const achievementButtons = [
    { label: '成就库', onClick: () => go(ROUTES.PARENT_TASKS), badge: 0 },
    { label: '勋章库', onClick: () => handlePlaceholder('勋章库'), badge: 0 },
    { label: '成功日记', onClick: () => handlePlaceholder('成功日记'), badge: 0 },
  ];

  // 特权兑换按钮
  const privilegeButtons = [
    { label: '特权库', onClick: () => go(ROUTES.PARENT_SHOP), badge: 0 },
    { label: '用户特权卡', onClick: () => go(ROUTES.PARENT_SHOP, 'tab=users'), badge: 0 },
    { label: '转盘权重', onClick: () => go(ROUTES.PARENT_SHOP, 'open=wheel'), badge: 0 },
  ];

  // 智慧星战按钮（两行）
  const starBattleButtons = [
    { label: '家默', onClick: () => go(ROUTES.PARENT_DICTATION), badge: 0 },
    { label: '背诵', onClick: () => go(ROUTES.PARENT_RECITATION), badge: 0 },
    { label: '关卡库', onClick: () => go(ROUTES.PARENT_CHALLENGES, 'tab=levels'), badge: 0 },
    { label: '题集库', onClick: () => go(ROUTES.PARENT_CHALLENGES, 'tab=sets'), badge: 0 },
    { label: '错题库', onClick: () => go(ROUTES.PARENT_CHALLENGES, 'tab=wrong_battle'), badge: 0 },
    { label: '题目报错', onClick: () => go(ROUTES.PARENT_QUESTION_REPORTS), badge: pendingReportCount },
    { label: '病句库', onClick: () => handlePlaceholder('病句库'), badge: 0 },
    { label: '连词成句库', onClick: () => handlePlaceholder('连词成句库'), badge: 0 },
    { label: '翻译库', onClick: () => handlePlaceholder('翻译库'), badge: 0 },
    { label: '通用语法', onClick: () => handlePlaceholder('通用语法'), badge: 0 },
  ];

  // 萌宠星球按钮（两行）
  const petPlanetButtons = [
    { label: '萌宠闯关', onClick: () => go(ROUTES.PARENT_WORD_CHALLENGE), badge: 0 },
    { label: '萌宠商店', onClick: () => go(ROUTES.PARENT_PETS, 'tab=shop'), badge: 0 },
    { label: '用户管理', onClick: () => go(ROUTES.PARENT_PETS, 'tab=user'), badge: 0 },
    { label: '背景管理', onClick: () => go(ROUTES.PARENT_PETS, 'tab=bg'), badge: 0 },
    { label: '新宠抽卡', onClick: () => go(ROUTES.PARENT_PETS, 'tab=gacha'), badge: 0 },
    { label: '特质配置', onClick: () => go(ROUTES.PARENT_PET_TRAITS), badge: 0 },
    { label: '新宠测试', onClick: () => handlePlaceholder('新宠测试'), badge: 0 },
    { label: '新宠奇遇', onClick: () => handlePlaceholder('新宠奇遇'), badge: 0 },
    { label: '宠物店', onClick: () => handlePlaceholder('宠物店'), badge: 0 },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-4 px-2">
      {/* 顶部：左上角「家长管理后台」与设置按钮对齐 */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">家长管理后台</h1>
        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-1 px-3 py-2 rounded-full bg-slate-100 hover:bg-slate-200 transition-colors"
        >
          <Settings className="w-4 h-4 text-slate-500" />
          <span className="text-sm">设置</span>
        </button>
      </div>

      {/* 第1行：手动加减分 | 快速验证 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 手动加减分 */}
        <Card className="p-4 space-y-2 border-star-200 bg-star-50/30">
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
                'flex-1 flex items-center justify-center gap-1 py-1 rounded-lg text-xs font-medium transition-colors',
                adjustForm.balanceType === 'star'
                  ? 'bg-gradient-to-r from-purple-400 to-purple-500 text-white shadow'
                  : 'bg-slate-100 text-slate-500'
              )}
            >
              <img src={STAR_ICON_SM} alt="星光值" className="w-3.5 h-3.5" />
              星光值
            </button>
            <button
              onClick={() => setAdjustForm(p => ({ ...p, balanceType: 'coin' }))}
              className={cn(
                'flex-1 flex items-center justify-center gap-1 py-1 rounded-lg text-xs font-medium transition-colors',
                adjustForm.balanceType === 'coin'
                  ? 'bg-gradient-to-r from-amber-400 to-amber-500 text-white shadow'
                  : 'bg-slate-100 text-slate-500'
              )}
            >
              <img src={COIN_ICON_SM} alt="金币" className="w-3.5 h-3.5" />
              金币
            </button>
          </div>
          {/* 加减按钮 + 数量 + 确认 + 留言原因，同一行，高度压缩 */}
          <div className="flex gap-1.5 items-center">
            <button
              onClick={() => setAdjustForm(p => ({ ...p, direction: 'add' }))}
              className={cn(
                'flex items-center justify-center w-7 h-7 rounded-full font-bold transition-colors shrink-0',
                adjustForm.direction === 'add'
                  ? 'bg-emerald-400 text-white'
                  : 'bg-slate-100 text-slate-400'
              )}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setAdjustForm(p => ({ ...p, direction: 'sub' }))}
              className={cn(
                'flex items-center justify-center w-7 h-7 rounded-full font-bold transition-colors shrink-0',
                adjustForm.direction === 'sub'
                  ? 'bg-red-400 text-white'
                  : 'bg-slate-100 text-slate-400'
              )}
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <Input
              type="number"
              min={1}
              value={adjustForm.amount}
              onChange={e => setAdjustForm(p => ({ ...p, amount: Number(e.target.value) }))}
              placeholder="数量"
              className="w-12 shrink-0 text-sm"
            />
            <Button
              loading={adjusting}
              onClick={handleManualAdjust}
              variant={adjustForm.direction === 'add' ? undefined : 'danger'}
              className="shrink-0 text-xs px-2 py-1"
            >
              确认
            </Button>
            <Input
              value={adjustForm.reason}
              onChange={e => setAdjustForm(p => ({ ...p, reason: e.target.value }))}
              placeholder="留言原因（选填）"
              className="flex-1 min-w-[80px] text-sm"
            />
          </div>
        </Card>

        {/* 快速验证 */}
        <Card className="p-4 space-y-2 border-star-200 bg-star-50/30">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-star-500" />
            <h2 className="font-bold text-star-700">快速验证</h2>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {quickVerifyButtons.map(b => (
              <button
                key={b.label}
                onClick={b.onClick}
                className="relative px-2 py-2.5 rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-amber-100 hover:from-amber-100 hover:to-amber-200 text-amber-700 text-sm font-medium transition-all hover:shadow-md active:scale-95 text-center"
              >
                {b.label}
                {b.badge ? (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full">
                    {b.badge > 99 ? '99+' : b.badge}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* 第2行：领取成就 | 特权兑换 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-4 space-y-2 border-star-200 bg-star-50/30">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-star-500" />
            <h2 className="font-bold text-star-700">领取成就</h2>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {achievementButtons.map(b => (
              <button
                key={b.label}
                onClick={b.onClick}
                className="px-2 py-2.5 rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-amber-100 hover:from-amber-100 hover:to-amber-200 text-amber-700 text-sm font-medium transition-all hover:shadow-md active:scale-95 text-center"
              >
                {b.label}
              </button>
            ))}
          </div>
        </Card>
        <Card className="p-4 space-y-2 border-star-200 bg-star-50/30">
          <div className="flex items-center gap-2">
            <Gift className="w-5 h-5 text-star-500" />
            <h2 className="font-bold text-star-700">特权兑换</h2>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {privilegeButtons.map(b => (
              <button
                key={b.label}
                onClick={b.onClick}
                className="px-2 py-2.5 rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-amber-100 hover:from-amber-100 hover:to-amber-200 text-amber-700 text-sm font-medium transition-all hover:shadow-md active:scale-95 text-center"
              >
                {b.label}
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* 第3行：智慧星战（通栏） */}
      <Card className="p-4 space-y-2 border-star-200 bg-star-50/30">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-star-500" />
          <h2 className="font-bold text-star-700">智慧星战</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
          {starBattleButtons.map(b => (
            <button
              key={b.label}
              onClick={b.onClick}
              className="relative px-2 py-2.5 rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-amber-100 hover:from-amber-100 hover:to-amber-200 text-amber-700 text-sm font-medium transition-all hover:shadow-md active:scale-95 text-center"
            >
              {b.label}
              {b.badge ? (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full">
                  {b.badge > 99 ? '99+' : b.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </Card>

      {/* 第4行：萌宠星球（通栏） */}
      <Card className="p-4 space-y-2 border-star-200 bg-star-50/30">
        <div className="flex items-center gap-2">
          <PawPrint className="w-5 h-5 text-star-500" />
          <h2 className="font-bold text-star-700">萌宠星球</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
          {petPlanetButtons.map(b => (
            <button
              key={b.label}
              onClick={b.onClick}
              className="px-2 py-2.5 rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-amber-100 hover:from-amber-100 hover:to-amber-200 text-amber-700 text-sm font-medium transition-all hover:shadow-md active:scale-95 text-center"
            >
              {b.label}
            </button>
          ))}
        </div>
      </Card>

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
