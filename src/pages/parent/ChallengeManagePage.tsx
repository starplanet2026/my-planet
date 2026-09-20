import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFamilyStore } from '../../store/familyStore';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input, Textarea } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { EmptyState } from '../../components/common/EmptyState';
import { Loading } from '../../components/common/Loading';
import { useToastStore } from '../../store/toastStore';
import { ROUTES } from '../../lib/constants';
import { cn } from '../../lib/utils';
import { Plus, Trash2, ArrowLeft, BookOpen, Calculator, ListChecks, Edit, Eye, EyeOff, Lightbulb, Save, Upload, Minus, ChevronUp, ChevronDown, CheckSquare, Square } from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  fetchChallengeSets, createChallengeSet, deleteChallengeSet, publishChallengeSet, updateChallengeSet,
  fetchQuestions, createQuestion, deleteQuestion, createQuestionsBatch, updateQuestion, deleteQuestionsBatch, updateQuestionOrder,
  fetchWords, createWord, deleteWord, createWordsBatch,
} from '../../api/challenges';
import type { ChallengeSet, ChallengeSetType, Question, Word, QuestionType, Difficulty } from '../../api/types';

const TYPE_CONFIG: Record<ChallengeSetType, { label: string; icon: React.ReactNode; color: string; desc: string }> = {
  word_vocab: { label: '单词背诵', icon: <BookOpen className="w-5 h-5" />, color: 'from-blue-400 to-blue-500', desc: '英选中/看中选英/听音选中/看中拼写' },
  math: { label: '数学计算', icon: <Calculator className="w-5 h-5" />, color: 'from-emerald-400 to-emerald-500', desc: '口算题，填写数字答案' },
  choice: { label: '知识挑战', icon: <ListChecks className="w-5 h-5" />, color: 'from-purple-400 to-purple-500', desc: '介词/冠词等知识点选择题' },
};

export function ChallengeManagePage() {
  const navigate = useNavigate();
  const family = useFamilyStore(s => s.family);
  const toast = useToastStore();

  const [sets, setSets] = useState<ChallengeSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [activeSet, setActiveSet] = useState<ChallengeSet | null>(null);

  const loadSets = async () => {
    if (!family) return;
    setLoading(true);
    try {
      const data = await fetchChallengeSets(family.id);
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
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(ROUTES.PARENT_DASHBOARD)} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold text-slate-800">智慧星战管理</h1>
      </div>

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500">创建题集，孩子答对获得星光值</p>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" /> 新建题集
        </Button>
      </div>

      {sets.length === 0 ? (
        <EmptyState icon="📚" title="还没有题集" description="点击右上角新建题集" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sets.map(set => {
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
        family_id: family.id,
        title: title.trim(),
        description: description.trim() || undefined,
        type,
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
  const [showAddQuestion, setShowAddQuestion] = useState(false);
  const [showAddWord, setShowAddWord] = useState(false);
  const [showBatchWords, setShowBatchWords] = useState(false);
  const [showEditKnowledge, setShowEditKnowledge] = useState(false);
  const [showEditSet, setShowEditSet] = useState(false);
  const [showBatchImport, setShowBatchImport] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const load = async () => {
    try {
      if (set.type === 'word_vocab') {
        setWords(await fetchWords(set.id));
      } else {
        setQuestions(await fetchQuestions(set.id));
      }
      setSelectedIds(new Set());
    } catch (e: any) {
      toast.error(e?.message ?? '加载失败');
    }
  };

  useEffect(() => { load(); }, [set.id]);

  const handleDeleteQuestion = async (id: string) => {
    try { await deleteQuestion(id); load(); } catch (e: any) { toast.error(e?.message ?? '删除失败'); }
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
                  <Button variant="ghost" size="sm" danger onClick={handleBatchDelete}>
                    <Trash2 className="w-4 h-4" /> 删除选中({selectedIds.size})
                  </Button>
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
          onClose={() => setShowBatchImport(false)}
          onImported={load}
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
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">题干</label>
          <Textarea value={questionText} onChange={e => setQuestionText(e.target.value)} placeholder="如：He ___ to school every day." rows={2} />
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
  options: string[];
  correct_answer: string;
  explanation: string;
  valid: boolean;
  error?: string;
}

function BatchImportQuestionsModal({ setId, onClose, onImported }: {
  setId: string; onClose: () => void; onImported: () => void;
}) {
  const toast = useToastStore();
  const [parsed, setParsed] = useState<ParsedQuestion[]>([]);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState('');

  const handleFile = async (file: File) => {
    setFileName(file.name);
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });
      const items: ParsedQuestion[] = rows.map((row, i) => {
        const rawType = String(row['题型'] ?? row['类型'] ?? '单选').trim();
        const rawDiff = String(row['难度'] ?? '中等').trim();
        const qText = String(row['题目'] ?? row['题干'] ?? '').trim();
        const opts: string[] = [];
        // 支持 选项A/选项B... 或 A/B... 或 选项1/选项2...
        for (const key of Object.keys(row)) {
          const m = key.match(/^选项?\s*([A-D])$/i) || key.match(/^选项\s*(\d+)$/i);
          if (m) {
            const val = String(row[key] ?? '').trim();
            if (val) opts.push(val);
          }
        }
        // 若没匹配到列名，尝试按固定列顺序 选项A/B/C/D
        if (opts.length === 0) {
          for (const k of ['选项A', '选项B', '选项C', '选项D']) {
            const v = String(row[k] ?? '').trim();
            if (v) opts.push(v);
          }
        }
        const answer = String(row['正确答案'] ?? row['答案'] ?? '').trim();
        const expl = String(row['解析'] ?? row['解释'] ?? '').trim();

        const qType: QuestionType = /多选/.test(rawType) ? 'multi_choice' : 'choice';
        const diff: Difficulty = /简|easy/i.test(rawDiff) ? 'easy' : /困|hard/i.test(rawDiff) ? 'hard' : 'medium';

        let valid = true;
        let error: string | undefined;
        if (!qText) { valid = false; error = '题干为空'; }
        else if (opts.length < 2) { valid = false; error = '选项不足'; }
        else if (!answer) { valid = false; error = '无正确答案'; }

        return { type: qType, difficulty: diff, question_text: qText, options: opts, correct_answer: answer, explanation: expl, valid, error };
      }).filter(it => it.question_text || it.options.length > 0); // 跳过完全空行

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
    setImporting(true);
    try {
      await createQuestionsBatch(validItems.map(p => ({
        challenge_set_id: setId,
        type: p.type,
        question_text: p.question_text,
        options: p.options,
        correct_answer: p.type === 'multi_choice'
          ? p.correct_answer.toUpperCase().replace(/[^A-Z]/g, '').split('').sort().join('')
          : p.correct_answer.toUpperCase().replace(/[^A-Z]/g, ''),
        explanation: p.explanation || undefined,
        difficulty: p.difficulty,
      })));
      toast.success(`已导入 ${validItems.length} 题`);
      onImported();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    const tpl = [
      { 序号: 1, 难度: '简单', 题型: '单选', 题目: '在……里面', 选项A: 'in', 选项B: 'on', 选项C: 'at', 选项D: 'of', 正确答案: 'A', 解析: '在空间内部用 in' },
      { 序号: 2, 难度: '简单', 题型: '多选', 题目: '下列哪些用法正确？', 选项A: 'in the bag', 选项B: 'in 2025', 选项C: 'in Monday', 选项D: 'in the morning', 正确答案: 'ABD', 解析: '具体某一天用 on，故 in Monday 错误' },
    ];
    const ws = XLSX.utils.json_to_sheet(tpl);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '题目');
    XLSX.writeFile(wb, '题集导入模板.xlsx');
  };

  const validCount = parsed.filter(p => p.valid).length;

  return (
    <Modal open onClose={onClose} title="批量导入题目（Excel）" size="lg">
      <div className="space-y-4">
        <div className="bg-slate-50 rounded-xl p-3 text-sm text-slate-600">
          <p>表格列：序号 | 难度（简单/中等/困难） | 题型（单选/多选） | 题目 | 选项A | 选项B | 选项C | 选项D | 正确答案（如 A 或 ABD） | 解析</p>
          <button onClick={downloadTemplate} className="mt-2 text-star-600 hover:text-star-700 flex items-center gap-1">
            <Upload className="w-4 h-4" /> 下载模板
          </button>
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
                  <th className="p-2 text-left">题目</th>
                  <th className="p-2 text-left">正确答案</th>
                  <th className="p-2 text-left">状态</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((p, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2">{i + 1}</td>
                    <td className="p-2">{p.type === 'multi_choice' ? '多选' : '单选'}</td>
                    <td className="p-2">{p.difficulty === 'easy' ? '简单' : p.difficulty === 'hard' ? '困难' : '中等'}</td>
                    <td className="p-2 max-w-[200px] truncate">{p.question_text || '—'}</td>
                    <td className="p-2 font-mono">{p.correct_answer}</td>
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
          <Button onClick={handleImport} loading={importing} disabled={validCount === 0} className="flex-1">
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
