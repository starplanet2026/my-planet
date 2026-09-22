import { useState, useEffect, useCallback } from 'react';
import { Modal } from '../../../../components/common/Modal';
import { Button } from '../../../../components/common/Button';
import { Loading } from '../../../../components/common/Loading';
import { useToastStore } from '../../../../store/toastStore';
import { useFamilyStore } from '../../../../store/familyStore';
import { cn } from '../../../../lib/utils';
import { supabase } from '../../../../api/client';
import { completePetLevelup } from '../../../../api/pets';
import type { Pet } from '../../../../api/types';

// 升级挑战所需题目数
const QUIZ_QUESTION_COUNT = 5;
// 通过分数线
const PASS_THRESHOLD = 0.8;

// 统一题面结构（题库随机题）
interface QuizItem {
  id: string;
  type: string;
  question_text: string;
  options: string[] | null;
  correct_answer: string;
  explanation: string | null;
}

export function PetLevelUpQuiz({
  pet,
  memberId,
  onClose,
  onLevelUp,
}: {
  pet: Pet;
  memberId: string;
  onClose: () => void;
  onLevelUp: (updated: Pet) => void;
}) {
  const toast = useToastStore();
  const family = useFamilyStore(s => s.family);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [questions, setQuestions] = useState<QuizItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<{ correct: number; total: number; passed: boolean } | null>(null);

  const shuffle = <T,>(arr: T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const loadQuestions = useCallback(async () => {
    setLoading(true);
    try {
      const picked: QuizItem[] = [];

      // 从所有题集中随机抽题（错题本已下线，升级挑战只用随机题库）
      if (family) {
        const { data: sets, error: setsErr } = await supabase
          .from('challenge_sets')
          .select('id');
        if (setsErr) throw setsErr;

        const setIds = (sets ?? []).map((s: any) => s.id).filter(Boolean);
        if (setIds.length > 0) {
          const { data: randRows, error: qErr } = await supabase
            .from('questions')
            .select('id, type, question_text, options, correct_answer, explanation')
            .in('challenge_set_id', setIds)
            .order('created_at', { ascending: false })
            .limit(50);

          if (qErr) throw qErr;

          const randomQs: QuizItem[] = (randRows ?? [])
            .filter((r: any) => r && r.question_text)
            .map((q: any) => ({
              id: q.id as string,
              type: q.type as string,
              question_text: q.question_text as string,
              options: q.options as string[] | null,
              correct_answer: q.correct_answer as string,
              explanation: (q.explanation ?? null) as string | null,
            }));

          picked.push(...shuffle(randomQs).slice(0, QUIZ_QUESTION_COUNT));
        }
      }

      // 兜底：题库不足 5 道，就把已有的全部展示
      setQuestions(picked.length > 0 ? picked : []);
      setCurrentIndex(0);
      setAnswers({});
      setRevealed({});
      setResult(null);
    } catch (e: any) {
      toast.error(e?.message ?? '加载题目失败');
    } finally {
      setLoading(false);
    }
  }, [memberId, family, toast]);

  useEffect(() => {
    loadQuestions();
  }, [loadQuestions]);

  const current = questions[currentIndex];

  const isChoiceLike = (q: QuizItem | undefined) =>
    !!q && (q.type === 'choice' || q.type === 'multi_choice') && Array.isArray(q.options) && q.options.length > 0;

  const handleAnswer = (qid: string, value: string) => {
    if (revealed[qid]) return;
    setAnswers(prev => ({ ...prev, [qid]: value }));
  };

  const handleConfirm = () => {
    if (!current) return;
    setRevealed(prev => ({ ...prev, [current.id]: true }));
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(i => i + 1);
    } else {
      // 提交判分
      const correctCount = questions.reduce((acc, q) => {
        const userAns = (answers[q.id] ?? '').trim();
        return acc + (userAns && userAns === q.correct_answer ? 1 : 0);
      }, 0);
      const passed = correctCount / questions.length >= PASS_THRESHOLD;
      setResult({ correct: correctCount, total: questions.length, passed });
    }
  };

  const handleRetry = async () => {
    await loadQuestions();
  };

  const handleCompleteLevelup = async () => {
    setSubmitting(true);
    try {
      const updated = await completePetLevelup(memberId, pet.id);
      toast.success(`升级成功！Lv.${pet.level} → Lv.${updated.level}，获得10金币`);
      onLevelUp(updated);
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? '升级失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 单题是否答对（用于已揭示时显示对错）
  const isCorrect = (q: QuizItem) => {
    const userAns = (answers[q.id] ?? '').trim();
    return !!userAns && userAns === q.correct_answer;
  };

  return (
    <Modal open onClose={onClose} title="升级挑战" size="md">
      {loading ? (
        <Loading text="加载题目中..." />
      ) : questions.length === 0 ? (
        <div className="py-8 text-center space-y-4">
          <p className="text-sm text-slate-500">暂无可用的挑战题目，请先去答题积累错题。</p>
          <Button variant="secondary" onClick={onClose} fullWidth>关闭</Button>
        </div>
      ) : result ? (
        <div className="space-y-5">
          <div className="text-center py-4">
            <div className={cn(
              'mx-auto w-16 h-16 rounded-full flex items-center justify-center text-3xl mb-3',
              result.passed ? 'bg-emerald-100' : 'bg-amber-100'
            )}>
              {result.passed ? '🎉' : '💪'}
            </div>
            <p className={cn(
              'text-2xl font-bold mb-1',
              result.passed ? 'text-emerald-600' : 'text-amber-600'
            )}>
              {result.passed ? '挑战通过！' : '未通过，再接再厉！'}
            </p>
            <p className="text-sm text-slate-500">
              答对 {result.correct} / {result.total} 题（正确率 {Math.round(result.correct / result.total * 100)}%）
            </p>
            <p className="text-xs text-slate-400 mt-1">
              通过线：{Math.round(PASS_THRESHOLD * 100)}%
            </p>
          </div>

          {result.passed ? (
            <Button
              variant="success"
              fullWidth
              loading={submitting}
              onClick={handleCompleteLevelup}
            >
              领取升级奖励（+10 金币）
            </Button>
          ) : (
            <Button variant="primary" fullWidth onClick={handleRetry}>
              再来一次
            </Button>
          )}
          <Button variant="ghost" fullWidth onClick={onClose}>
            稍后再试
          </Button>
        </div>
      ) : current ? (
        <div className="space-y-4">
          {/* 进度 */}
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>第 {currentIndex + 1} / {questions.length} 题</span>
            <span>随机题</span>
          </div>
          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-400 rounded-full transition-all"
              style={{ width: `${((currentIndex + (revealed[current.id] ? 1 : 0)) / questions.length) * 100}%` }}
            />
          </div>

          {/* 题面 */}
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-700 leading-relaxed">
              {current.question_text}
            </p>
          </div>

          {/* 选项 / 输入 */}
          {isChoiceLike(current) ? (
            <div className="space-y-2">
              {(current.options ?? []).map((opt, idx) => {
                const selected = answers[current.id] === opt;
                const showCorrect = revealed[current.id] && opt === current.correct_answer;
                const showWrong = revealed[current.id] && selected && opt !== current.correct_answer;
                return (
                  <button
                    key={idx}
                    onClick={() => handleAnswer(current.id, opt)}
                    disabled={revealed[current.id]}
                    className={cn(
                      'w-full text-left px-3 py-2.5 rounded-xl border-2 text-sm transition-colors',
                      !revealed[current.id] && selected && 'border-blue-400 bg-blue-50',
                      !revealed[current.id] && !selected && 'border-slate-200 hover:border-slate-300',
                      showCorrect && 'border-emerald-400 bg-emerald-50',
                      showWrong && 'border-red-400 bg-red-50',
                    )}
                  >
                    <span className="font-mono text-xs text-slate-500 mr-2">
                      {String.fromCharCode(65 + idx)}.
                    </span>
                    <span className="text-slate-700">{opt}</span>
                    {showCorrect && <span className="ml-2 text-emerald-600 text-xs">✓ 正确答案</span>}
                    {showWrong && <span className="ml-2 text-red-600 text-xs">✗ 你的选择</span>}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              <input
                type="text"
                value={answers[current.id] ?? ''}
                onChange={e => handleAnswer(current.id, e.target.value)}
                disabled={revealed[current.id]}
                placeholder="请输入答案"
                className={cn(
                  'w-full px-3 py-2.5 rounded-xl border-2 text-sm outline-none transition-colors',
                  revealed[current.id]
                    ? (isCorrect(current)
                        ? 'border-emerald-400 bg-emerald-50'
                        : 'border-red-400 bg-red-50')
                    : 'border-slate-200 focus:border-blue-400'
                )}
              />
              {revealed[current.id] && (
                <p className={cn('text-xs', isCorrect(current) ? 'text-emerald-600' : 'text-red-600')}>
                  {isCorrect(current) ? '✓ 回答正确' : `✗ 正确答案：${current.correct_answer}`}
                </p>
              )}
            </div>
          )}

          {/* 解释 */}
          {revealed[current.id] && current.explanation && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 leading-relaxed">
              💡 {current.explanation}
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex gap-2">
            {!revealed[current.id] ? (
              <Button
                variant="primary"
                fullWidth
                disabled={!answers[current.id]}
                onClick={handleConfirm}
              >
                确认答案
              </Button>
            ) : (
              <Button variant="primary" fullWidth onClick={handleNext}>
                {currentIndex < questions.length - 1 ? '下一题' : '查看结果'}
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
