import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFamilyStore } from '../../store/familyStore';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input, Select } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { Loading } from '../../components/common/Loading';
import { useToastStore } from '../../store/toastStore';
import { ROUTES } from '../../lib/constants';
import { cn } from '../../lib/utils';
import { ArrowLeft, Save, Send, Power, CheckSquare, Square } from 'lucide-react';
import {
  createRecitationTask, updateRecitationTask,
  publishRecitationTask, offlineRecitationTask,
} from '../../api/recitation';
import type {
  RecitationTask, RecitationTaskInput,
  RecitationSubject, RecitationMatchMode,
} from '../../api/types';

interface Props {
  embedded?: boolean;
  editingTask?: RecitationTask | null;
  onSaved?: () => void;
}

const EMPTY_FORM: RecitationTaskInput = {
  family_id: '',
  title: '',
  subject: 'chinese',
  answer_text: '',
  pass_threshold: 60,
  match_mode: 'fuzzy',
  reward_tier1_min: 60, reward_tier1_max: 79, reward_tier1_stars: 1,
  reward_tier2_min: 80, reward_tier2_max: 99, reward_tier2_stars: 2,
  reward_tier3_min: 100, reward_tier3_max: 100, reward_tier3_stars: 3,
};

export function RecitationCreatePage({ embedded = false, editingTask = null, onSaved }: Props) {
  const navigate = useNavigate();
  const family = useFamilyStore(s => s.family);
  const members = useFamilyStore(s => s.members);
  const toast = useToastStore();

  const [form, setForm] = useState<RecitationTaskInput>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  // 发布弹窗：选择学生
  const [showPublish, setShowPublish] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (editingTask) {
      setForm({
        family_id: editingTask.family_id,
        created_by: editingTask.created_by,
        title: editingTask.title,
        subject: editingTask.subject as RecitationSubject,
        answer_text: editingTask.answer_text,
        pass_threshold: editingTask.pass_threshold,
        match_mode: editingTask.match_mode as RecitationMatchMode,
        reward_tier1_min: editingTask.reward_tier1_min,
        reward_tier1_max: editingTask.reward_tier1_max,
        reward_tier1_stars: editingTask.reward_tier1_stars,
        reward_tier2_min: editingTask.reward_tier2_min,
        reward_tier2_max: editingTask.reward_tier2_max,
        reward_tier2_stars: editingTask.reward_tier2_stars,
        reward_tier3_min: editingTask.reward_tier3_min,
        reward_tier3_max: editingTask.reward_tier3_max,
        reward_tier3_stars: editingTask.reward_tier3_stars,
      });
    }
  }, [editingTask]);

  const childMembers = members.filter(m => m.role === 'child');

  const set = <K extends keyof RecitationTaskInput>(key: K, val: RecitationTaskInput[K]) => {
    setForm(prev => ({ ...prev, [key]: val }));
  };

  const validate = (): string | null => {
    if (!form.title.trim()) return '请输入任务标题';
    if (!form.answer_text.trim()) return '请输入标准答案原文';
    if (form.pass_threshold < 0 || form.pass_threshold > 100) return '通过阈值需在 0-100 之间';
    return null;
  };

  // 保存为模板（status=saved，尚未上线）
  const save = async () => {
    if (!family) { toast.error('家庭信息未加载'); return; }
    const err = validate();
    if (err) { toast.error(err); return; }
    setSubmitting(true);
    try {
      const payload = { ...form, family_id: family.id };
      if (editingTask) {
        await updateRecitationTask(editingTask.id, payload);
        toast.success('模板已更新');
      } else {
        await createRecitationTask(payload);
        toast.success('模板已保存');
      }
      onSaved?.();
    } catch (e: any) {
      toast.error('保存失败：' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // 发布上线：先保存（新建时）→ 选学生 → publish RPC
  const publish = async () => {
    if (!family) { toast.error('家庭信息未加载'); return; }
    const err = validate();
    if (err) { toast.error(err); return; }
    setSubmitting(true);
    try {
      // 确保模板已保存
      let taskId = editingTask?.id;
      const payload = { ...form, family_id: family.id };
      if (editingTask) {
        await updateRecitationTask(editingTask.id, payload);
      } else {
        const t = await createRecitationTask(payload);
        taskId = t.id;
      }
      if (!taskId) { toast.error('保存模板失败'); return; }
      // 打开学生选择弹窗
      setSelectedIds(new Set());
      setShowPublish(true);
    } catch (e: any) {
      toast.error('发布准备失败：' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const confirmPublish = async () => {
    if (!editingTask && !form.family_id) return;
    const taskId = editingTask?.id;
    if (!taskId) { toast.error('请先保存模板'); return; }
    if (selectedIds.size === 0) { toast.error('请至少选择一名学生'); return; }
    setSubmitting(true);
    try {
      const res = await publishRecitationTask(taskId, Array.from(selectedIds));
      if (res.success) {
        toast.success(`已推送给 ${res.published_count} 名学生`);
        setShowPublish(false);
        onSaved?.();
      } else {
        toast.error(res.message || '发布失败');
      }
    } catch (e: any) {
      toast.error('发布失败：' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // 下线
  const offline = async () => {
    if (!editingTask) return;
    if (!confirm('确认下线？未提交的学生不能再提交，模板仍保留在列表，期末可再次上线。')) return;
    setSubmitting(true);
    try {
      await offlineRecitationTask(editingTask.id);
      toast.success('已下线');
      onSaved?.();
    } catch (e: any) {
      toast.error('下线失败：' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitting && !showPublish) return <Loading />;

  return (
    <div className={cn(!embedded && 'max-w-4xl mx-auto py-4 px-4')}>
      {!embedded && (
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate(ROUTES.PARENT_RECITATION)} className="p-2 hover:bg-slate-100 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold flex items-center gap-2">📖 {editingTask ? '编辑背诵任务' : '新建背诵任务'}</h1>
        </div>
      )}

      {/* 基础配置 */}
      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-slate-500">任务标题</label>
            <Input value={form.title} onChange={e => set('title', e.target.value)} placeholder="如：背诵《静夜思》" />
          </div>
          <div>
            <label className="text-xs text-slate-500">学科</label>
            <Select value={form.subject} onChange={e => set('subject', e.target.value as RecitationSubject)}>
              <option value="chinese">语文</option>
              <option value="english">英语</option>
            </Select>
          </div>
        </div>
        <div className="mt-4">
          <label className="text-xs text-slate-500">标准答案原文</label>
          <textarea
            value={form.answer_text}
            onChange={e => set('answer_text', e.target.value)}
            rows={5}
            placeholder="请输入完整背诵原文，学生录音后系统将以此为标准进行比对打分"
            className="w-full p-3 rounded-xl border-2 border-slate-200 text-base text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-star-400 focus:border-transparent transition-all resize-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div>
            <label className="text-xs text-slate-500">通过阈值（分）</label>
            <Input type="number" min={0} max={100} value={form.pass_threshold}
              onChange={e => set('pass_threshold', Math.max(0, Math.min(100, Number(e.target.value))))} />
            <p className="text-xs text-slate-400 mt-1">达到该分数判定任务通过</p>
          </div>
          <div>
            <label className="text-xs text-slate-500">文本比对模式</label>
            <Select value={form.match_mode} onChange={e => set('match_mode', e.target.value as RecitationMatchMode)}>
              <option value="fuzzy">模糊匹配（作文/课文容错）</option>
              <option value="strict">严格匹配（古诗词/英语课文）</option>
            </Select>
            <p className="text-xs text-slate-400 mt-1">两种模式差异内容都会标红，仅扣分宽容度不同</p>
          </div>
        </div>
      </Card>

      {/* 奖励档位配置 */}
      <Card className="p-4 mb-4">
        <h3 className="font-medium text-sm mb-3">星光奖励档位（最多 3 档，可留空不配）</h3>
        <p className="text-xs text-slate-400 mb-3">仅当任务通过且得分落在档位区间内才发放对应星光；未命中档位不发星光。</p>
        {[1, 2, 3].map(idx => {
          const k = `reward_tier${idx}` as const;
          return (
            <div key={idx} className="grid grid-cols-4 gap-2 mb-2 items-end">
              <div className="col-span-1 text-xs text-slate-500 text-center py-2">档位 {idx}</div>
              <div>
                <label className="text-xs text-slate-500">最低分</label>
                <Input type="number" min={0} max={100}
                  value={form[`${k}_min`] ?? ''}
                  onChange={e => set(`${k}_min` as any, e.target.value === '' ? null : Number(e.target.value))} />
              </div>
              <div>
                <label className="text-xs text-slate-500">最高分</label>
                <Input type="number" min={0} max={100}
                  value={form[`${k}_max`] ?? ''}
                  onChange={e => set(`${k}_max` as any, e.target.value === '' ? null : Number(e.target.value))} />
              </div>
              <div>
                <label className="text-xs text-slate-500">星光值</label>
                <Input type="number" min={0}
                  value={form[`${k}_stars`] ?? ''}
                  onChange={e => set(`${k}_stars` as any, e.target.value === '' ? null : Number(e.target.value))} />
              </div>
            </div>
          );
        })}
      </Card>

      {/* 操作按钮 */}
      <div className="flex flex-wrap gap-2 justify-end">
        <Button variant="secondary" onClick={save} disabled={submitting}>
          <Save className="w-4 h-4" /> 保存模板
        </Button>
        {editingTask?.status === 'published' && (
          <Button variant="secondary" onClick={offline} disabled={submitting}>
            <Power className="w-4 h-4" /> 下线
          </Button>
        )}
        <Button variant="primary" onClick={publish} disabled={submitting}>
          <Send className="w-4 h-4" /> {editingTask?.status === 'published' ? '重新发布' : '发布上线'}
        </Button>
      </div>

      {/* 学生选择弹窗 */}
      <Modal open={showPublish} onClose={() => setShowPublish(false)} title="选择推送学生">
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {childMembers.length === 0 && <p className="text-sm text-slate-400">暂无可推送的学生</p>}
          {childMembers.map(m => {
            const checked = selectedIds.has(m.id);
            return (
              <button key={m.id} onClick={() => {
                setSelectedIds(prev => {
                  const next = new Set(prev);
                  if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
                  return next;
                });
              }} className="w-full flex items-center gap-2 p-3 rounded-lg hover:bg-slate-50 border border-slate-200">
                {checked ? <CheckSquare className="w-5 h-5 text-emerald-500" /> : <Square className="w-5 h-5 text-slate-300" />}
                <span className="text-2xl">{m.avatar_emoji}</span>
                <span className="font-medium">{m.name}</span>
              </button>
            );
          })}
        </div>
        <div className="flex gap-2 mt-4 justify-end">
          <Button variant="secondary" onClick={() => setShowPublish(false)}>取消</Button>
          <Button variant="primary" onClick={confirmPublish} disabled={submitting || selectedIds.size === 0}>
            推送 ({selectedIds.size})
          </Button>
        </div>
      </Modal>
    </div>
  );
}
