import { useState, useEffect } from 'react';
import { useFamilyStore } from '../../store/familyStore';
import { useModeStore } from '../../store/modeStore';
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
  answerQuestion, answerWord, fetchWrongQuestions, reviewWrongQuestion,
} from '../../api/challenges';
import type { ChallengeSet, Question, Word, WordQuestionType, ChallengeSetType, WrongQuestion, Difficulty } from '../../api/types';

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

  const [sets, setSets] = useState<ChallengeSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSet, setActiveSet] = useState<ChallengeSet | null>(null);
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

  if (activeSet) {
    return <ChallengePlayer set={activeSet} childId={child?.id ?? ''} onBack={() => setActiveSet(null)} onDone={refreshMembers} />;
  }

  return (
    <div className="max-w-4xl mx-auto -mt-6">
      {/* 错题本常驻入口 */}
      <Card
        className="p-4 mb-4 cursor-pointer hover:shadow-lg transition-shadow bg-gradient-to-r from-red-50 to-orange-50 border-red-100"
        onClick={() => setShowWrongBook(true)}
      >
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-400 to-orange-400 flex items-center justify-center text-white">
            <BookX className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-slate-800">错题本</h3>
            <p className="text-sm text-slate-400">复习错题，答对2次即可移除</p>
          </div>
          {wrongCount > 0 && (
            <span className="min-w-6 h-6 px-2 flex items-center justify-center bg-red-500 text-white text-xs font-bold rounded-full">
              {wrongCount}
            </span>
          )}
        </div>
      </Card>

      {sets.length === 0 ? (
        <EmptyState icon="📚" title="暂无挑战赛" description="家长还没发布题集哦" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sets.map(set => {
            const cfg = TYPE_CONFIG[set.type];
            return (
              <Card key={set.id} className="p-4 cursor-pointer hover:shadow-lg transition-shadow" onClick={() => setActiveSet(set)}>
                <div className="flex items-start gap-3">
                  <div className={cn('w-14 h-14 rounded-2xl bg-gradient-to-br flex items-center justify-center text-white', cfg.color)}>
                    {cfg.icon}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-slate-800 text-lg">{set.title}</h3>
                    {set.description && <p className="text-sm text-slate-400 mt-0.5">{set.description}</p>}
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">简+{set.reward_easy}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600">中+{set.reward_medium}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600">困+{set.reward_hard}</span>
                      <span className="text-xs text-slate-400">{cfg.label}</span>
                    </div>
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

// ====== 答题主组件 ======
function ChallengePlayer({ set, childId, onBack, onDone }: {
  set: ChallengeSet; childId: string; onBack: () => void; onDone: () => void;
}) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [words, setWords] = useState<(Word & { progress?: any })[]>([]);
  const [loading, setLoading] = useState(true);
  const [started, setStarted] = useState(false);
  // null = 未选择难度；'all' = 全选；'easy'/'medium'/'hard' = 单一难度
  const [difficulty, setDifficulty] = useState<'all' | Difficulty | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        if (set.type === 'word_vocab') {
          const data = await fetchWordProgress(childId, set.id);
          setWords(data);
        } else {
          setQuestions(await fetchQuestions(set.id));
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [set.id, childId]);

  if (loading) return <Loading />;

  const hasKnowledge = !!set.knowledge_points?.trim();

  // 答题前预览知识点
  if (!started && hasKnowledge) {
    return (
      <KnowledgePreview
        set={set}
        onStart={() => setStarted(true)}
        onBack={onBack}
      />
    );
  }

  // 单词背诵无难度分级，直接答题
  if (set.type === 'word_vocab') {
    return <WordPlayer set={set} words={words} childId={childId} onBack={onBack} onDone={onDone} />;
  }

  // 选择题/数学题：选择难度
  if (difficulty === null) {
    return (
      <DifficultySelection
        set={set}
        questions={questions}
        onSelect={(d) => setDifficulty(d)}
        onBack={onBack}
      />
    );
  }

  // 按难度过滤题目；全选时按简单→中等→困难顺序排列，循序渐进
  const diffRank: Record<string, number> = { easy: 0, medium: 1, hard: 2 };
  const filtered = difficulty === 'all'
    ? [...questions].sort((a, b) => (diffRank[a.difficulty] ?? 3) - (diffRank[b.difficulty] ?? 3))
    : questions.filter(q => q.difficulty === difficulty);

  if (filtered.length === 0) {
    return <EmptyState icon="📭" title="该难度暂无题目" description="请选择其他难度" />;
  }

  return <QuestionPlayer set={set} questions={filtered} childId={childId} onBack={onBack} onDone={onDone} />;
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

// ====== 难度选择 ======
function DifficultySelection({ set, questions, onSelect, onBack }: {
  set: ChallengeSet;
  questions: Question[];
  onSelect: (d: 'all' | Difficulty) => void;
  onBack: () => void;
}) {
  const easyCount = questions.filter(q => q.difficulty === 'easy').length;
  const mediumCount = questions.filter(q => q.difficulty === 'medium').length;
  const hardCount = questions.filter(q => q.difficulty === 'hard').length;
  const totalCount = questions.length;

  const options: Array<{
    key: 'all' | Difficulty;
    label: string;
    reward: number;
    count: number;
    color: string;
    icon: string;
    desc: string;
  }> = [
    { key: 'easy', label: '简单', reward: set.reward_easy, count: easyCount, color: 'from-emerald-400 to-green-400', icon: '🌱', desc: '基础题，轻松拿分' },
    { key: 'medium', label: '中等', reward: set.reward_medium, count: mediumCount, color: 'from-amber-400 to-orange-400', icon: '⭐', desc: '进阶题，稳步提升' },
    { key: 'hard', label: '困难', reward: set.reward_hard, count: hardCount, color: 'from-red-400 to-rose-400', icon: '🔥', desc: '挑战题，高额奖励' },
    { key: 'all', label: '全选', reward: 0, count: totalCount, color: 'from-purple-400 to-indigo-400', icon: '🎯', desc: '所有难度混合挑战' },
  ];

  return (
    <div className="max-w-2xl mx-auto -mt-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-bold text-slate-800">{set.title}</h2>
      </div>

      <Card className="p-6 mb-4 bg-gradient-to-br from-slate-50 to-slate-100">
        <h3 className="text-lg font-bold text-slate-800 text-center">选择答题难度</h3>
        <p className="text-sm text-slate-400 text-center mt-1">不同难度奖励不同星光值</p>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        {options.map(opt => {
          const disabled = opt.count === 0;
          return (
            <button
              key={opt.key}
              onClick={() => !disabled && onSelect(opt.key)}
              disabled={disabled}
              className={cn(
                'relative p-4 rounded-2xl border-2 text-left transition-all',
                disabled ? 'border-slate-200 opacity-50 cursor-not-allowed' : 'border-slate-200 hover:border-star-300 hover:shadow-lg'
              )}
            >
              <div className={cn('w-12 h-12 rounded-xl bg-gradient-to-br flex items-center justify-center text-2xl mb-2', opt.color)}>
                {opt.icon}
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-800">{opt.label}</span>
                {opt.key !== 'all' && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-star-100 text-star-600 font-medium">
                    +{opt.reward}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">{opt.desc}</p>
              <div className="flex items-center gap-1 mt-2">
                <span className="text-xs text-slate-500">{opt.count} 题</span>
                {opt.key === 'all' && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-purple-50 text-purple-600">混合奖励</span>
                )}
              </div>
              {disabled && (
                <span className="absolute top-2 right-2 text-xs text-slate-400">暂无</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ====== 选择题/数学题 答题 ======
function QuestionPlayer({ set, questions, childId, onBack, onDone }: {
  set: ChallengeSet; questions: Question[]; childId: string; onBack: () => void; onDone: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const toast = useToastStore();

  const q = questions[idx];

  const handleSubmit = async () => {
    if (!answer.trim()) return;
    setSubmitting(true);
    try {
      const result = await answerQuestion(childId, q.id, answer);
      setIsCorrect(result.is_correct);
      setShowResult(true);
      onDone();
      if (result.is_correct) {
        toast.success(`答对了！+${result.reward} 星光值`);
      } else {
        toast.error('答错了，已加入错题本');
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
    setIdx(i => (i + 1) % questions.length);
  };

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
                  <span className="flex-1">{opt.replace(/^[A-D][.、\s]*/, '')}</span>
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
              {idx < questions.length - 1 ? '下一题' : '再做一遍'}
            </Button>
          )}
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

function WordPlayer({ set, words, childId, onBack, onDone }: {
  set: ChallengeSet; words: (Word & { progress?: any })[]; childId: string; onBack: () => void; onDone: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [stage, setStage] = useState<'familiar' | 'quiz'>('familiar');
  const [quizType, setQuizType] = useState<WordQuestionType>('en2cn');
  const [options, setOptions] = useState<string[]>([]);
  const [answer, setAnswer] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const toast = useToastStore();

  const word = words[idx];
  const progress = word?.progress;
  const mastered = progress?.is_mastered;

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
        toast.error('答错了，已加入错题本');
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
