import { useState, useEffect, useCallback, useMemo } from 'react';
import { useFamilyStore } from '../../store/familyStore';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input, Select } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { Loading } from '../../components/common/Loading';
import { useToastStore } from '../../store/toastStore';
import { cn } from '../../lib/utils';
import { Plus, Trash2, ChevronDown, ChevronRight, Power, PowerOff, Sparkles, CheckSquare, Square } from 'lucide-react';
import {
  listTasks, listTaskWords, addTaskWords, removeTaskWord, updateTaskStatus, deleteTask,
} from '../../api/dictation';
import type { DictationTask, DictationTaskWord, DictationSubject, DictationTaskStatus } from '../../api/types';

const STATUS_LABEL: Record<DictationTaskStatus, string> = {
  active: '已上线',
  offline: '已下线',
  completed: '已完成',
};
const STATUS_COLOR: Record<DictationTaskStatus, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  offline: 'bg-slate-100 text-slate-500',
  completed: 'bg-blue-100 text-blue-700',
};

// 学科筛选按钮数据
const SUBJECT_OPTIONS: { key: DictationSubject; label: string }[] = [
  { key: 'english', label: '英语' },
  { key: 'chinese', label: '语文' },
];

export function DictationTaskManagePage() {
  const family = useFamilyStore(s => s.family);
  const members = useFamilyStore(s => s.members);
  const toast = useToastStore();

  const children = useMemo(() => members.filter(m => m.role === 'child'), [members]);
  const childIds = useMemo(() => children.map(c => c.id).join(','), [children]);
  // 用户筛选：空字符串 = 全部用户
  const [selectedChildId, setSelectedChildId] = useState<string>('');
  const [subjectFilter, setSubjectFilter] = useState<DictationSubject | ''>('');

  const [tasks, setTasks] = useState<DictationTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [taskWords, setTaskWords] = useState<DictationTaskWord[]>([]);
  const [wordsLoading, setWordsLoading] = useState(false);

  // 批量删除
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [showBatchDelete, setShowBatchDelete] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // 添加词条弹窗
  const [showAddWord, setShowAddWord] = useState(false);
  const [addWordTargetTask, setAddWordTargetTask] = useState<DictationTask | null>(null);
  const [wordForm, setWordForm] = useState({
    textbook_name: '', unit_no: 0, unit_name: '', pinyin: '',
    answer: '', chinese_meaning: '', part_of_speech: '',
  });

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      if (selectedChildId) {
        const list = await listTasks(selectedChildId, subjectFilter || undefined);
        setTasks(list);
      } else {
        // 全部用户：查询所有孩子的任务
        const ids = childIds.split(',').filter(Boolean);
        const all: DictationTask[] = [];
        for (const cid of ids) {
          const list = await listTasks(cid, subjectFilter || undefined);
          all.push(...list);
        }
        all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setTasks(all);
      }
      setSelectedTaskIds(new Set());
    } catch (e: any) {
      toast.error('加载任务失败：' + e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedChildId, subjectFilter, childIds]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const loadTaskWords = useCallback(async (taskId: string) => {
    setWordsLoading(true);
    try {
      const words = await listTaskWords(taskId);
      setTaskWords(words);
    } catch (e: any) {
      toast.error('加载词条失败：' + e.message);
    } finally {
      setWordsLoading(false);
    }
  }, []);

  const toggleExpand = (task: DictationTask) => {
    if (expandedId === task.id) {
      setExpandedId(null);
      setTaskWords([]);
    } else {
      setExpandedId(task.id);
      loadTaskWords(task.id);
    }
  };

  const onToggleStatus = async (task: DictationTask) => {
    const newStatus = task.status === 'active' ? 'offline' : 'active';
    try {
      await updateTaskStatus(task.id, newStatus);
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t));
      toast.success(newStatus === 'active' ? '已上线' : '已下线');
    } catch (e: any) {
      toast.error('操作失败：' + e.message);
    }
  };

  const onRemoveWord = async (wordId: string) => {
    if (!confirm('确认删除该词条？')) return;
    try {
      await removeTaskWord(wordId);
      setTaskWords(prev => prev.filter(w => w.id !== wordId));
      toast.success('已删除');
    } catch (e: any) {
      toast.error('删除失败：' + e.message);
    }
  };

  // 单条删除任务
  const onSingleDelete = (taskId: string) => {
    setPendingDeleteId(taskId);
  };

  const confirmSingleDelete = async () => {
    if (!pendingDeleteId) return;
    try {
      await deleteTask(pendingDeleteId);
      setTasks(prev => prev.filter(t => t.id !== pendingDeleteId));
      setSelectedTaskIds(prev => { const n = new Set(prev); n.delete(pendingDeleteId); return n; });
      toast.success('任务已删除');
    } catch (e: any) {
      toast.error('删除失败：' + e.message);
    } finally {
      setPendingDeleteId(null);
    }
  };

  // 批量删除
  const toggleTaskSelect = (taskId: string) => {
    setSelectedTaskIds(prev => {
      const n = new Set(prev);
      n.has(taskId) ? n.delete(taskId) : n.add(taskId);
      return n;
    });
  };

  const toggleSelectAll = () => {
    if (selectedTaskIds.size === tasks.length) {
      setSelectedTaskIds(new Set());
    } else {
      setSelectedTaskIds(new Set(tasks.map(t => t.id)));
    }
  };

  const confirmBatchDelete = async () => {
    try {
      for (const id of selectedTaskIds) {
        await deleteTask(id);
      }
      setTasks(prev => prev.filter(t => !selectedTaskIds.has(t.id)));
      toast.success(`已删除 ${selectedTaskIds.size} 条任务`);
      setSelectedTaskIds(new Set());
    } catch (e: any) {
      toast.error('批量删除失败：' + e.message);
    } finally {
      setShowBatchDelete(false);
    }
  };

  const openAddWord = (task: DictationTask) => {
    setAddWordTargetTask(task);
    setWordForm({
      textbook_name: '', unit_no: 0, unit_name: '', pinyin: '',
      answer: '', chinese_meaning: '', part_of_speech: '',
    });
    setShowAddWord(true);
  };

  const submitAddWord = async () => {
    if (!addWordTargetTask) return;
    if (!wordForm.answer.trim()) { toast.error('请填写答案'); return; }
    const isEnglish = addWordTargetTask.subject === 'english';
    try {
      await addTaskWords(addWordTargetTask.id, [{
        word_id: null, error_word_id: null,
        textbook_name: wordForm.textbook_name,
        unit_no: wordForm.unit_no,
        unit_name: wordForm.unit_name,
        page_no: null,
        chinese_meaning: isEnglish ? wordForm.chinese_meaning || null : null,
        part_of_speech: isEnglish ? wordForm.part_of_speech || null : null,
        pinyin: !isEnglish ? wordForm.pinyin || null : null,
        answer: wordForm.answer.trim(),
        is_temporary: true,
        save_to_library: false,
      }]);
      await loadTaskWords(addWordTargetTask.id);
      setShowAddWord(false);
      toast.success('已添加');
    } catch (e: any) {
      toast.error('添加失败：' + e.message);
    }
  };

  if (loading) return <Loading />;

  if (children.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400 text-sm">
        暂无孩子成员，请先在家庭成员管理中添加孩子
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 筛选栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={selectedChildId}
          onChange={e => { setSelectedChildId(e.target.value); setExpandedId(null); }}
          className="text-sm w-40"
        >
          <option value="">全部用户</option>
          {children.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        {/* 学科筛选：横向按钮，默认不选中=全部 */}
        <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            onClick={() => { setSubjectFilter(''); setExpandedId(null); }}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              subjectFilter === '' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            全部
          </button>
          {SUBJECT_OPTIONS.map(s => (
            <button
              key={s.key}
              onClick={() => { setSubjectFilter(s.key); setExpandedId(null); }}
              className={cn(
                'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                subjectFilter === s.key ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-400">共 {tasks.length} 条任务</span>
        {selectedTaskIds.size > 0 && (
          <Button size="sm" variant="danger" onClick={() => setShowBatchDelete(true)} className="ml-auto">
            <Trash2 className="w-3 h-3" />删除选中({selectedTaskIds.size})
          </Button>
        )}
      </div>

      {/* 任务列表 */}
      {tasks.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">
          <Sparkles className="w-8 h-8 mx-auto mb-2 text-slate-300" />
          暂无家默任务记录
        </div>
      ) : (
        <div className="space-y-2">
          {/* 全选行 */}
          <div className="flex items-center gap-2 px-1">
            <button onClick={toggleSelectAll} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
              {selectedTaskIds.size === tasks.length && tasks.length > 0
                ? <CheckSquare className="w-4 h-4 text-emerald-500" />
                : <Square className="w-4 h-4" />}
              {selectedTaskIds.size === tasks.length && tasks.length > 0 ? '取消全选' : '全选'}
            </button>
          </div>
          {tasks.map(task => {
            const isExpanded = expandedId === task.id;
            const isEnglish = task.subject === 'english';
            const canManage = task.status !== 'completed';
            const isSelected = selectedTaskIds.has(task.id);
            const memberName = children.find(c => c.id === task.member_id)?.name ?? '';
            return (
              <Card key={task.id} className={cn('p-0 overflow-hidden', isSelected && 'ring-2 ring-rose-200')}>
                {/* 任务头部 */}
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer hover:bg-slate-50"
                  onClick={() => toggleExpand(task)}
                >
                  {/* 批量选择复选框 */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleTaskSelect(task.id); }}
                    className="shrink-0"
                  >
                    {isSelected ? <CheckSquare className="w-4 h-4 text-rose-500" /> : <Square className="w-4 h-4 text-slate-300" />}
                  </button>
                  <button className="text-slate-400 shrink-0">
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">{task.title}</span>
                      <span className="text-xs text-slate-400">{isEnglish ? '英语' : '语文'}</span>
                      {memberName && <span className="text-xs text-slate-400">· {memberName}</span>}
                      <span className={cn('text-xs px-1.5 py-0.5 rounded-full', STATUS_COLOR[task.status])}>
                        {STATUS_LABEL[task.status]}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {new Date(task.created_at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} · {task.star_per_word}星/词
                    </div>
                  </div>
                  {canManage && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleStatus(task); }}
                      className={cn(
                        'flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium shrink-0',
                        task.status === 'active'
                          ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          : 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200'
                      )}
                    >
                      {task.status === 'active'
                        ? <><PowerOff className="w-3 h-3" />下线</>
                        : <><Power className="w-3 h-3" />上线</>}
                    </button>
                  )}
                  {/* 单条删除 */}
                  <button
                    onClick={(e) => { e.stopPropagation(); onSingleDelete(task.id); }}
                    className="p-1 text-red-400 hover:text-red-600 shrink-0"
                    title="删除任务"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* 展开内容：词条列表 */}
                {isExpanded && (
                  <div className="border-t border-slate-100 bg-slate-50/50 p-3">
                    {wordsLoading ? (
                      <div className="text-center py-4 text-xs text-slate-400">加载中...</div>
                    ) : taskWords.length === 0 ? (
                      <div className="text-center py-4 text-xs text-slate-400">暂无词条</div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 mb-2">
                        {taskWords.map(w => (
                          <div key={w.id} className="flex items-center justify-between p-1.5 bg-white rounded-lg border border-slate-100">
                            <div className="text-xs min-w-0">
                              <div className="font-medium truncate">{w.answer}</div>
                              <div className="text-slate-400 truncate">
                                {isEnglish ? w.chinese_meaning : w.pinyin}
                              </div>
                            </div>
                            {canManage && (
                              <button
                                onClick={() => onRemoveWord(w.id)}
                                className="p-1 text-red-400 hover:text-red-600 shrink-0"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {canManage && (
                      <Button size="sm" variant="secondary" onClick={() => openAddWord(task)}>
                        <Plus className="w-3 h-3" />增词
                      </Button>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* 添加词条弹窗 */}
      <Modal open={showAddWord} onClose={() => setShowAddWord(false)} title="添加词条到任务">
        {addWordTargetTask && (
          <div className="space-y-3">
            <div className="text-xs text-slate-500">
              添加到「{addWordTargetTask.title}」（{addWordTargetTask.subject === 'english' ? '英语' : '语文'}）
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500">课本名称（选填）</label>
                <Input value={wordForm.textbook_name} onChange={e => setWordForm({ ...wordForm, textbook_name: e.target.value })} placeholder="可不填" />
              </div>
              <div>
                <label className="text-xs text-slate-500">单元序号（选填）</label>
                <Input type="number" value={wordForm.unit_no === 0 ? '' : wordForm.unit_no} onChange={e => setWordForm({ ...wordForm, unit_no: e.target.value === '' ? 0 : Number(e.target.value) })} placeholder="可不填" />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500">单元名称（选填）</label>
              <Input value={wordForm.unit_name} onChange={e => setWordForm({ ...wordForm, unit_name: e.target.value })} placeholder="可不填" />
            </div>
            {addWordTargetTask.subject === 'english' ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">中文释义</label>
                    <Input value={wordForm.chinese_meaning} onChange={e => setWordForm({ ...wordForm, chinese_meaning: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">词性</label>
                    <Input value={wordForm.part_of_speech} onChange={e => setWordForm({ ...wordForm, part_of_speech: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-500">英文答案</label>
                  <Input value={wordForm.answer} onChange={e => setWordForm({ ...wordForm, answer: e.target.value })} />
                </div>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500">拼音</label>
                  <Input value={wordForm.pinyin} onChange={e => setWordForm({ ...wordForm, pinyin: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-slate-500">汉字答案</label>
                  <Input value={wordForm.answer} onChange={e => setWordForm({ ...wordForm, answer: e.target.value })} />
                </div>
              </div>
            )}
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="secondary" onClick={() => setShowAddWord(false)}>取消</Button>
              <Button onClick={submitAddWord}>添加</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* 单条删除确认弹窗 */}
      <Modal open={pendingDeleteId !== null} onClose={() => setPendingDeleteId(null)} title="确认删除任务">
        <div className="py-4">
          <p className="text-sm text-slate-600">确认删除该家默任务？删除后不可恢复，但基础词条库数据不受影响。</p>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={() => setPendingDeleteId(null)}>取消</Button>
          <Button variant="danger" onClick={confirmSingleDelete}>确认删除</Button>
        </div>
      </Modal>

      {/* 批量删除确认弹窗 */}
      <Modal open={showBatchDelete} onClose={() => setShowBatchDelete(false)} title="确认批量删除任务">
        <div className="py-4">
          <p className="text-sm text-slate-600">确认删除选中的 <span className="font-bold text-rose-600">{selectedTaskIds.size}</span> 条家默任务？删除后不可恢复，但基础词条库数据不受影响。</p>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={() => setShowBatchDelete(false)}>取消</Button>
          <Button variant="danger" onClick={confirmBatchDelete}>确认删除</Button>
        </div>
      </Modal>
    </div>
  );
}
