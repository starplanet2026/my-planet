import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFamilyStore } from '../../store/familyStore';
import { useModeStore } from '../../store/modeStore';
import { useTasks } from '../../hooks/useTasks';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Modal } from '../../components/common/Modal';
import { Input, Textarea, Select } from '../../components/common/Input';
import { EmptyState } from '../../components/common/EmptyState';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { useToastStore } from '../../store/toastStore';
import { TASK_CATEGORIES, TASK_CATEGORY_LIST, TASK_ICONS, STAR_PERSON_DEFAULT_ICON, getTaskIconUrl, ROUTES } from '../../lib/constants';
import { formatSignedCoins, formatDate } from '../../lib/utils';
import { cn } from '../../lib/utils';
import { Plus, Edit2, Trash2, Send, Power, Calendar, ArrowLeft, Upload, GripVertical, CheckSquare, Square } from 'lucide-react';
import type { Task, TaskCategory } from '../../api/types';
import { updateTaskOrder, publishTasks, offlineTasks, deleteTasks } from '../../api/tasks';

// 周几标签（0=周日, 1=周一...6=周六）
const WEEKDAY_LABELS: { value: number; label: string }[] = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 0, label: '周日' },
];

interface TaskFormData {
  title: string;
  description: string;
  category: TaskCategory;
  reward_coins: number;
  deadline: string;        // YYYY-MM-DD 格式
  icon: string;
  repeat_days: number[];  // 周几重复（0=周日）
}

export function TaskManagePage() {
  const navigate = useNavigate();
  const family = useFamilyStore(s => s.family);
  const members = useFamilyStore(s => s.members);
  const childMembers = members.filter(m => m.role === 'child');
  const parentMember = members.find(m => m.role === 'parent');

  const currentChildId = useModeStore(s => s.currentChildId);
  // 验证 currentChildId 是否有效，无效则用第一个孩子
  const validChild = childMembers.find(m => m.id === currentChildId);
  const effectiveChildId = validChild?.id ?? childMembers[0]?.id ?? null;
  const { tasks, loading, refresh, createTask, updateTask, deleteTask, publishTask, offlineTask } = useTasks();
  const toast = useToastStore();

  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);

  const [form, setForm] = useState<TaskFormData>({
    title: '',
    description: '',
    category: 'daily',
    reward_coins: 1,
    deadline: '',
    icon: STAR_PERSON_DEFAULT_ICON,
    repeat_days: [],
  });

  const update = (k: keyof TaskFormData, v: string | number | number[]) =>
    setForm(p => ({ ...p, [k]: v }));

  const toggleWeekday = (day: number) => {
    setForm(p => {
      const has = p.repeat_days.includes(day);
      return {
        ...p,
        repeat_days: has ? p.repeat_days.filter(d => d !== day) : [...p.repeat_days, day],
      };
    });
  };

  const openCreate = () => {
    setEditingTask(null);
    setForm({
      title: '', description: '', category: 'daily', reward_coins: 1,
      deadline: '', icon: STAR_PERSON_DEFAULT_ICON, repeat_days: [],
    });
    setShowForm(true);
  };

  const openEdit = (task: Task) => {
    setEditingTask(task);
    // deadline 从 ISO 提取 YYYY-MM-DD
    const deadlineDate = task.deadline ? task.deadline.slice(0, 10) : '';
    setForm({
      title: task.title,
      description: task.description ?? '',
      category: task.category,
      reward_coins: task.reward_coins,
      deadline: deadlineDate,
      icon: task.icon ?? STAR_PERSON_DEFAULT_ICON,
      repeat_days: task.repeat_days ?? [],
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!family || !parentMember) {
      toast.error('家庭数据未加载，请稍后重试');
      return;
    }
    if (!effectiveChildId) {
      toast.error('未找到孩子成员，请先在设置中添加孩子');
      return;
    }
    if (!form.title.trim()) { toast.error('请输入任务标题'); return; }

    setSaving(true);
    try {
      // deadline: YYYY-MM-DD → 当天 23:59 的 ISO
      const deadlineIso = form.deadline
        ? new Date(form.deadline + 'T23:59:00').toISOString()
        : null;

      const data = {
        family_id: family.id,
        member_id: effectiveChildId || null,
        title: form.title.trim(),
        description: form.description.trim() || null,
        category: form.category,
        reward_coins: Number(form.reward_coins),
        deadline: deadlineIso,
        created_by: parentMember.id,
        icon: form.icon,
        repeat_days: form.repeat_days,
      };

      if (editingTask) {
        await updateTask(editingTask.id, data);
        toast.success('任务已更新');
      } else {
        await createTask(data);
        toast.success('任务已创建（草稿）');
      }
      await refresh();
      setShowForm(false);
    } catch (e: any) {
      toast.error(e?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteTask(deleteTarget.id);
      await refresh();
      toast.success('任务已删除');
    } catch (e: any) {
      toast.error(e?.message ?? '删除失败');
    }
  };

  const handlePublish = async (id: string) => {
    setActionId(id);
    try {
      await publishTask(id);
      await refresh();
      toast.success('任务已发布');
    } catch (e: any) {
      toast.error(e?.message ?? '发布失败');
    } finally {
      setActionId(null);
    }
  };

  const handleOffline = async (id: string) => {
    setActionId(id);
    try {
      await offlineTask(id);
      await refresh();
      toast.success('任务已下线');
    } catch (e: any) {
      toast.error(e?.message ?? '下线失败');
    } finally {
      setActionId(null);
    }
  };

  // 快速修改奖励星光值（不打开详情页）
  const handleRewardChange = async (id: string, val: number) => {
    try {
      await updateTask(id, { reward_coins: val });
      await refresh();
      toast.success('奖励已更新');
    } catch (e: any) {
      toast.error(e?.message ?? '更新失败');
    }
  };

  // 任务分类筛选
  const [categoryFilter, setCategoryFilter] = useState<'all' | TaskCategory>('all');
  const CATEGORY_OPTIONS: { id: 'all' | TaskCategory; label: string; emoji: string }[] = [
    { id: 'all', label: '全部', emoji: '📚' },
    ...TASK_CATEGORY_LIST.map(([cat, cfg]) => ({ id: cat, label: cfg.label, emoji: cfg.emoji })),
  ];

  // 分类任务（先按分类筛选，再按状态分组）
  const visibleTasks = tasks.filter(t =>
    t.status !== 'deleted' &&
    (categoryFilter === 'all' || t.category === categoryFilter)
  );
  const draftTasks = visibleTasks.filter(t => t.status === 'draft' || t.status === 'expired' || t.status === 'completed');
  const activeTasks = visibleTasks.filter(t => t.status === 'active');

  // 拖拽排序
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [localActive, setLocalActive] = useState<Task[]>(activeTasks);
  const [localDraft, setLocalDraft] = useState<Task[]>(draftTasks);

  // 批量选择
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => { setLocalActive(activeTasks); }, [activeTasks.length, activeTasks.map(t => t.id).join(',')]);
  useEffect(() => { setLocalDraft(draftTasks); }, [draftTasks.length, draftTasks.map(t => t.id).join(',')]);

  const handleDragStart = (id: string) => { setDragId(id); };
  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (id === dragId) return;
    setOverId(id);
  };
  const handleDrop = async (group: 'active' | 'draft') => {
    if (!dragId || !overId || dragId === overId) { setDragId(null); setOverId(null); return; };
    const list = group === 'active' ? localActive : localDraft;
    const setter = group === 'active' ? setLocalActive : setLocalDraft;
    const dragIdx = list.findIndex(t => t.id === dragId);
    const overIdx = list.findIndex(t => t.id === overId);
    if (dragIdx === -1 || overIdx === -1) { setDragId(null); setOverId(null); return; };
    const reordered = [...list];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(overIdx, 0, moved);
    setter(reordered);
    setDragId(null);
    setOverId(null);
    try {
      await updateTaskOrder(reordered.map(t => t.id));
    } catch (e: any) {
      toast.error(e?.message ?? '排序失败');
      refresh();
    }
  };

  // 批量操作
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = (group: 'active' | 'draft') => {
    const list = group === 'active' ? localActive : localDraft;
    if (list.every(t => selectedIds.has(t.id))) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        list.forEach(t => next.delete(t.id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        list.forEach(t => next.add(t.id));
        return next;
      });
    }
  };
  const handleBatchPublish = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      await publishTasks(ids);
      await refresh();
      toast.success(`已发布 ${ids.length} 个任务`);
      setSelectedIds(new Set());
    } catch (e: any) {
      toast.error(e?.message ?? '批量发布失败');
    }
  };
  const handleBatchOffline = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      await offlineTasks(ids);
      await refresh();
      toast.success(`已下架 ${ids.length} 个任务`);
      setSelectedIds(new Set());
    } catch (e: any) {
      toast.error(e?.message ?? '批量下架失败');
    }
  };
  const handleBatchDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      await deleteTasks(ids);
      await refresh();
      toast.success(`已删除 ${ids.length} 个任务`);
      setSelectedIds(new Set());
    } catch (e: any) {
      toast.error(e?.message ?? '批量删除失败');
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(ROUTES.PARENT)}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold">任务管理</h1>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="w-4 h-4" /> 新建
        </Button>
      </div>

      {loading && tasks.length === 0 ? (
        <EmptyState icon="📋" title="加载中..." />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon="📋"
          title="还没有任务"
          description="创建任务让孩子开始赚取星光值吧"
          action={<Button onClick={openCreate}><Plus className="w-4 h-4" /> 新建任务</Button>}
        />
      ) : (
        <div className="space-y-4">
        {/* 任务分类筛选栏 */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {CATEGORY_OPTIONS.map(opt => {
            const count = opt.id === 'all'
              ? tasks.filter(t => t.status !== 'deleted').length
              : tasks.filter(t => t.status !== 'deleted' && t.category === opt.id).length;
            const active = categoryFilter === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setCategoryFilter(opt.id)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors',
                  active
                    ? 'bg-star-400 text-white shadow-sm'
                    : 'bg-star-50 text-slate-600 hover:bg-star-100'
                )}
              >
                {opt.emoji} {opt.label}
                <span className={cn('ml-1', active ? 'text-white/80' : 'text-slate-400')}>
                  ({count})
                </span>
              </button>
            );
          })}
        </div>

        {visibleTasks.length === 0 ? (
          <EmptyState
            icon="🔍"
            title="该分类下暂无任务"
            description="切换其他分类或新建任务"
            action={<Button onClick={openCreate}><Plus className="w-4 h-4" /> 新建任务</Button>}
          />
        ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 批量操作工具栏 */}
          {selectedIds.size > 0 && (
            <div className="col-span-full flex items-center gap-2 p-3 bg-star-50 rounded-xl border border-star-200">
              <span className="text-sm font-medium text-star-700">已选 {selectedIds.size} 项</span>
              <button onClick={() => setSelectedIds(new Set())} className="text-xs text-slate-500 hover:text-slate-700 ml-1">取消</button>
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" size="sm" onClick={handleBatchPublish}>
                  <Send className="w-4 h-4" /> 批量发布
                </Button>
                <Button variant="ghost" size="sm" onClick={handleBatchOffline}>
                  <Power className="w-4 h-4" /> 批量下架
                </Button>
                <Button variant="ghost" size="sm" danger onClick={handleBatchDelete}>
                  <Trash2 className="w-4 h-4" /> 批量删除
                </Button>
              </div>
            </div>
          )}
          {/* 已发布（active） */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <h3 className="text-sm font-medium text-emerald-600 flex items-center gap-1">
                🟢 已发布 ({activeTasks.length}) {activeTasks.length > 1 && <span className="text-xs text-slate-400 ml-1">可拖拽排序</span>}
              </h3>
              {activeTasks.length > 0 && (
                <button onClick={() => toggleSelectAll('active')} className="ml-auto text-xs text-slate-500 hover:text-star-600 flex items-center gap-1">
                  {activeTasks.every(t => selectedIds.has(t.id))
                    ? <CheckSquare className="w-4 h-4 text-star-500" />
                    : <Square className="w-4 h-4" />}
                  全选
                </button>
              )}
            </div>
            {localActive.length === 0 ? (
              <p className="text-xs text-slate-400 px-1 py-4 text-center">暂无已发布任务</p>
            ) : (
              localActive.map(task => (
                <div
                  key={task.id}
                  draggable
                  onDragStart={() => handleDragStart(task.id)}
                  onDragOver={(e) => handleDragOver(e, task.id)}
                  onDrop={() => handleDrop('active')}
                  onDragEnd={() => { setDragId(null); setOverId(null); }}
                  className={cn(
                    'transition-opacity',
                    dragId === task.id && 'opacity-40',
                    overId === task.id && 'ring-2 ring-star-300 rounded-xl'
                  )}
                >
                  <TaskRow
                    task={task}
                    childMembers={childMembers}
                    actionLoading={actionId === task.id}
                    onEdit={() => openEdit(task)}
                    onDelete={() => setDeleteTarget(task)}
                    onOffline={() => handleOffline(task.id)}
                    onRewardChange={(val) => handleRewardChange(task.id, val)}
                    dragHandle
                    selected={selectedIds.has(task.id)}
                    onToggleSelect={() => toggleSelect(task.id)}
                  />
                </div>
              ))
            )}
          </div>

          {/* 待发布（草稿） */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <h3 className="text-sm font-medium text-amber-600 flex items-center gap-1">
                📝 待发布 ({draftTasks.length}) {draftTasks.length > 1 && <span className="text-xs text-slate-400 ml-1">可拖拽排序</span>}
              </h3>
              {draftTasks.length > 0 && (
                <button onClick={() => toggleSelectAll('draft')} className="ml-auto text-xs text-slate-500 hover:text-star-600 flex items-center gap-1">
                  {draftTasks.every(t => selectedIds.has(t.id))
                    ? <CheckSquare className="w-4 h-4 text-star-500" />
                    : <Square className="w-4 h-4" />}
                  全选
                </button>
              )}
            </div>
            {localDraft.length === 0 ? (
              <p className="text-xs text-slate-400 px-1 py-4 text-center">暂无待发布任务</p>
            ) : (
              localDraft.map(task => (
                <div
                  key={task.id}
                  draggable
                  onDragStart={() => handleDragStart(task.id)}
                  onDragOver={(e) => handleDragOver(e, task.id)}
                  onDrop={() => handleDrop('draft')}
                  onDragEnd={() => { setDragId(null); setOverId(null); }}
                  className={cn(
                    'transition-opacity',
                    dragId === task.id && 'opacity-40',
                    overId === task.id && 'ring-2 ring-star-300 rounded-xl'
                  )}
                >
                  <TaskRow
                    task={task}
                    childMembers={childMembers}
                    actionLoading={actionId === task.id}
                    onEdit={() => openEdit(task)}
                    onDelete={() => setDeleteTarget(task)}
                    onPublish={() => handlePublish(task.id)}
                    onRewardChange={(val) => handleRewardChange(task.id, val)}
                    dragHandle
                    selected={selectedIds.has(task.id)}
                    onToggleSelect={() => toggleSelect(task.id)}
                  />
                </div>
              ))
            )}
          </div>
        </div>
        )}
        </div>
      )}

      {/* 任务表单 */}
      <Modal
        open={showForm}
        onClose={() => !saving && setShowForm(false)}
        title={editingTask ? '编辑任务' : '新建任务'}
      >
        <div className="space-y-4">
          {/* 图标选择器 */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">任务图标</label>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-12 h-12 rounded-2xl bg-star-50 flex items-center justify-center overflow-hidden">
                {getTaskIconUrl(form.icon) ? (
                  <img src={getTaskIconUrl(form.icon)!} alt={form.icon} className="w-10 h-10 object-contain" />
                ) : (
                  <span className="text-2xl">❓</span>
                )}
              </div>
              <span className="text-sm text-slate-400">已选: {form.icon}</span>
            </div>
            <div className="max-h-40 overflow-y-auto rounded-cute bg-slate-50 p-2">
              {TASK_ICONS.map(group => (
                <div key={group.label} className="mb-2">
                  <p className="text-xs text-slate-400 mb-1">{group.label}</p>
                  <div className="grid grid-cols-6 gap-1">
                    {group.icons.map(item => (
                      <button
                        key={item.name}
                        type="button"
                        onClick={() => update('icon', item.name)}
                        className={cn(
                          'aspect-square rounded-lg flex items-center justify-center transition-all overflow-hidden bg-white',
                          form.icon === item.name
                            ? 'bg-star-100 ring-2 ring-star-400 scale-105'
                            : 'hover:bg-star-50'
                        )}
                      >
                        {item.url ? (
                          <img src={item.url} alt={item.name} className="w-full h-full object-contain" />
                        ) : (
                          <span className="text-xs">{item.name}</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {/* 自定义上传 */}
              <div className="mb-2">
                <p className="text-xs text-slate-400 mb-1">自定义</p>
                <div className="grid grid-cols-6 gap-1">
                  <label className="aspect-square rounded-lg flex items-center justify-center bg-white border-2 border-dashed border-star-200 hover:bg-star-50 cursor-pointer transition-colors">
                    <Upload className="w-4 h-4 text-star-400" />
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp"
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 200 * 1024) {
                          toast.error('图片需小于 200KB');
                          return;
                        }
                        const reader = new FileReader();
                        reader.onload = () => {
                          update('icon', reader.result as string);
                          toast.success('已上传自定义图标');
                        };
                        reader.onerror = () => toast.error('读取失败');
                        reader.readAsDataURL(file);
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>

          <Input
            label="任务标题"
            required
            placeholder="如：背单词 20 个"
            value={form.title}
            onChange={e => update('title', e.target.value)}
          />
          <Textarea
            label="描述"
            placeholder="任务说明（可选）"
            value={form.description}
            onChange={e => update('description', e.target.value)}
          />
          <Select
            label="分类"
            value={form.category}
            onChange={e => update('category', e.target.value)}
          >
            {TASK_CATEGORY_LIST.map(([cat, cfg]) => (
              <option key={cat} value={cat}>{cfg.emoji} {cfg.label}</option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="奖励星光值"
              type="number"
              required
              value={form.reward_coins}
              onChange={e => update('reward_coins', e.target.value)}
            />
            <Input
              label="截止时间（可选）"
              type="date"
              value={form.deadline}
              onChange={e => update('deadline', e.target.value)}
            />
          </div>

          {/* 重复选择器 */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700 flex items-center gap-1">
              <Calendar className="w-4 h-4" /> 重复上线
            </label>
            <p className="text-xs text-slate-400">勾选周几自动上线，都不选=不重复</p>
            <div className="flex gap-1.5 flex-wrap">
              {WEEKDAY_LABELS.map(({ value, label }) => {
                const active = form.repeat_days.includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleWeekday(value)}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-sm font-medium transition-all',
                      active
                        ? 'bg-star-400 text-white ring-2 ring-star-300'
                        : 'bg-slate-100 text-slate-500 hover:bg-star-50'
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {form.repeat_days.length > 0 && (
              <p className="text-xs text-star-500">
                每周 {form.repeat_days.map(d => WEEKDAY_LABELS.find(w => w.value === d)?.label).join('、')} 自动上线
              </p>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="secondary" fullWidth onClick={() => setShowForm(false)} disabled={saving}>
              取消
            </Button>
            <Button fullWidth loading={saving} onClick={handleSave}>
              {editingTask ? '保存' : '创建'}
            </Button>
          </div>
          {!editingTask && (
            <p className="text-xs text-slate-400 text-center">新建任务默认为草稿，需点击「发布」才会在儿童端显示</p>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        title="删除任务？"
        message={`确认删除「${deleteTarget?.title ?? ''}」？此操作不可恢复。`}
        confirmText="删除"
        variant="danger"
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />

    </div>
  );
}

// ---- 任务行组件 ----
function TaskRow({
  task,
  childMembers,
  actionLoading,
  onEdit,
  onDelete,
  onPublish,
  onOffline,
  onRewardChange,
  dragHandle,
  selected,
  onToggleSelect,
}: {
  task: Task;
  childMembers: { id: string; name: string; avatar_emoji: string }[];
  actionLoading?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onPublish?: () => void;
  onOffline?: () => void;
  onRewardChange?: (val: number) => void;
  dragHandle?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const cfg = TASK_CATEGORIES[task.category];
  const assignedTo = childMembers.find(m => m.id === task.member_id);
  const iconUrl = getTaskIconUrl(task.icon);
  const isDraft = task.status === 'draft';
  const isActive = task.status === 'active';
  const isExpired = task.status === 'expired';
  const isCompleted = task.status === 'completed';
  const hasRepeat = task.repeat_days && task.repeat_days.length > 0;

  return (
    <Card key={task.id} className={cn('p-4', isExpired && 'opacity-60', selected && 'border-star-300 bg-star-50')}>
      <div className="flex items-start justify-between gap-3">
        {onToggleSelect && (
          <button onClick={(e) => { e.stopPropagation(); onToggleSelect(); }} className="mt-1 flex-shrink-0">
            {selected
              ? <CheckSquare className="w-5 h-5 text-star-500" />
              : <Square className="w-5 h-5 text-slate-300" />}
          </button>
        )}
        {dragHandle && (
          <div className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-400 mt-1 flex-shrink-0">
            <GripVertical className="w-5 h-5" />
          </div>
        )}
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {iconUrl ? (
            <img src={iconUrl} alt={task.title} className="w-10 h-10 object-contain rounded-xl bg-star-50 flex-shrink-0" />
          ) : (
            <span className="text-2xl flex-shrink-0">{cfg.emoji}</span>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-medium">{task.title}</h3>
              {(isDraft || isExpired || isCompleted) && (
                <span className="text-xs px-2 py-0.5 bg-amber-50 text-amber-600 rounded-full">待发布</span>
              )}
              {isActive && (
                <span className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-full">已发布</span>
              )}
            </div>
            {task.description && (
              <p className="text-xs text-slate-400 mb-1 line-clamp-2">{task.description}</p>
            )}
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span>{cfg.label}</span>
              {assignedTo && <span>· {assignedTo.name}</span>}
              {task.deadline && <span>· 截止 {formatDate(task.deadline)}</span>}
              {hasRepeat && (
                <span className="text-star-500">
                  · 重复 {task.repeat_days!.map(d => '日一二三四五六'[d]).join('')}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {onRewardChange ? (
            <div className="flex items-center gap-1">
              <input
                type="number"
                defaultValue={task.reward_coins}
                key={task.id}
                onBlur={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v !== task.reward_coins) onRewardChange(v);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                className="w-14 text-right font-bold tabular-nums border border-slate-200 rounded-lg px-1 py-0.5 focus:border-star-400 focus:outline-none focus:ring-1 focus:ring-star-200"
                title="奖励星光值，回车保存"
              />
              <span className="text-xs text-slate-400">⭐</span>
            </div>
          ) : (
            <span className={cn(
              'font-bold tabular-nums',
              task.reward_coins >= 0 ? 'text-emerald-500' : 'text-red-500'
            )}>
              {formatSignedCoins(task.reward_coins)}
            </span>
          )}
          {/* 发布按钮：待发布状态显示（草稿/过期/已完成） */}
          {(isDraft || isExpired || isCompleted) && onPublish && (
            <button
              onClick={onPublish}
              disabled={actionLoading}
              className="p-2 text-star-500 hover:bg-star-50 rounded-lg disabled:opacity-50"
              title="发布"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
          {/* 下线按钮：已发布状态显示 */}
          {isActive && onOffline && (
            <button
              onClick={onOffline}
              disabled={actionLoading}
              className="p-2 text-slate-400 hover:bg-slate-100 rounded-lg disabled:opacity-50"
              title="下线"
            >
              <Power className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onEdit}
            className="p-2 text-slate-400 hover:text-star-500"
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button
            onClick={onDelete}
            className="p-2 text-slate-400 hover:text-red-500"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </Card>
  );
}
