import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFamilyStore } from '../../store/familyStore';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { Loading } from '../../components/common/Loading';
import { EmptyState } from '../../components/common/EmptyState';
import { Avatar } from '../../components/common/Avatar';
import { useToastStore } from '../../store/toastStore';
import { ROUTES } from '../../lib/constants';
import { ArrowLeft, Plus, Trash2, CheckCircle, XCircle } from 'lucide-react';
import {
  fetchStudyTaskTemplates, addStudyTaskTemplates,
  updateStudyTaskTemplate, deleteStudyTaskTemplate, reorderStudyTaskTemplates,
} from '../../api/pets';
import type { StudyTaskTemplate } from '../../api/pets';

export function StudyTaskManagePage() {
  const navigate = useNavigate();
  const family = useFamilyStore(s => s.family);
  const members = useFamilyStore(s => s.members);
  const toast = useToastStore();

  const children = useMemo(() => members.filter(m => m.role === 'child'), [members]);
  const [selectedChildId, setSelectedChildId] = useState<string>('');

  const [templates, setTemplates] = useState<StudyTaskTemplate[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 新建/编辑弹窗
  const [showEdit, setShowEdit] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formText, setFormText] = useState('');
  const [formReward, setFormReward] = useState(1);

  useEffect(() => {
    if (children.length > 0 && !selectedChildId) {
      setSelectedChildId(children[0].id);
    }
  }, [children, selectedChildId]);

  useEffect(() => {
    if (!selectedChildId) return;
    setLoading(true);
    fetchStudyTaskTemplates(selectedChildId)
      .then(setTemplates)
      .catch(e => toast.error(e?.message ?? '加载失败'))
      .finally(() => setLoading(false));
  }, [selectedChildId, toast]);

  const openCreate = () => {
    setEditingId(null);
    setFormText('');
    setFormReward(1);
    setShowEdit(true);
  };

  const openEdit = (t: StudyTaskTemplate) => {
    setEditingId(t.id);
    setFormText(t.text);
    setFormReward(t.reward);
    setShowEdit(true);
  };

  const submitForm = async () => {
    if (!formText.trim()) { toast.error('请输入任务内容'); return; }
    if (!selectedChildId) return;
    try {
      if (editingId) {
        await updateStudyTaskTemplate(editingId, { text: formText.trim(), reward: formReward });
        toast.success('已更新');
      } else {
        await addStudyTaskTemplates(selectedChildId, [{ text: formText.trim(), reward: formReward }]);
        toast.success('已添加');
      }
      setShowEdit(false);
      // 刷新
      const list = await fetchStudyTaskTemplates(selectedChildId);
      setTemplates(list);
    } catch (e: any) {
      toast.error(e?.message ?? '保存失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除该任务？删除后学生端将不再显示。')) return;
    try {
      await deleteStudyTaskTemplate(id);
      setTemplates(prev => prev.filter(t => t.id !== id));
      toast.success('已删除');
    } catch (e: any) {
      toast.error(e?.message ?? '删除失败');
    }
  };

  const toggleSelected = async (t: StudyTaskTemplate) => {
    try {
      await updateStudyTaskTemplate(t.id, { selected: !t.selected });
      setTemplates(prev => prev.map(x => x.id === t.id ? { ...x, selected: !x.selected } : x));
    } catch (e: any) {
      toast.error(e?.message ?? '操作失败');
    }
  };

  // 上移/下移：乐观更新本地顺序，再调 RPC 持久化
  // 拖拽排序：dragStart 记录源、dragOver 实时重排、dragEnd 持久化
  const handleDragStart = (id: string) => setDragId(id);
  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (id === dragId) return;
    const fromIdx = templates.findIndex(t => t.id === dragId);
    const toIdx = templates.findIndex(t => t.id === id);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...templates];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setTemplates(next);
  };
  const handleDragEnd = async () => {
    setDragId(null);
    try {
      await reorderStudyTaskTemplates(templates.map(t => t.id));
    } catch (e: any) {
      toast.error(e?.message ?? '排序失败');
      const list = await fetchStudyTaskTemplates(selectedChildId);
      setTemplates(list);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(ROUTES.PARENT_DASHBOARD)}
          className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold">陪伴学习任务管理</h1>
      </div>

      {/* 孩子选择 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-slate-500">选择孩子：</span>
        {children.map(c => (
          <button
              key={c.id}
              onClick={() => setSelectedChildId(c.id)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                selectedChildId === c.id
                  ? 'bg-green-500 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Avatar emoji={c.avatar_emoji} size="sm" /> {c.name}
            </button>
        ))}
      </div>

      {/* 新建按钮 */}
      <div className="flex justify-between items-center">
        <p className="text-sm text-slate-400">
          共 {templates.length} 个任务，已启用 {templates.filter(t => t.selected).length} 个
        </p>
        <Button onClick={openCreate} size="sm">
          <Plus className="w-4 h-4" />
          新建任务
        </Button>
      </div>

      {/* 任务列表 */}
      {loading ? (
        <Loading />
      ) : templates.length === 0 ? (
        <EmptyState
          icon="📚"
          title="还没有学习任务"
          description="点击右上角新建任务，下发给孩子"
        />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {templates.map((t, idx) => (
            <div
              key={t.id}
              draggable
              onDragStart={() => handleDragStart(t.id)}
              onDragOver={(e) => handleDragOver(e, t.id)}
              onDragEnd={handleDragEnd}
              className={`bg-white rounded-cute shadow-sm border border-star-100 p-3 cursor-move transition-opacity ${dragId === t.id ? 'opacity-40' : ''}`}
            >
              <div className="flex items-center gap-2">
                {/* 拖拽手柄 */}
                <span className="flex-shrink-0 text-slate-300 cursor-move select-none" title="拖动调整顺序">⋮⋮</span>
                {/* 启用/停用 */}
                <button
                  onClick={() => toggleSelected(t)}
                  className={`flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center text-[10px] transition-colors ${
                    t.selected ? 'bg-green-400 border-green-400 text-white' : 'border-slate-300'
                  }`}
                  title={t.selected ? '已启用' : '已停用'}
                >
                  {t.selected ? '✓' : ''}
                </button>
                {/* 内容 */}
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-medium truncate ${t.selected ? 'text-slate-700' : 'text-slate-400 line-through'}`}>
                    {t.text}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-amber-500">⭐{t.reward}</span>
                    <span className={`text-[9px] px-1 py-0.5 rounded-full ${
                      t.selected ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-400'
                    }`}>
                      {t.selected ? '启用' : '停用'}
                    </span>
                  </div>
                </div>
                {/* 操作 */}
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button
                    onClick={() => openEdit(t)}
                    className="p-1 text-slate-400 hover:bg-blue-50 hover:text-blue-500 rounded-lg transition-colors"
                    title="编辑"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(t.id)}
                    className="p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 rounded-lg transition-colors"
                    title="删除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 新建/编辑弹窗 */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={editingId ? '编辑任务' : '新建任务'} size="sm">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">任务内容</label>
            <Input
              value={formText}
              onChange={e => setFormText(e.target.value)}
              placeholder="如：背诵语文第3课"
              maxLength={100}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">完成奖励星光值</label>
            <Input
              type="number"
              min={0}
              value={formReward}
              onChange={e => setFormReward(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={submitForm} className="flex-1">保存</Button>
            <Button onClick={() => setShowEdit(false)} variant="ghost" className="flex-1">取消</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
