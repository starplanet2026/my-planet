import { useState, useMemo, useEffect } from 'react';
import { useFamilyStore } from '../../store/familyStore';
import { useModeStore } from '../../store/modeStore';
import { useTasks, useTaskCategories } from '../../hooks/useTasks';
import { Card } from '../../components/common/Card';
import { Loading } from '../../components/common/Loading';
import { Modal } from '../../components/common/Modal';
import { useToastStore } from '../../store/toastStore';
import { getTaskIconUrl, getCategoryMeta } from '../../lib/constants';
import { formatSignedCoins, formatDate, isExpired, isToday } from '../../lib/utils';
import { cn } from '../../lib/utils';
import type { Task, TaskCategory } from '../../api/types';
import { updateTaskOrder, resubmitRepeatingTask } from '../../api/tasks';

// 判断 pending_approval 的重复任务是否跨天，需要让孩子可重新提交
// 满足条件：状态为 pending_approval、repeat_days 非空、completed_at 不是今天
function isRecurringTaskResubmittable(task: Task): boolean {
  if (task.status !== 'pending_approval') return false;
  if (!task.repeat_days || task.repeat_days.length === 0) return false;
  if (!task.completed_at) return false;
  return !isToday(task.completed_at);
}

// 获取任务在孩子端的“有效状态”：跨天的重复 pending_approval 任务视为 active
function getEffectiveStatus(task: Task): Task['status'] {
  if (isRecurringTaskResubmittable(task)) return 'active';
  return task.status;
}

// 五角星奖励徽章（参考星星人主题）
function StarReward({ coins, className }: { coins: number; className?: string }) {
  const isNegative = coins < 0;
  const color = isNegative ? '#ef4444' : '#f59e0b';
  const colorDark = isNegative ? '#dc2626' : '#d97706';
  const absVal = Math.abs(coins);
  const sign = coins < 0 ? '-' : '';
  const text = `${sign}${absVal}`;

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: 44, height: 44 }}>
      <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-sm">
        {/* 五角星 */}
        <path
          d="M50 8 L61 38 L93 38 L67 57 L77 88 L50 69 L23 88 L33 57 L7 38 L39 38 Z"
          fill={color}
          stroke={colorDark}
          strokeWidth="5"
          strokeLinejoin="round"
        />
        {/* 中心白色圆 */}
        <circle cx="50" cy="52" r="20" fill="white" />
      </svg>
      <span
        className="absolute font-bold tabular-nums leading-none"
        style={{ color: isNegative ? '#dc2626' : '#1f2937', fontSize: absVal > 99 ? 10 : absVal > 9 ? 12 : 14 }}
      >
        {text}
      </span>
    </div>
  );
}

export function TasksPage() {
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [localTasks, setLocalTasks] = useState<Task[]>([]);

  const members = useFamilyStore(s => s.members);
  const currentChildId = useModeStore(s => s.currentChildId);
  const child = members.find(m => m.id === currentChildId && m.role === 'child')
    ?? members.find(m => m.role === 'child');

  const { tasks, loading, requestCompleteTask, refresh } = useTasks();
  const { categories } = useTaskCategories();
  const toast = useToastStore();

  useEffect(() => { setLocalTasks(tasks); }, [tasks]);

  // 分类选项（内置4 + 自定义），用于分类标签与列表渲染
  const categoryTabs = useMemo(() =>
    categories.map(c => ({ key: c.key as TaskCategory, name: c.name, meta: getCategoryMeta(c.key, categories) })),
    [categories]
  );

  const getCategoryTasks = useMemo(() => {
    return (cat: TaskCategory) => {
      const isRecurring = cat === 'black' || cat === 'super';
      return localTasks
        .filter(t => t.category === cat)
        .filter(t => {
          // 不再按 repeat_days 隐藏任务，所有已发布任务都显示
          // repeat_days 仅用于跨天重置逻辑（isRecurringTaskResubmittable）
          if (t.status === 'active' || t.status === 'pending_approval') return true;
          if (t.status === 'draft' && isRecurring) return true;
          return false;
        })
        .sort((a, b) => {
          const order: Record<string, number> = { active: 0, pending_approval: 1, draft: 2 };
          const diff = (order[getEffectiveStatus(a)] ?? 9) - (order[getEffectiveStatus(b)] ?? 9);
          if (diff !== 0) return diff;
          // 优先级降序（数值越大越靠前），相同则按 sort_order 稳定排序
          const pDiff = (b.priority ?? 0) - (a.priority ?? 0);
          if (pDiff !== 0) return pDiff;
          return (a.sort_order ?? 0) - (b.sort_order ?? 0);
        });
    };
  }, [localTasks]);

  const handleDragStart = (id: string) => { setDragId(id); };
  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (id === dragId) return;
    setOverId(id);
  };
  const handleDrop = async (cat: TaskCategory) => {
    if (!dragId || !overId || dragId === overId) { setDragId(null); setOverId(null); return; }
    const catTasks = getCategoryTasks(cat);
    const dragIdx = catTasks.findIndex(t => t.id === dragId);
    const overIdx = catTasks.findIndex(t => t.id === overId);
    if (dragIdx === -1 || overIdx === -1) { setDragId(null); setOverId(null); return; }
    const reordered = [...catTasks];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(overIdx, 0, moved);
    // 更新 localTasks 中的 priority（与 API 一致：越靠前 priority 越大）
    const priorityMap = new Map(reordered.map((t, i) => [t.id, (reordered.length - i) * 10]));
    setLocalTasks(prev => prev.map(t => priorityMap.has(t.id) ? { ...t, priority: priorityMap.get(t.id)! } : t));
    setDragId(null);
    setOverId(null);
    try {
      await updateTaskOrder(reordered.map(t => t.id));
    } catch (e: any) {
      toast.error(e?.message ?? '排序失败');
      refresh();
    }
  };

  const handleComplete = async (task: Task) => {
    if (!child) return;
    setCompletingId(task.id);
    try {
      // 跨天的重复任务处于 pending_approval 状态时，走重新提交逻辑（更新 completed_at）
      if (isRecurringTaskResubmittable(task)) {
        await resubmitRepeatingTask(task.id, child.id);
      } else {
        await requestCompleteTask(task.id, child.id);
      }
      toast.success('已提交完成，等待家长确认');
      setDetailTask(null);
    } catch (e: any) {
      toast.error(e?.message ?? '提交失败');
    } finally {
      setCompletingId(null);
    }
  };

  // 点击顶部图标滚动到对应板块
  const scrollToSection = (cat: TaskCategory) => {
    const el = document.getElementById(`section-${cat}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="max-w-6xl mx-auto -mt-6">
      {loading ? (
        <Loading />
      ) : (
        <>
          {/* 顶部快速定位菜单 - sticky 固定在 TopBar 下方 */}
          <div className="sticky top-16 z-20 bg-white/80 backdrop-blur-sm border-b border-star-100 shadow-sm mb-4 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 pt-0 pb-2">
            <div className="grid grid-cols-4 gap-1">
              {categoryTabs.map(({ key: cat, name, meta }) => {
                const iconUrl = getTaskIconUrl(meta.iconKey);
                return (
                  <button
                    key={cat}
                    onClick={() => scrollToSection(cat)}
                    className="flex flex-col items-center gap-0 pt-0 pb-1 rounded-xl hover:bg-star-100 transition-colors"
                  >
                    {iconUrl && (
                      <img
                        src={iconUrl}
                        alt={name}
                        className="w-14 h-14 sm:w-16 sm:h-16 object-contain -mt-1"
                      />
                    )}
                    <span className="text-[11px] font-medium text-slate-600">{name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 各分类板块 */}
          {categoryTabs.map(({ key: cat, name, meta }) => {
            const catTasks = getCategoryTasks(cat);
            return (
              <section key={cat} id={`section-${cat}`} className="pt-6 first:pt-0 border-t border-star-100 first:border-t-0 scroll-mt-36 lg:scroll-mt-40">
                {/* 分类头 - 主标左右渐变分割线 */}
                <div className="flex items-center justify-center gap-3 mb-4">
                  <div className="w-20 h-1.5 rounded-full bg-gradient-to-r from-transparent to-star-300" />
                  <div className="text-center">
                    <h2 className="text-xl sm:text-2xl font-bold text-slate-800">{name}</h2>
                    <p className="text-xs sm:text-sm text-slate-400 mt-0.5">{meta.subtitle}</p>
                  </div>
                  <div className="w-20 h-1.5 rounded-full bg-gradient-to-l from-transparent to-star-300" />
                </div>

                {/* 任务网格 */}
                {catTasks.length === 0 ? (
                  <p className="text-sm text-slate-300 text-center py-4">暂无任务</p>
                ) : (
                  <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
                    {catTasks.map(task => {
                    const effectiveStatus = getEffectiveStatus(task);
                    const isPending = effectiveStatus === 'pending_approval';
                    const isDone = effectiveStatus === 'draft';
                    const isActive = effectiveStatus === 'active';
                    const taskIconUrl = getTaskIconUrl(task.icon);

                    return (
                      <div
                        key={task.id}
                        draggable
                        onDragStart={() => handleDragStart(task.id)}
                        onDragOver={(e) => handleDragOver(e, task.id)}
                        onDrop={() => handleDrop(cat)}
                        onDragEnd={() => { setDragId(null); setOverId(null); }}
                        className={cn(
                          'transition-opacity',
                          dragId === task.id && 'opacity-40',
                          overId === task.id && 'ring-2 ring-star-300 rounded-2xl'
                        )}
                      >
                      <Card
                        className={cn('p-2 sm:p-3 flex flex-col items-center text-center cursor-pointer hover:shadow-md transition-shadow', isDone && 'opacity-70')}
                        onClick={() => setDetailTask(task)}
                      >
                        <div className={cn(
                          'w-10 h-10 sm:w-12 sm:h-12 rounded-2xl flex items-center justify-center overflow-hidden flex-shrink-0 mb-1.5',
                          isPending ? 'bg-amber-50' : isDone ? 'bg-slate-50' : 'bg-star-50'
                        )}>
                          {taskIconUrl ? (
                            <img src={taskIconUrl} alt={task.title} className="w-full h-full object-contain" />
                          ) : (
                            <span className="text-xl sm:text-2xl">{getCategoryMeta(task.category, categories).emoji}</span>
                          )}
                        </div>
                        <h3 className={cn(
                          'text-xs sm:text-sm font-medium text-slate-800 line-clamp-2 mb-2 flex-1',
                          isDone && 'text-slate-500'
                        )}>
                          {task.title}
                        </h3>
                        {isActive ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleComplete(task); }}
                            disabled={completingId === task.id}
                            className={cn(
                              'w-full py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium text-white transition-colors',
                              completingId === task.id
                                ? 'bg-slate-300'
                                : 'bg-star-400 hover:bg-star-500 active:bg-star-600'
                            )}
                          >
                            {completingId === task.id ? '提交中' : `达成${task.reward_coins >= 0 ? '+' : ''}${task.reward_coins}`}
                          </button>
                        ) : isPending ? (
                          <span className="w-full py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium bg-amber-100 text-amber-600 text-center">
                            ⏳ 待确认
                          </span>
                        ) : (
                          <span className="w-full py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium bg-emerald-50 text-emerald-500 text-center">
                            已达成
                          </span>
                        )}
                      </Card>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
        </>
      )}

      {/* 任务详情弹窗 */}
      <Modal
        open={!!detailTask}
        onClose={() => setDetailTask(null)}
        title={detailTask ? detailTask.title : ''}
      >
        {detailTask && (
          <div className="space-y-5">
            {/* icon */}
            <div className="text-center">
              <div className="w-20 h-20 mx-auto rounded-3xl bg-star-50 flex items-center justify-center mb-1 overflow-hidden">
                {getTaskIconUrl(detailTask.icon) ? (
                  <img src={getTaskIconUrl(detailTask.icon)!} alt={detailTask.title} className="w-full h-full object-contain" />
                ) : (
                  <span className="text-5xl">{getCategoryMeta(detailTask.category, categories).emoji}</span>
                )}
              </div>
            </div>

            {/* 奖励 */}
            <div className="flex items-center justify-center gap-2">
              <span className="text-slate-400 text-sm">奖励</span>
              <StarReward coins={detailTask.reward_coins} className="scale-125" />
              <span className="text-slate-400 text-sm">星光值</span>
            </div>

            {/* 描述 */}
            {detailTask.description && (
              <div className="bg-star-50 rounded-cute p-4">
                <p className="text-xs text-slate-400 mb-1">任务描述</p>
                <p className="text-sm text-slate-600 whitespace-pre-line">{detailTask.description}</p>
              </div>
            )}

            {/* 截止时间 */}
            {detailTask.deadline && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">截止时间</span>
                <span className={cn(
                  'font-medium',
                  isExpired(detailTask.deadline) && getEffectiveStatus(detailTask) === 'active' ? 'text-red-500' : 'text-slate-700'
                )}>
                  {formatDate(detailTask.deadline)}
                </span>
              </div>
            )}

            {/* 状态展示 */}
            {getEffectiveStatus(detailTask) === 'pending_approval' && (
              <div className="bg-amber-50 border border-amber-100 rounded-cute p-3 text-center">
                <p className="text-amber-600 font-medium text-sm">⏳ 已提交完成，等待家长确认</p>
              </div>
            )}
            {getEffectiveStatus(detailTask) === 'draft' && (detailTask.category === 'black' || detailTask.category === 'super') && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-cute p-3 text-center">
                <p className="text-emerald-600 font-medium text-sm">已达成</p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
