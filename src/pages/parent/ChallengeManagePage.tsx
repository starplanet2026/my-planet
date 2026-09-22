import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFamilyStore } from '../../store/familyStore';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input, Textarea, Select } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { EmptyState } from '../../components/common/EmptyState';
import { Loading } from '../../components/common/Loading';
import { useToastStore } from '../../store/toastStore';
import { ROUTES } from '../../lib/constants';
import { cn } from '../../lib/utils';
import { Plus, Trash2, ArrowLeft, BookOpen, Calculator, ListChecks, Edit, Eye, EyeOff, Lightbulb, Save, Upload, Minus, ChevronUp, ChevronDown, CheckSquare, Square, Swords, Layers, Filter } from 'lucide-react';
import {
  fetchChallengeSets, createChallengeSet, deleteChallengeSet, publishChallengeSet, updateChallengeSet,
  fetchQuestions, createQuestion, deleteQuestion, createQuestionsBatch, updateQuestion, deleteQuestionsBatch, setQuestionsActiveBatch, updateQuestionOrder,
  fetchWords, createWord, deleteWord, createWordsBatch,
  fetchChallengeLevels, createChallengeLevel, updateChallengeLevel, deleteChallengeLevel, setQuestionsLevel,
  fetchWrongQuestionStats, fetchWrongBattlePool, addWrongToBattlePool, removeWrongFromBattlePool,
} from '../../api/challenges';
import type { ChallengeSet, ChallengeSetType, Question, Word, QuestionType, Difficulty, ChallengeLevel, ChallengeBoardType, WrongQuestionStat, WrongBattlePoolItem } from '../../api/types';

const TYPE_CONFIG: Record<ChallengeSetType, { label: string; icon: React.ReactNode; color: string; desc: string }> = {
  word_vocab: { label: '单词背诵', icon: <BookOpen className="w-5 h-5" />, color: 'from-blue-400 to-blue-500', desc: '英选中/看中选英/听音选中/看中拼写' },
  math: { label: '数学计算', icon: <Calculator className="w-5 h-5" />, color: 'from-emerald-400 to-emerald-500', desc: '口算题，填写数字答案' },
  choice: { label: '知识挑战', icon: <ListChecks className="w-5 h-5" />, color: 'from-purple-400 to-purple-500', desc: '介词/冠词等知识点选择题' },
};

const BOARD_CONFIG: Record<ChallengeBoardType, { label: string; color: string }> = {
  today_review: { label: '今日复习', color: 'bg-rose-100 text-rose-600' },
  gap_check: { label: '查漏补缺', color: 'bg-amber-100 text-amber-600' },
  wrong_battle: { label: '错题大混战', color: 'bg-purple-100 text-purple-600' },
  advance: { label: '超前拓展', color: 'bg-sky-100 text-sky-600' },
};

// 七种题型 + math（兼容）可读标签
const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  choice: '单选题',
  multi_choice: '多选题',
  spell: '单词拼写',
  match: '匹配连连看',
  scramble: '句子乱序重组',
  recite: '语文语音背诵',
  correct: '英语改错',
  math: '数学计算',
};

export function ChallengeManagePage() {
  const navigate = useNavigate();
  const family = useFamilyStore(s => s.family);
  const toast = useToastStore();

  const [tab, setTab] = useState<'sets' | 'wrong_battle'>('sets');
  const [sets, setSets] = useState<ChallengeSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [activeSet, setActiveSet] = useState<ChallengeSet | null>(null);

  const loadSets = async () => {
    if (!family) return;
    setLoading(true);
    try {
      const data = await fetchChallengeSets();
      setSets(data);
    } catch (e: any) {
      toast.error(e?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSets(); }, [family?.id]);

  const handleDelete = async (id: string) => {
    try {
      await deleteChallengeSet(id);
      toast.success('已删除');
      loadSets();
    } catch (e: any) {
      toast.error(e?.message ?? '删除失败');
    }
  };

  const handlePublish = async (id: string) => {
    try {
      await publishChallengeSet(id);
      toast.success('已发布');
      loadSets();
    } catch (e: any) {
      toast.error(e?.message ?? '发布失败');
    }
  };

  const handleUnpublish = async (id: string) => {
    try {
      await updateChallengeSet(id, { status: 'draft' });
      toast.success('已下线');
      loadSets();
    } catch (e: any) {
      toast.error(e?.message ?? '下线失败');
    }
  };

  if (loading) return <Loading />;

  if (activeSet) {
    return <SetDetail set={activeSet} onBack={() => { setActiveSet(null); loadSets(); }} />;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(ROUTES.PARENT_DASHBOARD)} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold text-slate-800">智慧星战管理</h1>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-2 mb-4 border-b border-slate-200">
        <button
          onClick={() => setTab('sets')}
          className={cn('px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === 'sets' ? 'border-star-400 text-star-600' : 'border-transparent text-slate-500 hover:text-slate-700')}
        >
          <Layers className="w-4 h-4 inline-block mr-1" /> 题集管理
        </button>
        <button
          onClick={() => setTab('wrong_battle')}
          className={cn('px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === 'wrong_battle' ? 'border-star-400 text-star-600' : 'border-transparent text-slate-500 hover:text-slate-700')}
        >
          <Swords className="w-4 h-4 inline-block mr-1" /> 错题混战管理
        </button>
      </div>

      {tab === 'wrong_battle' ? (
        <WrongBattleManageTab sets={sets} />
      ) : (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-slate-500">创建题集，孩子答对获得星光值</p>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4" /> 新建题集
            </Button>
          </div>

          {sets.length === 0 ? (
            <EmptyState icon="📚" title="还没有题集" description="点击右上角新建题集" />
          ) : (
            <div className="space-y-6">
              {/* 按板块分组 */}
              {(Object.keys(BOARD_CONFIG) as ChallengeBoardType[]).map(board => {
                const boardSets = sets.filter(s => (s.board as ChallengeBoardType) === board);
                if (boardSets.length === 0) return null;
                const bcfg = BOARD_CONFIG[board];
                return (
                  <div key={board}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', bcfg.color)}>{bcfg.label}</span>
                      <span className="text-xs text-slate-400">({boardSets.length})</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {boardSets.map(set => {
                        const cfg = TYPE_CONFIG[set.type];
                        return (
                          <Card key={set.id} className="p-4">
                            <div className="flex items-start gap-3">
                              <div className={cn('w-12 h-12 rounded-xl bg-gradient-to-br flex items-center justify-center text-white', cfg.color)}>
                                {cfg.icon}
                              </div>
                              <div className="flex-1 min-w-0">
                                <h3 className="font-bold text-slate-800">{set.title}</h3>
                                <p className="text-xs text-slate-400 mt-0.5">{cfg.desc}</p>
                                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">简{set.reward_easy}</span>
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600">中{set.reward_medium}</span>
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600">困{set.reward_hard}</span>
                                  <span className="text-xs text-slate-400">星光值</span>
                                  <span className={cn('text-xs px-2 py-0.5 rounded-full',
                                    set.status === 'active' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500')}>
                                    {set.status === 'active' ? '已发布' : '草稿'}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-2 mt-3">
                              <Button variant="ghost" size="sm" onClick={() => setActiveSet(set)}>
                                <Edit className="w-4 h-4" /> 编辑
                              </Button>
                              {set.status === 'draft' ? (
                                <Button variant="ghost" size="sm" onClick={() => handlePublish(set.id)}>
                                  <Eye className="w-4 h-4" /> 发布
                                </Button>
                              ) : (
                                <Button variant="ghost" size="sm" onClick={() => handleUnpublish(set.id)}>
                                  <EyeOff className="w-4 h-4" /> 下线
                                </Button>
                              )}
                              <Button variant="ghost" size="sm" danger onClick={() => handleDelete(set.id)}>
                                <Trash2 className="w-4 h-4" /> 删除
                              </Button>
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {showCreate && (
        <CreateSetModal
          onClose={() => setShowCreate(false)}
          onCreated={(set) => { setShowCreate(false); setActiveSet(set); }}
        />
      )}
    </div>
  );
}

// ====== 新建题集弹窗 ======
function CreateSetModal({ onClose, onCreated }: { onClose: () => void; onCreated: (s: ChallengeSet) => void }) {
  const family = useFamilyStore(s => s.family);
  const toast = useToastStore();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<ChallengeSetType>('word_vocab');
  const [board, setBoard] = useState<ChallengeBoardType>('today_review');
  const [rewardEasy, setRewardEasy] = useState(3);
  const [rewardMedium, setRewardMedium] = useState(5);
  const [rewardHard, setRewardHard] = useState(8);
  const [knowledgePoints, setKnowledgePoints] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!family) return;
    if (!title.trim()) { toast.error('请输入标题'); return; }
    if (rewardEasy < 0 || rewardMedium < 0 || rewardHard < 0) { toast.error('奖励不能为负数'); return; }
    setCreating(true);
    try {
      const set = await createChallengeSet({
        title: title.trim(),
        description: description.trim() || undefined,
        type,
        board,
        reward_easy: rewardEasy,
        reward_medium: rewardMedium,
        reward_hard: rewardHard,
        knowledge_points: knowledgePoints.trim() || undefined,
      });
      toast.success('题集已创建，请添加内容');
      onCreated(set);
    } catch (e: any) {
      toast.error(e?.message ?? '创建失败');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="新建题集" size="md">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">题集标题</label>
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="如：三年级上册单词" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">所属板块</label>
          <div className="grid grid-cols-4 gap-2">
            {(Object.keys(BOARD_CONFIG) as ChallengeBoardType[]).map(b => {
              const bcfg = BOARD_CONFIG[b];
              return (
                <button
                  key={b}
                  onClick={() => setBoard(b)}
                  className={cn(
                    'py-2 rounded-lg text-xs font-medium border-2 transition-colors',
                    board === b ? 'border-star-400 bg-star-50 text-star-600' : 'border-slate-200 text-slate-500'
                  )}
                >
                  {bcfg.label}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">类型</label>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(TYPE_CONFIG) as ChallengeSetType[]).map(t => {
              const cfg = TYPE_CONFIG[t];
              return (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={cn(
                    'p-3 rounded-xl border-2 text-center transition-colors',
                    type === t ? 'border-star-400 bg-star-50' : 'border-slate-200'
                  )}
                >
                  <div className={cn('w-10 h-10 mx-auto rounded-lg bg-gradient-to-br flex items-center justify-center text-white mb-1', cfg.color)}>
                    {cfg.icon}
                  </div>
                  <span className="text-sm font-medium">{cfg.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">每题奖励星光值（按难度分级）</label>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-emerald-50 p-2 text-center">
              <div className="text-xs text-emerald-600 mb-1">简单</div>
              <Input type="number" min={0} value={rewardEasy} onChange={e => setRewardEasy(Number(e.target.value))} className="text-center" />
            </div>
            <div className="rounded-lg bg-amber-50 p-2 text-center">
              <div className="text-xs text-amber-600 mb-1">中等</div>
              <Input type="number" min={0} value={rewardMedium} onChange={e => setRewardMedium(Number(e.target.value))} className="text-center" />
            </div>
            <div className="rounded-lg bg-red-50 p-2 text-center">
              <div className="text-xs text-red-600 mb-1">困难</div>
              <Input type="number" min={0} value={rewardHard} onChange={e => setRewardHard(Number(e.target.value))} className="text-center" />
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-1">答题时按题目难度发放对应星光值；单词背诵默认按中等奖励</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">知识点（可选）</label>
          <Textarea value={knowledgePoints} onChange={e => setKnowledgePoints(e.target.value)} placeholder="每行一个知识点，答题前/答题中可查看" rows={3} />
          <p className="text-xs text-slate-400 mt-1">孩子答题前可预览，答题中右上角灯泡图标可随时查看</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">描述（可选）</label>
          <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="题集说明" rows={2} />
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">取消</Button>
          <Button onClick={handleCreate} loading={creating} className="flex-1">创建</Button>
        </div>
      </div>
    </Modal>
  );
}

// ====== 题集详情（添加题目/单词） ======
function SetDetail({ set: initialSet, onBack }: { set: ChallengeSet; onBack: () => void }) {
  const toast = useToastStore();
  const [set, setSet] = useState<ChallengeSet>(initialSet);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [words, setWords] = useState<Word[]>([]);
  const [levels, setLevels] = useState<ChallengeLevel[]>([]);
  const [showAddQuestion, setShowAddQuestion] = useState(false);
  const [showAddWord, setShowAddWord] = useState(false);
  const [showBatchWords, setShowBatchWords] = useState(false);
  const [showEditKnowledge, setShowEditKnowledge] = useState(false);
  const [showEditSet, setShowEditSet] = useState(false);
  const [showBatchImport, setShowBatchImport] = useState(false);
  const [showLevelModal, setShowLevelModal] = useState(false);
  const [editingLevel, setEditingLevel] = useState<ChallengeLevel | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const load = async () => {
    try {
      // 关卡对所有题集类型都可加载（word_vocab 不展示但加载无副作用）
      const [qs, ws, lvs] = await Promise.all([
        set.type === 'word_vocab' ? Promise.resolve([] as Question[]) : fetchQuestions(set.id),
        set.type === 'word_vocab' ? fetchWords(set.id) : Promise.resolve([] as Word[]),
        set.type === 'word_vocab' ? Promise.resolve([] as ChallengeLevel[]) : fetchChallengeLevels(set.id),
      ]);
      setQuestions(qs);
      setWords(ws);
      setLevels(lvs);
      setSelectedIds(new Set());
    } catch (e: any) {
      toast.error(e?.message ?? '加载失败');
    }
  };

  useEffect(() => { load(); }, [set.id]);

  const handleDeleteQuestion = async (id: string) => {
    try { await deleteQuestion(id); load(); } catch (e: any) { toast.error(e?.message ?? '删除失败'); }
  };

  // 切换题目的上线/下线状态（孩子端是否展示）
  const toggleQuestionActive = async (q: Question) => {
    const newActive = q.is_active === false ? true : false;
    try {
      await updateQuestion(q.id, { is_active: newActive });
      toast.success(newActive ? '已上线' : '已下线');
      load();
    } catch (e: any) {
      toast.error(e?.message ?? '切换失败（需执行 0052 迁移）');
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    try {
      await deleteQuestionsBatch([...selectedIds]);
      toast.success(`已删除 ${selectedIds.size} 题`);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? '批量删除失败');
    }
  };

  // 批量上线/下线
  const handleBatchSetActive = async (isActive: boolean) => {
    if (selectedIds.size === 0) return;
    try {
      await setQuestionsActiveBatch([...selectedIds], isActive);
      toast.success(`已${isActive ? '上线' : '下线'} ${selectedIds.size} 题`);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? '批量操作失败');
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === questions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(questions.map(q => q.id)));
    }
  };

  // 上移/下移题目
  const handleMoveQuestion = async (idx: number, dir: 'up' | 'down') => {
    const newIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= questions.length) return;
    const reordered = [...questions];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    setQuestions(reordered); // 即时更新 UI
    try {
      await updateQuestionOrder(reordered.map((q, i) => ({ id: q.id, display_order: i + 1 })));
    } catch (e: any) {
      toast.error(e?.message ?? '排序失败');
      load(); // 回滚
    }
  };

  // 批量移到顶部：选中的题按原顺序移到最前，其余顺延
  const handleMoveSelectedToTop = async () => {
    if (selectedIds.size === 0) return;
    const selected = questions.filter(q => selectedIds.has(q.id));
    const others = questions.filter(q => !selectedIds.has(q.id));
    const reordered = [...selected, ...others];
    setQuestions(reordered);
    try {
      await updateQuestionOrder(reordered.map((q, i) => ({ id: q.id, display_order: i + 1 })));
      toast.success('已移到顶部');
    } catch (e: any) {
      toast.error(e?.message ?? '移动失败');
      load();
    }
  };

  // 批量移到底部：选中的题按原顺序移到最后，其余前移
  const handleMoveSelectedToBottom = async () => {
    if (selectedIds.size === 0) return;
    const selected = questions.filter(q => selectedIds.has(q.id));
    const others = questions.filter(q => !selectedIds.has(q.id));
    const reordered = [...others, ...selected];
    setQuestions(reordered);
    try {
      await updateQuestionOrder(reordered.map((q, i) => ({ id: q.id, display_order: i + 1 })));
      toast.success('已移到底部');
    } catch (e: any) {
      toast.error(e?.message ?? '移动失败');
      load();
    }
  };

  // 切换题目所属关卡
  const handleChangeQuestionLevel = async (q: Question, levelId: string | null) => {
    try {
      await setQuestionsLevel([{ id: q.id, level_id: levelId }]);
      toast.success('已修改关卡');
      load();
    } catch (e: any) {
      toast.error(e?.message ?? '修改关卡失败');
    }
  };

  // 批量把选中题目移到指定关卡
  const handleBatchChangeLevel = async (levelId: string) => {
    if (selectedIds.size === 0) return;
    try {
      await setQuestionsLevel([...selectedIds].map(id => ({ id, level_id: levelId })));
      toast.success(`已将 ${selectedIds.size} 题移到关卡 ${levels.find(l => l.id === levelId)?.level_no ?? '?'}`);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? '批量移动失败');
    }
  };

  // 删除关卡
  const handleDeleteLevel = async (id: string) => {
    try {
      await deleteChallengeLevel(id);
      toast.success('关卡已删除，其下题目变为"未分配关卡"');
      load();
    } catch (e: any) {
      toast.error(e?.message ?? '删除关卡失败');
    }
  };

  const handleDeleteWord = async (id: string) => {
    try { await deleteWord(id); load(); } catch (e: any) { toast.error(e?.message ?? '删除失败'); }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-800">{set.title}</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {TYPE_CONFIG[set.type].label} ·
            <span className="text-emerald-600 ml-1">简+{set.reward_easy}</span>
            <span className="text-amber-600 ml-1">中+{set.reward_medium}</span>
            <span className="text-red-600 ml-1">困+{set.reward_hard}</span>
            <span className="ml-1">星光值</span>
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setShowEditSet(true)}>
          <Edit className="w-4 h-4" /> 编辑
        </Button>
      </div>

      {/* 知识点 */}
      <Card className="p-4 mb-4 bg-gradient-to-r from-amber-50 to-yellow-50 border-amber-100">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-yellow-400 flex items-center justify-center text-white flex-shrink-0">
            <Lightbulb className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-800">知识点</h3>
              <button onClick={() => setShowEditKnowledge(true)} className="text-xs text-star-600 hover:text-star-700 flex items-center gap-1">
                <Edit className="w-3.5 h-3.5" /> 编辑
              </button>
            </div>
            {set.knowledge_points ? (
              <pre className="text-sm text-slate-600 mt-1 whitespace-pre-wrap font-sans">{set.knowledge_points}</pre>
            ) : (
              <p className="text-sm text-slate-400 mt-1">暂无知识点，点击编辑添加</p>
            )}
          </div>
        </div>
      </Card>

      {/* 单词背诵 */}
      {set.type === 'word_vocab' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button onClick={() => setShowAddWord(true)}><Plus className="w-4 h-4" /> 添加单词</Button>
            <Button variant="ghost" onClick={() => setShowBatchWords(true)}>批量导入</Button>
          </div>
          {words.length === 0 ? (
            <EmptyState icon="📝" title="还没有单词" description="添加单词开始背诵" />
          ) : (
            <div className="space-y-2">
              {words.map((w, i) => (
                <Card key={w.id} className="p-3 flex items-center gap-3">
                  <span className="text-slate-400 text-sm w-6">{i + 1}</span>
                  <div className="flex-1">
                    <span className="font-medium text-slate-800">{w.word_en}</span>
                    {w.phonetic && <span className="text-xs text-slate-400 ml-2">{w.phonetic}</span>}
                    <span className="text-sm text-slate-500 ml-3">{w.word_cn}</span>
                  </div>
                  <button onClick={() => handleDeleteWord(w.id)} className="text-red-400 hover:text-red-500">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 关卡管理（选择题/数学题集） */}
      {(set.type === 'choice' || set.type === 'math') && (
        <Card className="p-4 mb-4 border-slate-200">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-slate-500" />
              <h3 className="font-bold text-slate-800">关卡管理</h3>
              <span className="text-xs text-slate-400">({levels.length} 关)</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setEditingLevel(null); setShowLevelModal(true); }}>
              <Plus className="w-4 h-4" /> 新建关卡
            </Button>
          </div>
          {levels.length === 0 ? (
            <p className="text-xs text-slate-400">暂无关卡，会自动按 level_no=1 顺序解锁。新建关卡后可把题目分配到不同关卡</p>
          ) : (
            <div className="space-y-2">
              {levels.map(lv => {
                const qCount = questions.filter(q => q.level_id === lv.id).length;
                return (
                  <div key={lv.id} className="flex items-center gap-3 p-2 rounded-lg bg-slate-50">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-star-100 text-star-600 font-medium">第 {lv.level_no} 关</span>
                    <span className="text-sm text-slate-700 flex-1 truncate">{lv.title || `关卡 ${lv.level_no}`}</span>
                    <span className="text-xs text-slate-400">{qCount} 题</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">通关+{lv.pass_reward}</span>
                    <button onClick={() => { setEditingLevel(lv); setShowLevelModal(true); }} className="text-slate-400 hover:text-star-600">
                      <Edit className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDeleteLevel(lv.id)} className="text-red-400 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* 选择题/数学 */}
      {(set.type === 'choice' || set.type === 'math') && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Button onClick={() => setShowAddQuestion(true)}><Plus className="w-4 h-4" /> 添加题目</Button>
            {set.type === 'choice' && (
              <Button variant="ghost" onClick={() => setShowBatchImport(true)}>
                <Upload className="w-4 h-4" /> 批量导入
              </Button>
            )}
            {questions.length > 0 && (
              <>
                <button
                  onClick={toggleSelectAll}
                  className="ml-auto text-sm text-slate-600 hover:text-star-600 flex items-center gap-1"
                >
                  {selectedIds.size === questions.length
                    ? <CheckSquare className="w-4 h-4 text-star-500" />
                    : <Square className="w-4 h-4" />}
                  {selectedIds.size === questions.length ? '取消全选' : '全选'}
                </button>
                {selectedIds.size > 0 && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => handleBatchSetActive(true)}
                      title="将选中的题目上线（孩子端可见）">
                      <Eye className="w-4 h-4" /> 上线({selectedIds.size})
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleBatchSetActive(false)}
                      title="将选中的题目下线（孩子端不可见）">
                      <EyeOff className="w-4 h-4" /> 下线({selectedIds.size})
                    </Button>
                    {levels.length > 0 && (
                      <Select
                        value=""
                        onChange={e => { if (e.target.value) handleBatchChangeLevel(e.target.value); }}
                        className="text-xs py-1 px-2 rounded-lg border-slate-200"
                        title="将选中的题目移到指定关卡"
                      >
                        <option value="">移到关卡…</option>
                        {levels.map(lv => (
                          <option key={lv.id} value={lv.id}>第 {lv.level_no} 关 · {lv.title || `关卡 ${lv.level_no}`}</option>
                        ))}
                      </Select>
                    )}
                    <Button variant="ghost" size="sm" onClick={handleMoveSelectedToTop}
                      title="将选中的题目移到列表顶部">
                      <ChevronUp className="w-4 h-4" /> 置顶
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleMoveSelectedToBottom}
                      title="将选中的题目移到列表底部">
                      <ChevronDown className="w-4 h-4" /> 置底
                    </Button>
                    <Button variant="ghost" size="sm" danger onClick={handleBatchDelete}>
                      <Trash2 className="w-4 h-4" /> 删除({selectedIds.size})
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
          {questions.length === 0 ? (
            <EmptyState icon="❓" title="还没有题目" description="添加题目开始挑战" />
          ) : (
            <div className="space-y-2">
              {questions.map((q, i) => {
                const isSelected = selectedIds.has(q.id);
                return (
                  <Card key={q.id} className={cn('p-3 transition-colors', isSelected && 'border-star-300 bg-star-50')}>
                    <div className="flex items-start gap-3">
                      <button onClick={() => toggleSelect(q.id)} className="mt-1 flex-shrink-0">
                        {isSelected
                          ? <CheckSquare className="w-5 h-5 text-star-500" />
                          : <Square className="w-5 h-5 text-slate-300" />}
                      </button>
                      <span className="text-slate-400 text-sm w-6 mt-0.5">{i + 1}</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-slate-800">{q.question_text}</p>
                          <span className={cn('text-xs px-1.5 py-0.5 rounded',
                            q.difficulty === 'easy' ? 'bg-emerald-50 text-emerald-600' :
                            q.difficulty === 'hard' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600')}>
                            {q.difficulty === 'easy' ? '简单' : q.difficulty === 'hard' ? '困难' : '中等'}
                          </span>
                          {q.type === 'multi_choice' && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-purple-50 text-purple-600">多选</span>
                          )}
                          {/* 题型徽标（非 choice/multi_choice 时显示） */}
                          {q.type !== 'choice' && q.type !== 'multi_choice' && q.type !== 'math' && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">
                              {QUESTION_TYPE_LABEL[q.type]}
                            </span>
                          )}
                          {/* 关卡选择器 */}
                          {levels.length > 0 && (
                            <Select
                              value={q.level_id ?? ''}
                              onChange={e => handleChangeQuestionLevel(q, e.target.value || null)}
                              className="text-xs py-0.5 px-1.5 rounded border-slate-200 ml-auto"
                              title="选择题目所属关卡"
                            >
                              <option value="">未分配关卡</option>
                              {levels.map(lv => (
                                <option key={lv.id} value={lv.id}>第 {lv.level_no} 关</option>
                              ))}
                            </Select>
                          )}
                          <button
                            onClick={() => toggleQuestionActive(q)}
                            title="下线后孩子端不再出现该题；做对的题会自动下线，可在此手动上线"
                            className={cn(
                              'text-xs px-1.5 py-0.5 rounded',
                              q.is_active === false
                                ? 'bg-red-50 text-red-600 hover:bg-red-100'
                                : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                            )}
                          >
                            {q.is_active === false ? '已下线' : '在线'}
                          </button>
                        </div>
                        {q.options && (
                          <div className="mt-1 text-sm text-slate-500">
                            {q.options.map((opt, j) => {
                              const letter = String.fromCharCode(65 + j);
                              const isRight = q.correct_answer.includes(letter);
                              return (
                                <span key={j} className={cn('mr-3', isRight && 'text-emerald-600 font-medium')}>
                                  {letter}. {opt}{isRight ? ' ✓' : ''}
                                </span>
                              );
                            })}
                          </div>
                        )}
                        {q.explanation && <p className="text-xs text-slate-400 mt-1">{q.explanation}</p>}
                      </div>
                      <div className="flex flex-col gap-1 flex-shrink-0">
                        <button onClick={() => handleMoveQuestion(i, 'up')} disabled={i === 0}
                          className="text-slate-400 hover:text-star-600 disabled:opacity-30">
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleMoveQuestion(i, 'down')} disabled={i === questions.length - 1}
                          className="text-slate-400 hover:text-star-600 disabled:opacity-30">
                          <ChevronDown className="w-4 h-4" />
                        </button>
                      </div>
                      <button onClick={() => setEditingQuestion(q)} className="text-slate-400 hover:text-star-600">
                        <Edit className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDeleteQuestion(q.id)} className="text-red-400 hover:text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showAddQuestion && (
        <AddQuestionModal
          setId={set.id}
          type={set.type as QuestionType}
          onClose={() => setShowAddQuestion(false)}
          onAdded={load}
        />
      )}
      {showAddWord && (
        <AddWordModal setId={set.id} onClose={() => setShowAddWord(false)} onAdded={load} />
      )}
      {showBatchWords && (
        <BatchWordsModal setId={set.id} onClose={() => setShowBatchWords(false)} onAdded={load} />
      )}
      {showEditKnowledge && (
        <EditKnowledgeModal
          set={set}
          onClose={() => setShowEditKnowledge(false)}
          onSaved={(updated) => { setSet(updated); setShowEditKnowledge(false); }}
        />
      )}
      {showEditSet && (
        <EditSetModal
          set={set}
          onClose={() => setShowEditSet(false)}
          onSaved={(updated) => { setSet(updated); setShowEditSet(false); }}
        />
      )}
      {showBatchImport && (
        <BatchImportQuestionsModal
          setId={set.id}
          existingCount={questions.length}
          levels={levels}
          onClose={() => setShowBatchImport(false)}
          onImported={load}
        />
      )}
      {showLevelModal && (
        <LevelModal
          setId={set.id}
          level={editingLevel}
          existingLevels={levels}
          onClose={() => { setShowLevelModal(false); setEditingLevel(null); }}
          onSaved={() => { setShowLevelModal(false); setEditingLevel(null); load(); }}
        />
      )}
      {editingQuestion && (
        <EditQuestionModal
          question={editingQuestion}
          isChoiceSet={set.type === 'choice'}
          onClose={() => setEditingQuestion(null)}
          onSaved={() => { setEditingQuestion(null); load(); }}
        />
      )}
    </div>
  );
}

// ====== 编辑题目弹窗 ======
function EditQuestionModal({ question: q, isChoiceSet, onClose, onSaved }: {
  question: Question; isChoiceSet: boolean; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToastStore();
  const isChoice = q.type === 'choice' || q.type === 'multi_choice';
  const [questionType, setQuestionType] = useState<QuestionType>(q.type);
  const [questionText, setQuestionText] = useState(q.question_text);
  const [options, setOptions] = useState<string[]>(q.options ?? ['', '']);
  const [correctLetters, setCorrectLetters] = useState<string>(
    (q.correct_answer ?? '').toUpperCase().replace(/[^A-Z]/g, '').split('').join('')
  );
  const [correctAnswer, setCorrectAnswer] = useState(q.correct_answer ?? ''); // 数学题
  const [explanation, setExplanation] = useState(q.explanation ?? '');
  const [difficulty, setDifficulty] = useState<Difficulty>(q.difficulty ?? 'medium');
  const [saving, setSaving] = useState(false);

  const updateOption = (i: number, val: string) => {
    const next = [...options];
    next[i] = val;
    setOptions(next);
  };
  const addOption = () => {
    if (options.length >= 8) { toast.error('最多 8 个选项'); return; }
    setOptions([...options, '']);
  };
  const removeOption = (i: number) => {
    if (options.length <= 2) { toast.error('至少保留 2 个选项'); return; }
    setOptions(options.filter((_, idx) => idx !== i));
    // 修正 correctLetters 中受影响字母
    const removedLetter = String.fromCharCode(65 + i);
    const newLetters = correctLetters.split('').filter(l => l !== removedLetter).map(l => {
      const idx = l.charCodeAt(0) - 65;
      return idx > i ? String.fromCharCode(l.charCodeAt(0) - 1) : l;
    }).join('');
    setCorrectLetters(newLetters);
  };
  const toggleCorrect = (letter: string) => {
    if (questionType === 'multi_choice') {
      setCorrectLetters(prev => prev.includes(letter) ? prev.replace(letter, '') : prev + letter);
    } else {
      setCorrectLetters(correctLetters[0] === letter ? '' : letter);
    }
  };

  const handleSave = async () => {
    if (!questionText.trim()) { toast.error('请输入题干'); return; }
    if (isChoice) {
      const opts = options.map(o => o.trim()).filter(Boolean);
      if (opts.length < 2) { toast.error('至少 2 个选项'); return; }
      if (!correctLetters) { toast.error('请标记正确选项'); return; }
      setSaving(true);
      try {
        await updateQuestion(q.id, {
          type: questionType,
          question_text: questionText.trim(),
          options: opts,
          correct_answer: correctLetters.split('').sort().join(''),
          explanation: explanation.trim() || null,
          difficulty,
        });
        toast.success('已保存');
        onSaved();
      } catch (e: any) {
        toast.error(e?.message ?? '保存失败');
      } finally {
        setSaving(false);
      }
    } else {
      if (!correctAnswer.trim()) { toast.error('请输入正确答案'); return; }
      setSaving(true);
      try {
        await updateQuestion(q.id, {
          question_text: questionText.trim(),
          correct_answer: correctAnswer.trim(),
          explanation: explanation.trim() || null,
          difficulty,
        });
        toast.success('已保存');
        onSaved();
      } catch (e: any) {
        toast.error(e?.message ?? '保存失败');
      } finally {
        setSaving(false);
      }
    }
  };

  return (
    <Modal open onClose={onClose} title="编辑题目" size="md">
      <div className="space-y-4">
        {isChoiceSet && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">题型</label>
            <div className="flex gap-2">
              <button onClick={() => { setQuestionType('choice'); setCorrectLetters(''); }}
                className={cn('flex-1 py-2 rounded-lg text-sm', questionType === 'choice' ? 'bg-star-100 text-star-600 font-medium' : 'bg-slate-100 text-slate-500')}>
                单选
              </button>
              <button onClick={() => { setQuestionType('multi_choice'); }}
                className={cn('flex-1 py-2 rounded-lg text-sm', questionType === 'multi_choice' ? 'bg-star-100 text-star-600 font-medium' : 'bg-slate-100 text-slate-500')}>
                多选
              </button>
            </div>
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">题干</label>
          <Textarea value={questionText} onChange={e => setQuestionText(e.target.value)} rows={2} />
        </div>
        {isChoice && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              选项（点击左侧圆点标记正确答案{questionType === 'multi_choice' ? '，可多选' : ''}）
            </label>
            <div className="space-y-2">
              {options.map((opt, i) => {
                const letter = String.fromCharCode(65 + i);
                const isCorrect = correctLetters.includes(letter);
                return (
                  <div key={i} className="flex items-center gap-2">
                    <button type="button" onClick={() => toggleCorrect(letter)}
                      className={cn('w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 flex-shrink-0',
                        isCorrect ? 'bg-emerald-500 text-white border-emerald-500' : 'border-slate-300 text-slate-400')}>
                      {isCorrect ? '✓' : letter}
                    </button>
                    <Input value={opt} onChange={e => updateOption(i, e.target.value)} className="flex-1" />
                    <button type="button" onClick={() => removeOption(i)} className="text-red-400 hover:text-red-500 flex-shrink-0">
                      <Minus className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
            <button onClick={addOption} className="mt-2 text-sm text-star-600 hover:text-star-700 flex items-center gap-1">
              <Plus className="w-4 h-4" /> 增加选项
            </button>
          </div>
        )}
        {!isChoice && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">正确答案</label>
            <Input value={correctAnswer} onChange={e => setCorrectAnswer(e.target.value)} />
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">解析（可选）</label>
          <Textarea value={explanation} onChange={e => setExplanation(e.target.value)} rows={2} />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">难度</label>
          <div className="flex gap-2">
            {(['easy', 'medium', 'hard'] as Difficulty[]).map(d => (
              <button key={d} onClick={() => setDifficulty(d)}
                className={cn('flex-1 py-2 rounded-lg text-sm', difficulty === d ? 'bg-star-100 text-star-600' : 'bg-slate-100 text-slate-500')}>
                {d === 'easy' ? '简单' : d === 'medium' ? '中等' : '困难'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">取消</Button>
          <Button onClick={handleSave} loading={saving} className="flex-1">
            <Save className="w-4 h-4" /> 保存
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ====== 编辑题集弹窗（标题/描述/奖励） ======
function EditSetModal({ set, onClose, onSaved }: {
  set: ChallengeSet; onClose: () => void; onSaved: (s: ChallengeSet) => void;
}) {
  const toast = useToastStore();
  const [title, setTitle] = useState(set.title);
  const [description, setDescription] = useState(set.description ?? '');
  const [board, setBoard] = useState<ChallengeBoardType>((set.board as ChallengeBoardType) ?? 'today_review');
  const [rewardEasy, setRewardEasy] = useState(set.reward_easy);
  const [rewardMedium, setRewardMedium] = useState(set.reward_medium);
  const [rewardHard, setRewardHard] = useState(set.reward_hard);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim()) { toast.error('请输入标题'); return; }
    if (rewardEasy < 0 || rewardMedium < 0 || rewardHard < 0) { toast.error('奖励不能为负数'); return; }
    setSaving(true);
    try {
      const updated = await updateChallengeSet(set.id, {
        title: title.trim(),
        description: description.trim() || null,
        board,
        reward_easy: rewardEasy,
        reward_medium: rewardMedium,
        reward_hard: rewardHard,
      });
      toast.success('已保存');
      onSaved(updated);
    } catch (e: any) {
      toast.error(e?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="编辑题集" size="md">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">题集标题</label>
          <Input value={title} onChange={e => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">所属板块</label>
          <div className="grid grid-cols-4 gap-2">
            {(Object.keys(BOARD_CONFIG) as ChallengeBoardType[]).map(b => {
              const bcfg = BOARD_CONFIG[b];
              return (
                <button
                  key={b}
                  onClick={() => setBoard(b)}
                  className={cn(
                    'py-2 rounded-lg text-xs font-medium border-2 transition-colors',
                    board === b ? 'border-star-400 bg-star-50 text-star-600' : 'border-slate-200 text-slate-500'
                  )}
                >
                  {bcfg.label}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">每题奖励星光值（按难度分级）</label>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-emerald-50 p-2 text-center">
              <div className="text-xs text-emerald-600 mb-1">简单</div>
              <Input type="number" min={0} value={rewardEasy} onChange={e => setRewardEasy(Number(e.target.value))} className="text-center" />
            </div>
            <div className="rounded-lg bg-amber-50 p-2 text-center">
              <div className="text-xs text-amber-600 mb-1">中等</div>
              <Input type="number" min={0} value={rewardMedium} onChange={e => setRewardMedium(Number(e.target.value))} className="text-center" />
            </div>
            <div className="rounded-lg bg-red-50 p-2 text-center">
              <div className="text-xs text-red-600 mb-1">困难</div>
              <Input type="number" min={0} value={rewardHard} onChange={e => setRewardHard(Number(e.target.value))} className="text-center" />
            </div>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">描述（可选）</label>
          <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="题集说明" rows={2} />
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">取消</Button>
          <Button onClick={handleSave} loading={saving} className="flex-1">
            <Save className="w-4 h-4" /> 保存
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ====== 关卡编辑/新建弹窗 ======
function LevelModal({ setId, level, existingLevels, onClose, onSaved }: {
  setId: string;
  level: ChallengeLevel | null;
  existingLevels: ChallengeLevel[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToastStore();
  const isEdit = !!level;
  // 新建时默认 level_no = 当前最大 + 1
  const defaultNo = existingLevels.length === 0
    ? 1
    : Math.max(...existingLevels.map(l => l.level_no)) + 1;
  const [levelNo, setLevelNo] = useState<number>(level?.level_no ?? defaultNo);
  const [title, setTitle] = useState<string>(level?.title ?? '');
  const [passReward, setPassReward] = useState<number>(level?.pass_reward ?? 3);
  const [status, setStatus] = useState<'active' | 'inactive'>(level?.status ?? 'active');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!levelNo || levelNo < 1) { toast.error('关卡号需为正整数'); return; }
    // 新建时校验 level_no 不重复
    if (!isEdit && existingLevels.some(l => l.level_no === levelNo)) {
      toast.error(`第 ${levelNo} 关已存在`);
      return;
    }
    if (passReward < 0) { toast.error('通关奖励不能为负数'); return; }
    setSaving(true);
    try {
      if (isEdit && level) {
        await updateChallengeLevel(level.id, {
          level_no: levelNo,
          title: title.trim() || null,
          pass_reward: passReward,
          status,
        });
        toast.success('关卡已更新');
      } else {
        await createChallengeLevel({
          challenge_set_id: setId,
          level_no: levelNo,
          title: title.trim() || undefined,
          pass_reward: passReward,
          status,
        });
        toast.success('关卡已创建');
      }
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? `编辑第 ${level?.level_no} 关` : '新建关卡'} size="md">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">关卡号（必填，决定解锁顺序）</label>
          <Input type="number" min={1} value={levelNo} onChange={e => setLevelNo(Number(e.target.value))} />
          <p className="text-xs text-slate-400 mt-1">孩子必须按关卡号顺序通关：第 1 关 100% 清零后才能解锁第 2 关</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">关卡标题（可选）</label>
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder={`如：第一单元练习`} />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">通关奖励星光值</label>
          <Input type="number" min={0} value={passReward} onChange={e => setPassReward(Number(e.target.value))} />
          <p className="text-xs text-slate-400 mt-1">关卡 100% 清零时固定奖励（默认 3）</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">状态</label>
          <div className="flex gap-2">
            <button onClick={() => setStatus('active')}
              className={cn('flex-1 py-2 rounded-lg text-sm', status === 'active' ? 'bg-star-100 text-star-600 font-medium' : 'bg-slate-100 text-slate-500')}>
              启用
            </button>
            <button onClick={() => setStatus('inactive')}
              className={cn('flex-1 py-2 rounded-lg text-sm', status === 'inactive' ? 'bg-star-100 text-star-600 font-medium' : 'bg-slate-100 text-slate-500')}>
              停用
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">取消</Button>
          <Button onClick={handleSave} loading={saving} className="flex-1">
            <Save className="w-4 h-4" /> {isEdit ? '保存' : '创建'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ====== 编辑知识点弹窗 ======
function EditKnowledgeModal({ set, onClose, onSaved }: {
  set: ChallengeSet; onClose: () => void; onSaved: (s: ChallengeSet) => void;
}) {
  const toast = useToastStore();
  const [text, setText] = useState(set.knowledge_points ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await updateChallengeSet(set.id, { knowledge_points: text.trim() || null });
      toast.success('知识点已保存');
      onSaved(updated);
    } catch (e: any) {
      toast.error(e?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="编辑知识点" size="md">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">知识点内容</label>
          <Textarea value={text} onChange={e => setText(e.target.value)} placeholder="每行一个知识点，答题前/答题中可查看" rows={6} />
          <p className="text-xs text-slate-400 mt-1">孩子答题前可预览，答题中右上角灯泡图标可随时查看</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">取消</Button>
          <Button onClick={handleSave} loading={saving} className="flex-1">
            <Save className="w-4 h-4" /> 保存
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ====== 添加题目弹窗 ======
function AddQuestionModal({ setId, type, onClose, onAdded }: {
  setId: string; type: QuestionType; onClose: () => void; onAdded: () => void;
}) {
  const toast = useToastStore();
  const isChoiceSet = type === 'choice';
  // 对于 choice 题集，允许单选/多选切换；math 题集固定 math
  const [questionType, setQuestionType] = useState<QuestionType>(type);
  const [questionNumber, setQuestionNumber] = useState(''); // 题号（选填），映射到 display_order
  const [questionText, setQuestionText] = useState('');
  const [options, setOptions] = useState<string[]>(['', '', '', '']);
  const [correctLetters, setCorrectLetters] = useState<string[]>([]); // 选项字母 ['A','C']
  const [correctAnswer, setCorrectAnswer] = useState(''); // 数学题答案
  const [explanation, setExplanation] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [saving, setSaving] = useState(false);

  const handleTypeToggle = (t: QuestionType) => {
    setQuestionType(t);
    setCorrectLetters([]); // 切换题型清空已选正确项
  };

  const updateOption = (i: number, val: string) => {
    const next = [...options];
    next[i] = val;
    setOptions(next);
  };

  const addOption = () => {
    if (options.length >= 8) { toast.error('最多 8 个选项'); return; }
    setOptions([...options, '']);
  };

  const removeOption = (i: number) => {
    if (options.length <= 2) { toast.error('至少保留 2 个选项'); return; }
    const next = options.filter((_, idx) => idx !== i);
    setOptions(next);
    // 移除对应字母的已选状态，并修正后续字母
    const removedLetter = String.fromCharCode(65 + i);
    const newLetters = correctLetters
      .filter(l => l !== removedLetter)
      .map(l => {
        const idx = l.charCodeAt(0) - 65;
        return idx > i ? String.fromCharCode(l.charCodeAt(0) - 1) : l;
      });
    setCorrectLetters(newLetters);
  };

  const toggleCorrect = (letter: string) => {
    if (questionType === 'multi_choice') {
      setCorrectLetters(prev => prev.includes(letter) ? prev.filter(l => l !== letter) : [...prev, letter]);
    } else {
      // 单选：只能选一个
      setCorrectLetters(correctLetters[0] === letter ? [] : [letter]);
    }
  };

  const handleSave = async () => {
    if (!questionText.trim()) { toast.error('请输入题干'); return; }
    // 题号选填：映射到 display_order，空则不传
    const displayOrder = questionNumber.trim() ? parseInt(questionNumber, 10) : undefined;
    if (displayOrder !== undefined && (isNaN(displayOrder) || displayOrder < 1)) {
      toast.error('题号需为正整数');
      return;
    }
    if (isChoiceSet) {
      const opts = options.map(o => o.trim()).filter(Boolean);
      if (opts.length < 2) { toast.error('至少 2 个选项'); return; }
      if (correctLetters.length === 0) { toast.error('请标记正确选项'); return; }
      setSaving(true);
      try {
        await createQuestion({
          challenge_set_id: setId,
          type: questionType,
          question_text: questionText.trim(),
          options: opts,
          correct_answer: correctLetters.slice().sort().join(''),
          explanation: explanation.trim() || undefined,
          difficulty,
          display_order: displayOrder,
        });
        toast.success('已添加');
        onAdded();
        onClose();
      } catch (e: any) {
        toast.error(e?.message ?? '添加失败');
      } finally {
        setSaving(false);
      }
    } else {
      // 数学题
      if (!correctAnswer.trim()) { toast.error('请输入正确答案'); return; }
      setSaving(true);
      try {
        await createQuestion({
          challenge_set_id: setId,
          type: 'math',
          question_text: questionText.trim(),
          correct_answer: correctAnswer.trim(),
          explanation: explanation.trim() || undefined,
          difficulty,
          display_order: displayOrder,
        });
        toast.success('已添加');
        onAdded();
        onClose();
      } catch (e: any) {
        toast.error(e?.message ?? '添加失败');
      } finally {
        setSaving(false);
      }
    }
  };

  return (
    <Modal open onClose={onClose} title={isChoiceSet ? '添加选择题' : '添加数学题'} size="md">
      <div className="space-y-4">
        {isChoiceSet && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">题型</label>
            <div className="flex gap-2">
              <button onClick={() => handleTypeToggle('choice')}
                className={cn('flex-1 py-2 rounded-lg text-sm', questionType === 'choice' ? 'bg-star-100 text-star-600 font-medium' : 'bg-slate-100 text-slate-500')}>
                单选
              </button>
              <button onClick={() => handleTypeToggle('multi_choice')}
                className={cn('flex-1 py-2 rounded-lg text-sm', questionType === 'multi_choice' ? 'bg-star-100 text-star-600 font-medium' : 'bg-slate-100 text-slate-500')}>
                多选
              </button>
            </div>
          </div>
        )}
        <div className="flex gap-3">
          <div className="w-28 flex-shrink-0">
            <label className="block text-sm font-medium text-slate-700 mb-1">题号</label>
            <Input value={questionNumber} onChange={e => setQuestionNumber(e.target.value)} placeholder="选填" type="number" min={1} />
            <p className="text-xs text-slate-400 mt-0.5">控制题目顺序</p>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700 mb-1">题干</label>
            <Textarea value={questionText} onChange={e => setQuestionText(e.target.value)} placeholder="如：He ___ to school every day." rows={2} />
          </div>
        </div>
        {isChoiceSet && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              选项（点击左侧圆点标记正确答案{questionType === 'multi_choice' ? '，可多选' : ''}）
            </label>
            <div className="space-y-2">
              {options.map((opt, i) => {
                const letter = String.fromCharCode(65 + i);
                const isCorrect = correctLetters.includes(letter);
                return (
                  <div key={i} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleCorrect(letter)}
                      className={cn('w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 flex-shrink-0',
                        isCorrect ? 'bg-emerald-500 text-white border-emerald-500' : 'border-slate-300 text-slate-400')}
                      title={isCorrect ? '取消正确' : '标记为正确'}
                    >
                      {isCorrect ? '✓' : letter}
                    </button>
                    <Input value={opt} onChange={e => updateOption(i, e.target.value)} placeholder={`选项 ${letter}`} className="flex-1" />
                    <button type="button" onClick={() => removeOption(i)} className="text-red-400 hover:text-red-500 flex-shrink-0">
                      <Minus className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
            <button onClick={addOption} className="mt-2 text-sm text-star-600 hover:text-star-700 flex items-center gap-1">
              <Plus className="w-4 h-4" /> 增加选项
            </button>
          </div>
        )}
        {!isChoiceSet && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">正确答案（填数字）</label>
            <Input value={correctAnswer} onChange={e => setCorrectAnswer(e.target.value)} placeholder="42" />
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">解析（可选）</label>
          <Textarea value={explanation} onChange={e => setExplanation(e.target.value)} placeholder="答案解析" rows={2} />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">难度</label>
          <div className="flex gap-2">
            {(['easy', 'medium', 'hard'] as Difficulty[]).map(d => (
              <button key={d} onClick={() => setDifficulty(d)}
                className={cn('flex-1 py-2 rounded-lg text-sm', difficulty === d ? 'bg-star-100 text-star-600' : 'bg-slate-100 text-slate-500')}>
                {d === 'easy' ? '简单' : d === 'medium' ? '中等' : '困难'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">取消</Button>
          <Button onClick={handleSave} loading={saving} className="flex-1">添加</Button>
        </div>
      </div>
    </Modal>
  );
}

// ====== 批量导入题目弹窗（Excel） ======
interface ParsedQuestion {
  type: QuestionType;
  difficulty: Difficulty;
  question_text: string;
  options: string[] | null;
  correct_answer: string;
  explanation: string;
  metadata: Record<string, any> | null;
  level_no: number | null; // 关卡号（可选，导入时映射到 level_id）
  display_order: number | null;
  valid: boolean;
  error?: string;
}

// 从表头识别"解析"二字的字段（用户明确要求）
function findExplanationKey(row: Record<string, any>): string | null {
  return Object.keys(row).find(k => k.includes('解析')) ?? null;
}

// 识别题型：根据"题型"列的值映射到 QuestionType
function detectQuestionType(raw: string): QuestionType {
  const s = raw.trim();
  if (/多选/.test(s)) return 'multi_choice';
  if (/单选/.test(s)) return 'choice';
  if (/拼写|spell/i.test(s)) return 'spell';
  if (/匹配|连连看|match/i.test(s)) return 'match';
  if (/乱序|重组|scramble/i.test(s)) return 'scramble';
  if (/背诵|语音?背诵|recite/i.test(s)) return 'recite';
  if (/改错|correct/i.test(s)) return 'correct';
  if (/数学|计算|math/i.test(s)) return 'math';
  return 'choice'; // 默认
}

function BatchImportQuestionsModal({ setId, existingCount, levels, onClose, onImported }: {
  setId: string; existingCount: number; levels: ChallengeLevel[]; onClose: () => void; onImported: () => void;
}) {
  const toast = useToastStore();
  const [parsed, setParsed] = useState<ParsedQuestion[]>([]);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState('');
  const [defaultLevelId, setDefaultLevelId] = useState<string>(levels[0]?.id ?? '');

  // 关卡号 → level_id 的映射表
  const levelNoToId = new Map<number, string>(levels.map(l => [l.level_no, l.id]));

  const handleFile = async (file: File) => {
    setFileName(file.name);
    try {
      const mod = await import('xlsx');
      const XLSX = (mod as any).default ?? mod;
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, any>[];

      // 收集所有"解析"列候选（首行决定）
      let explKey: string | null = null;
      if (rows.length > 0) explKey = findExplanationKey(rows[0]);

      const items: ParsedQuestion[] = rows.map((row: Record<string, any>) => {
        const rawType = String(row['题型'] ?? row['类型'] ?? '单选').trim();
        const rawDiff = String(row['难度'] ?? '中等').trim();
        const qText = String(row['题目'] ?? row['题干'] ?? '').trim();
        const answer = String(row['正确答案'] ?? row['答案'] ?? '').trim();
        const expl = explKey ? String(row[explKey] ?? '').trim() : '';
        const hint = String(row['提示'] ?? row['hints'] ?? '').trim();
        const wordBlocks = String(row['词块'] ?? row['单词块'] ?? '').trim();
        const rightCol = String(row['右列项'] ?? row['右列'] ?? row['匹配右列'] ?? '').trim();
        const correctSentence = String(row['正确句子'] ?? row['正确整句'] ?? '').trim();
        const errorPositionsRaw = String(row['错误位置'] ?? row['错误点'] ?? '').trim();
        const levelNoRaw = String(row['关卡号'] ?? row['关卡'] ?? row['level'] ?? '').trim();
        const serialNo = String(row['序号'] ?? row['题号'] ?? '').trim();

        const qType: QuestionType = detectQuestionType(rawType);
        const diff: Difficulty = /简|easy/i.test(rawDiff) ? 'easy' : /困|hard/i.test(rawDiff) ? 'hard' : 'medium';

        // 收集选项A-H（同时用于 match 的左列项）
        const optEntries: { letter: string; val: string }[] = [];
        for (const key of Object.keys(row)) {
          const m = key.match(/^选项?\s*([A-H])$/i) || key.match(/^选项\s*(\d+)$/i);
          if (m) {
            const val = String(row[key] ?? '').trim();
            if (val) {
              const letter = /^\d+$/.test(m[1])
                ? String.fromCharCode(64 + parseInt(m[1], 10))
                : m[1].toUpperCase();
              optEntries.push({ letter, val });
            }
          }
        }
        optEntries.sort((a, b) => a.letter.localeCompare(b.letter));
        const opts = optEntries.map(e => e.val);
        // 若没匹配到列名，按固定列扫描
        if (opts.length === 0) {
          for (const k of ['选项A', '选项B', '选项C', '选项D', '选项E', '选项F', '选项G', '选项H']) {
            const v = String(row[k] ?? '').trim();
            if (v) opts.push(v);
          }
        }

        // 按题型构造 options/correct_answer/metadata
        let finalOptions: string[] | null = opts.length > 0 ? opts : null;
        let finalAnswer = answer;
        let metadata: Record<string, any> | null = null;
        let valid = true;
        let error: string | undefined;

        switch (qType) {
          case 'choice':
          case 'multi_choice': {
            if (!qText) { valid = false; error = '题干为空'; break; }
            if (opts.length < 2) { valid = false; error = '选项不足'; break; }
            if (!answer) { valid = false; error = '无正确答案'; break; }
            finalAnswer = answer.toUpperCase().replace(/[^A-Z]/g, '');
            if (qType === 'multi_choice') {
              finalAnswer = finalAnswer.split('').sort().join('');
            }
            finalOptions = opts;
            break;
          }
          case 'spell': {
            // correct_answer=正确单词；options=null；metadata={hint?}
            if (!qText) { valid = false; error = '题干为空'; break; }
            if (!answer) { valid = false; error = '无正确单词'; break; }
            finalOptions = null;
            metadata = hint ? { hint } : null;
            break;
          }
          case 'match': {
            // 选项A-D=左列；右列项=分号分隔；正确答案="0:2,1:3,2:0,3:1"
            if (!qText) { valid = false; error = '题干为空'; break; }
            if (opts.length < 2) { valid = false; error = '左列项不足'; break; }
            if (!rightCol) { valid = false; error = '无右列项'; break; }
            if (!answer) { valid = false; error = '无配对答案'; break; }
            const rightArr = rightCol.split(/[;；]+/).map(s => s.trim()).filter(Boolean);
            if (rightArr.length !== opts.length) {
              valid = false; error = `左右列数量不一致（左${opts.length} 右${rightArr.length}）`; break;
            }
            finalOptions = opts;
            metadata = { rightColumn: rightArr };
            finalAnswer = answer.replace(/\s+/g, '');
            break;
          }
          case 'scramble': {
            // correct_answer=正确句子；metadata={words:[]}
            if (!qText) { valid = false; error = '题干为空'; break; }
            if (!wordBlocks && !answer) { valid = false; error = '无词块或正确答案'; break; }
            finalOptions = null;
            const words = wordBlocks ? wordBlocks.split(/[\s,，]+/).filter(Boolean) : (answer || '').split(/\s+/).filter(Boolean);
            metadata = { words };
            if (!answer) { valid = false; error = '无正确答案（正确句子）'; break; }
            break;
          }
          case 'recite': {
            // correct_answer=参考文本；question_text=背诵提示；metadata={hint?}
            if (!qText) { valid = false; error = '题干为空'; break; }
            if (!answer) { valid = false; error = '无参考文本'; break; }
            finalOptions = null;
            metadata = hint ? { hint } : null;
            break;
          }
          case 'correct': {
            // correct_answer=错误位置字母如"BD"；question_text=含错误的句子
            // metadata={correctSentence, errorPositions:number[]}
            if (!qText) { valid = false; error = '题干为空'; break; }
            if (!correctSentence && !answer) { valid = false; error = '无正确句子或错误位置'; break; }
            let errPositions: number[] = [];
            if (errorPositionsRaw) {
              errPositions = errorPositionsRaw.split(/[,，\s]+/).map(s => parseInt(s, 10)).filter(n => !isNaN(n));
            } else if (answer) {
              // 从字母推断索引：A=0,B=1...
              errPositions = answer.toUpperCase().replace(/[^A-Z]/g, '').split('').map(l => l.charCodeAt(0) - 65);
            }
            if (errPositions.length === 0) { valid = false; error = '无错误位置'; break; }
            finalOptions = null;
            metadata = {
              correctSentence: correctSentence || qText,
              errorPositions: errPositions,
            };
            // correct_answer 字段：错误位置字母形式（B=index1,D=index3）
            finalAnswer = errPositions.map(n => String.fromCharCode(65 + n)).join('');
            break;
          }
          case 'math': {
            if (!qText) { valid = false; error = '题干为空'; break; }
            if (!answer) { valid = false; error = '无正确答案'; break; }
            finalOptions = null;
            break;
          }
        }

        // 关卡号映射
        let levelNo: number | null = null;
        if (levelNoRaw) {
          const n = parseInt(levelNoRaw, 10);
          if (!isNaN(n)) levelNo = n;
        }
        // 序号映射到 display_order
        let displayOrder: number | null = null;
        if (serialNo) {
          const n = parseInt(serialNo, 10);
          if (!isNaN(n) && n > 0) displayOrder = n;
        }

        return {
          type: qType,
          difficulty: diff,
          question_text: qText,
          options: finalOptions,
          correct_answer: finalAnswer,
          explanation: expl,
          metadata,
          level_no: levelNo,
          display_order: displayOrder,
          valid,
          error,
        };
      }).filter((it: ParsedQuestion) => it.question_text || (it.options && it.options.length > 0) || it.correct_answer);

      setParsed(items);
      if (items.length === 0) toast.error('未解析到有效数据，请检查表格格式');
      else toast.success(`解析到 ${items.length} 题，请确认后导入`);
    } catch (e: any) {
      toast.error('解析失败：' + (e?.message ?? '未知错误'));
      setParsed([]);
    }
  };

  const handleImport = async () => {
    const validItems = parsed.filter(p => p.valid);
    if (validItems.length === 0) { toast.error('没有可导入的有效题目'); return; }
    if (!defaultLevelId && levels.length > 0) { toast.error('请选择默认关卡'); return; }
    setImporting(true);
    try {
      // 检查未识别的关卡号
      const unknownLevels = new Set<number>();
      for (const p of validItems) {
        if (p.level_no && !levelNoToId.has(p.level_no)) unknownLevels.add(p.level_no);
      }
      if (unknownLevels.size > 0) {
        const list = [...unknownLevels].sort((a, b) => a - b).join(', ');
        if (!confirm(`以下关卡号在题集中不存在：${list}\n这些题目将归到默认关卡（第 ${levels.find(l => l.id === defaultLevelId)?.level_no} 关），是否继续？`)) {
          return;
        }
      }
      await createQuestionsBatch(validItems.map((p, i) => {
        const levelId = (p.level_no && levelNoToId.get(p.level_no)) || defaultLevelId || null;
        return {
          challenge_set_id: setId,
          type: p.type,
          question_text: p.question_text,
          options: p.options ?? undefined,
          correct_answer: p.correct_answer,
          explanation: p.explanation || undefined,
          difficulty: p.difficulty,
          display_order: p.display_order ?? (existingCount + i + 1),
          level_id: levelId ?? undefined,
          metadata: p.metadata ?? undefined,
        };
      }));
      toast.success(`已导入 ${validItems.length} 题`);
      onImported();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = async () => {
    // 模板覆盖七种题型示例
    const tpl = [
      { 序号: 1, 关卡号: 1, 题型: '单选', 难度: '简单', 题目: '在……里面', 选项A: 'in', 选项B: 'on', 选项C: 'at', 选项D: 'of', 正确答案: 'A', 解析: '在空间内部用 in' },
      { 序号: 2, 关卡号: 1, 题型: '多选', 难度: '中等', 题目: '下列哪些用法正确？', 选项A: 'in the bag', 选项B: 'in 2025', 选项C: 'in Monday', 选项D: 'in the morning', 正确答案: 'ABD', 解析: '具体某一天用 on，故 in Monday 错误' },
      { 序号: 3, 关卡号: 2, 题型: '拼写', 难度: '中等', 题目: '拼出"苹果"', 正确答案: 'apple', 提示: '红色水果', 解析: 'apple = 苹果' },
      { 序号: 4, 关卡号: 2, 题型: '匹配', 难度: '中等', 题目: '连线配对：英文与中文', 选项A: 'cat', 选项B: 'dog', 选项C: 'bird', 选项D: 'fish', 右列项: '猫;狗;鱼;鸟', 正确答案: '0:0,1:1,2:3,3:2', 解析: 'cat=猫,dog=狗,bird=鸟,fish=鱼' },
      { 序号: 5, 关卡号: 3, 题型: '乱序', 难度: '困难', 题目: '重组：I to school go every day', 词块: 'I go to school every day', 正确答案: 'I go to school every day', 解析: '主谓宾结构：I go to school' },
      { 序号: 6, 关卡号: 3, 题型: '背诵', 难度: '中等', 题目: '背诵《静夜思》', 正确答案: '床前明月光，疑是地上霜。举头望明月，低头思故乡。', 提示: '李白', 解析: '李白·静夜思' },
      { 序号: 7, 关卡号: 4, 题型: '改错', 难度: '困难', 题目: 'He go to school every day.', 正确句子: 'He goes to school every day.', 错误位置: '1', 解析: '三单动词加 s' },
    ];
    const mod = await import('xlsx');
    const XLSX = (mod as any).default ?? mod;
    const ws = XLSX.utils.json_to_sheet(tpl);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '题目');
    XLSX.writeFile(wb, '题集导入模板-七题型.xlsx');
  };

  const validCount = parsed.filter(p => p.valid).length;

  return (
    <Modal open onClose={onClose} title="批量导入题目（Excel · 七题型）" size="lg">
      <div className="space-y-4">
        <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-600 space-y-1">
          <p><b>题型列</b>：单选/多选/拼写/匹配/乱序/背诵/改错</p>
          <p><b>通用列</b>：序号 | 关卡号 | 难度 | 题目 | 解析</p>
          <p><b>按题型需要的列</b>：</p>
          <ul className="ml-4 list-disc">
            <li>单选/多选：选项A~H（最多 8）+ 正确答案（A 或 ABD）</li>
            <li>拼写：正确答案（单词）+ 提示（可选）</li>
            <li>匹配：选项A~D（左列）+ 右列项（分号分隔）+ 正确答案（如 0:0,1:1,2:3,3:2）</li>
            <li>乱序：词块（空格分隔）+ 正确答案（正确句子）</li>
            <li>背诵：正确答案（参考文本）+ 提示（可选）</li>
            <li>改错：题目（含错句）+ 正确句子 + 错误位置（0-indexed，如 1）</li>
          </ul>
          <button onClick={downloadTemplate} className="mt-2 text-star-600 hover:text-star-700 flex items-center gap-1">
            <Upload className="w-4 h-4" /> 下载模板（含 7 题型示例）
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">默认关卡（未填关卡号或关卡号不存在时归入此关）</label>
          {levels.length === 0 ? (
            <p className="text-xs text-red-500">题集暂无关卡，请先在 SetDetail 创建关卡</p>
          ) : (
            <Select value={defaultLevelId} onChange={e => setDefaultLevelId(e.target.value)}>
              {levels.map(lv => (
                <option key={lv.id} value={lv.id}>第 {lv.level_no} 关 · {lv.title || `关卡 ${lv.level_no}`}</option>
              ))}
            </Select>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">选择 Excel 文件</label>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            className="block w-full text-sm text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-star-100 file:text-star-700 hover:file:bg-star-200"
          />
          {fileName && <p className="text-xs text-slate-400 mt-1">已选择：{fileName}</p>}
        </div>

        {parsed.length > 0 && (
          <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-xl">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-100">
                <tr>
                  <th className="p-2 text-left">#</th>
                  <th className="p-2 text-left">题型</th>
                  <th className="p-2 text-left">难度</th>
                  <th className="p-2 text-left">关卡</th>
                  <th className="p-2 text-left">题目</th>
                  <th className="p-2 text-left">答案</th>
                  <th className="p-2 text-left">状态</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((p, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2">{i + 1}</td>
                    <td className="p-2">{QUESTION_TYPE_LABEL[p.type]}</td>
                    <td className="p-2">{p.difficulty === 'easy' ? '简单' : p.difficulty === 'hard' ? '困难' : '中等'}</td>
                    <td className="p-2">{p.level_no ?? '—'}</td>
                    <td className="p-2 max-w-[200px] truncate">{p.question_text || '—'}</td>
                    <td className="p-2 font-mono max-w-[120px] truncate" title={p.correct_answer}>{p.correct_answer || '—'}</td>
                    <td className="p-2">
                      {p.valid ? <span className="text-emerald-600">✓</span> : <span className="text-red-500" title={p.error}>{p.error}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">取消</Button>
          <Button onClick={handleImport} loading={importing} disabled={validCount === 0 || (levels.length > 0 && !defaultLevelId)} className="flex-1">
            导入 {validCount > 0 ? `(${validCount}题)` : ''}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ====== 添加单词弹窗 ======
function AddWordModal({ setId, onClose, onAdded }: { setId: string; onClose: () => void; onAdded: () => void }) {
  const toast = useToastStore();
  const [wordEn, setWordEn] = useState('');
  const [wordCn, setWordCn] = useState('');
  const [phonetic, setPhonetic] = useState('');
  const [example, setExample] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!wordEn.trim() || !wordCn.trim()) { toast.error('请输入英文和中文'); return; }
    setSaving(true);
    try {
      await createWord({
        challenge_set_id: setId,
        word_en: wordEn.trim(),
        word_cn: wordCn.trim(),
        phonetic: phonetic.trim() || undefined,
        example_sentence: example.trim() || undefined,
      });
      toast.success('已添加');
      onAdded();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? '添加失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="添加单词" size="md">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">英文单词</label>
          <Input value={wordEn} onChange={e => setWordEn(e.target.value)} placeholder="如：apple" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">中文释义</label>
          <Input value={wordCn} onChange={e => setWordCn(e.target.value)} placeholder="如：苹果" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">音标（可选）</label>
          <Input value={phonetic} onChange={e => setPhonetic(e.target.value)} placeholder="如：/ˈæpl/" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">例句（可选）</label>
          <Input value={example} onChange={e => setExample(e.target.value)} placeholder="如：I eat an apple." />
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">取消</Button>
          <Button onClick={handleSave} loading={saving} className="flex-1">添加</Button>
        </div>
      </div>
    </Modal>
  );
}

// ====== 批量导入单词弹窗 ======
function BatchWordsModal({ setId, onClose, onAdded }: { setId: string; onClose: () => void; onAdded: () => void }) {
  const toast = useToastStore();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const lines = text.trim().split('\n').filter(l => l.trim());
    if (lines.length === 0) { toast.error('请输入单词'); return; }
    // 支持多种分隔符：逗号、Tab、空格；只有英文时中文留空
    const words = lines.map(line => {
      const parts = line.split(/[,，\t\s]+/).map(s => s.trim()).filter(s => s);
      return { challenge_set_id: setId, word_en: parts[0] || '', word_cn: parts[1] || '' };
    }).filter(w => w.word_en);
    if (words.length === 0) { toast.error('格式错误，请输入英文单词'); return; }
    setSaving(true);
    try {
      await createWordsBatch(words);
      toast.success(`已导入 ${words.length} 个单词`);
      onAdded();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? '导入失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="批量导入单词" size="md">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">每行一个单词，英文和中文用逗号或空格分隔（中文可留空）</label>
          <Textarea value={text} onChange={e => setText(e.target.value)} placeholder={'apple,苹果\nbanana 香蕉\ncat\nsport,运动'} rows={8} />
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">取消</Button>
          <Button onClick={handleSave} loading={saving} className="flex-1">导入</Button>
        </div>
      </div>
    </Modal>
  );
}

// ====== 错题混战管理 Tab ======
// 功能：按用户筛选错题 → 按错误率/错误次数排序 → 勾选 → 批量加入错题混战池 → 池中查看/移除
function WrongBattleManageTab({ sets }: { sets: ChallengeSet[] }) {
  const members = useFamilyStore(s => s.members);
  const toast = useToastStore();

  // 子模式：list（错题筛选）| pool（错题混战池）
  const [subView, setSubView] = useState<'list' | 'pool'>('list');

  // 筛选条件
  const [memberId, setMemberId] = useState<string>('');
  const [setId, setSetId] = useState<string>('');
  const [minWrongCount, setMinWrongCount] = useState<number>(0);
  const [minErrorRate, setMinErrorRate] = useState<number>(0);
  const [sortBy, setSortBy] = useState<'error_rate' | 'wrong_count'>('wrong_count');

  const [stats, setStats] = useState<WrongQuestionStat[]>([]);
  const [selectedQids, setSelectedQids] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  // 池子数据
  const [pool, setPool] = useState<WrongBattlePoolItem[]>([]);
  const [poolLoading, setPoolLoading] = useState(false);
  const [poolMemberId, setPoolMemberId] = useState<string>('');
  const [selectedPoolIds, setSelectedPoolIds] = useState<Set<string>>(new Set());

  const childMembers = members.filter(m => m.role === 'child');

  // 加载错题统计
  const loadStats = async () => {
    setLoading(true);
    try {
      const data = await fetchWrongQuestionStats(
        memberId || undefined,
        setId || undefined,
      );
      // 客户端二次筛选 + 排序
      const filtered = data
        .filter(s => s.wrong_count >= minWrongCount)
        .filter(s => {
          if (minErrorRate <= 0) return true;
          return s.error_rate >= minErrorRate;
        })
        .sort((a, b) => {
          if (sortBy === 'error_rate') return b.error_rate - a.error_rate;
          return b.wrong_count - a.wrong_count;
        });
      setStats(filtered);
      setSelectedQids(new Set());
    } catch (e: any) {
      toast.error(e?.message ?? '加载错题统计失败');
    } finally {
      setLoading(false);
    }
  };

  // 加载错题混战池
  const loadPool = async (mid: string) => {
    if (!mid) { setPool([]); return; }
    setPoolLoading(true);
    try {
      const data = await fetchWrongBattlePool(mid);
      setPool(data);
      setSelectedPoolIds(new Set());
    } catch (e: any) {
      toast.error(e?.message ?? '加载错题混战池失败');
    } finally {
      setPoolLoading(false);
    }
  };

  useEffect(() => {
    if (subView === 'pool' && poolMemberId) loadPool(poolMemberId);
  }, [subView, poolMemberId]);

  // 默认选中第一个孩子
  useEffect(() => {
    if (!memberId && childMembers.length > 0) setMemberId(childMembers[0].id);
    if (!poolMemberId && childMembers.length > 0) setPoolMemberId(childMembers[0].id);
  }, [childMembers.length]);

  const toggleSelectQid = (qid: string) => {
    setSelectedQids(prev => {
      const next = new Set(prev);
      if (next.has(qid)) next.delete(qid); else next.add(qid);
      return next;
    });
  };
  const toggleSelectAllQids = () => {
    if (selectedQids.size === stats.length) setSelectedQids(new Set());
    else setSelectedQids(new Set(stats.map(s => s.question_id)));
  };

  // 批量加入错题混战池
  const handleBatchAddToPool = async () => {
    if (!memberId) { toast.error('请选择孩子'); return; }
    if (selectedQids.size === 0) { toast.error('请勾选要导入的题目'); return; }
    try {
      const n = await addWrongToBattlePool(memberId, [...selectedQids]);
      toast.success(`已将 ${n} 题加入错题混战池`);
      setSelectedQids(new Set());
      // 如果当前正在查看该用户的池子，刷新
      if (subView === 'pool' && poolMemberId === memberId) loadPool(poolMemberId);
    } catch (e: any) {
      toast.error(e?.message ?? '加入错题混战池失败');
    }
  };

  // 池子勾选
  const toggleSelectPoolId = (pid: string) => {
    setSelectedPoolIds(prev => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid); else next.add(pid);
      return next;
    });
  };
  const toggleSelectAllPoolIds = () => {
    if (selectedPoolIds.size === pool.length) setSelectedPoolIds(new Set());
    else setSelectedPoolIds(new Set(pool.map(p => p.pool_id)));
  };

  // 批量移除
  const handleBatchRemove = async () => {
    if (selectedPoolIds.size === 0) return;
    try {
      const n = await removeWrongFromBattlePool([...selectedPoolIds]);
      toast.success(`已移除 ${n} 题`);
      if (poolMemberId) loadPool(poolMemberId);
    } catch (e: any) {
      toast.error(e?.message ?? '移除失败');
    }
  };
  // 单题移除
  const handleRemoveOne = async (pid: string) => {
    try {
      await removeWrongFromBattlePool([pid]);
      toast.success('已移除');
      if (poolMemberId) loadPool(poolMemberId);
    } catch (e: any) {
      toast.error(e?.message ?? '移除失败');
    }
  };

  return (
    <div className="space-y-4">
      {/* 子视图切换 */}
      <div className="flex gap-2">
        <button
          onClick={() => setSubView('list')}
          className={cn('px-3 py-1.5 rounded-lg text-sm',
            subView === 'list' ? 'bg-star-100 text-star-600 font-medium' : 'bg-slate-100 text-slate-500')}
        >
          <Filter className="w-4 h-4 inline-block mr-1" /> 错题筛选
        </button>
        <button
          onClick={() => setSubView('pool')}
          className={cn('px-3 py-1.5 rounded-lg text-sm',
            subView === 'pool' ? 'bg-star-100 text-star-600 font-medium' : 'bg-slate-100 text-slate-500')}
        >
          <Swords className="w-4 h-4 inline-block mr-1" /> 错题混战池
        </button>
      </div>

      {subView === 'list' ? (
        <>
          {/* 筛选条件 */}
          <Card className="p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">孩子</label>
                <Select value={memberId} onChange={e => setMemberId(e.target.value)}>
                  <option value="">全部孩子</option>
                  {childMembers.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">题集</label>
                <Select value={setId} onChange={e => setSetId(e.target.value)}>
                  <option value="">全部题集</option>
                  {sets.map(s => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">最低错误次数</label>
                <Input type="number" min={0} value={minWrongCount} onChange={e => setMinWrongCount(Number(e.target.value))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">最低错误率（%）</label>
                <Input type="number" min={0} max={100} value={minErrorRate} onChange={e => setMinErrorRate(Number(e.target.value))} />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-slate-600 mb-1">排序</label>
                <Select value={sortBy} onChange={e => setSortBy(e.target.value as 'error_rate' | 'wrong_count')}>
                  <option value="wrong_count">按错误次数降序</option>
                  <option value="error_rate">按错误率降序</option>
                </Select>
              </div>
              <Button onClick={loadStats} loading={loading} className="self-end">
                <Filter className="w-4 h-4" /> 筛选
              </Button>
            </div>
          </Card>

          {/* 筛选结果 */}
          {stats.length > 0 && (
            <div className="flex items-center justify-between">
              <button onClick={toggleSelectAllQids} className="text-sm text-slate-600 hover:text-star-600 flex items-center gap-1">
                {selectedQids.size === stats.length
                  ? <CheckSquare className="w-4 h-4 text-star-500" />
                  : <Square className="w-4 h-4" />}
                {selectedQids.size === stats.length ? '取消全选' : '全选'}（共 {stats.length} 题）
              </button>
              {selectedQids.size > 0 && (
                <Button size="sm" onClick={handleBatchAddToPool}>
                  <Swords className="w-4 h-4" /> 加入错题混战池（{selectedQids.size}）
                </Button>
              )}
            </div>
          )}

          {loading ? (
            <Loading />
          ) : stats.length === 0 ? (
            <EmptyState icon="🎯" title="暂无符合条件的错题" description="调整筛选条件后重试" />
          ) : (
            <div className="space-y-2">
              {stats.map(s => {
                const isSelected = selectedQids.has(s.question_id);
                const setCfg = sets.find(x => x.id === s.challenge_set_id);
                return (
                  <Card key={s.question_id} className={cn('p-3 transition-colors', isSelected && 'border-star-300 bg-star-50')}>
                    <div className="flex items-start gap-3">
                      <button onClick={() => toggleSelectQid(s.question_id)} className="mt-1 flex-shrink-0">
                        {isSelected
                          ? <CheckSquare className="w-5 h-5 text-star-500" />
                          : <Square className="w-5 h-5 text-slate-300" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-800 break-words">{s.question_text || '（无题干）'}</p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          {setCfg && <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{setCfg.title}</span>}
                          <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">{QUESTION_TYPE_LABEL[s.type as QuestionType] ?? s.type}</span>
                          <span className={cn('text-xs px-1.5 py-0.5 rounded',
                            s.difficulty === 'easy' ? 'bg-emerald-50 text-emerald-600' :
                            s.difficulty === 'hard' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600')}>
                            {s.difficulty === 'easy' ? '简单' : s.difficulty === 'hard' ? '困难' : '中等'}
                          </span>
                          {s.member_name && <span className="text-xs text-slate-400">{s.member_name}</span>}
                        </div>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <div className="text-xs text-red-500">错 {s.wrong_count} 次</div>
                        <div className="text-xs text-amber-600">错误率 {Math.round(s.error_rate * 100)}%</div>
                        <div className="text-xs text-slate-400">共答 {s.attempt_count} 次</div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          {/* 错题混战池 */}
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-slate-600 mb-1">选择孩子查看错题混战池</label>
                <Select value={poolMemberId} onChange={e => setPoolMemberId(e.target.value)}>
                  <option value="">请选择…</option>
                  {childMembers.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </Select>
              </div>
              {poolMemberId && (
                <span className="text-xs text-slate-500">池中：{pool.length} 题</span>
              )}
            </div>
          </Card>

          {!poolMemberId ? (
            <EmptyState icon="🎯" title="请选择孩子" description="选择孩子后查看其错题混战池" />
          ) : poolLoading ? (
            <Loading />
          ) : pool.length === 0 ? (
            <EmptyState icon="🎉" title="错题混战池为空" description="切换到「错题筛选」勾选题目后批量导入" />
          ) : (
            <>
              <div className="flex items-center justify-between">
                <button onClick={toggleSelectAllPoolIds} className="text-sm text-slate-600 hover:text-star-600 flex items-center gap-1">
                  {selectedPoolIds.size === pool.length
                    ? <CheckSquare className="w-4 h-4 text-star-500" />
                    : <Square className="w-4 h-4" />}
                  {selectedPoolIds.size === pool.length ? '取消全选' : '全选'}
                </button>
                {selectedPoolIds.size > 0 && (
                  <Button size="sm" danger onClick={handleBatchRemove}>
                    <Trash2 className="w-4 h-4" /> 批量移除（{selectedPoolIds.size}）
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                {pool.map(p => {
                  const isSelected = selectedPoolIds.has(p.pool_id);
                  return (
                    <Card key={p.pool_id} className={cn('p-3 transition-colors', isSelected && 'border-star-300 bg-star-50')}>
                      <div className="flex items-start gap-3">
                        <button onClick={() => toggleSelectPoolId(p.pool_id)} className="mt-1 flex-shrink-0">
                          {isSelected
                            ? <CheckSquare className="w-5 h-5 text-star-500" />
                            : <Square className="w-5 h-5 text-slate-300" />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-slate-800 break-words">{p.question_text || '（无题干）'}</p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">{QUESTION_TYPE_LABEL[p.type as QuestionType] ?? p.type}</span>
                            <span className={cn('text-xs px-1.5 py-0.5 rounded',
                              p.difficulty === 'easy' ? 'bg-emerald-50 text-emerald-600' :
                              p.difficulty === 'hard' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600')}>
                              {p.difficulty === 'easy' ? '简单' : p.difficulty === 'hard' ? '困难' : '中等'}
                            </span>
                            <span className="text-xs text-slate-400">加入时间：{new Date(p.added_at).toLocaleString()}</span>
                          </div>
                          {p.explanation && <p className="text-xs text-slate-400 mt-1">{p.explanation}</p>}
                        </div>
                        <button onClick={() => handleRemoveOne(p.pool_id)} className="text-red-400 hover:text-red-500 flex-shrink-0">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
