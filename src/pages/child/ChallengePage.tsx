import { useState, useEffect, useRef } from 'react';
import { useFamilyStore } from '../../store/familyStore';
import { useModeStore } from '../../store/modeStore';
import { useChallengeUiStore } from '../../store/challengeUiStore';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { EmptyState } from '../../components/common/EmptyState';
import { Loading } from '../../components/common/Loading';
import { useToastStore } from '../../store/toastStore';
import { cn } from '../../lib/utils';
import { BookOpen, Calculator, ListChecks, Volume2, ArrowLeft, Check, X, Star, BookX, Lightbulb } from 'lucide-react';
import {
  fetchChallengeSets, fetchQuestions, fetchWords, fetchWordProgress,
  fetchActiveQuestions, getChallengeAnalysis, awardPerfectChallengeBonus,
  answerQuestion, answerWord, fetchWrongQuestions, reviewWrongQuestion,
} from '../../api/challenges';
import type { ChallengeSet, Question, Word, WordQuestionType, ChallengeSetType, WrongQuestion, Difficulty, ChallengeAnalysisItem } from '../../api/types';

const TYPE_CONFIG: Record<ChallengeSetType, { label: string; icon: React.ReactNode; color: string }> = {
  word_vocab: { label: '单词背诵', icon: <BookOpen className="w-6 h-6" />, color: 'from-blue-400 to-blue-500' },
  math: { label: '数学计算', icon: <Calculator className="w-6 h-6" />, color: 'from-emerald-400 to-emerald-500' },
  choice: { label: '知识挑战', icon: <ListChecks className="w-6 h-6" />, color: 'from-purple-400 to-purple-500' },
};

// 单词发音
function speakWord(word: string) {
  if ('speechSynthesis' in window) {
    const utter = new SpeechSynthesisUtterance(word);
    utter.lang = 'en-US';
    utter.rate = 0.8;
    window.speechSynthesis.speak(utter);
  }
}

export function ChallengePage() {
  const family = useFamilyStore(s => s.family);
  const members = useFamilyStore(s => s.members);
  const refreshMembers = useFamilyStore(s => s.refreshMembers);
  const currentChildId = useModeStore(s => s.currentChildId);
  const child = members.find(m => m.id === currentChildId && m.role === 'child') ?? members.find(m => m.role === 'child');
  const toast = useToastStore();

  // 跨页面/Tab 保活：store 保存活动题集与答题进度，回到此页自动恢复
  const activeSet = useChallengeUiStore(s => s.activeSet);
  const storeStarted = useChallengeUiStore(s => s.started);
  const snapshot = useChallengeUiStore(s => s.snapshot);
  const setActive = useChallengeUiStore(s => s.setActive);
  const clearChallenge = useChallengeUiStore(s => s.clear);

  const [sets, setSets] = useState<ChallengeSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWrongBook, setShowWrongBook] = useState(false);
  const [wrongCount, setWrongCount] = useState(0);

  useEffect(() => {
    if (!family || !child) return;
    (async () => {
      setLoading(true);
      try {
        const data = await fetchChallengeSets(family.id);
        setSets(data.filter(s => s.status === 'active'));
        const wrongs = await fetchWrongQuestions(child.id);
        setWrongCount(wrongs.length);
      } finally {
        setLoading(false);
      }
    })();
  }, [family?.id, child?.id]);

  if (loading) return <Loading />;

  if (showWrongBook) {
    return <WrongBookView childId={child?.id ?? ''} onBack={() => setShowWrongBook(false)} onReviewed={refreshMembers} />;
  }

  // 有保存的活动题集 → 直接恢复答题界面，不重新展示列表
  if (activeSet) {
    return (
      <ChallengePlayer
        set={activeSet}
        childId={child?.id ?? ''}
        started={storeStarted}
        restoreSnapshot={snapshot}
        onBack={() => { clearChallenge(); }}
        onDone={refreshMembers}
      />
    );
  }

  return (
    <div className="max-w-4xl mx-auto -mt-6">
      {/* 错题本常驻入口 - 与题集卡片设计一致 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4 mb-4">
        <div
          onClick={() => setShowWrongBook(true)}
          className={cn(
            'relative aspect-square rounded-2xl border-2 border-emerald-400 bg-gradient-to-br from-emerald-50 to-green-50',
            'cursor-pointer hover:shadow-lg hover:scale-[1.03] active:scale-[0.98] transition-all',
            'flex flex-col items-center justify-center p-3 text-center'
          )}
        >
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-400 to-orange-400 flex items-center justify-center text-white mb-2">
            <BookX className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-slate-800 text-sm">错题本</h3>
          <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">复习错题</p>
          {wrongCount > 0 && (
            <span className="absolute top-1.5 right-1.5 min-w-5 h-5 px-1.5 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full">
              {wrongCount}
            </span>
          )}
        </div>
      </div>

      {sets.length === 0 ? (
        <EmptyState icon="📚" title="暂无挑战赛" description="家长还没发布题集哦" />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
          {sets.map(set => {
            const cfg = TYPE_CONFIG[set.type];
            return (
              <div
                key={set.id}
                onClick={() => setActive(set, false)}
                className={cn(
                  'relative aspect-square rounded-2xl border-2 border-emerald-400 bg-white',
                  'cursor-pointer hover:shadow-lg hover:scale-[1.03] active:scale-[0.98] transition-all',
                  'flex flex-col items-center justify-center p-3 text-center'
                )}
              >
                <div className={cn('w-12 h-12 rounded-2xl bg-gradient-to-br flex items-center justify-center text-white mb-2', cfg.color)}>
                  {cfg.icon}
                </div>
                <h3 className="font-bold text-slate-800 text-sm line-clamp-1">{set.title}</h3>
                {set.description && (
                  <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-2">{set.description}</p>
                )}
                <div className="flex items-center gap-1 mt-1.5 flex-wrap justify-center">
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600">+{set.reward_easy}⭐</span>
                  <span className="text-[10px] text-slate-400">{cfg.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ====== 答题主组件 ======
function ChallengePlayer({ set, childId, onBack, onDone, started: startedProp = false, restoreSnapshot = null }: {
  set: ChallengeSet;
  childId: string;
  onBack: () => void;
  onDone: () => void;
  started?: boolean;
  restoreSnapshot: import('../../store/challengeUiStore').PlayerSnapshot | null;
}) {
  const setStoreActive = useChallengeUiStore(s => s.setActive);
  const setStoreSnapshot = useChallengeUiStore(s => s.setSnapshot);
  const patchStoreSnapshot = useChallengeUiStore(s => s.patchSnapshot);
  const clearChallenge = useChallengeUiStore(s => s.clear);

  // 有快照则直接恢复，避免重新拉取（已答对的题会在 fetchActiveQuestions 中被过滤，破坏 idx）
  const [questions, setQuestions] = useState<Question[]>(
    restoreSnapshot && restoreSnapshot.type === 'question' ? restoreSnapshot.questions : []
  );
  const [words, setWords] = useState<(Word & { progress?: any })[]>(
    restoreSnapshot && restoreSnapshot.type === 'word' ? restoreSnapshot.words : []
  );
  const [loading, setLoading] = useState(restoreSnapshot === null);
  const [started, setStarted] = useState(startedProp);
  // 重做时刷新题目列表（fetchActiveQuestions 会过滤掉已掌握）
  const [reloadKey, setReloadKey] = useState(0);

  // 记录是否已从快照恢复（避免首次 useEffect 覆盖快照数据）
  const restoredRef = useRef(!!restoreSnapshot);

  useEffect(() => {
    // 已从快照恢复，无需重新拉取；重做时 reloadKey 变化才重新拉取
    if (restoredRef.current) {
      restoredRef.current = false;
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      try {
        if (set.type === 'word_vocab') {
          const data = await fetchWordProgress(childId, set.id);
          setWords(data);
        } else {
          // 使用 fetchActiveQuestions：只取未掌握的题，做对自动下线
          try {
            const active = await fetchActiveQuestions(set.id, childId);
            setQuestions(active);
          } catch (e: any) {
            // 迁移未执行时回退到 fetchQuestions
            const all = await fetchQuestions(set.id);
            setQuestions(all.filter(q => q.is_active !== false));
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [set.id, childId, reloadKey]);

  // 持久化：当前题集 + started 状态到 store，切换页面后可恢复
  useEffect(() => {
    setStoreActive(set, started);
  }, [set, started, setStoreActive]);

  // 数据加载完成后，把完整快照（含 questions/words 数组）写入 store，
  // 后续进度变化由 QuestionPlayer/WordPlayer 通过 patch 更新
  useEffect(() => {
    if (loading) return;
    if (set.type === 'word_vocab') {
      if (words.length === 0) return;
      setStoreSnapshot({
        type: 'word',
        questions: [],
        words,
        idx: restoreSnapshot?.idx ?? 0,
        results: restoreSnapshot?.results ?? [],
        totalReward: restoreSnapshot?.totalReward ?? 0,
        totalBonus: restoreSnapshot?.totalBonus ?? 0,
        showChallengeResult: restoreSnapshot?.showChallengeResult ?? false,
        stage: restoreSnapshot?.stage ?? 'familiar',
        quizType: restoreSnapshot?.quizType ?? 'en2cn',
      });
    } else {
      if (questions.length === 0) return;
      setStoreSnapshot({
        type: 'question',
        questions,
        words: [],
        idx: restoreSnapshot?.idx ?? 0,
        results: restoreSnapshot?.results ?? [],
        totalReward: restoreSnapshot?.totalReward ?? 0,
        totalBonus: restoreSnapshot?.totalBonus ?? 0,
        showChallengeResult: restoreSnapshot?.showChallengeResult ?? false,
        stage: 'familiar',
        quizType: 'en2cn',
      });
    }
  }, [loading, questions, words, set, setStoreSnapshot]);

  // 返回/退出时清空 store（由父组件 onBack 触发 clear）
  const handleBack = () => {
    clearChallenge();
    onBack();
  };

  if (loading) return <Loading />;

  const hasKnowledge = !!set.knowledge_points?.trim();

  // 答题前预览知识点
  if (!started && hasKnowledge) {
    return (
      <KnowledgePreview
        set={set}
        onStart={() => setStarted(true)}
        onBack={handleBack}
      />
    );
  }

  // 单词背诵保持原流程
  if (set.type === 'word_vocab') {
    return (
      <WordPlayer
        set={set}
        words={words}
        childId={childId}
        onBack={handleBack}
        onDone={onDone}
        restoreSnapshot={restoreSnapshot && restoreSnapshot.type === 'word' ? restoreSnapshot : null}
        onSnapshot={patchStoreSnapshot}
      />
    );
  }

  // 选择题/数学题：直接顺序做题，不再选难度
  if (questions.length === 0) {
    // 所有题都已掌握 → 挑战完成
    return (
      <ChallengeAllMastered
        set={set}
        childId={childId}
        onBack={handleBack}
        onRedo={() => {
          setStarted(true);
          setStoreActive(set, true);
          setReloadKey(k => k + 1);
        }}
      />
    );
  }

  return (
    <QuestionPlayer
      set={set}
      questions={questions}
      childId={childId}
      onBack={handleBack}
      onDone={onDone}
      onChallengeEnd={() => setReloadKey(k => k + 1)}
      restoreSnapshot={restoreSnapshot && restoreSnapshot.type === 'question' ? restoreSnapshot : null}
      onSnapshot={patchStoreSnapshot}
    />
  );
}

// ====== 知识点按钮（答题中右上角灯泡） ======
function KnowledgePointsButton({ points, label = '查看知识点' }: { points: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-2 rounded-full bg-amber-100 text-amber-600 hover:bg-amber-200 transition-colors"
        title={label}
      >
        <Lightbulb className="w-5 h-5" />
      </button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title="知识点" size="md">
          <div className="space-y-3">
            <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans bg-amber-50 p-4 rounded-xl">
              {points}
            </pre>
            <Button onClick={() => setOpen(false)} fullWidth>知道了</Button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ====== 答题前知识点预览 ======
function KnowledgePreview({ set, onStart, onBack }: {
  set: ChallengeSet; onStart: () => void; onBack: () => void;
}) {
  return (
    <div className="max-w-2xl mx-auto -mt-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-bold text-slate-800">{set.title}</h2>
      </div>

      <Card className="p-6 bg-gradient-to-br from-amber-50 to-yellow-50 border-amber-100">
        <div className="text-center mb-4">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-amber-400 to-yellow-400 flex items-center justify-center text-white mb-3">
            <Lightbulb className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-slate-800">答题前先看看知识点</h3>
          <p className="text-sm text-slate-400 mt-1">答题过程中也可点击右上角灯泡随时查看</p>
        </div>
        <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans bg-white/60 p-4 rounded-xl">
          {set.knowledge_points}
        </pre>
        <div className="flex gap-2 mt-4">
          <Button variant="ghost" onClick={onBack} className="flex-1">返回</Button>
          <Button onClick={onStart} className="flex-1">开始答题</Button>
        </div>
      </Card>
    </div>
  );
}

// ====== 难度选择已移除：新流程直接顺序做题，做完一轮显示正确率 ======

// ====== 选择题/数学题 答题（新流程：顺序做题→挑战结束页→重做错题） ======
function QuestionPlayer({ set, questions, childId, onBack, onDone, onChallengeEnd, restoreSnapshot = null, onSnapshot }: {
  set: ChallengeSet; questions: Question[]; childId: string;
  onBack: () => void; onDone: () => void; onChallengeEnd: () => void;
  restoreSnapshot: import('../../store/challengeUiStore').PlayerSnapshot | null;
  onSnapshot: (patch: Partial<import('../../store/challengeUiStore').PlayerSnapshot>) => void;
}) {
  const [idx, setIdx] = useState(restoreSnapshot?.idx ?? 0);
  const [answer, setAnswer] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // 本轮挑战每题结果（true=对，false=错）
  const [results, setResults] = useState<boolean[]>(restoreSnapshot?.results ?? []);
  // 本轮累计奖励
  const [totalReward, setTotalReward] = useState(restoreSnapshot?.totalReward ?? 0);
  const [totalBonus, setTotalBonus] = useState(restoreSnapshot?.totalBonus ?? 0);
  const [showChallengeResult, setShowChallengeResult] = useState(restoreSnapshot?.showChallengeResult ?? false);
  const toast = useToastStore();

  const q = questions[idx];

  // 持久化快照：idx/结果/奖励/结束页状态变化时同步到 store
  useEffect(() => {
    onSnapshot({ idx, results, totalReward, totalBonus, showChallengeResult });
  }, [idx, results, totalReward, totalBonus, showChallengeResult, onSnapshot]);

  const handleSubmit = async () => {
    if (!answer.trim()) return;
    setSubmitting(true);
    try {
      const result = await answerQuestion(childId, q.id, answer);
      setIsCorrect(result.is_correct);
      setShowResult(true);
      onDone();
      // 累计结果
      setResults(prev => [...prev, result.is_correct]);
      setTotalReward(r => r + (result.reward ?? 0));
      setTotalBonus(b => b + (result.bonus_reward ?? 0));
      if (result.is_correct) {
        const bonusMsg = result.bonus_reward > 0 ? ` 首次掌握奖励 +${result.bonus_reward}!` : '';
        toast.success(`答对了！+${result.reward} 星光值${bonusMsg}`);
      } else {
        // 错题不再写入错题本，挑战内部通过 question_progress.is_mastered 过滤，
        // 再次挑战时未掌握的题会自动再次出现
        toast.error('答错了，再试一次');
      }
    } catch (e: any) {
      toast.error(e?.message ?? '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleNext = () => {
    if (idx < questions.length - 1) {
      setAnswer('');
      setShowResult(false);
      setIdx(i => i + 1);
    } else {
      // 本轮所有题做完，进入挑战结束页
      setShowChallengeResult(true);
      onChallengeEnd();
    }
  };

  // 挑战结束页
  if (showChallengeResult) {
    return (
      <ChallengeResult
        set={set}
        childId={childId}
        correctCount={results.filter(Boolean).length}
        totalCount={questions.length}
        totalReward={totalReward}
        totalBonus={totalBonus}
        onBack={onBack}
        onRedo={() => {
          // 重置本轮状态，触发父组件 reload（自动过滤已掌握）
          setIdx(0);
          setAnswer('');
          setShowResult(false);
          setResults([]);
          setTotalReward(0);
          setTotalBonus(0);
          setShowChallengeResult(false);
        }}
        onDone={onDone}
      />
    );
  }

  if (!q) return <EmptyState icon="❓" title="暂无题目" description="" />;

  return (
    <div className="max-w-2xl mx-auto -mt-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-bold text-slate-800">{set.title}</h2>
        <div className="ml-auto flex items-center gap-2">
          {set.knowledge_points?.trim() && <KnowledgePointsButton points={set.knowledge_points} />}
          <span className="text-sm text-slate-400">{idx + 1}/{questions.length}</span>
        </div>
      </div>

      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <p className="text-lg font-medium text-slate-800">{q.question_text}</p>
          {q.type === 'multi_choice' && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-600 flex-shrink-0 ml-2">多选</span>
          )}
        </div>

        {(q.type === 'choice' || q.type === 'multi_choice') && q.options ? (
          <div className="space-y-3">
            {q.options.map((opt, i) => {
              const letter = String.fromCharCode(65 + i);
              const isMulti = q.type === 'multi_choice';
              const isSelected = isMulti ? answer.includes(letter) : answer === letter;
              const isRightAnswer = showResult && q.correct_answer.includes(letter);
              const isWrongPick = showResult && isSelected && !q.correct_answer.includes(letter);
              const toggle = () => {
                if (showResult) return;
                if (isMulti) {
                  setAnswer(prev => prev.includes(letter) ? prev.replace(letter, '') : prev + letter);
                } else {
                  setAnswer(letter);
                }
              };
              return (
                <button
                  key={i}
                  onClick={toggle}
                  className={cn(
                    'w-full p-4 rounded-xl border-2 text-left transition-colors flex items-center',
                    isRightAnswer ? 'border-emerald-400 bg-emerald-50' :
                    isWrongPick ? 'border-red-400 bg-red-50' :
                    isSelected ? 'border-star-400 bg-star-50' : 'border-slate-200 hover:border-star-200'
                  )}
                >
                  <span className={cn('w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold mr-3 flex-shrink-0',
                    isSelected ? 'bg-star-500 text-white border-star-500' : 'border-slate-300 text-slate-400')}>
                    {isMulti && isSelected ? '✓' : letter}
                  </span>
                  <span className="flex-1">{opt.replace(/^[A-H][.、\s]*/, '')}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <Input
            type="number"
            value={answer}
            onChange={e => setAnswer(e.target.value)}
            placeholder="输入答案"
            className="text-2xl text-center py-4"
            disabled={showResult}
          />
        )}

        {showResult && q.explanation && (
          <div className={cn('mt-4 p-3 rounded-xl', isCorrect ? 'bg-emerald-50' : 'bg-red-50')}>
            <p className={cn('text-sm font-medium', isCorrect ? 'text-emerald-600' : 'text-red-600')}>
              {isCorrect ? '✅ 回答正确！' : `❌ 正确答案：${q.correct_answer}`}
            </p>
            <p className="text-sm text-slate-600 mt-1">{q.explanation}</p>
          </div>
        )}

        <div className="mt-6">
          {!showResult ? (
            <Button onClick={handleSubmit} loading={submitting} fullWidth disabled={!answer.trim()}>
              提交答案
            </Button>
          ) : (
            <Button onClick={handleNext} fullWidth>
              {idx < questions.length - 1 ? '下一题' : '查看挑战结果'}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

// ====== 挑战结束页：正确率 + 重做错题 + 挑战分析 ======
function ChallengeResult({ set, childId, correctCount, totalCount, totalReward, totalBonus, onBack, onRedo, onDone }: {
  set: ChallengeSet;
  childId: string;
  correctCount: number;
  totalCount: number;
  totalReward: number;
  totalBonus: number;
  onBack: () => void;
  onRedo: () => void;
  onDone: () => void;
}) {
  const toast = useToastStore();
  const [analysis, setAnalysis] = useState<ChallengeAnalysisItem[] | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [bonusAwarded, setBonusAwarded] = useState(false);

  const correctRate = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;
  const allCorrect = correctCount === totalCount && totalCount > 0;
  const wrongCount = totalCount - correctCount;

  // 拉取挑战分析（每题挑战次数）
  useEffect(() => {
    (async () => {
      setLoadingAnalysis(true);
      try {
        const data = await getChallengeAnalysis(childId, set.id);
        setAnalysis(data);
      } catch (e: any) {
        // 迁移未执行时静默
      } finally {
        setLoadingAnalysis(false);
      }
    })();
  }, [childId, set.id]);

  // 100% 正确率时一次性发放10星光奖励
  useEffect(() => {
    if (!allCorrect || bonusAwarded) return;
    (async () => {
      try {
        const r = await awardPerfectChallengeBonus(childId, set.id);
        if (r.awarded) {
          setBonusAwarded(true);
          toast.success(`🏆 100% 正确率！额外 +${r.bonus} 星光值`);
          onDone();
        }
      } catch (e: any) {
        // 迁移未执行时静默
      }
    })();
  }, [allCorrect, bonusAwarded, childId, set.id]);

  return (
    <div className="max-w-2xl mx-auto -mt-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-bold text-slate-800">{set.title} - 挑战结束</h2>
      </div>

      <Card className="p-6 mb-4 text-center bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-100">
        <div className="text-6xl mb-3">{allCorrect ? '🎉' : correctRate >= 60 ? '🌟' : '💪'}</div>
        <h3 className="text-2xl font-bold text-slate-800 mb-2">
          {allCorrect ? '全部答对！' : '挑战完成'}
        </h3>
        <div className="text-5xl font-bold text-emerald-500 mb-1">{correctRate}%</div>
        <p className="text-sm text-slate-500">
          答对 {correctCount} / {totalCount} 题
          {wrongCount > 0 && `（错 ${wrongCount} 题）`}
        </p>
        <div className="mt-4 flex items-center justify-center gap-3 flex-wrap">
          {totalReward > 0 && (
            <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-sm font-medium">
              ⭐ +{totalReward} 星光值
            </span>
          )}
          {totalBonus > 0 && (
            <span className="px-3 py-1 rounded-full bg-purple-100 text-purple-700 text-sm font-medium">
              🎁 首次掌握奖励 +{totalBonus}
            </span>
          )}
          {allCorrect && (
            <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-sm font-medium">
              🏆 100% 正确率额外 +10 星光
            </span>
          )}
        </div>
      </Card>

      {/* 重新挑战按钮 */}
      <div className="flex gap-2 mb-6">
        <Button variant="ghost" onClick={onBack} className="flex-1">返回题集</Button>
        {wrongCount > 0 ? (
          <Button onClick={onRedo} className="flex-1">
            重新挑战（只做错题）
          </Button>
        ) : (
          <Button onClick={onBack} className="flex-1">完成挑战</Button>
        )}
      </div>

      {/* 挑战分析：每题挑战次数 */}
      <Card className="p-4">
        <h4 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
          📊 挑战分析
        </h4>
        {loadingAnalysis ? (
          <p className="text-sm text-slate-400 text-center py-4">加载中...</p>
        ) : analysis && analysis.length > 0 ? (
          <div className="space-y-2">
            {analysis.map((item, i) => (
              <div
                key={item.question_id}
                className={cn(
                  'p-3 rounded-xl border flex items-start gap-3',
                  item.is_mastered ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'
                )}
              >
                <div className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
                  item.is_mastered ? 'bg-emerald-500 text-white' : 'bg-slate-300 text-white'
                )}>
                  {item.is_mastered ? '✓' : '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-800 line-clamp-2">{item.question_text}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 flex-wrap">
                    <span>挑战 {item.attempt_count} 次</span>
                    <span>答对 {item.correct_count} 次</span>
                    {!item.is_active && <span className="text-red-500">已下线</span>}
                    {item.is_mastered && <span className="text-emerald-600">已掌握</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400 text-center py-4">暂无挑战分析数据（需执行 0052 迁移）</p>
        )}
      </Card>
    </div>
  );
}

// ====== 全部掌握状态：所有题已答对至少一次 ======
function ChallengeAllMastered({ set, childId, onBack, onRedo }: {
  set: ChallengeSet; childId: string; onBack: () => void; onRedo: () => void;
}) {
  return (
    <div className="max-w-2xl mx-auto -mt-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-bold text-slate-800">{set.title}</h2>
      </div>
      <Card className="p-8 text-center bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-100">
        <div className="text-6xl mb-3">🏆</div>
        <h3 className="text-2xl font-bold text-slate-800 mb-2">全部掌握！</h3>
        <p className="text-sm text-slate-500 mb-6">
          所有题目都已答对至少一次，正确率 100%
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onBack} className="flex-1">返回</Button>
          <Button onClick={onRedo} className="flex-1">从头挑战</Button>
        </div>
      </Card>
    </div>
  );
}

// ====== 单词背诵 答题 ======
const WORD_TYPES: { type: WordQuestionType; label: string }[] = [
  { type: 'en2cn', label: '英选中' },
  { type: 'cn2en', label: '中选英' },
  { type: 'listen', label: '听音选中' },
  { type: 'spell', label: '看中拼写' },
];

function WordPlayer({ set, words, childId, onBack, onDone, restoreSnapshot = null, onSnapshot }: {
  set: ChallengeSet; words: (Word & { progress?: any })[]; childId: string; onBack: () => void; onDone: () => void;
  restoreSnapshot: import('../../store/challengeUiStore').PlayerSnapshot | null;
  onSnapshot: (patch: Partial<import('../../store/challengeUiStore').PlayerSnapshot>) => void;
}) {
  const [idx, setIdx] = useState(restoreSnapshot?.idx ?? 0);
  const [stage, setStage] = useState<'familiar' | 'quiz'>(restoreSnapshot?.stage ?? 'familiar');
  const [quizType, setQuizType] = useState<WordQuestionType>(restoreSnapshot?.quizType ?? 'en2cn');
  const [options, setOptions] = useState<string[]>([]);
  const [answer, setAnswer] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const toast = useToastStore();

  const word = words[idx];
  const progress = word?.progress;
  const mastered = progress?.is_mastered;

  // 持久化快照：idx/stage/quizType 变化时同步到 store
  useEffect(() => {
    onSnapshot({ idx, stage, quizType });
  }, [idx, stage, quizType, onSnapshot]);

  // 生成选择题选项
  const genOptions = (correct: string, all: string[], count = 4) => {
    const wrong = all.filter(w => w !== correct).sort(() => Math.random() - 0.5).slice(0, count - 1);
    return [...wrong, correct].sort(() => Math.random() - 0.5);
  };

  const startQuiz = (type: WordQuestionType) => {
    setQuizType(type);
    setShowResult(false);
    setAnswer('');
    if (type === 'en2cn') {
      setOptions(genOptions(word.word_cn, words.map(w => w.word_cn)));
    } else if (type === 'cn2en') {
      setOptions(genOptions(word.word_en, words.map(w => w.word_en)));
    } else if (type === 'listen') {
      speakWord(word.word_en);
      setOptions(genOptions(word.word_cn, words.map(w => w.word_cn)));
    } else if (type === 'spell') {
      setOptions([]);
    }
    setStage('quiz');
  };

  const handleFamiliar = async () => {
    // 熟悉模式：只考拼写
    startQuiz('spell');
  };

  const handleSubmit = async (selectedAnswer?: string) => {
    const finalAnswer = selectedAnswer ?? answer;
    if (!finalAnswer.trim()) return;
    setSubmitting(true);
    try {
      const result = await answerWord(childId, word.id, quizType, finalAnswer, stage === 'familiar' || progress?.is_familiar);
      setIsCorrect(result.is_correct);
      setShowResult(true);
      onDone();
      if (result.is_correct) {
        toast.success(`答对了！+${result.reward} 星光值`);
        if (result.is_mastered) toast.success('🎉 已掌握该单词！');
      } else {
        // 错题不再写入错题本
        toast.error('答错了，再试一次');
      }
    } catch (e: any) {
      toast.error(e?.message ?? '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleNext = () => {
    setStage('familiar');
    setShowResult(false);
    setAnswer('');
    setIdx(i => (i + 1) % words.length);
  };

  if (!word) return <EmptyState icon="📝" title="暂无单词" description="" />;

  return (
    <div className="max-w-2xl mx-auto -mt-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-bold text-slate-800">{set.title}</h2>
        <div className="ml-auto flex items-center gap-2">
          {set.knowledge_points?.trim() && <KnowledgePointsButton points={set.knowledge_points} />}
          <span className="text-sm text-slate-400">{idx + 1}/{words.length}</span>
        </div>
      </div>

      <Card className="p-6">
        {/* 熟悉界面 */}
        {stage === 'familiar' && (
          <div className="text-center">
            <div className="text-5xl font-bold text-slate-800 mb-2">{word.word_en}</div>
            {word.phonetic && <p className="text-slate-400 mb-2">{word.phonetic}</p>}
            <div className="text-2xl text-slate-600 mb-6">{word.word_cn}</div>
            {word.example_sentence && (
              <p className="text-sm text-slate-400 mb-6 italic">"{word.example_sentence}"</p>
            )}
            <button onClick={() => speakWord(word.word_en)} className="mb-6 p-3 rounded-full bg-star-100 text-star-600 hover:bg-star-200">
              <Volume2 className="w-6 h-6" />
            </button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={handleFamiliar} className="flex-1">
                已熟悉（只考拼写）
              </Button>
              <Button onClick={() => startQuiz('en2cn')} className="flex-1">
                开始背诵
              </Button>
            </div>
            {mastered && (
              <div className="mt-4 text-emerald-500 text-sm">✅ 已掌握</div>
            )}
          </div>
        )}

        {/* 答题界面 */}
        {stage === 'quiz' && (
          <div>
            {/* 题型切换 */}
            <div className="flex gap-1 mb-6">
              {WORD_TYPES.map(t => (
                <button
                  key={t.type}
                  onClick={() => startQuiz(t.type)}
                  className={cn(
                    'flex-1 py-2 text-sm rounded-lg transition-colors',
                    quizType === t.type ? 'bg-star-100 text-star-600 font-medium' : 'text-slate-400'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* 题目区 */}
            <div className="text-center mb-6">
              {quizType === 'en2cn' && (
                <>
                  <div className="text-4xl font-bold text-slate-800 mb-2">{word.word_en}</div>
                  {word.phonetic && <p className="text-slate-400">{word.phonetic}</p>}
                </>
              )}
              {quizType === 'cn2en' && (
                <div className="text-3xl text-slate-700">{word.word_cn}</div>
              )}
              {quizType === 'listen' && (
                <button onClick={() => speakWord(word.word_en)} className="p-4 rounded-full bg-star-100 text-star-600 hover:bg-star-200">
                  <Volume2 className="w-8 h-8" />
                </button>
              )}
              {quizType === 'spell' && (
                <div className="text-3xl text-slate-700">{word.word_cn}</div>
              )}
            </div>

            {/* 选项区 */}
            {(quizType === 'en2cn' || quizType === 'cn2en' || quizType === 'listen') ? (
              <div className="space-y-2">
                {options.map((opt, i) => {
                  const isSelected = answer === opt;
                  const correctVal = quizType === 'cn2en' ? word.word_en : word.word_cn;
                  const isRight = showResult && opt === correctVal;
                  const isWrong = showResult && isSelected && !isCorrect;
                  return (
                    <button
                      key={i}
                      onClick={() => !showResult && setAnswer(opt)}
                      className={cn(
                        'w-full p-4 rounded-xl border-2 text-left transition-colors',
                        isRight ? 'border-emerald-400 bg-emerald-50' :
                        isWrong ? 'border-red-400 bg-red-50' :
                        isSelected ? 'border-star-400 bg-star-50' : 'border-slate-200 hover:border-star-200'
                      )}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            ) : (
              <Input
                value={answer}
                onChange={e => setAnswer(e.target.value)}
                placeholder="输入英文单词"
                className="text-2xl text-center py-4"
                disabled={showResult}
              />
            )}

            {/* 结果 */}
            {showResult && (
              <div className={cn('mt-4 p-3 rounded-xl', isCorrect ? 'bg-emerald-50' : 'bg-red-50')}>
                <p className={cn('font-medium', isCorrect ? 'text-emerald-600' : 'text-red-600')}>
                  {isCorrect ? '✅ 回答正确！' : `❌ 正确答案：${quizType === 'cn2en' || quizType === 'spell' ? word.word_en : word.word_cn}`}
                </p>
              </div>
            )}

            <div className="mt-6">
              {!showResult ? (
                <Button onClick={() => handleSubmit()} loading={submitting} fullWidth disabled={!answer.trim()}>
                  提交答案
                </Button>
              ) : (
                <Button onClick={handleNext} fullWidth>
                  {idx < words.length - 1 ? '下一个单词' : '再来一遍'}
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* 进度指示 */}
      <div className="mt-4 flex justify-center gap-2">
        {words.slice(0, 20).map((w, i) => (
          <div key={i} className={cn(
            'w-2 h-2 rounded-full',
            i === idx ? 'bg-star-500' : w.progress?.is_mastered ? 'bg-emerald-400' : 'bg-slate-200'
          )} />
        ))}
      </div>
    </div>
  );
}

// ====== 错题本视图 ======
function WrongBookView({ childId, onBack, onReviewed }: {
  childId: string; onBack: () => void; onReviewed: () => void;
}) {
  const [wrongs, setWrongs] = useState<WrongQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeWrong, setActiveWrong] = useState<WrongQuestion | null>(null);
  const toast = useToastStore();

  const load = async () => {
    setLoading(true);
    try {
      setWrongs(await fetchWrongQuestions(childId));
    } catch (e: any) {
      toast.error(e?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [childId]);

  if (loading) return <Loading />;

  if (activeWrong) {
    return (
      <ReviewWrong
        wrong={activeWrong}
        childId={childId}
        onBack={() => { setActiveWrong(null); load(); }}
        onReviewed={onReviewed}
      />
    );
  }

  return (
    <div className="max-w-4xl mx-auto -mt-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-bold text-slate-800">错题本</h2>
        <span className="text-sm text-slate-400">共 {wrongs.length} 题</span>
      </div>

      {wrongs.length === 0 ? (
        <EmptyState icon="🎉" title="暂无错题" description="继续加油，保持全对！" />
      ) : (
        <div className="space-y-3">
          {wrongs.map(w => {
            const isWord = !!w.word;
            const content = isWord ? w.word!.word_en : w.question?.question_text ?? '已删除';
            return (
              <Card key={w.id} className="p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => setActiveWrong(w)}>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-800 line-clamp-2">{content}</p>
                    {isWord && <p className="text-sm text-slate-400 mt-1">{w.word?.word_cn}</p>}
                  </div>
                  <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-500">
                      错 {w.wrong_count} 次
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-500">
                      对 {w.correct_count}/2
                    </span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ====== 复习错题 ======
function ReviewWrong({ wrong, childId, onBack, onReviewed }: {
  wrong: WrongQuestion; childId: string; onBack: () => void; onReviewed: () => void;
}) {
  const [answer, setAnswer] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const toast = useToastStore();

  const isWord = !!wrong.word;
  const correctAnswer = isWord ? wrong.word!.word_en : wrong.question?.correct_answer ?? '';

  const handleSubmit = async () => {
    if (!answer.trim()) return;
    setSubmitting(true);
    try {
      const correct = answer.trim().toLowerCase() === correctAnswer.trim().toLowerCase();
      setIsCorrect(correct);
      setShowResult(true);
      const result = await reviewWrongQuestion(wrong.id, childId, correct);
      onReviewed();
      if (correct) {
        if (result.removed) toast.success('🎉 已掌握，移出错题本');
        else toast.success(`答对了，再答对 ${2 - wrong.correct_count - 1} 次即可移除`);
      } else {
        toast.error(`答错了，正确答案：${correctAnswer}`);
      }
    } catch (e: any) {
      toast.error(e?.message ?? '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto -mt-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-bold text-slate-800">复习错题</h2>
      </div>

      <Card className="p-6">
        <div className="mb-6">
          {isWord ? (
            <>
              <p className="text-sm text-slate-400 mb-2">请输入英文：</p>
              <p className="text-3xl font-bold text-slate-700">{wrong.word?.word_cn}</p>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-400 mb-2">题目：</p>
              <p className="text-lg font-medium text-slate-800">{wrong.question?.question_text}</p>
              {wrong.question?.options && (
                <div className="mt-2 space-y-1">
                  {wrong.question.options.map((opt, i) => (
                    <p key={i} className="text-sm text-slate-600">{opt}</p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <Input
          value={answer}
          onChange={e => setAnswer(e.target.value)}
          placeholder={isWord ? '输入英文单词' : wrong.question?.type === 'choice' ? '输入选项字母' : '输入答案'}
          className="text-xl py-3"
          disabled={showResult}
        />

        {showResult && wrong.question?.explanation && (
          <div className="mt-4 p-3 rounded-xl bg-slate-50">
            <p className="text-sm text-slate-600">解析：{wrong.question.explanation}</p>
          </div>
        )}

        <div className="mt-6">
          {!showResult ? (
            <Button onClick={handleSubmit} loading={submitting} fullWidth disabled={!answer.trim()}>
              提交答案
            </Button>
          ) : (
            <Button onClick={onBack} fullWidth>
              返回错题本
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
