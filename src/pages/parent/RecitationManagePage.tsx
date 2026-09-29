import { useState, useEffect } from 'react';
import { useFamilyStore, safeName, safeAvatar } from '../../store/familyStore';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Select } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { Loading } from '../../components/common/Loading';
import { EmptyState } from '../../components/common/EmptyState';
import { useToastStore } from '../../store/toastStore';
import { ROUTES } from '../../lib/constants';
import { cn } from '../../lib/utils';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Pencil, Trash2, Eye, Mic } from 'lucide-react';
import {
  listRecitationTasks, deleteRecitationTask,
  listTaskSubmissions, listFamilySubmissions,
} from '../../api/recitation';
import { compareRecitation } from '../../lib/recitationCompare';
import type { RecitationTask, RecitationInstance, RecitationSubject } from '../../api/types';

type Tab = 'templates' | 'submissions';
type SubjectFilter = '' | RecitationSubject; // '' = 全部

const STATUS_LABELS: Record<string, string> = {
  saved: '已保存',
  published: '已发布',
  offline: '已下线',
};
const STATUS_COLORS: Record<string, string> = {
  saved: 'bg-slate-100 text-slate-600',
  published: 'bg-emerald-100 text-emerald-600',
  offline: 'bg-amber-100 text-amber-600',
};

export function RecitationManagePage() {
  const navigate = useNavigate();
  const family = useFamilyStore(s => s.family);
  const members = useFamilyStore(s => s.members);
  const toast = useToastStore();

  const [tab, setTab] = useState<Tab>('templates');
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<RecitationTask[]>([]);
  // 学科筛选：''=全部，'chinese'=语文，'english'=英语
  const [subjectFilter, setSubjectFilter] = useState<SubjectFilter>('');

  // 新建/编辑：内嵌 RecitationCreatePage
  const [editing, setEditing] = useState<RecitationTask | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // 提交查看：选任务 → 筛选；不选则显示家庭全部提交
  const [subTaskId, setSubTaskId] = useState<string>('');
  const [submissions, setSubmissions] = useState<RecitationInstance[]>([]);
  const [subLoading, setSubLoading] = useState(false);
  const [viewing, setViewing] = useState<RecitationInstance | null>(null);

  const reload = async () => {
    if (!family) return;
    setLoading(true);
    try {
      const opts = subjectFilter ? { subject: subjectFilter as RecitationSubject } : undefined;
      const list = await listRecitationTasks(family.id, opts);
      setTasks(list);
    } catch (e: any) {
      toast.error('加载失败：' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [family?.id, subjectFilter]);

  // 提交查看：不选任务显示家庭全部提交，选任务则筛选
  useEffect(() => {
    if (!family) return;
    setSubLoading(true);
    const p = subTaskId
      ? listTaskSubmissions(subTaskId)
      : listFamilySubmissions(family.id);
    p.then(setSubmissions).catch(e => toast.error(e.message)).finally(() => setSubLoading(false));
  }, [subTaskId, family?.id]);

  const onDelete = async (t: RecitationTask) => {
    if (!confirm(`确认删除模板《${t.title}》？已提交的作答记录会保留（30天清理）。`)) return;
    try {
      await deleteRecitationTask(t.id);
      toast.success('已删除');
      reload();
    } catch (e: any) {
      toast.error('删除失败：' + e.message);
    }
  };

  const onEdit = (t: RecitationTask) => {
    setEditing(t);
    setShowCreate(true);
  };

  const onNew = () => {
    setEditing(null);
    setShowCreate(true);
  };

  const memberName = (id: string) => members.find(m => m.id === id)?.name ?? '未知';

  if (showCreate) {
    return (
      <RecitationCreateEmbedded
        task={editing}
        onClose={() => { setShowCreate(false); setEditing(null); reload(); }}
      />
    );
  }

  if (loading) return <Loading />;

  return (
    <div className="max-w-6xl mx-auto py-4 px-4">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(ROUTES.PARENT_DASHBOARD)} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold flex items-center gap-2">📖 背诵任务库</h1>
      </div>

      {/* Tab */}
      <div className="flex gap-1 mb-4 p-1 bg-slate-100 rounded-xl">
        {[
          { key: 'templates' as Tab, label: '背诵任务库' },
          { key: 'submissions' as Tab, label: '学生提交' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn('flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
              tab === t.key ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'templates' && (
        <div>
          {/* 学科筛选按钮组 */}
          <div className="flex gap-2 mb-3">
            {[
              { key: '' as SubjectFilter, label: '全部' },
              { key: 'chinese' as SubjectFilter, label: '语文' },
              { key: 'english' as SubjectFilter, label: '英语' },
            ].map(s => (
              <button
                key={s.key}
                onClick={() => setSubjectFilter(s.key)}
                className={cn(
                  'px-4 py-1.5 rounded-full text-sm font-medium transition-colors',
                  subjectFilter === s.key
                    ? 'bg-emerald-500 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex justify-end mb-3">
            <Button onClick={onNew}><Plus className="w-4 h-4" /> 新建背诵任务</Button>
          </div>
          {tasks.length === 0 ? (
            <EmptyState title="暂无背诵任务" description="点击右上角新建第一条背诵任务模板" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {tasks.map(t => (
                <Card key={t.id} className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h3 className="font-bold text-base">{t.title}</h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {t.subject === 'chinese' ? '语文' : '英语'} · {t.match_mode === 'fuzzy' ? '模糊匹配' : '严格匹配'} · 阈值 {t.pass_threshold}分
                      </p>
                    </div>
                    <span className={cn('text-xs px-2 py-0.5 rounded-full', STATUS_COLORS[t.status])}>{STATUS_LABELS[t.status]}</span>
                  </div>
                  <p className="text-sm text-slate-600 line-clamp-2 mb-3 whitespace-pre-wrap">{t.answer_text}</p>
                  <div className="text-xs text-slate-400 mb-3">
                    奖励档位：
                    {[1,2,3].map(i => {
                      const min = (t as any)[`reward_tier${i}_min`];
                      const max = (t as any)[`reward_tier${i}_max`];
                      const stars = (t as any)[`reward_tier${i}_stars`];
                      if (min === null || min === undefined) return null;
                      return <span key={i} className="mr-2">[{min}-{max}→{stars}⭐]</span>;
                    })}
                    {(t.reward_tier1_min ?? t.reward_tier2_min ?? t.reward_tier3_min) === null && '未配置'}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => onEdit(t)}><Pencil className="w-3.5 h-3.5" />编辑</Button>
                    <Button size="sm" variant="danger" onClick={() => onDelete(t)}><Trash2 className="w-3.5 h-3.5" />删除</Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'submissions' && (
        <div>
          <div className="mb-3">
            <label className="text-xs text-slate-500">按任务筛选（可选，不选显示全部）</label>
            <Select value={subTaskId} onChange={e => setSubTaskId(e.target.value)}>
              <option value="">全部任务</option>
              {tasks.map(t => <option key={t.id} value={t.id}>{t.title}（{t.subject === 'chinese' ? '语文' : '英语'}）</option>)}
            </Select>
          </div>
          {subLoading ? (
            <Loading />
          ) : submissions.length === 0 ? (
            <EmptyState title="暂无学生提交" description="学生完成背诵后会显示在这里" />
          ) : (
            <div className="space-y-2">
              {submissions.map(inst => {
                const m = members.find(x => x.id === inst.member_id);
                const taskTitle = inst.task?.title ?? '（模板已删除）';
                return (
                  <Card key={inst.id} className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{safeAvatar(m?.avatar_emoji)}</span>
                      <div>
                        <p className="font-medium">{safeName(m?.name)}</p>
                        <p className="text-xs text-slate-500">
                          《{taskTitle}》
                        </p>
                        <p className="text-xs text-slate-500">
                          {inst.status === 'submitted'
                            ? `已提交 · ${inst.score}分 · ${inst.passed ? '通过' : '未通过'} · +${inst.awarded_stars}⭐`
                            : '未作答'}
                        </p>
                      </div>
                    </div>
                    {inst.status === 'submitted' && (
                      <Button size="sm" variant="secondary" onClick={() => setViewing(inst)}>
                        <Eye className="w-3.5 h-3.5" />查看详情
                      </Button>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 提交详情弹窗 */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title="作答详情" size="xl">
        {viewing && <SubmissionDetail inst={viewing} />}
      </Modal>
    </div>
  );
}

// 内嵌创建页（带返回栏）
function RecitationCreateEmbedded({ task, onClose }: { task: RecitationTask | null; onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="max-w-4xl mx-auto py-4 px-4">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold flex items-center gap-2">📖 {task ? '编辑背诵任务' : '新建背诵任务'}</h1>
      </div>
      <EmbeddedCreate task={task} onClose={onClose} />
    </div>
  );
}

// 直接复用 RecitationCreatePage 逻辑，embedded 模式
import { RecitationCreatePage } from './RecitationCreatePage';
function EmbeddedCreate({ task, onClose }: { task: RecitationTask | null; onClose: () => void }) {
  return <RecitationCreatePage embedded editingTask={task} onSaved={onClose} />;
}

// 提交详情：左右对照（左：识别文本红绿标，右：标准答案）
function SubmissionDetail({ inst }: { inst: RecitationInstance }) {
  const task = inst.task;
  if (!task) return <p className="text-sm text-slate-400">模板已被删除</p>;

  const result = compareRecitation(
    task.answer_text,
    inst.recognized_text ?? '',
    task.match_mode,
    task.subject,
  );

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <span className={cn('text-sm px-2 py-0.5 rounded-full',
          inst.passed ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600')}>
          {inst.score}分 · {inst.passed ? '通过' : '未通过'}
        </span>
        {inst.awarded_stars > 0 && <span className="text-sm text-amber-600">+{inst.awarded_stars}⭐</span>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-slate-400 mb-1">学生识别文本：</p>
          <div className="p-3 rounded-xl bg-slate-50 text-base leading-loose">
            {result.diff.map((t, i) => (
              <span key={i} className={cn(
                t.status === 'matched' && 'text-emerald-600 font-medium',
                t.status === 'missing' && 'text-red-500 bg-red-50 rounded',
                t.status === 'extra' && 'text-slate-400 bg-slate-200/50 rounded line-through',
              )}>{t.text}</span>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-1">标准答案：</p>
          <div className="p-3 rounded-xl bg-slate-50 text-base leading-loose text-slate-700 whitespace-pre-wrap">
            {task.answer_text}
          </div>
        </div>
      </div>
    </div>
  );
}
