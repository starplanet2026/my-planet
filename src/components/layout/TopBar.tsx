import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Shield, ChevronDown } from 'lucide-react';
import { useFamilyStore } from '../../store/familyStore';
import { useModeStore } from '../../store/modeStore';
import { supabase } from '../../api/client';
import { Modal } from '../common/Modal';
import { ROUTES, TASK_CATEGORIES, getTaskIconUrl, COIN_ICON_SM, STAR_ICON_SM } from '../../lib/constants';
import { formatCoins } from '../../lib/utils';
import { cn } from '../../lib/utils';
import type { Task } from '../../api/types';

// 判断是否为今日
function isToday(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

export function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const members = useFamilyStore(s => s.members);
  const familyId = useFamilyStore(s => s.family?.id);
  const currentChildId = useModeStore(s => s.currentChildId);
  const setChild = useModeStore(s => s.setChild);
  const multiChild = useModeStore(s => s.multiChildMode);
  const mode = useModeStore(s => s.mode);
  const lockParent = useModeStore(s => s.lockParent);

  const [showSwitcher, setShowSwitcher] = useState(false);
  const [showTodayCompleted, setShowTodayCompleted] = useState(false);
  const [showTodayAnswerRecords, setShowTodayAnswerRecords] = useState(false);
  // TopBar 专用的轻量数据（不走 useRealtimeTable 避免频道冲突）
  const [todayCompleted, setTodayCompleted] = useState<Task[]>([]);
  const [backpackCount, setBackpackCount] = useState(0);
  const [todayAnswerCount, setTodayAnswerCount] = useState(0);
  // 今日答题记录：按题集分组（题集名称 + 今日答题数量）
  const [todayAnswerGroups, setTodayAnswerGroups] = useState<{ title: string; count: number }[]>([]);

  const childMembers = members.filter(m => m.role === 'child');

  useEffect(() => {
    if (!currentChildId && members.length > 0) {
      const firstChild = members.find(m => m.role === 'child');
      if (firstChild) setChild(firstChild.id);
    }
  }, [members, currentChildId, setChild]);

  const currentChild = members.find(m => m.id === currentChildId && m.role === 'child')
    ?? members.find(m => m.role === 'child');

  // 货币信息：根据当前路由决定展示内容
  const isTasksPage = location.pathname === ROUTES.TASKS;
  const isShopPage = location.pathname === ROUTES.SHOP;
  const isPetPage = location.pathname === ROUTES.PET;
  const isChallengePage = location.pathname === ROUTES.CHALLENGE;

  // 轻量查询：只在对应页面 + 有 familyId 时拉取（不创建实时订阅频道）
  useEffect(() => {
    if (!familyId || !currentChild || !isTasksPage) {
      setTodayCompleted([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const { data } = await supabase
          .from('tasks')
          .select('*')
          .eq('family_id', familyId)
          .not('completed_at', 'is', null)
          .gte('completed_at', startOfDay.toISOString())
          .order('completed_at', { ascending: false });
        if (!cancelled) setTodayCompleted((data as Task[]) ?? []);
      } catch {
        if (!cancelled) setTodayCompleted([]);
      }
    })();
    return () => { cancelled = true; };
  }, [familyId, currentChild?.id, isTasksPage]);

  useEffect(() => {
    if (!familyId || !currentChild) {
      setBackpackCount(0);
      return;
    }
    if (!isShopPage) {
      setBackpackCount(0);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { count } = await supabase
          .from('purchases')
          .select('*', { count: 'exact', head: true })
          .eq('family_id', familyId)
          .eq('member_id', currentChild.id)
          .eq('status', 'pending');
        if (!cancelled) setBackpackCount(count ?? 0);
      } catch {
        if (!cancelled) setBackpackCount(0);
      }
    })();
    return () => { cancelled = true; };
  }, [familyId, currentChild, isShopPage]);

  // 智慧星战页面：查询今日答题数（答题记录 + 默写记录，剔除已删除题集）
  useEffect(() => {
    if (!currentChild || !isChallengePage) {
      setTodayAnswerCount(0);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const startISO = startOfDay.toISOString();
        // 答题记录：剔除 challenge_set_id 为 null（题集已删除）的记录
        const [{ count: qCount }, { count: dCount }] = await Promise.all([
          supabase
            .from('question_records')
            .select('*', { count: 'exact', head: true })
            .eq('member_id', currentChild.id)
            .not('challenge_set_id', 'is', null)
            .gte('answered_at', startISO),
          supabase
            .from('dictation_records')
            .select('*', { count: 'exact', head: true })
            .eq('member_id', currentChild.id)
            .gte('created_at', startISO),
        ]);
        if (!cancelled) setTodayAnswerCount((qCount ?? 0) + (dCount ?? 0));
      } catch {
        if (!cancelled) setTodayAnswerCount(0);
      }
    })();
    return () => { cancelled = true; };
  }, [currentChild?.id, isChallengePage]);

  // 打开答题记录弹窗时：加载今日答题记录，按来源（题集/默写任务）分组
  // 统计范围：智慧星战下全部答题入口（question_records）+ 默写入口（dictation_records）
  // 过滤：剔除 challenge_set_id 为 null（题集已删除）的无效记录
  useEffect(() => {
    if (!showTodayAnswerRecords || !currentChild) {
      setTodayAnswerGroups([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const startISO = startOfDay.toISOString();
        // 并行查询答题记录和默写记录
        const [qRes, dRes] = await Promise.all([
          supabase
            .from('question_records')
            .select('challenge_set_id, challenge_sets(title)')
            .eq('member_id', currentChild.id)
            .not('challenge_set_id', 'is', null)
            .gte('answered_at', startISO),
          supabase
            .from('dictation_records')
            .select('task_id, dictation_tasks(title)')
            .eq('member_id', currentChild.id)
            .gte('created_at', startISO),
        ]);
        if (cancelled) return;
        const map = new Map<string, { title: string; count: number }>();
        // 答题记录：按题集分组，来源名称取 challenge_sets.title
        for (const r of (qRes.data ?? []) as { challenge_set_id: string; challenge_sets: { title: string } | null }[]) {
          const id = 'q_' + r.challenge_set_id;
          const title = r.challenge_sets?.title ?? '未知题集';
          const cur = map.get(id);
          if (cur) cur.count += 1;
          else map.set(id, { title, count: 1 });
        }
        // 默写记录：按默写任务分组，来源名称取 dictation_tasks.title
        for (const r of (dRes.data ?? []) as { task_id: string; dictation_tasks: { title: string } | null }[]) {
          const id = 'd_' + r.task_id;
          const title = r.dictation_tasks?.title ?? '未知默写任务';
          const cur = map.get(id);
          if (cur) cur.count += 1;
          else map.set(id, { title, count: 1 });
        }
        // 按数量降序排列
        const groups = [...map.values()].sort((a, b) => b.count - a.count);
        setTodayAnswerGroups(groups);
      } catch {
        if (!cancelled) setTodayAnswerGroups([]);
      }
    })();
    return () => { cancelled = true; };
  }, [showTodayAnswerRecords, currentChild?.id]);

  const handleToggleClick = () => {
    if (mode === 'parent') return;
    navigate(ROUTES.PARENT_DASHBOARD);
  };

  // 渲染左侧货币区域
  const renderCurrencyBar = () => {
    if (isTasksPage && currentChild) {
      return (
        <div className="flex items-center gap-4">
          {/* 星光值 */}
          <div className="flex items-center gap-1.5">
            <img src={STAR_ICON_SM} alt="星光值" className="w-7 h-7 object-contain" />
            <span className="text-lg font-bold text-amber-600 tabular-nums">
              {currentChild.star_value ?? 0}
            </span>
          </div>
          <div className="w-px h-6 bg-slate-200" />
          {/* 今日达成（可点击） */}
          <button
            onClick={() => setShowTodayCompleted(true)}
            className="flex items-center gap-1.5 hover:bg-star-50 rounded-lg px-2 py-1.5 cursor-pointer transition-colors relative z-40"
          >
            <span className="text-sm text-slate-500 font-medium">今日达成</span>
            <span className="text-lg font-bold text-star-600 tabular-nums">
              {todayCompleted.length}
            </span>
          </button>
        </div>
      );
    }

    if (isShopPage && currentChild) {
      return (
        <div className="flex items-center gap-4">
          {/* 金币 */}
          <div className="flex items-center gap-1.5">
            <img src={COIN_ICON_SM} alt="金币" className="w-7 h-7 object-contain" />
            <span className="text-lg font-bold text-amber-600 tabular-nums">
              {formatCoins(currentChild.coin_balance)}
            </span>
          </div>
          <div className="w-px h-6 bg-slate-200" />
          {/* 背包 */}
          <button
            onClick={() => navigate(ROUTES.PROFILE)}
            className="flex items-center gap-1.5 hover:bg-star-50 rounded-lg px-1.5 py-1 cursor-pointer transition-colors"
          >
            <span className="text-sm text-slate-500 font-medium">背包</span>
            <span className="text-lg font-bold text-star-600 tabular-nums">
              {backpackCount}
            </span>
          </button>
        </div>
      );
    }

    if (isPetPage && currentChild) {
      return (
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <img src={STAR_ICON_SM} alt="星光值" className="w-7 h-7 object-contain" />
            <span className="text-lg font-bold text-amber-600 tabular-nums">
              {currentChild.star_value ?? 0}
            </span>
          </div>
          <div className="w-px h-6 bg-slate-200" />
          <div className="flex items-center gap-1.5">
            <img src={COIN_ICON_SM} alt="金币" className="w-7 h-7 object-contain" />
            <span className="text-lg font-bold text-amber-600 tabular-nums">
              {formatCoins(currentChild.coin_balance)}
            </span>
          </div>
        </div>
      );
    }

    if (isChallengePage && currentChild) {
      return (
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <img src={STAR_ICON_SM} alt="星光值" className="w-7 h-7 object-contain" />
            <span className="text-lg font-bold text-amber-600 tabular-nums">
              {currentChild.star_value ?? 0}
            </span>
          </div>
          <div className="w-px h-6 bg-slate-200" />
          {/* 今日答题：点击弹出按题集分组的答题记录 */}
          <button
            onClick={() => setShowTodayAnswerRecords(true)}
            className="flex items-center gap-1.5 hover:bg-star-50 rounded-lg px-2 py-1.5 cursor-pointer transition-colors relative z-40"
          >
            <span className="text-sm text-slate-500 font-medium">今日答题</span>
            <span className="text-lg font-bold text-star-600 tabular-nums">
              {todayAnswerCount}
            </span>
          </button>
        </div>
      );
    }

    // 其他页面：默认展示 My Planet + 当前孩子
    return (
      <div className="flex items-center gap-3">
        <span className="text-2xl">🌟</span>
        <span className="font-bold text-star-700 text-lg">My Planet</span>
        {currentChild && (
          <button
            onClick={() => multiChild && childMembers.length > 1 && setShowSwitcher(true)}
            disabled={!multiChild || childMembers.length <= 1}
            className={cn(
              'flex items-center gap-1 ml-2 px-2 py-1 rounded-full transition-colors',
              multiChild && childMembers.length > 1
                ? 'bg-star-50 hover:bg-star-100 cursor-pointer'
                : 'bg-star-50 cursor-default'
            )}
          >
            <span>{currentChild.avatar_emoji?.startsWith('data:') ? '🦁' : currentChild.avatar_emoji}</span>
            <span className="text-sm text-slate-600">{currentChild.name}</span>
            {multiChild && childMembers.length > 1 && (
              <ChevronDown className="w-3 h-3 text-slate-400" />
            )}
          </button>
        )}
      </div>
    );
  };

  return (
    <>
    <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-star-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {renderCurrencyBar()}

        <div className="flex items-center gap-2">
          <button
            onClick={handleToggleClick}
            className="p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
            aria-label="家长管理"
            title="家长管理"
          >
            <Shield className="w-5 h-5" />
          </button>
          {mode === 'parent' && (
            <button
              onClick={() => { lockParent(); navigate(ROUTES.HOME); }}
              className="text-sm text-slate-500 hover:text-slate-700 px-2"
            >
              退出家长
            </button>
          )}
        </div>
      </div>
    </header>

      {/* 孩子切换弹窗 */}
      <Modal open={showSwitcher} onClose={() => setShowSwitcher(false)} title="选择小朋友" size="sm">
        <div className="space-y-2">
          {childMembers.map(child => (
            <button
              key={child.id}
              onClick={() => { setChild(child.id); setShowSwitcher(false); }}
              className={cn(
                'w-full flex items-center gap-3 p-3 rounded-cute transition-colors',
                child.id === currentChildId
                  ? 'bg-star-100 border-2 border-star-400'
                  : 'bg-slate-50 hover:bg-star-50 border-2 border-transparent'
              )}
            >
              <span className="text-3xl">{child.avatar_emoji?.startsWith('data:') ? '🦁' : child.avatar_emoji}</span>
              <div className="flex-1 text-left">
                <div className="font-medium">{child.name}</div>
                <div className="text-xs text-slate-400">{child.coin_balance} 金币</div>
              </div>
              {child.id === currentChildId && (
                <span className="text-star-500 text-sm font-medium">当前</span>
              )}
            </button>
          ))}
        </div>
      </Modal>

      {/* 今日达成弹窗 */}
      <Modal
        open={showTodayCompleted}
        onClose={() => setShowTodayCompleted(false)}
        title={'今日达成 ' + todayCompleted.length}
        size="sm"
      >
        {todayCompleted.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">今天还没有达成的任务</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {todayCompleted.map(t => {
              const iconUrl = getTaskIconUrl(t.icon);
              const isPending = t.status === 'pending_approval';
              return (
                <div
                  key={t.id}
                  className={cn(
                    'flex items-center gap-3 p-3 rounded-xl border-2',
                    isPending
                      ? 'bg-amber-50 border-amber-200'
                      : 'bg-emerald-50 border-emerald-200'
                  )}
                >
                  <div className="w-10 h-10 rounded-xl bg-white overflow-hidden flex items-center justify-center flex-shrink-0">
                    {iconUrl ? (
                      <img src={iconUrl} alt={t.title} className="w-full h-full object-contain" />
                    ) : (
                      <span className="text-xl">{TASK_CATEGORIES[t.category].emoji}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-slate-800 line-clamp-1">{t.title}</p>
                    <p className="text-xs text-slate-400">
                      {isPending ? '⏳ 待家长确认' : ('+' + t.reward_coins + ' 星光值')}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      {/* 今日答题记录弹窗：按题集分组展示 */}
      <Modal
        open={showTodayAnswerRecords}
        onClose={() => setShowTodayAnswerRecords(false)}
        title={'今日答题 ' + todayAnswerCount}
        size="sm"
      >
        {todayAnswerGroups.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">今天还没有答题记录</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {todayAnswerGroups.map((g, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-3 rounded-xl bg-star-50 border border-star-100"
              >
                <span className="font-medium text-sm text-slate-700 truncate pr-2">
                  {g.title}
                </span>
                <span className="text-sm font-bold text-star-600 tabular-nums flex-shrink-0">
                  {g.count} 题
                </span>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
