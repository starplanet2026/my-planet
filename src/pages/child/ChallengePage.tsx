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
import { playClick, playCorrect, playWrong } from '../../lib/audio';
import { cn } from '../../lib/utils';
import { BookOpen, Calculator, ListChecks, Volume2, ArrowLeft, Check, X, Star, Lightbulb, Lock, Trophy, ChevronRight, AlertCircle, Layers, Eye } from 'lucide-react';
import { QuestionRenderer } from './challenge/questions/QuestionRenderer';
import {
  fetchChallengeSets, fetchQuestions, fetchWords, fetchWordProgress,
  fetchActiveQuestions, getChallengeAnalysis, awardPerfectChallengeBonus,
  answerQuestion, answerWord, fetchChallengeProgress,
  fetchChallengeBoards, fetchLevelQuestions,
  saveLevelSnapshot, loadLevelSnapshot, resetLevelSnapshot,
  finishChallengeLevel,
  fetchWrongQuestionStats,
  fetchWrongBattlePool,
  fetchLevelWrongQuestionStats,
  fetchSetQuestionsAll,
  startChallengeSession, flushChallengeSession,
} from '../../api/challenges';
import type {
  ChallengeSet, Question, Word, WordQuestionType, ChallengeSetType, Difficulty, ChallengeAnalysisItem,
  ChallengeBoard, ChallengeBoardType, SetWithLevels, LevelWithProgress,
  WrongQuestionStat, WrongBattlePoolItem, ChallengeSubject,
} from '../../api/types';

// ====== 板块配置 ======
const BOARD_CONFIG: { type: ChallengeBoardType; label: string; icon: string }[] = [
  { type: 'today_review', label: '今日复习', icon: '📖' },
  { type: 'gap_check', label: '疑难杂症', icon: '🔍' },
  { type: 'wrong_battle', label: '错题大混战', icon: '⚔️' },
  { type: 'advance', label: '超前拓展', icon: '🚀' },
];

const TYPE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  word_vocab: { label: '单词背诵', icon: <BookOpen className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />, color: 'from-blue-400 to-blue-500' },
  math: { label: '数学计算', icon: <Calculator className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />, color: 'from-emerald-400 to-emerald-500' },
  choice: { label: '知识挑战', icon: <ListChecks className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />, color: 'from-purple-400 to-purple-500' },
};

// 学科标签颜色映射
const SUBJECT_COLORS: Record<string, string> = {
  '语文': 'bg-rose-50 text-rose-500',
  '数学': 'bg-sky-50 text-sky-500',
  '英语': 'bg-emerald-50 text-emerald-500',
};
const DEFAULT_SUBJECT_COLOR = 'bg-indigo-50 text-indigo-500';
const subjectColor = (s: string) => SUBJECT_COLORS[s] ?? DEFAULT_SUBJECT_COLOR;

// 单词发音
function speakWord(word: string) {
  if ('speechSynthesis' in window) {
    const utter = new SpeechSynthesisUtterance(word);
    utter.lang = 'en-US';
    utter.rate = 0.8;
    window.speechSynthesis.speak(utter);
  }
}

// 挑战会话星光汇总：进入时开启会话（并补录上一轮未汇总星光），退出/卸载时汇总生成单条流水
function useChallengeSession(childId: string, setId?: string, levelId?: string, title?: string) {
  const flushedRef = useRef(false);
  useEffect(() => {
    // 进入：开启新会话，同时服务端会先 flush 上一轮未汇总的星光（异常关闭兜底）
    startChallengeSession(childId, setId, levelId, title).catch(() => {});
    // 卸载：汇总本次会话星光
    return () => {
      if (flushedRef.current) return;
      flushedRef.current = true;
      flushChallengeSession(childId).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childId]);
  const flush = useCallback(() => {
    if (flushedRef.current) return;
    flushedRef.current = true;
    flushChallengeSession(childId).catch(() => {});
  }, [childId]);
  return { flush };
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
  const [wrongRetry, setWrongRetry] = useState<{ setId: string; setTitle: string; questionIds: string[] } | null>(null);
  const [viewOnly, setViewOnly] = useState<{ questions: Question[]; title: string } | null>(null);
  const [battleMode, setBattleMode] = useState(false);

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
            subject: s.subject,
            reward_easy: s.reward_easy, reward_medium: s.reward_medium, reward_hard: s.reward_hard,
            knowledge_points: s.knowledge_points,
            knowledge_points_images: s.knowledge_points_images,
            easy_count: 0, medium_count: 0, hard_count: 0,
            levels: [],
          })),
          levels: [],
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
        onWrongRetry={(setId, setTitle, questionIds) => setWrongRetry({ setId, setTitle, questionIds })}
      />
    );
  }

  // 2) 新流程：已选关卡 → 进入关卡答题
  if (activeSet && activeLevelId) {
    const lvSnap = levelSnapshot && levelSnapshot.levelId === activeLevelId ? levelSnapshot : null;
    // 找到当前关卡的元信息（先查题集内关卡，再查独立关卡）
    const setLevels = boards
      .flatMap(b => b.sets)
      .find(s => s.id === activeSet.id)
      ?.levels;
    const standaloneLevel = boards.flatMap(b => b.levels ?? []).find(l => l.id === activeLevelId);
    const levelInfo = setLevels?.find(l => l.id === activeLevelId) ?? standaloneLevel;
    const allLevels = setLevels ?? (standaloneLevel ? [standaloneLevel] : []);
    return (
      <LevelPlayer
        key={activeLevelId}
        set={activeSet}
        levelId={activeLevelId}
        levelInfo={levelInfo}
        allLevels={allLevels}
        childId={child?.id ?? ''}
        board={activeSet.board}
        restoreSnapshot={lvSnap}
        onBack={() => {
          // 退出关卡，回到关卡列表
          clearLevel();
        }}
        onDone={refreshMembers}
        onLevelCleared={(nextLevelId) => {
          // 关卡清零，刷新 boards 数据
          if (family && child) {
            fetchChallengeBoards(child.id).then(freshBoards => {
              setBoards(freshBoards);
              if (nextLevelId) {
                setActiveLevel(nextLevelId);
              } else {
                clearLevel();
              }
            }).catch(() => { clearLevel(); });
          } else {
            clearLevel();
          }
        }}
        onWrongRetry={(setId, setTitle, questionIds) => setWrongRetry({ setId, setTitle, questionIds })}
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
        onWrongRetry={(setId, setTitle, questionIds) => setWrongRetry({ setId, setTitle, questionIds })}
      />
    );
  }

  // 3.5) 错题混战池：全屏答题
  if (battleMode) {
    return (
      <WrongBattlePlayer
        childId={child?.id ?? ''}
        onBack={() => setBattleMode(false)}
      />
    );
  }

  // 3.6) 错题再战：全屏答题
  if (wrongRetry) {
    return (
      <WrongQuestionPlayer
        setId={wrongRetry.setId}
        setTitle={wrongRetry.setTitle}
        childId={child?.id ?? ''}
        questionIds={wrongRetry.questionIds}
        onBack={() => setWrongRetry(null)}
      />
    );
  }

  // 3b) 只读题目查看模式（从卡片"查看题集"按钮进入）
  if (viewOnly) {
    return (
      <ReadOnlyQuestionsView
        questions={viewOnly.questions}
        title={viewOnly.title}
        onBack={() => setViewOnly(null)}
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

  const hasAnySet = boards.some(b => b.sets.length > 0 || (b.levels ?? []).length > 0);

  if (!hasAnySet) {
    return <EmptyState icon="📚" title="暂无挑战赛" description="家长还没发布题集哦" />;
  }

  return (
    <div className="max-w-6xl mx-auto -mt-6">
      {/* 顶部 4 个 Tab（和成就板块布局一致） */}
      <div className="sticky top-0 z-20 bg-white/90 backdrop-blur-sm border-b border-slate-100 -mx-4 px-4 py-2 mb-4">
        <div className="flex gap-1">
          {BOARD_CONFIG.map(b => {
            const boardData = boards.find(brd => brd.board === b.type);
            const count = (boardData?.sets.length ?? 0) + (boardData?.levels?.length ?? 0);
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
                standaloneLevels={board?.levels ?? []}
                childId={child?.id ?? ''}
                onSelectSet={(s) => {
                  // 清除旧快照，进入新题集
                  setSnapshot(null);
                  setActive(s);
                }}
                onSelectLevel={(lv) => {
                  // 独立关卡：合成 fakeSet 路由到 LevelPlayer
                  setSnapshot(null);
                  const fakeSet: ChallengeSet = {
                    id: 'standalone:' + lv.id,
                    title: lv.title || `关卡 ${lv.level_no}`,
                    description: lv.description,
                    type: 'choice' as ChallengeSetType,
                    board: bcfg.type,
                    subject: (lv.subject as ChallengeSubject) ?? null,
                    reward_easy: 1, reward_medium: 2, reward_hard: 3,
                    knowledge_points: lv.knowledge_points ?? null,
                    knowledge_points_images: lv.knowledge_points_images ?? null,
                    status: 'active' as any,
                    created_at: '', updated_at: '',
                  };
                  setActive(fakeSet);
                  setActiveLevel(lv.id);
                }}
                onWrongRetry={(setId, setTitle, questionIds) => setWrongRetry({ setId, setTitle, questionIds })}
                onStartBattle={() => setBattleMode(true)}
                onViewSetQuestions={async (setId, setTitle) => {
                  try {
                    const all = await fetchSetQuestionsAll(setId);
                    setViewOnly({ questions: all, title: setTitle });
                  } catch { /* toast error handled by parent */ }
                }}
                onViewLevelQuestions={async (levelId, title) => {
                  try {
                    const all = await fetchLevelQuestions(levelId);
                    setViewOnly({ questions: all, title });
                  } catch { /* ignore */ }
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
function BoardSection({ boardType, label, icon, sets, standaloneLevels, onSelectSet, onSelectLevel, childId, onWrongRetry, onStartBattle, onViewSetQuestions, onViewLevelQuestions }: {
  boardType: ChallengeBoardType;
  label: string;
  icon: string;
  sets: SetWithLevels[];
  standaloneLevels: LevelWithProgress[];
  onSelectSet: (s: ChallengeSet) => void;
  onSelectLevel: (lv: LevelWithProgress) => void;
  childId: string;
  onWrongRetry: (setId: string, setTitle: string, questionIds: string[]) => void;
  onStartBattle: () => void;
  onViewSetQuestions: (setId: string, setTitle: string) => void;
  onViewLevelQuestions: (levelId: string, title: string) => void;
}) {
  const [wrongSet, setWrongSet] = useState<{ id: string; title: string; levelId?: string } | null>(null);
  const navigate = useNavigate();

  // 今日复习板块始终渲染（用于展示家默入口）
  if (sets.length === 0 && standaloneLevels.length === 0 && boardType !== 'wrong_battle' && boardType !== 'today_review') return null;

  return (
    <div>
      {/* 板块标题 */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className="text-xl">{icon}</span>
        <h2 className="text-base font-bold text-slate-800">{label}</h2>
        <span className="text-xs text-slate-400">({boardType === 'wrong_battle' ? Math.max(1, sets.length) : sets.length + standaloneLevels.length})</span>
      </div>

      {/* 题集卡片网格 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
        {/* 错题混战池入口（仅错题大混战板块显示） */}
        {boardType === 'wrong_battle' && (
          <div
            onClick={onStartBattle}
            className="cursor-pointer rounded-2xl p-4 flex flex-col items-center justify-center bg-gradient-to-br from-purple-400 to-pink-500 text-white min-h-32 hover:shadow-lg transition-shadow"
          >
            <span className="text-3xl mb-1">⚔️</span>
            <span className="text-sm font-bold">错题混战池</span>
            <span className="text-[10px] mt-1 opacity-90">点击开始挑战</span>
          </div>
        )}
        {sets.map(set => {
          const cfg = TYPE_CONFIG[set.type] ?? TYPE_CONFIG.choice;
          // 汇总整个题集的进度
          const total = set.levels.reduce((s, l) => s + l.total, 0);
          const mastered = set.levels.reduce((s, l) => s + l.mastered, 0);
          const allCleared = set.levels.length > 0 && set.levels.every(l => l.is_cleared);
          const remaining = Math.max(0, total - mastered);
          const accuracy = total > 0 ? Math.round((mastered / total) * 100) : 0;
          // 状态判断: 3=全新未做(mastered===0), 2=全消除(allCleared), 1=进行中
          const state: 1 | 2 | 3 = allCleared ? 2 : (mastered > 0 ? 1 : 3);
          const leftLabel = state === 2 ? '查看题集' : (state === 1 ? '继续挑战' : '开始挑战');

          const fakeSet: ChallengeSet = {
            id: set.id, title: set.title, description: set.description,
            type: set.type as ChallengeSetType, board: boardType,
            subject: set.subject as ChallengeSubject | null,
            reward_easy: set.reward_easy, reward_medium: set.reward_medium, reward_hard: set.reward_hard,
            knowledge_points: set.knowledge_points,
            knowledge_points_images: set.knowledge_points_images,
            status: set.status as any,
            created_at: '', updated_at: '',
          };

          return (
            <div
              key={set.id}
              className={cn(
                'relative aspect-square rounded-2xl border-2 border-emerald-400 bg-white',
                'hover:shadow-lg hover:scale-[1.03] active:scale-[0.98] transition-all',
                'flex flex-col p-3'
              )}
            >
              {allCleared && (
                <span className="absolute top-1.5 right-1.5 min-w-5 h-5 px-1.5 flex items-center justify-center bg-emerald-500 text-white text-[10px] font-bold rounded-full">
                  ✓
                </span>
              )}
              {/* ① 左上角学科标签 + 右上角icon */}
              <div className="flex items-center justify-between mb-1">
                <span className={cn('px-1.5 py-0.5 rounded-md text-[9px] font-medium', subjectColor(set.subject || cfg.label))}>{set.subject || cfg.label}</span>
                {cfg.icon}
              </div>
              {/* 内容区：垂直居中 */}
              <div className="flex-1 flex flex-col justify-center">
                {/* ② 居中标题 + 黄色底色 */}
                <div className="px-2 py-1.5 rounded-lg bg-emerald-100 text-center mb-1.5">
                  <h3 className="font-bold text-slate-900 text-base line-clamp-1">{set.title}</h3>
                </div>
                {/* 描述文本 */}
                {set.description && (
                  <p className="text-[10px] text-slate-400 text-center line-clamp-2 mb-1 px-1">{set.description}</p>
                )}
                {/* ③ 难度分布 */}
                <div className="flex items-center justify-center gap-1.5 text-[9px]">
                  <span className="text-emerald-500">简 {set.easy_count}</span>
                  <span className="text-amber-500">中 {set.medium_count}</span>
                  <span className="text-red-400">难 {set.hard_count}</span>
                </div>
                {/* ④ 进度信息 */}
                {total > 0 && (
                  <div className="mt-1 flex flex-col items-center gap-0.5">
                    <span className={cn('text-[11px] font-bold', allCleared ? 'text-emerald-600' : 'text-slate-700')}>
                      已做 {mastered}/{total}
                    </span>
                    {mastered > 0 && <span className="text-[9px] text-emerald-500">正确率 {accuracy}%</span>}
                    {!allCleared && <span className="text-[9px] text-slate-400">剩 {remaining} 题</span>}
                  </div>
                )}
              </div>
              {/* ⑤ 底部双按钮 */}
              <div className="mt-auto flex gap-1.5 pt-2">
                <button
                  onClick={() => state === 2 ? onViewSetQuestions(set.id, set.title) : onSelectSet(fakeSet)}
                  className="flex-1 flex items-center justify-center gap-1 text-[11px] px-1.5 py-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
                >
                  {state === 2 ? <Eye className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  {leftLabel}
                </button>
                <button
                  onClick={() => setWrongSet({ id: set.id, title: set.title, levelId: undefined })}
                  className="flex-1 flex items-center justify-center gap-1 text-[11px] px-1.5 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
                >
                  <AlertCircle className="w-3 h-3" /> 查看错题
                </button>
              </div>
            </div>
          );
        })}
        {/* 独立关卡卡片 */}
        {standaloneLevels.map(lv => {
          const total = lv.total;
          const mastered = lv.mastered;
          const allCleared = lv.is_cleared;
          const remaining = Math.max(0, total - mastered);
          const accuracy = total > 0 ? Math.round((mastered / total) * 100) : 0;
          const state: 1 | 2 | 3 = allCleared ? 2 : (mastered > 0 ? 1 : 3);
          const leftLabel = state === 2 ? '查看题集' : (state === 1 ? '继续挑战' : '开始挑战');
          return (
            <div
              key={lv.id}
              className={cn(
                'relative aspect-square rounded-2xl border-2 border-sky-400 bg-white',
                'hover:shadow-lg hover:scale-[1.03] active:scale-[0.98] transition-all',
                'flex flex-col p-3'
              )}
            >
              {allCleared && (
                <span className="absolute top-1.5 right-1.5 min-w-5 h-5 px-1.5 flex items-center justify-center bg-emerald-500 text-white text-[10px] font-bold rounded-full">
                  ✓
                </span>
              )}
              {/* ① 左上角学科标签 + 右上角icon */}
              <div className="flex items-center justify-between mb-1">
                <span className={cn('px-1.5 py-0.5 rounded-md text-[9px] font-medium', subjectColor(lv.subject || '关卡'))}>{lv.subject || '关卡'}</span>
                <Layers className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
              </div>
              {/* 内容区：垂直居中 */}
              <div className="flex-1 flex flex-col justify-center">
                {/* ② 居中标题 + 黄色底色 */}
                <div className="px-2 py-1.5 rounded-lg bg-sky-100 text-center mb-1.5">
                  <h3 className="font-bold text-slate-900 text-base line-clamp-1">{lv.title || `关卡 ${lv.level_no}`}</h3>
                </div>
                {/* 描述文本 */}
                {lv.description && (
                  <p className="text-[10px] text-slate-400 text-center line-clamp-2 mb-1 px-1">{lv.description}</p>
                )}
                {/* ③ 难度分布 */}
                {(lv.easy_count !== undefined || lv.medium_count !== undefined || lv.hard_count !== undefined) && (
                  <div className="flex items-center justify-center gap-1.5 text-[9px]">
                    <span className="text-emerald-500">简 {lv.easy_count ?? 0}</span>
                    <span className="text-amber-500">中 {lv.medium_count ?? 0}</span>
                    <span className="text-red-400">难 {lv.hard_count ?? 0}</span>
                  </div>
                )}
                {/* ④ 进度信息 */}
                {total > 0 && (
                  <div className="mt-1 flex flex-col items-center gap-0.5">
                    <span className={cn('text-[11px] font-bold', allCleared ? 'text-emerald-600' : 'text-slate-700')}>
                      已做 {mastered}/{total}
                    </span>
                    {mastered > 0 && <span className="text-[9px] text-emerald-500">正确率 {accuracy}%</span>}
                    {!allCleared && <span className="text-[9px] text-slate-400">剩 {remaining} 题</span>}
                  </div>
                )}
              </div>
              {/* ⑤ 底部双按钮 */}
              <div className="mt-auto flex gap-1.5 pt-2">
                <button
                  onClick={() => state === 2 ? onViewLevelQuestions(lv.id, lv.title || `关卡 ${lv.level_no}`) : onSelectLevel(lv)}
                  className="flex-1 flex items-center justify-center gap-1 text-[11px] px-1.5 py-1.5 rounded-lg bg-sky-500 text-white hover:bg-sky-600 transition-colors"
                >
                  {state === 2 ? <Eye className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  {leftLabel}
                </button>
                <button
                  onClick={() => setWrongSet({ id: 'standalone:' + lv.id, title: lv.title || `关卡 ${lv.level_no}`, levelId: lv.id })}
                  className="flex-1 flex items-center justify-center gap-1 text-[11px] px-1.5 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
                >
                  <AlertCircle className="w-3 h-3" /> 查看错题
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {wrongSet && (
        <WrongQuestionsModal
          childId={childId}
          setId={wrongSet.id}
          setTitle={wrongSet.title}
          levelId={wrongSet.levelId}
          onClose={() => setWrongSet(null)}
          onRetry={(questionIds) => {
            const id = wrongSet.id;
            const title = wrongSet.title;
            setWrongSet(null);
            onWrongRetry(id, title, questionIds);
          }}
        />
      )}
    </div>
  );
}

// ================================================================
// 错题查看弹窗：展示孩子在某题集中的错题，带错误次数
// ================================================================
function WrongQuestionsModal({ childId, setId, setTitle, levelId, onClose, onRetry }: {
  childId: string;
  setId: string;
  setTitle: string;
  levelId?: string;
  onClose: () => void;
  onRetry: (questionIds: string[]) => void;
}) {
  const [stats, setStats] = useState<WrongQuestionStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // 关卡错题用 levelId 查询，题集错题用 setId 查询
        const data = levelId
          ? await fetchLevelWrongQuestionStats(childId, levelId)
          : await fetchWrongQuestionStats(childId, setId);
        // 只展示有错误记录的题
        setStats(data.filter(s => s.wrong_count > 0));
      } catch {
        setStats([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [childId, setId, levelId]);

  return (
    <Modal open onClose={onClose} title={`${setTitle} - 错题`} size="md">
      {loading ? (
        <Loading />
      ) : stats.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-4xl mb-2">🎉</div>
          <p className="text-sm text-slate-500">没有错题，全部答对了！</p>
        </div>
      ) : (
        <>
          <div className="space-y-2 max-h-[55vh] overflow-y-auto">
            {stats.map(s => (
              <div key={s.question_id} className="relative p-3 rounded-xl border border-slate-200 bg-slate-50">
                {/* 右上角错误次数 */}
                <span className="absolute top-1.5 right-1.5 min-w-5 h-5 px-1.5 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full">
                  {s.wrong_count}
                </span>
                <p className="text-sm text-slate-800 pr-6 break-words">{s.question_text || '（无题干）'}</p>
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600">错 {s.wrong_count} 次</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">
                    错误率 {Math.round(s.error_rate)}%
                  </span>
                  <span className="text-[10px] text-slate-400">共答 {s.attempt_count} 次</span>
                  {s.is_mastered && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600">已掌握</span>
                  )}
                </div>
                {s.correct_count > 0 && (
                  <p className="text-[10px] text-emerald-500 mt-1">答对 {s.correct_count} 次</p>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="ghost" onClick={onClose} className="flex-1">返回</Button>
            <Button
              onClick={() => onRetry(stats.map(s => s.question_id))}
              className="flex-1"
            >
              再战一次
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ================================================================
// 错题再战播放器：只做错题，答对得星光值，可反复挑战
// ================================================================
function WrongQuestionPlayer({ setId, setTitle, childId, questionIds, onBack }: {
  setId: string;
  setTitle: string;
  childId: string;
  questionIds: string[];
  onBack: () => void;
}) {
  const isStandaloneLevel = setId.startsWith('standalone:');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<boolean[]>([]);
  const [totalReward, setTotalReward] = useState(0);
  const [showFinal, setShowFinal] = useState(false);
  const toast = useToastStore();
  useChallengeSession(childId, setId, undefined, setTitle);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const all = isStandaloneLevel
          ? await fetchLevelQuestions(setId.replace('standalone:', ''))
          : await fetchQuestions(setId);
        setQuestions(all.filter(q => questionIds.includes(q.id)));
      } catch {
        setQuestions([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [setId, questionIds]);

  const q = questions[idx];

  const handleSubmit = async () => {
    if (!answer.trim() || !q) return;
    setSubmitting(true);
    try {
      const result = await answerQuestion(childId, q.id, answer);
      setIsCorrect(result.is_correct);
      setShowResult(true);
      setResults(prev => [...prev, result.is_correct]);
      setTotalReward(r => r + (result.reward ?? 0));
      if (result.is_correct) playCorrect(); else playWrong();
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
      setShowFinal(true);
    }
  };

  const handleRedo = () => {
    setIdx(0);
    setAnswer('');
    setShowResult(false);
    setResults([]);
    setTotalReward(0);
    setShowFinal(false);
  };

  if (loading) return <Loading />;

  if (questions.length === 0) {
    return (
      <div className="max-w-2xl mx-auto -mt-6">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-bold text-slate-800">{setTitle} - 错题再战</h2>
        </div>
        <EmptyState icon="🎉" title="没有错题" description="全部答对了！" />
      </div>
    );
  }

  // 最终结果
  if (showFinal) {
    const correctCount = results.filter(Boolean).length;
    const wrongCount = results.length - correctCount;
    return (
      <div className="max-w-2xl mx-auto -mt-6">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-bold text-slate-800">{setTitle} - 再战结果</h2>
        </div>
        <Card className="p-6 text-center bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-100">
          <div className="text-5xl mb-3">{correctCount === results.length ? '🎉' : '💪'}</div>
          <div className="text-4xl font-bold text-emerald-500 mb-1">
            {results.length > 0 ? Math.round((correctCount / results.length) * 100) : 0}%
          </div>
          <p className="text-sm text-slate-500">
            答对 {correctCount} 题，答错 {wrongCount} 题
          </p>
          {totalReward > 0 && (
            <span className="inline-block mt-3 px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-sm font-medium">
              ⭐ +{totalReward} 星光值
            </span>
          )}
        </Card>
        <div className="flex gap-2 mt-4">
          <Button variant="ghost" onClick={onBack} className="flex-1">返回</Button>
          <Button onClick={handleRedo} className="flex-1">再战一次</Button>
        </div>
      </div>
    );
  }

  if (!q) return <EmptyState icon="❓" title="暂无题目" description="" />;

  return (
    <div className="max-w-2xl mx-auto -mt-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-bold text-slate-800">{setTitle} - 错题再战</h2>
        <span className="ml-auto text-sm text-slate-400">{idx + 1}/{questions.length}</span>
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
                  <span className="flex-1">{opt.replace(/^[A-H][.、]\s*/, '')}</span>
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
              {idx < questions.length - 1 ? '下一题' : '查看再战结果'}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

// ================================================================
// 错题混战播放器：从错题混战池中抽题作答，答对得星光值
// ================================================================
function WrongBattlePlayer({ childId, onBack }: {
  childId: string;
  onBack: () => void;
}) {
  const [pool, setPool] = useState<WrongBattlePoolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<boolean[]>([]);
  const [totalReward, setTotalReward] = useState(0);
  const [showFinal, setShowFinal] = useState(false);
  const toast = useToastStore();
  useChallengeSession(childId, undefined, undefined, '错题大混战');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await fetchWrongBattlePool(childId);
        setPool(data);
      } catch {
        setPool([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [childId]);

  const q = pool[idx];

  const handleSubmit = async () => {
    if (!answer.trim() || !q) return;
    setSubmitting(true);
    try {
      const result = await answerQuestion(childId, q.question_id, answer);
      setIsCorrect(result.is_correct);
      setShowResult(true);
      setResults(prev => [...prev, result.is_correct]);
      setTotalReward(r => r + (result.reward ?? 0));
      if (result.is_correct) playCorrect(); else playWrong();
      if (result.is_correct) {
        toast.success(`答对了！+${result.reward} 星光值`);
      } else {
        toast.error('答错了，继续加油');
      }
    } catch (e: any) {
      toast.error(e?.message ?? '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleNext = () => {
    if (idx < pool.length - 1) {
      setAnswer('');
      setShowResult(false);
      setIdx(i => i + 1);
    } else {
      setShowFinal(true);
    }
  };

  const handleRedo = async () => {
    setLoading(true);
    try {
      const data = await fetchWrongBattlePool(childId);
      setPool(data);
    } catch {
      setPool([]);
    } finally {
      setLoading(false);
    }
    setIdx(0);
    setAnswer('');
    setShowResult(false);
    setResults([]);
    setTotalReward(0);
    setShowFinal(false);
  };

  if (loading) return <Loading />;

  if (pool.length === 0) {
    return (
      <div className="max-w-2xl mx-auto -mt-6">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-bold text-slate-800">错题混战池</h2>
        </div>
        <EmptyState icon="🎉" title="混战池为空" description="家长还没添加错题到混战池，做完其他题集的错题后再来看看吧！" />
      </div>
    );
  }

  // 最终结果
  if (showFinal) {
    const correctCount = results.filter(Boolean).length;
    const wrongCount = results.length - correctCount;
    return (
      <div className="max-w-2xl mx-auto -mt-6">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-bold text-slate-800">混战结果</h2>
        </div>
        <Card className="p-6 text-center bg-gradient-to-br from-purple-50 to-pink-50 border-purple-100">
          <div className="text-5xl mb-3">{correctCount === results.length ? '🏆' : '💪'}</div>
          <div className="text-4xl font-bold text-purple-500 mb-1">
            {results.length > 0 ? Math.round((correctCount / results.length) * 100) : 0}%
          </div>
          <p className="text-sm text-slate-500">
            答对 {correctCount} 题，答错 {wrongCount} 题
          </p>
          {totalReward > 0 && (
            <span className="inline-block mt-3 px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-sm font-medium">
              ⭐ +{totalReward} 星光值
            </span>
          )}
        </Card>
        <div className="flex gap-2 mt-4">
          <Button variant="ghost" onClick={onBack} className="flex-1">返回</Button>
          <Button onClick={handleRedo} className="flex-1">再战一轮</Button>
        </div>
      </div>
    );
  }

  if (!q) return <EmptyState icon="❓" title="暂无题目" description="" />;

  return (
    <div className="max-w-2xl mx-auto -mt-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-bold text-slate-800">⚔️ 错题混战</h2>
        <span className="ml-auto text-sm text-slate-400">{idx + 1}/{pool.length}</span>
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
                  <span className="flex-1">{opt.replace(/^[A-H][.、]\s*/, '')}</span>
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
              {idx < pool.length - 1 ? '下一题' : '查看混战结果'}
            </Button>
          )}
        </div>
      </Card>
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
  onWrongRetry: (setId: string, setTitle: string, questionIds: string[]) => void;
}) {
  const sortedLevels = [...levels].sort((a, b) => (a.sort_order ?? a.level_no) - (b.sort_order ?? b.level_no));

  // 判断每个关卡是否解锁：第1关总是解锁，第N关需要前一个关卡 is_cleared
  const isLevelUnlocked = (idx: number): boolean => {
    if (idx === 0) return true;
    return sortedLevels[idx - 1]?.is_cleared ?? false;
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
          {sortedLevels.map((level, idx) => {
            const unlocked = isLevelUnlocked(idx);
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
                   unlocked ? <span className="text-lg font-bold">{idx + 1}</span> :
                   <Lock className="w-5 h-5" />}
                </div>

                {/* 关卡信息 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-slate-800 text-sm">
                      {level.title || `第 ${idx + 1} 关`}
                    </h3>
                    {allDone && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-600">已通关</span>
                    )}
                  </div>
                  {level.description && (
                    <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">{level.description}</p>
                  )}
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
          <KnowledgePointsButton points={set.knowledge_points} images={set.knowledge_points_images} label="查看知识点" />
        </div>
      )}
    </div>
  );
}

// ================================================================
// 关卡答题组件（新流程）：消题/错题循环/关卡解锁
// ================================================================
function LevelPlayer({ set, levelId, levelInfo, allLevels, childId, board, restoreSnapshot = null, onBack, onDone, onLevelCleared, onWrongRetry }: {
  set: ChallengeSet;
  levelId: string;
  levelInfo?: LevelWithProgress;
  allLevels: LevelWithProgress[];
  childId: string;
  board: ChallengeBoardType;
  restoreSnapshot: import('../../store/challengeUiStore').LevelSnapshotState | null;
  onBack: () => void;
  onDone: () => void;
  onLevelCleared: (nextLevelId?: string) => void;
  onWrongRetry: (setId: string, setTitle: string, questionIds: string[]) => void;
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
  // 本轮题目列表（固定，本轮内不缩小，避免 currentIdx 跳过未答题）
  const [roundQuestions, setRoundQuestions] = useState<Question[]>([]);

  const [loading, setLoading] = useState(!restoreSnapshot);
  const [answer, setAnswer] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resultQuestion, setResultQuestion] = useState<Question | null>(null);
  const [levelCleared, setLevelCleared] = useState(false);
  const [levelBonus, setLevelBonus] = useState(0);

  const restoredRef = useRef(!!restoreSnapshot);
  const snapshotInitRef = useRef(false);

  // 加载关卡题目
  useEffect(() => {
    if (restoredRef.current) {
      restoredRef.current = false;
      // 从快照恢复本轮题目列表
      if (restoreSnapshot?.questions?.length) {
        setRoundQuestions(restoreSnapshot.questions);
        setAllQuestions(restoreSnapshot.questions);
      }
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
          // 初始化本轮题目（排除已消题）
          setRoundQuestions(data.filter(q => !snap.cleared_question_ids.includes(q.id)));
        } else {
          setRoundQuestions(data);
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
        questions: roundQuestions,
        clearedIds,
        currentIdx,
        results,
        totalReward,
        showRoundResult,
      });
    } else {
      patchLevelSnapshot({
        clearedIds, currentIdx, results, totalReward, showRoundResult,
        questions: roundQuestions,
      });
    }
    // 服务端快照（非今日复习板需要保存暂停态）
    saveLevelSnapshot(childId, levelId, currentIdx, clearedIds, board !== 'today_review').catch(() => {});
  }, [clearedIds, currentIdx, results, totalReward, showRoundResult, roundQuestions, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // 剩余题目 = 原始题 - 已消题（用于通关判断）
  const originalTotal = allQuestions.length; // 正确率分母：关卡原始总题数
  // 答题中：showResult 时用 resultQuestion（锁定的题目），避免消题后 q 漏出下一题答案
  const q = showResult && resultQuestion ? resultQuestion : roundQuestions[currentIdx];

  const handleSubmit = async () => {
    if (!answer.trim() || !q) return;
    setSubmitting(true);
    setResultQuestion(q); // 锁定当前题目，防止消题后 q 指向下一题
    try {
      const result = await answerQuestion(childId, q.id, answer);
      setIsCorrect(result.is_correct);
      setShowResult(true);
      onDone();
      setResults(prev => [...prev, result.is_correct]);
      setTotalReward(r => r + (result.reward ?? 0));
      if (result.is_correct) playCorrect(); else playWrong();
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
    setResultQuestion(null);
    if (currentIdx < roundQuestions.length - 1) {
      setCurrentIdx(i => i + 1);
    } else {
      // 本轮做完，检查是否全部消题
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
    // clearedIds 已包含答对的题，重新生成 roundQuestions 只含错题
    const newRound = allQuestions.filter(q => !clearedIds.includes(q.id));
    setRoundQuestions(newRound);
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

  // 关卡清零 → 发奖 → 展示通关页（不立即跳转）
  const handleLevelClear = async () => {
    try {
      const result = await finishChallengeLevel(childId, levelId);
      if (result.level_awarded) {
        setLevelBonus(result.level_reward ?? 0);
        onDone();
      }
      if (result.set_awarded) {
        toast.success(`🏆 题集全部通关！额外 +${result.set_reward} 星光值`);
        onDone();
      }
      setLevelCleared(true); // 展示通关页，等待用户选择
    } catch (e: any) {
      toast.error(e?.message ?? '通关发奖失败');
    }
  };

  const [showLevelDesc, setShowLevelDesc] = useState(false);
  const [showViewQuestions, setShowViewQuestions] = useState(false);

  if (loading) return <Loading />;

  // 只读题目查看模式
  if (showViewQuestions) {
    return (
      <ReadOnlyQuestionsView
        questions={allQuestions}
        title={levelInfo?.title || set.title}
        onBack={() => setShowViewQuestions(false)}
      />
    );
  }

  // 关卡已全部通关
  if (levelCleared && originalTotal > 0 && clearedIds.length >= originalTotal) {
    // 计算下一关
    const sortedLevels = [...allLevels].sort((a, b) => (a.sort_order ?? a.level_no) - (b.sort_order ?? b.level_no));
    const currentIdx = sortedLevels.findIndex(l => l.id === levelId);
    const nextLevel = currentIdx >= 0 && currentIdx < sortedLevels.length - 1 ? sortedLevels[currentIdx + 1] : undefined;
    const isLastLevel = !nextLevel;

    return (
      <div className="max-w-2xl mx-auto -mt-6">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => onLevelCleared()} className="p-2 hover:bg-slate-100 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-bold text-slate-800">{set.title}</h2>
        </div>
        <Card className="p-8 text-center bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-100">
          <div className="text-6xl mb-3">{isLastLevel ? '🏆' : '🎉'}</div>
          <h3 className="text-2xl font-bold text-slate-800 mb-2">
            {isLastLevel ? '题集全部通关！' : '关卡通关！'}
          </h3>
          <p className="text-sm text-slate-500 mb-6">
            {levelInfo?.title || `第 ${levelInfo?.level_no ?? 1} 关`} 全部清零
          </p>
          {levelBonus > 0 && (
            <span className="inline-block mb-4 px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-sm font-medium">
              ⭐ +{levelBonus} 星光值
            </span>
          )}
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => onLevelCleared()} className="flex-1">返回关卡列表</Button>
            {!isLastLevel && nextLevel && (
              <Button onClick={() => onLevelCleared(nextLevel.id)} className="flex-1">挑战下一关</Button>
            )}
          </div>
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
    // 关卡题目已全部消除完毕 → 展示空状态 + 挑战错题 + 查看题目
    return (
      <ClearedEmptyState
        title={levelInfo?.title || set.title}
        onBack={onBack}
        onChallengeWrong={() => {
          // 异步获取该关卡的错题 ID，进入错题再战
          (async () => {
            try {
              const stats = await fetchLevelWrongQuestionStats(childId, levelId);
              if (stats.length === 0) {
                toast.info('暂无错题记录');
                return;
              }
              onWrongRetry('standalone:' + levelId, levelInfo?.title || set.title, stats.map(s => s.question_id));
            } catch {
              toast.error('获取错题失败');
            }
          })();
        }}
        onViewQuestions={() => setShowViewQuestions(true)}
      />
    );
  }

  return (
    <div className="max-w-2xl mx-auto -mt-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-bold text-slate-800">{set.title}</h2>
        {levelInfo?.description && (
          <button
            onClick={() => setShowLevelDesc(s => !s)}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"
            title="查看关卡说明"
          >
            <Lightbulb className="w-4 h-4" />
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {set.knowledge_points?.trim() && <KnowledgePointsButton points={set.knowledge_points} images={set.knowledge_points_images} />}
          <span className="text-sm text-slate-400">
            {currentIdx + 1}/{roundQuestions.length}
          </span>
        </div>
      </div>

      {/* 关卡描述展开 */}
      {showLevelDesc && levelInfo?.description && (
        <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-100">
          <div className="flex items-start gap-2">
            <Lightbulb className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-amber-700 mb-0.5">{levelInfo.title || `第 ${levelInfo.level_no} 关`}</p>
              <p className="text-sm text-amber-900">{levelInfo.description}</p>
            </div>
          </div>
        </div>
      )}

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
              {currentIdx < roundQuestions.length - 1 ? '下一题' : '查看本轮结果'}
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
function KnowledgePointsButton({ points, images, label = '查看知识点' }: { points: string; images?: string[] | null; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-2 rounded-full bg-amber-100 text-amber-600 hover:bg-amber-200 transition-colors fixed top-4 right-4 z-30"
        title={label}
      >
        <Lightbulb className="w-5 h-5" />
      </button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title="知识点" size="md">
          <div className="space-y-3">
            {points && (
              <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans bg-amber-50 p-4 rounded-xl">
                {points}
              </pre>
            )}
            {images && images.length > 0 && (
              <div className="space-y-2">
                {images.map((url, i) => (
                  <img key={i} src={url} alt={`知识点图 ${i + 1}`} className="w-full rounded-xl border border-amber-100" />
                ))}
              </div>
            )}
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
function ChallengePlayer({ set, childId, onBack, onDone, started: startedProp = false, restoreSnapshot = null, onWrongRetry }: {
  set: ChallengeSet;
  childId: string;
  onBack: () => void;
  onDone: () => void;
  started?: boolean;
  restoreSnapshot: import('../../store/challengeUiStore').PlayerSnapshot | null;
  onWrongRetry: (setId: string, setTitle: string, questionIds: string[]) => void;
}) {
  const setStoreActive = useChallengeUiStore(s => s.setActive);
  const setStoreSnapshot = useChallengeUiStore(s => s.setSnapshot);
  const patchStoreSnapshot = useChallengeUiStore(s => s.patchSnapshot);
  const clearAll = useChallengeUiStore(s => s.clear);
  const toast = useToastStore();

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

  const [showViewQuestions, setShowViewQuestions] = useState(false);
  const [viewQuestions, setViewQuestions] = useState<Question[]>([]);

  if (loading) return <Loading />;

  // 只读题目查看模式
  if (showViewQuestions) {
    return (
      <ReadOnlyQuestionsView
        questions={viewQuestions}
        title={set.title}
        onBack={() => setShowViewQuestions(false)}
      />
    );
  }

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
    // 题集题目已全部消除完毕 → 展示空状态 + 挑战错题 + 查看题目
    return (
      <ClearedEmptyState
        title={set.title}
        onBack={handleChallengeEnd}
        onChallengeWrong={() => {
          (async () => {
            try {
              const stats = await fetchWrongQuestionStats(childId, set.id);
              if (stats.length === 0) {
                toast.info('暂无错题记录');
                return;
              }
              onWrongRetry(set.id, set.title, stats.map(s => s.question_id));
            } catch {
              toast.error('获取错题失败');
            }
          })();
        }}
        onViewQuestions={async () => {
          try {
            const all = await fetchQuestions(set.id);
            setViewQuestions(all);
            setShowViewQuestions(true);
          } catch {
            toast.error('加载题目失败');
          }
        }}
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
        {set.knowledge_points && (
          <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans bg-white/60 p-4 rounded-xl mb-3">
            {set.knowledge_points}
          </pre>
        )}
        {set.knowledge_points_images && set.knowledge_points_images.length > 0 && (
          <div className="space-y-2 mb-3">
            {set.knowledge_points_images.map((url, i) => (
              <img key={i} src={url} alt={`知识点图 ${i + 1}`} className="w-full rounded-xl border border-amber-100" />
            ))}
          </div>
        )}
        <div className="flex gap-2 mt-4">
          <Button variant="ghost" onClick={onBack} className="flex-1">返回</Button>
          <Button onClick={onStart} className="flex-1">我已学会</Button>
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
  useChallengeSession(childId, set.id, undefined, set.title);

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
          {set.knowledge_points?.trim() && <KnowledgePointsButton points={set.knowledge_points} images={set.knowledge_points_images} />}
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
                  <span className="flex-1">{opt.replace(/^[A-H][.、]\s*/, '')}</span>
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

// ====== 已全部消除完毕的空状态：暂无可挑战题目 + 挑战错题 + 查看题目 ======
function ClearedEmptyState({ title, onBack, onChallengeWrong, onViewQuestions }: {
  title: string;
  onBack: () => void;
  onChallengeWrong: () => void;
  onViewQuestions: () => void;
}) {
  return (
    <div className="max-w-2xl mx-auto -mt-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-bold text-slate-800">{title}</h2>
      </div>
      <Card className="p-8 text-center bg-gradient-to-br from-slate-50 to-slate-100 border-slate-200">
        <div className="text-5xl mb-3">📭</div>
        <h3 className="text-lg font-bold text-slate-700 mb-2">暂无可挑战题目</h3>
        <p className="text-sm text-slate-400 mb-6">本关卡/题集的全部题目已消除完成</p>
        <div className="flex gap-3">
          <Button variant="ghost" onClick={onChallengeWrong} className="flex-1">
            <AlertCircle className="w-4 h-4" /> 挑战错题
          </Button>
          <Button onClick={onViewQuestions} className="flex-1">
            <Eye className="w-4 h-4" /> 查看题目
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ====== 只读题目查看器：展示全部题目、正确答案与解析，不可答题 ======
function ReadOnlyQuestionsView({ questions, title, onBack }: {
  questions: Question[];
  title: string;
  onBack: () => void;
}) {
  return (
    <div className="max-w-2xl mx-auto -mt-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-bold text-slate-800">{title} - 题目一览</h2>
      </div>
      {questions.length === 0 ? (
        <EmptyState icon="📋" title="暂无题目" description="" />
      ) : (
        <div className="space-y-3">
          {questions.map((q, i) => (
            <Card key={q.id} className="p-4">
              <div className="flex items-start gap-2">
                <span className="text-xs font-bold text-slate-400 flex-shrink-0 mt-0.5">Q{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-800 font-medium break-words">{q.question_text}</p>
                  {q.options && q.options.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {q.options.map((opt, oi) => (
                        <div key={oi} className={cn(
                          'text-xs px-2 py-1 rounded',
                          opt === q.correct_answer
                            ? 'bg-emerald-50 text-emerald-600 font-medium'
                            : 'text-slate-500'
                        )}>
                          {String.fromCharCode(65 + oi)}. {opt}
                          {opt === q.correct_answer && <span className="ml-1">✓</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {q.type !== 'choice' && q.type !== 'multi_choice' && (
                    <div className="mt-2 text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-600 font-medium inline-block">
                      正确答案：{q.correct_answer}
                    </div>
                  )}
                  {q.explanation && (
                    <div className="mt-2 text-xs text-slate-400 bg-slate-50 rounded p-2">
                      <Lightbulb className="w-3 h-3 inline-block mr-1" />
                      {q.explanation}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <div className="mt-4">
        <Button variant="ghost" onClick={onBack} className="w-full">
          <ArrowLeft className="w-4 h-4" /> 返回
        </Button>
      </div>
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
  useChallengeSession(childId, set.id, undefined, set.title);

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
          {set.knowledge_points?.trim() && <KnowledgePointsButton points={set.knowledge_points} images={set.knowledge_points_images} />}
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
                    <button key={i} onClick={() => { if (!showResult) { playClick(); setAnswer(opt); } }}
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
