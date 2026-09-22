import { useState, useEffect, useRef, useCallback } from 'react';
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
import { BookOpen, Calculator, ListChecks, Volume2, ArrowLeft, Check, X, Star, Lightbulb, Lock, Trophy, ChevronRight } from 'lucide-react';
import { QuestionRenderer } from './challenge/questions/QuestionRenderer';
import {
  fetchChallengeSets, fetchQuestions, fetchWords, fetchWordProgress,
  fetchActiveQuestions, getChallengeAnalysis, awardPerfectChallengeBonus,
  answerQuestion, answerWord, fetchChallengeProgress,
  fetchChallengeBoards, fetchLevelQuestions,
  saveLevelSnapshot, loadLevelSnapshot, resetLevelSnapshot,
  finishChallengeLevel,
} from '../../api/challenges';
import type {
  ChallengeSet, Question, Word, WordQuestionType, ChallengeSetType, Difficulty, ChallengeAnalysisItem,
  ChallengeBoard, ChallengeBoardType, SetWithLevels, LevelWithProgress,
} from '../../api/types';

// ====== 板块配置 ======
const BOARD_CONFIG: { type: ChallengeBoardType; label: string; icon: string }[] = [
  { type: 'today_review', label: '今日复习', icon: '📖' },
  { type: 'gap_check', label: '查漏补缺', icon: '🔍' },
  { type: 'wrong_battle', label: '错题大混战', icon: '⚔️' },
  { type: 'advance', label: '超前拓展', icon: '🚀' },
];

const TYPE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
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

// ================================================================
// 主组件：4 Tab + 4 板块垂直滚动
// ================================================================
export function ChallengePage() {
  const family = useFamilyStore(s => s.family);
  const members = useFamilyStore(s => s.members);
  const refreshMembers = useFamilyStore(s => s.refreshMembers);
  const currentChildId = useModeStore(s => s.currentChildId);
  const child = members.find(m => m.id === currentChildId && m.role === 'child') ?? members.find(m => m.role === 'child');

  // store 状态
  const activeSet = useChallengeUiStore(s => s.activeSet);
  const snapshot = useChallengeUiStore(s => s.snapshot);
  const activeLevelId = useChallengeUiStore(s => s.activeLevelId);
  const levelSnapshot = useChallengeUiStore(s => s.levelSnapshot);
  const setActive = useChallengeUiStore(s => s.setActive);
  const setSnapshot = useChallengeUiStore(s => s.setSnapshot);
  const clearActive = useChallengeUiStore(s => s.clearActive);
  const setActiveLevel = useChallengeUiStore(s => s.setActiveLevel);
  const clearLevel = useChallengeUiStore(s => s.clearLevel);

  const [boards, setBoards] = useState<ChallengeBoard[]>([]);
  const [activeBoard, setActiveBoard] = useState<ChallengeBoardType>('today_review');
  const [loading, setLoading] = useState(true);

  // 板块 ref（用于 scrollIntoView）
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!family || !child) return;
    (async () => {
      setLoading(true);
      try {
        const data = await fetchChallengeBoards(child.id);
        setBoards(data);
      } catch (e) {
        // 迁移未执行时回退到旧逻辑
        const sets = await fetchChallengeSets();
        const active = sets.filter(s => s.status === 'active');
        const fallbackBoard: ChallengeBoard = {
          board: 'today_review',
          sets: active.map(s => ({
            id: s.id, title: s.title, description: s.description,
            type: s.type, status: s.status,
            reward_easy: s.reward_easy, reward_medium: s.reward_medium, reward_hard: s.reward_hard,
            knowledge_points: s.knowledge_points,
            levels: [],
          })),
        };
        setBoards([fallbackBoard]);
      } finally {
        setLoading(false);
      }
    })();
  }, [family?.id, child?.id]);

  // 滚动监听：自动高亮当前可见板块的 Tab（必须在所有 early return 之前调用，避免 Hooks 顺序不一致）
  const handleScroll = useCallback((entries: IntersectionObserverEntry[]) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const board = entry.target.getAttribute('data-board') as ChallengeBoardType;
        if (board) setActiveBoard(board);
      }
    }
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(handleScroll, {
      root: null,
      rootMargin: '-20% 0px -60% 0px',
      threshold: 0,
    });
    Object.values(sectionRefs.current).forEach(ref => {
      if (ref) observer.observe(ref);
    });
    return () => observer.disconnect();
  }, [boards, handleScroll]);

  // ---- 路由判定 ----
  // 1) 旧流程：word_vocab 题集（保留 2 个上线题集不动）
  if (activeSet && activeSet.type === 'word_vocab') {
    return (
      <ChallengePlayer
        set={activeSet}
        childId={child?.id ?? ''}
        started={snapshot?.started ?? false}
        restoreSnapshot={snapshot}
        onBack={() => { clearActive(); }}
        onDone={refreshMembers}
      />
    );
  }

  // 2) 新流程：已选关卡 → 进入关卡答题
  if (activeSet && activeLevelId) {
    const lvSnap = levelSnapshot && levelSnapshot.levelId === activeLevelId ? levelSnapshot : null;
    // 找到当前关卡的元信息
    const levelInfo = boards
      .flatMap(b => b.sets)
      .find(s => s.id === activeSet.id)
      ?.levels.find(l => l.id === activeLevelId);
    return (
      <LevelPlayer
        set={activeSet}
        levelId={activeLevelId}
        levelInfo={levelInfo}
        childId={child?.id ?? ''}
        board={activeSet.board}
        restoreSnapshot={lvSnap}
        onBack={() => {
          // 退出关卡，回到关卡列表
          clearLevel();
        }}
        onDone={refreshMembers}
        onLevelCleared={() => {
          // 关卡清零，回到关卡列表（刷新 boards）
          clearLevel();
          if (family && child) {
            fetchChallengeBoards(child.id).then(setBoards).catch(() => {});
          }
        }}
      />
    );
  }

  // 3) 新流程：已选题集但未选关卡 → 显示关卡列表
  if (activeSet) {
    const setWithLevels = boards
      .flatMap(b => b.sets)
      .find(s => s.id === activeSet.id);
    return (
      <SetDetailPage
        set={activeSet}
        levels={setWithLevels?.levels ?? []}
        childId={child?.id ?? ''}
        onBack={() => { clearActive(); }}
        onEnterLevel={(levelId) => { setActiveLevel(levelId); }}
      />
    );
  }

  // 4) 默认：显示板块列表

  if (loading) return <Loading />;

  const handleTabClick = (board: ChallengeBoardType) => {
    setActiveBoard(board);
    const ref = sectionRefs.current[board];
    if (ref) {
      ref.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const hasAnySet = boards.some(b => b.sets.length > 0);

  if (!hasAnySet) {
    return <EmptyState icon="📚" title="暂无挑战赛" description="家长还没发布题集哦" />;
  }

  return (
    <div className="max-w-4xl mx-auto -mt-6">
      {/* 顶部 4 个 Tab（和成就板块布局一致） */}
      <div className="sticky top-0 z-20 bg-white/90 backdrop-blur-sm border-b border-slate-100 -mx-4 px-4 py-2 mb-4">
        <div className="flex gap-1">
          {BOARD_CONFIG.map(b => {
            const count = boards.find(brd => brd.board === b.type)?.sets.length ?? 0;
            return (
              <button
                key={b.type}
                onClick={() => handleTabClick(b.type)}
                className={cn(
                  'flex-1 flex flex-col items-center gap-0.5 py-2 rounded-xl text-xs font-medium transition-colors',
                  activeBoard === b.type
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'text-slate-400 hover:bg-slate-50'
                )}
              >
                <span className="text-base">{b.icon}</span>
                <span>{b.label}</span>
                {count > 0 && (
                  <span className="text-[9px] text-slate-400">{count} 个题集</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 4 个板块垂直滚动 */}
      <div className="space-y-6">
        {BOARD_CONFIG.map(bcfg => {
          const board = boards.find(b => b.board === bcfg.type);
          const sets = board?.sets ?? [];
          return (
            <div
              key={bcfg.type}
              ref={el => { sectionRefs.current[bcfg.type] = el; }}
              data-board={bcfg.type}
            >
              <BoardSection
                boardType={bcfg.type}
                label={bcfg.label}
                icon={bcfg.icon}
                sets={sets}
                onSelectSet={(s) => {
                  // 清除旧快照，进入新题集
                  setSnapshot(null);
                  setActive(s);
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ================================================================
// 板块组件：标题 + 题集卡片网格
// ================================================================
function BoardSection({ boardType, label, icon, sets, onSelectSet }: {
  boardType: ChallengeBoardType;
  label: string;
  icon: string;
  sets: SetWithLevels[];
  onSelectSet: (s: ChallengeSet) => void;
}) {
  if (sets.length === 0) return null;

  return (
    <div>
      {/* 板块标题 */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className="text-xl">{icon}</span>
        <h2 className="text-base font-bold text-slate-800">{label}</h2>
        <span className="text-xs text-slate-400">({sets.length})</span>
      </div>

      {/* 题集卡片网格 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
        {sets.map(set => {
          const cfg = TYPE_CONFIG[set.type] ?? TYPE_CONFIG.choice;
          // 汇总整个题集的进度
          const total = set.levels.reduce((s, l) => s + l.total, 0);
          const mastered = set.levels.reduce((s, l) => s + l.mastered, 0);
          const allCleared = set.levels.length > 0 && set.levels.every(l => l.is_cleared);
          const remaining = Math.max(0, total - mastered);
          const accuracy = total > 0 ? Math.round((mastered / total) * 100) : 0;

          const fakeSet: ChallengeSet = {
            id: set.id, title: set.title, description: set.description,
            type: set.type as ChallengeSetType, board: boardType,
            reward_easy: set.reward_easy, reward_medium: set.reward_medium, reward_hard: set.reward_hard,
            knowledge_points: set.knowledge_points, status: set.status as any,
            created_at: '', updated_at: '',
          };

          return (
            <div
              key={set.id}
              onClick={() => onSelectSet(fakeSet)}
              className={cn(
                'relative aspect-square rounded-2xl border-2 border-emerald-400 bg-white',
                'cursor-pointer hover:shadow-lg hover:scale-[1.03] active:scale-[0.98] transition-all',
                'flex flex-col items-center justify-center p-3 text-center'
              )}
            >
              {allCleared && (
                <span className="absolute top-1.5 right-1.5 min-w-5 h-5 px-1.5 flex items-center justify-center bg-emerald-500 text-white text-[10px] font-bold rounded-full">
                  ✓
                </span>
              )}
              <div className={cn('w-12 h-12 rounded-2xl bg-gradient-to-br flex items-center justify-center text-white mb-2', cfg.color)}>
                {cfg.icon}
              </div>
              <h3 className="font-bold text-slate-800 text-sm line-clamp-1">{set.title}</h3>
              {set.description && (
                <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-2">{set.description}</p>
              )}
              {/* 实时进度 + 正确率 */}
              {total > 0 && (
                <div className="mt-1.5 flex flex-col items-center gap-0.5">
                  <span className={cn(
                    'text-[11px] font-bold',
                    allCleared ? 'text-emerald-600' : 'text-slate-700'
                  )}>
                    {mastered}/{total}
                  </span>
                  {!allCleared && (
                    <span className="text-[9px] text-slate-400">剩 {remaining} 题</span>
                  )}
                  {mastered > 0 && (
                    <span className="text-[9px] text-emerald-500">正确率 {accuracy}%</span>
                  )}
                </div>
              )}
              <div className="flex items-center gap-1 mt-1.5 flex-wrap justify-center">
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600">+{set.reward_easy}⭐</span>
                <span className="text-[10px] text-slate-400">{cfg.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ================================================================
// 关卡列表页：题集 → 有序关卡 → 题目
// ================================================================
function SetDetailPage({ set, levels, childId, onBack, onEnterLevel }: {
  set: ChallengeSet;
  levels: LevelWithProgress[];
  childId: string;
  onBack: () => void;
  onEnterLevel: (levelId: string) => void;
}) {
  const sortedLevels = [...levels].sort((a, b) => a.level_no - b.level_no);

  // 判断每个关卡是否解锁：第1关总是解锁，第N关需要第N-1关 is_cleared
  const isLevelUnlocked = (levelNo: number): boolean => {
    if (levelNo === 1) return true;
    const prevLevel = sortedLevels.find(l => l.level_no === levelNo - 1);
    return prevLevel?.is_cleared ?? false;
  };

  return (
    <div className="max-w-2xl mx-auto -mt-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-bold text-slate-800">{set.title}</h2>
      </div>

      {set.description && (
        <p className="text-sm text-slate-500 mb-4">{set.description}</p>
      )}

      {sortedLevels.length === 0 ? (
        <EmptyState icon="📋" title="暂无关卡" description="家长还未创建关卡" />
      ) : (
        <div className="space-y-3">
          {sortedLevels.map(level => {
            const unlocked = isLevelUnlocked(level.level_no);
            const allDone = level.is_cleared;
            const progress = level.total > 0 ? Math.round((level.mastered / level.total) * 100) : 0;

            return (
              <Card
                key={level.id}
                className={cn(
                  'p-4 flex items-center gap-4 transition-all',
                  unlocked ? 'cursor-pointer hover:shadow-md' : 'opacity-50'
                )}
                {...(unlocked ? { onClick: () => onEnterLevel(level.id) } : {})}
              >
                {/* 关卡序号/锁图标 */}
                <div className={cn(
                  'w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0',
                  allDone ? 'bg-emerald-100 text-emerald-600' :
                  unlocked ? 'bg-star-100 text-star-600' :
                  'bg-slate-100 text-slate-400'
                )}>
                  {allDone ? <Check className="w-6 h-6" /> :
                   unlocked ? <span className="text-lg font-bold">{level.level_no}</span> :
                   <Lock className="w-5 h-5" />}
                </div>

                {/* 关卡信息 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-slate-800 text-sm">
                      {level.title || `第 ${level.level_no} 关`}
                    </h3>
                    {allDone && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-600">已通关</span>
                    )}
                  </div>
                  {level.total > 0 && (
                    <div className="mt-1 flex items-center gap-2">
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={cn('h-full rounded-full transition-all', allDone ? 'bg-emerald-400' : 'bg-star-400')}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-slate-500 flex-shrink-0">
                        {level.mastered}/{level.total}
                      </span>
                    </div>
                  )}
                </div>

                {/* 右侧：奖励/箭头 */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-amber-500">+{level.pass_reward}⭐</span>
                  {unlocked && <ChevronRight className="w-5 h-5 text-slate-300" />}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* 知识点入口 */}
      {set.knowledge_points?.trim() && (
        <div className="mt-4">
          <KnowledgePointsButton points={set.knowledge_points} label="查看知识点" />
        </div>
      )}
    </div>
  );
}

// ================================================================
// 关卡答题组件（新流程）：消题/错题循环/关卡解锁
// ================================================================
function LevelPlayer({ set, levelId, levelInfo, childId, board, restoreSnapshot = null, onBack, onDone, onLevelCleared }: {
  set: ChallengeSet;
  levelId: string;
  levelInfo?: LevelWithProgress;
  childId: string;
  board: ChallengeBoardType;
  restoreSnapshot: import('../../store/challengeUiStore').LevelSnapshotState | null;
  onBack: () => void;
  onDone: () => void;
  onLevelCleared: () => void;
}) {
  const setLevelSnapshot = useChallengeUiStore(s => s.setLevelSnapshot);
  const patchLevelSnapshot = useChallengeUiStore(s => s.patchLevelSnapshot);
  const clearLevel = useChallengeUiStore(s => s.clearLevel);
  const toast = useToastStore();

  // 原始题目列表（关卡内全部题，按 display_order 排序）
  const [allQuestions, setAllQuestions] = useState<Question[]>([]);
  // 本轮已消题 ID（答对的永久消失）
  const [clearedIds, setClearedIds] = useState<string[]>(restoreSnapshot?.clearedIds ?? []);
  // 本轮每题结果（true=对 false=错），用于正确率计算
  const [results, setResults] = useState<boolean[]>(restoreSnapshot?.results ?? []);
  // 当前题目索引（在剩余题目中的位置）
  const [currentIdx, setCurrentIdx] = useState(restoreSnapshot?.currentIdx ?? 0);
  // 本轮累计星光
  const [totalReward, setTotalReward] = useState(restoreSnapshot?.totalReward ?? 0);
  // 是否显示一轮结果弹窗
  const [showRoundResult, setShowRoundResult] = useState(restoreSnapshot?.showRoundResult ?? false);

  const [loading, setLoading] = useState(!restoreSnapshot);
  const [answer, setAnswer] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const restoredRef = useRef(!!restoreSnapshot);
  const snapshotInitRef = useRef(false);

  // 加载关卡题目
  useEffect(() => {
    if (restoredRef.current) {
      restoredRef.current = false;
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      try {
        const data = await fetchLevelQuestions(levelId);
        setAllQuestions(data);
        // 如果有服务端快照，加载已消题列表
        const snap = await loadLevelSnapshot(childId, levelId);
        if (snap && snap.cleared_question_ids?.length > 0) {
          setClearedIds(snap.cleared_question_ids);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [levelId, childId]);

  // 持久化快照：状态变化时同步到 store + 服务端
  useEffect(() => {
    if (loading || allQuestions.length === 0) return;
    if (!snapshotInitRef.current) {
      snapshotInitRef.current = true;
      setLevelSnapshot({
        setId: set.id,
        levelId,
        questions: remainingQuestions,
        clearedIds,
        currentIdx,
        results,
        totalReward,
        showRoundResult,
      });
    } else {
      patchLevelSnapshot({
        clearedIds, currentIdx, results, totalReward, showRoundResult,
        questions: remainingQuestions,
      });
    }
    // 服务端快照（非今日复习板需要保存暂停态）
    saveLevelSnapshot(childId, levelId, currentIdx, clearedIds, board !== 'today_review').catch(() => {});
  }, [clearedIds, currentIdx, results, totalReward, showRoundResult, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // 剩余题目 = 原始题 - 已消题
  const remainingQuestions = allQuestions.filter(q => !clearedIds.includes(q.id));
  const originalTotal = allQuestions.length; // 正确率分母：关卡原始总题数
  const q = remainingQuestions[currentIdx];

  const handleSubmit = async () => {
    if (!answer.trim() || !q) return;
    setSubmitting(true);
    try {
      const result = await answerQuestion(childId, q.id, answer);
      setIsCorrect(result.is_correct);
      setShowResult(true);
      onDone();
      setResults(prev => [...prev, result.is_correct]);
      setTotalReward(r => r + (result.reward ?? 0));
      if (result.is_correct) {
        // 答对：题目永久消失（加入 clearedIds）
        setClearedIds(prev => [...prev, q.id]);
        const bonusMsg = result.bonus_reward > 0 ? ` 首次掌握奖励 +${result.bonus_reward}!` : '';
        toast.success(`答对了！+${result.reward} 星光值${bonusMsg}`);
      } else {
        toast.error('答错了，题目保留，再试一次');
      }
    } catch (e: any) {
      toast.error(e?.message ?? '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleNext = () => {
    setAnswer('');
    setShowResult(false);
    if (currentIdx < remainingQuestions.length - 1) {
      setCurrentIdx(i => i + 1);
    } else {
      // 本轮做完，所有剩余题循环完毕
      // 检查是否全部消题
      const stillRemaining = allQuestions.filter(qid => !clearedIds.includes(qid.id));
      if (stillRemaining.length === 0) {
        // 关卡 100% 通关
        handleLevelClear();
      } else {
        // 还有未消题，显示一轮结果
        setShowRoundResult(true);
      }
    }
  };

  // 一轮结果弹窗：再试一次 / 明日再战
  const handleRedo = () => {
    // 再试一次：只重做本轮错题，已对题目不再出现
    // clearedIds 已包含答对的题，remainingQuestions 自然只剩错题
    setCurrentIdx(0);
    setAnswer('');
    setShowResult(false);
    setResults([]);
    setTotalReward(0);
    setShowRoundResult(false);
  };

  const handleTomorrow = () => {
    // 明日再战：保存暂停态，退出
    saveLevelSnapshot(childId, levelId, currentIdx, clearedIds, true).catch(() => {});
    clearLevel();
    onBack();
  };

  // 关卡清零 → 发奖 → 解锁下一关
  const handleLevelClear = async () => {
    try {
      const result = await finishChallengeLevel(childId, levelId);
      if (result.level_awarded) {
        toast.success(`🎉 关卡通关！+${result.level_reward} 星光值`);
        onDone();
      }
      if (result.set_awarded) {
        toast.success(`🏆 题集全部通关！额外 +${result.set_reward} 星光值`);
        onDone();
      }
      onLevelCleared();
    } catch (e: any) {
      toast.error(e?.message ?? '通关发奖失败');
    }
  };

  if (loading) return <Loading />;

  // 关卡已全部通关
  if (originalTotal > 0 && clearedIds.length >= originalTotal) {
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
          <h3 className="text-2xl font-bold text-slate-800 mb-2">关卡通关！</h3>
          <p className="text-sm text-slate-500 mb-6">
            {levelInfo?.title || `第 ${levelInfo?.level_no ?? 1} 关`} 全部清零
          </p>
          <Button onClick={onBack} fullWidth>返回关卡列表</Button>
        </Card>
      </div>
    );
  }

  // 一轮结果弹窗
  if (showRoundResult) {
    const correctCount = results.filter(Boolean).length;
    const wrongCount = results.length - correctCount;
    const accuracy = originalTotal > 0 ? Math.round((clearedIds.length / originalTotal) * 100) : 0;
    const isTodayReview = board === 'today_review';

    return (
      <div className="max-w-2xl mx-auto -mt-6">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setShowRoundResult(false)} className="p-2 hover:bg-slate-100 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-bold text-slate-800">{set.title} - 本轮结果</h2>
        </div>
        <Card className="p-6 mb-4 text-center bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-100">
          <div className="text-5xl mb-3">{accuracy === 100 ? '🎉' : accuracy >= 60 ? '🌟' : '💪'}</div>
          <div className="text-4xl font-bold text-emerald-500 mb-1">{accuracy}%</div>
          <p className="text-sm text-slate-500">
            已消题 {clearedIds.length} / 原始总题 {originalTotal}
          </p>
          <p className="text-sm text-slate-500 mt-1">
            本轮答对 {correctCount} 题，答错 {wrongCount} 题
          </p>
          {totalReward > 0 && (
            <span className="inline-block mt-3 px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-sm font-medium">
              ⭐ +{totalReward} 星光值
            </span>
          )}
        </Card>
        <div className="flex gap-2">
          {isTodayReview ? (
            // 今日复习：不允许明日再战，必须反复再挑战直到清零
            <Button onClick={handleRedo} className="flex-1">再试一次（只做错题）</Button>
          ) : (
            <>
              <Button onClick={handleRedo} className="flex-1">再试一次（只做错题）</Button>
              <Button variant="ghost" onClick={handleTomorrow} className="flex-1">明日再战</Button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!q) {
    return <EmptyState icon="📋" title="本关暂无题目" description="" />;
  }

  const cfg = TYPE_CONFIG[set.type] ?? TYPE_CONFIG.choice;

  return (
    <div className="max-w-2xl mx-auto -mt-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-bold text-slate-800">{set.title}</h2>
        <div className="ml-auto flex items-center gap-2">
          {set.knowledge_points?.trim() && <KnowledgePointsButton points={set.knowledge_points} />}
          <span className="text-sm text-slate-400">
            {currentIdx + 1}/{remainingQuestions.length}
          </span>
        </div>
      </div>

      {/* 进度条：已消题/原始总数 */}
      <div className="mb-4 flex items-center gap-2">
        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-400 rounded-full transition-all"
            style={{ width: `${originalTotal > 0 ? (clearedIds.length / originalTotal) * 100 : 0}%` }}
          />
        </div>
        <span className="text-xs text-slate-500 flex-shrink-0">{clearedIds.length}/{originalTotal}</span>
      </div>

      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <p className="text-lg font-medium text-slate-800">{q.question_text}</p>
          {q.type === 'multi_choice' && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-600 flex-shrink-0 ml-2">多选</span>
          )}
        </div>

        <QuestionRenderer
          question={q}
          answer={answer}
          setAnswer={setAnswer}
          showResult={showResult}
          isCorrect={isCorrect}
          disabled={showResult}
        />

        {/* 通用解析显示（correct 题型内部已展示解析，跳过） */}
        {showResult && q.explanation && q.type !== 'correct' && (
          <div className={cn('mt-4 p-3 rounded-xl', isCorrect ? 'bg-emerald-50' : 'bg-red-50')}>
            <p className={cn('text-sm font-medium', isCorrect ? 'text-emerald-600' : 'text-red-600')}>
              {isCorrect ? '✅ 回答正确！' : `❌ 正确答案：${q.correct_answer}`}
            </p>
            <p className="text-sm text-slate-600 mt-1">{q.explanation}</p>
          </div>
        )}

        <div className="mt-6 flex gap-3">
          {!showResult ? (
            <Button onClick={handleSubmit} loading={submitting} fullWidth disabled={!answer.trim()}>
              提交答案
            </Button>
          ) : (
            <Button onClick={handleNext} fullWidth>
              {currentIdx < remainingQuestions.length - 1 ? '下一题' : '查看本轮结果'}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

// ================================================================
// 知识点按钮（答题中右上角灯泡）
// ================================================================
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

// ================================================================
// 旧流程：word_vocab 题集（保留2个上线题集不动）
// ================================================================
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
  const clearAll = useChallengeUiStore(s => s.clear);

  const [questions, setQuestions] = useState<Question[]>(
    restoreSnapshot && restoreSnapshot.type === 'question' ? restoreSnapshot.questions : []
  );
  const [words, setWords] = useState<(Word & { progress?: any })[]>(
    restoreSnapshot && restoreSnapshot.type === 'word' ? restoreSnapshot.words : []
  );
  const [loading, setLoading] = useState(restoreSnapshot === null);
  const [started, setStarted] = useState(startedProp);
  const [reloadKey, setReloadKey] = useState(0);

  const restoredRef = useRef(!!restoreSnapshot);
  const snapshotInitRef = useRef(false);

  useEffect(() => {
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
          try {
            const active = await fetchActiveQuestions(set.id, childId);
            setQuestions(active);
          } catch (e: any) {
            const all = await fetchQuestions(set.id);
            setQuestions(all.filter(q => q.is_active !== false));
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [set.id, childId, reloadKey]);

  useEffect(() => {
    setStoreActive(set);
  }, [set, setStoreActive]);

  useEffect(() => {
    patchStoreSnapshot({ started });
  }, [started, patchStoreSnapshot]);

  useEffect(() => {
    if (loading) return;
    if (set.type === 'word_vocab') {
      if (words.length === 0) return;
      if (!snapshotInitRef.current) {
        snapshotInitRef.current = true;
        setStoreSnapshot({
          setId: set.id, started, type: 'word', questions: [], words,
          idx: restoreSnapshot?.idx ?? 0, results: restoreSnapshot?.results ?? [],
          totalReward: restoreSnapshot?.totalReward ?? 0, totalBonus: restoreSnapshot?.totalBonus ?? 0,
          showChallengeResult: restoreSnapshot?.showChallengeResult ?? false,
          stage: restoreSnapshot?.stage ?? 'familiar', quizType: restoreSnapshot?.quizType ?? 'en2cn',
        });
      } else {
        patchStoreSnapshot({ words, idx: 0, results: [], totalReward: 0, totalBonus: 0, showChallengeResult: false });
      }
    } else {
      if (questions.length === 0) return;
      if (!snapshotInitRef.current) {
        snapshotInitRef.current = true;
        setStoreSnapshot({
          setId: set.id, started, type: 'question', questions, words: [],
          idx: restoreSnapshot?.idx ?? 0, results: restoreSnapshot?.results ?? [],
          totalReward: restoreSnapshot?.totalReward ?? 0, totalBonus: restoreSnapshot?.totalBonus ?? 0,
          showChallengeResult: restoreSnapshot?.showChallengeResult ?? false,
          stage: 'familiar', quizType: 'en2cn',
        });
      } else {
        patchStoreSnapshot({ questions, idx: 0, results: [], totalReward: 0, totalBonus: 0, showChallengeResult: false });
      }
    }
  }, [loading, questions, words, set, setStoreSnapshot, patchStoreSnapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBack = () => { onBack(); };
  const handleChallengeEnd = () => { clearAll(); onBack(); };

  if (loading) return <Loading />;

  const hasKnowledge = !!set.knowledge_points?.trim();

  if (!started && hasKnowledge) {
    return <KnowledgePreview set={set} onStart={() => setStarted(true)} onBack={handleBack} />;
  }

  if (set.type === 'word_vocab') {
    return (
      <WordPlayer
        set={set} words={words} childId={childId}
        onBack={handleBack} onDone={onDone}
        restoreSnapshot={restoreSnapshot && restoreSnapshot.type === 'word' ? restoreSnapshot : null}
        onSnapshot={patchStoreSnapshot}
      />
    );
  }

  if (questions.length === 0) {
    return (
      <ChallengeAllMastered set={set} childId={childId} onBack={handleChallengeEnd}
        onRedo={() => { setStarted(true); setReloadKey(k => k + 1); }}
      />
    );
  }

  return (
    <QuestionPlayer
      set={set} questions={questions} childId={childId}
      onBack={handleBack} onDone={onDone}
      onChallengeEnd={() => setReloadKey(k => k + 1)}
      onChallengeFinish={handleChallengeEnd}
      restoreSnapshot={restoreSnapshot && restoreSnapshot.type === 'question' ? restoreSnapshot : null}
      onSnapshot={patchStoreSnapshot}
    />
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

// ====== 选择题/数学题 答题（旧流程，仅 word_vocab 题集回退用） ======
function QuestionPlayer({ set, questions, childId, onBack, onDone, onChallengeEnd, onChallengeFinish, restoreSnapshot = null, onSnapshot }: {
  set: ChallengeSet; questions: Question[]; childId: string;
  onBack: () => void; onDone: () => void; onChallengeEnd: () => void; onChallengeFinish: () => void;
  restoreSnapshot: import('../../store/challengeUiStore').PlayerSnapshot | null;
  onSnapshot: (patch: Partial<import('../../store/challengeUiStore').PlayerSnapshot>) => void;
}) {
  const [idx, setIdx] = useState(restoreSnapshot?.idx ?? 0);
  const [answer, setAnswer] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<boolean[]>(restoreSnapshot?.results ?? []);
  const [totalReward, setTotalReward] = useState(restoreSnapshot?.totalReward ?? 0);
  const [totalBonus, setTotalBonus] = useState(restoreSnapshot?.totalBonus ?? 0);
  const [showChallengeResult, setShowChallengeResult] = useState(restoreSnapshot?.showChallengeResult ?? false);
  const toast = useToastStore();
  const q = questions[idx];

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
      setResults(prev => [...prev, result.is_correct]);
      setTotalReward(r => r + (result.reward ?? 0));
      setTotalBonus(b => b + (result.bonus_reward ?? 0));
      if (result.is_correct) {
        const bonusMsg = result.bonus_reward > 0 ? ` 首次掌握奖励 +${result.bonus_reward}!` : '';
        toast.success(`答对了！+${result.reward} 星光值${bonusMsg}`);
      } else {
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
      setShowChallengeResult(true);
      onChallengeEnd();
    }
  };

  if (showChallengeResult) {
    return (
      <ChallengeResult
        set={set} childId={childId}
        correctCount={results.filter(Boolean).length}
        totalCount={questions.length}
        totalReward={totalReward} totalBonus={totalBonus}
        onBack={onChallengeFinish}
        onRedo={() => {
          setIdx(0); setAnswer(''); setShowResult(false);
          setResults([]); setTotalReward(0); setTotalBonus(0);
          setShowChallengeResult(false); onChallengeEnd();
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
                <button key={i} onClick={toggle}
                  className={cn('w-full p-4 rounded-xl border-2 text-left transition-colors flex items-center',
                    isRightAnswer ? 'border-emerald-400 bg-emerald-50' :
                    isWrongPick ? 'border-red-400 bg-red-50' :
                    isSelected ? 'border-star-400 bg-star-50' : 'border-slate-200 hover:border-star-200')}>
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
          <Input type="number" value={answer} onChange={e => setAnswer(e.target.value)}
            placeholder="输入答案" className="text-2xl text-center py-4" disabled={showResult} />
        )}
        {showResult && q.explanation && (
          <div className={cn('mt-4 p-3 rounded-xl', isCorrect ? 'bg-emerald-50' : 'bg-red-50')}>
            <p className={cn('text-sm font-medium', isCorrect ? 'text-emerald-600' : 'text-red-600')}>
              {isCorrect ? '✅ 回答正确！' : `❌ 正确答案：${q.correct_answer}`}
            </p>
            <p className="text-sm text-slate-600 mt-1">{q.explanation}</p>
          </div>
        )}
        <div className="mt-6 flex gap-3">
          {!showResult ? (
            <Button onClick={handleSubmit} loading={submitting} fullWidth disabled={!answer.trim()}>提交答案</Button>
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

// ====== 挑战结束页（旧流程） ======
function ChallengeResult({ set, childId, correctCount, totalCount, totalReward, totalBonus, onBack, onRedo, onDone }: {
  set: ChallengeSet; childId: string; correctCount: number; totalCount: number;
  totalReward: number; totalBonus: number; onBack: () => void; onRedo: () => void; onDone: () => void;
}) {
  const toast = useToastStore();
  const [analysis, setAnalysis] = useState<ChallengeAnalysisItem[] | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [bonusAwarded, setBonusAwarded] = useState(false);
  const correctRate = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;
  const allCorrect = correctCount === totalCount && totalCount > 0;
  const wrongCount = totalCount - correctCount;

  useEffect(() => {
    (async () => {
      setLoadingAnalysis(true);
      try {
        const data = await getChallengeAnalysis(childId, set.id);
        setAnalysis(data);
      } catch { } finally { setLoadingAnalysis(false); }
    })();
  }, [childId, set.id]);

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
      } catch { }
    })();
  }, [allCorrect, bonusAwarded, childId, set.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <h3 className="text-2xl font-bold text-slate-800 mb-2">{allCorrect ? '全部答对！' : '挑战完成'}</h3>
        <div className="text-5xl font-bold text-emerald-500 mb-1">{correctRate}%</div>
        <p className="text-sm text-slate-500">
          答对 {correctCount} / {totalCount} 题{wrongCount > 0 && `（错 ${wrongCount} 题）`}
        </p>
        <div className="mt-4 flex items-center justify-center gap-3 flex-wrap">
          {totalReward > 0 && (
            <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-sm font-medium">⭐ +{totalReward} 星光值</span>
          )}
          {totalBonus > 0 && (
            <span className="px-3 py-1 rounded-full bg-purple-100 text-purple-700 text-sm font-medium">🎁 首次掌握奖励 +{totalBonus}</span>
          )}
          {allCorrect && (
            <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-sm font-medium">🏆 100% 正确率额外 +10 星光</span>
          )}
        </div>
      </Card>
      <div className="flex gap-2 mb-6">
        <Button variant="ghost" onClick={onBack} className="flex-1">返回题集</Button>
        {wrongCount > 0 ? (
          <Button onClick={onRedo} className="flex-1">重新挑战（只做错题）</Button>
        ) : (
          <Button onClick={onBack} className="flex-1">完成挑战</Button>
        )}
      </div>
      <Card className="p-4">
        <h4 className="font-bold text-slate-800 mb-3 flex items-center gap-2">📊 挑战分析</h4>
        {loadingAnalysis ? (
          <p className="text-sm text-slate-400 text-center py-4">加载中...</p>
        ) : analysis && analysis.length > 0 ? (
          <div className="space-y-2">
            {analysis.map((item) => (
              <div key={item.question_id}
                className={cn('p-3 rounded-xl border flex items-start gap-3',
                  item.is_mastered ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200')}>
                <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
                  item.is_mastered ? 'bg-emerald-500 text-white' : 'bg-slate-300 text-white')}>
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
          <p className="text-sm text-slate-400 text-center py-4">暂无挑战分析数据</p>
        )}
      </Card>
    </div>
  );
}

// ====== 全部掌握状态（旧流程） ======
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
        <p className="text-sm text-slate-500 mb-6">所有题目都已答对至少一次，正确率 100%</p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onBack} className="flex-1">返回</Button>
          <Button onClick={onRedo} className="flex-1">从头挑战</Button>
        </div>
      </Card>
    </div>
  );
}

// ====== 单词背诵 答题（旧流程，word_vocab 题集用） ======
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

  useEffect(() => {
    onSnapshot({ idx, stage, quizType });
  }, [idx, stage, quizType, onSnapshot]);

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

  const handleFamiliar = async () => { startQuiz('spell'); };

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
              <Button variant="ghost" onClick={handleFamiliar} className="flex-1">已熟悉（只考拼写）</Button>
              <Button onClick={() => startQuiz('en2cn')} className="flex-1">开始背诵</Button>
            </div>
            {mastered && <div className="mt-4 text-emerald-500 text-sm">✅ 已掌握</div>}
          </div>
        )}
        {stage === 'quiz' && (
          <div>
            <div className="flex gap-1 mb-6">
              {WORD_TYPES.map(t => (
                <button key={t.type} onClick={() => startQuiz(t.type)}
                  className={cn('flex-1 py-2 text-sm rounded-lg transition-colors',
                    quizType === t.type ? 'bg-star-100 text-star-600 font-medium' : 'text-slate-400')}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="text-center mb-6">
              {quizType === 'en2cn' && (
                <>
                  <div className="text-4xl font-bold text-slate-800 mb-2">{word.word_en}</div>
                  {word.phonetic && <p className="text-slate-400">{word.phonetic}</p>}
                </>
              )}
              {quizType === 'cn2en' && <div className="text-3xl text-slate-700">{word.word_cn}</div>}
              {quizType === 'listen' && (
                <button onClick={() => speakWord(word.word_en)} className="p-4 rounded-full bg-star-100 text-star-600 hover:bg-star-200">
                  <Volume2 className="w-8 h-8" />
                </button>
              )}
              {quizType === 'spell' && <div className="text-3xl text-slate-700">{word.word_cn}</div>}
            </div>
            {(quizType === 'en2cn' || quizType === 'cn2en' || quizType === 'listen') ? (
              <div className="space-y-2">
                {options.map((opt, i) => {
                  const isSelected = answer === opt;
                  const correctVal = quizType === 'cn2en' ? word.word_en : word.word_cn;
                  const isRight = showResult && opt === correctVal;
                  const isWrong = showResult && isSelected && !isCorrect;
                  return (
                    <button key={i} onClick={() => !showResult && setAnswer(opt)}
                      className={cn('w-full p-4 rounded-xl border-2 text-left transition-colors',
                        isRight ? 'border-emerald-400 bg-emerald-50' :
                        isWrong ? 'border-red-400 bg-red-50' :
                        isSelected ? 'border-star-400 bg-star-50' : 'border-slate-200 hover:border-star-200')}>
                      {opt}
                    </button>
                  );
                })}
              </div>
            ) : (
              <Input value={answer} onChange={e => setAnswer(e.target.value)}
                placeholder="输入英文单词" className="text-2xl text-center py-4" disabled={showResult} />
            )}
            {showResult && (
              <div className={cn('mt-4 p-3 rounded-xl', isCorrect ? 'bg-emerald-50' : 'bg-red-50')}>
                <p className={cn('font-medium', isCorrect ? 'text-emerald-600' : 'text-red-600')}>
                  {isCorrect ? '✅ 回答正确！' : `❌ 正确答案：${quizType === 'cn2en' || quizType === 'spell' ? word.word_en : word.word_cn}`}
                </p>
              </div>
            )}
            <div className="mt-6">
              {!showResult ? (
                <Button onClick={() => handleSubmit()} loading={submitting} fullWidth disabled={!answer.trim()}>提交答案</Button>
              ) : (
                <Button onClick={handleNext} fullWidth>
                  {idx < words.length - 1 ? '下一个单词' : '再来一遍'}
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>
      <div className="mt-4 flex justify-center gap-2">
        {words.slice(0, 20).map((w, i) => (
          <div key={i} className={cn('w-2 h-2 rounded-full',
            i === idx ? 'bg-star-500' : w.progress?.is_mastered ? 'bg-emerald-400' : 'bg-slate-200')} />
        ))}
      </div>
    </div>
  );
}
