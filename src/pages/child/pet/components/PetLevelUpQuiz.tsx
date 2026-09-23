import { useState, useEffect, useCallback } from 'react';
import { Modal } from '../../../../components/common/Modal';
import { Button } from '../../../../components/common/Button';
import { Loading } from '../../../../components/common/Loading';
import { useToastStore } from '../../../../store/toastStore';
import { cn } from '../../../../lib/utils';
import { fetchWrongBattlePool } from '../../../../api/challenges';
import { completePetLevelup } from '../../../../api/pets';
import type { Pet } from '../../../../api/types';

// 通过分数线
const PASS_THRESHOLD = 0.8;

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

  // 升级到的目标级别 = 当前级别 + 1，题目数 = 目标级别数
  const targetLevel = pet.level + 1;
  const quizCount = targetLevel;

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [questions, setQuestions] = useState<QuizItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<{ correct: number; total: number; passed: boolean } | null>(null);
  const [poolEmpty, setPoolEmpty] = useState(false);

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
    setPoolEmpty(false);
    try {
      // 从错题混战池获取题目
      const pool = await fetchWrongBattlePool(memberId);
      const poolQuestions: QuizItem[] = (pool ?? [])
        .filter(r => r && r.question_text)
        .map(r => ({
          id: r.question_id,
          type: r.type,
          question_text: r.question_text,
          options: r.options,
          correct_answer: r.correct_answer,
          explanation: r.explanation,
        }));

      if (poolQuestions.length === 0) {
        setPoolEmpty(true);
        setQuestions([]);
        return;
      }

      // 题目数 = 目标级别数，池中不足则全部使用
      const picked = shuffle(poolQuestions).slice(0, quizCount);
      setQuestions(picked);
      setCurrentIndex(0);
      setAnswers({});
      setRevealed({});
      setResult(null);
    } catch (e: any) {
      toast.error(e?.message ?? '加载题目失败');
    } finally {
      setLoading(false);
    }
  }, [memberId, quizCount, toast]);

  useEffect(() => {
    loadQuestions();
  }, [loadQuestions]);

  const current = questions[currentIndex];

  const isChoiceLike = (q: QuizItem | undefined) =>
    !!q && (q.type === 'choice' || q.type === 'multi_choice') && Array.isArray(q.options) && q.options.length > 0;

  const handleAnswer = (qid: string, letter: string, isMulti: boolean) => {
    if (revealed[qid]) return;
    setAnswers(prev => {
      const prevAns = prev[qid] ?? '';
      if (isMulti) {
        const newAns = prevAns.includes(letter) ? prevAns.replace(letter, '') : prevAns + letter;
        return { ...prev, [qid]: newAns };
      }
      return { ...prev, [qid]: letter };
    });
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
        if (!userAns) return acc;
        // 选择题/多选题：比较选项字母（排序后比较）
        if (q.type === 'choice' || q.type === 'multi_choice') {
          const sortStr = (s: string) => s.split('').sort().join('');
          return acc + (sortStr(userAns) === sortStr(q.correct_answer) ? 1 : 0);
        }
        // 填空题：直接比较文本
        return acc + (userAns === q.correct_answer ? 1 : 0);
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
      const reward = (updated.level ?? 1) * 1.25;
      toast.success(`升级成功！Lv.${pet.level} → Lv.${updated.level}，升级奖励 ${reward} 金币`);
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
    if (!userAns) return false;
    if (q.type === 'choice' || q.type === 'multi_choice') {
      const sortStr = (s: string) => s.split('').sort().join('');
      return sortStr(userAns) === sortStr(q.correct_answer);
    }
    return userAns === q.correct_answer;
  };

  return (
    <Modal open onClose={onClose} title="升级挑战" size="md">
      {loading ? (
        <Loading text="加载题目中..." />
      ) : questions.length === 0 || poolEmpty ? (
        <div className="py-8 text-center space-y-4">
          <p className="text-sm text-slate-500">
            {poolEmpty
              ? '错题混战池为空，请先在智慧星战中答错题目，由家长加入混战池后再来挑战。'
              : '暂无足够的挑战题目。'}
          </p>
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
              领取升级奖励（等级×1.25）
            </Button>
          ) : (
            <>
              <Button variant="primary" fullWidth onClick={handleRetry}>
                再来一次
              </Button>
              <Button variant="ghost" fullWidth onClick={onClose}>
                稍后再试
              </Button>
            </>
          )}
        </div>
      ) : current ? (
        <div className="space-y-4">
          {/* 进度 */}
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>第 {currentIndex + 1} / {questions.length} 题（Lv.{pet.level} → Lv.{targetLevel}）</span>
            <span>错题混战</span>
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
                const letter = String.fromCharCode(65 + idx);
                const isMulti = current.type === 'multi_choice';
                const userAns = answers[current.id] ?? '';
                const selected = isMulti ? userAns.includes(letter) : userAns === letter;
                const showCorrect = revealed[current.id] && current.correct_answer.includes(letter);
                const showWrong = revealed[current.id] && selected && !current.correct_answer.includes(letter);
                return (
                  <button
                    key={idx}
                    onClick={() => handleAnswer(current.id, letter, isMulti)}
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
                      {letter}.
                    </span>
                    <span className="text-slate-700">{opt.replace(/^[A-H][.、]\s*/, '')}</span>
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
                onChange={e => handleAnswer(current.id, e.target.value, false)}
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
